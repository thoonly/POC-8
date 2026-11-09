import { AiError } from "../errors";
import { splitSse } from "../json";

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504, 529]);
const MAX_RETRIES = 3;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AiError("ABORTED", "The request was cancelled."));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new AiError("ABORTED", "The request was cancelled.")); }, { once: true });
  });

export interface FetchOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  /** For error messages: "Claude API", "OpenRouter", "Tavily". */
  who: string;
}

/**
 * POST/GET with the CLAUDE.md retry rules:
 *  - transient failures (429, 5xx, 529, network) retry with backoff, at most 3 times;
 *  - a timeout is NEVER retried: it aborts and throws TIMEOUT (a slow call is a big call);
 *  - a caller abort throws ABORTED.
 * Returns the Response (possibly non-2xx on the last try); callers map non-2xx to errors.
 */
export async function fetchWithRetry(url: string, init: RequestInit, opts: FetchOptions): Promise<Response> {
  let lastStatus: Response | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (opts.signal?.aborted) throw new AiError("ABORTED", "The request was cancelled.");
    const timeout = AbortSignal.timeout(opts.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (e) {
      if (opts.signal?.aborted) throw new AiError("ABORTED", "The request was cancelled.");
      // fetch rejects with the signal's reason: a "TimeoutError" DOMException when our timeout fired.
      if (timeout.aborted || (e instanceof Error && e.name === "TimeoutError")) {
        throw new AiError(
          "TIMEOUT",
          `${opts.who} took longer than ${Math.round(opts.timeoutMs / 1000)} s and was stopped. Ask for less in one go, then try again.`,
        );
      }
      if (attempt === MAX_RETRIES) throw new AiError("NETWORK", `Could not reach ${opts.who}. Check the server's connection and try again.`);
      await sleep(backoff(attempt), opts.signal);
      continue;
    }
    if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      lastStatus = res;
      const ra = Number(res.headers.get("retry-after"));
      await res.body?.cancel().catch(() => {});
      await sleep(ra > 0 && ra < 30 ? ra * 1000 : backoff(attempt), opts.signal);
      continue;
    }
    return res;
  }
  // Unreachable in practice (the last attempt returns or throws); keeps TypeScript satisfied.
  if (lastStatus) return lastStatus;
  throw new AiError("NETWORK", `Could not reach ${opts.who}.`);
}

/** 0.8 s, 1.6 s, 3.2 s plus jitter. */
const backoff = (attempt: number) => 800 * 2 ** attempt + Math.random() * 400;

export async function errorDetail(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j?.error?.message || (typeof j?.error === "string" ? j.error : "") || "";
  } catch {
    return "";
  }
}

/** Maps a failed provider response to a message the user can act on. */
export function httpError(provider: "claude" | "openrouter" | "tavily", status: number, detail: string, what = "Request failed."): AiError {
  const hint =
    provider === "claude"
      ? status === 401 ? "The server's Claude API key was rejected. Check ANTHROPIC_API_KEY."
        : status === 404 ? "The Claude API doesn't know this model. Check CLAUDE_MODEL_SMALL / CLAUDE_MODEL_LARGE."
        : status === 429 ? "Claude API rate limit. Wait a moment and try again."
        : status === 529 ? "The Claude API is overloaded. Wait a moment and try again."
        : `Claude API: ${what}`
      : provider === "openrouter"
      ? status === 401 ? "The server's OpenRouter key was rejected. Check OPENROUTER_API_KEY."
        : status === 402 ? "Not enough OpenRouter credits for this model."
        : status === 429 ? "OpenRouter rate limit. Wait a moment and try again."
        : `OpenRouter: ${what}`
      : status === 401 ? "The server's Tavily key was rejected. Check TAVILY_API_KEY."
        : status === 429 ? "Tavily rate limit. Wait a moment and try again."
        : status === 432 || status === 433 ? "The Tavily plan or credit limit is reached."
        : "Tavily search failed.";
  return new AiError("HTTP", `${hint}${detail ? ` (${detail})` : ""}`, undefined, status);
}

/**
 * Reads a server-sent-events response and hands each `data:` payload to `onData` as it arrives.
 * onData may return true to stop early. Throws a NETWORK error if the stream breaks, or the abort/timeout
 * the caller's signal carries (the fetch signal stays active while the body is read).
 */
export async function readSse(res: Response, onData: (payload: string) => boolean | void, who: string, signal?: AbortSignal): Promise<void> {
  if (!res.body) throw new AiError("NETWORK", `${who} sent no stream. Try again.`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { payloads, rest } = splitSse(buffer);
      buffer = rest;
      for (const p of payloads) if (onData(p) === true) return;
    }
    const { payloads } = splitSse(buffer + "\n"); // a last line without its newline
    for (const p of payloads) if (onData(p) === true) return;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (signal?.aborted) throw new AiError("ABORTED", "The request was cancelled.");
    if (e instanceof Error && e.name === "TimeoutError") throw new AiError("TIMEOUT", `${who} took too long and was stopped. Ask for less in one go, then try again.`);
    throw new AiError("NETWORK", `The stream from ${who} broke before it finished. Try again.`);
  } finally {
    reader.cancel().catch(() => {});
  }
}
