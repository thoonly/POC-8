/**
 * Browser-side AI client. The ONLY thing the UI calls to reach a model: it talks to /api/ai/*,
 * which holds the keys. Never fetch a model API from a component.
 *
 *   const plan = await ai.json<Plan>(messages, { label: "entry:gap-check", tier: "small", schema });
 *   const text = await ai.chat(messages, { label: "entry:answer", tier: "large" });
 *   const { text, sources } = await ai.search(messages, { label: "entry:research", tier: "large" });
 *
 * Errors are AiError with a code (see errors.ts). A cut-off answer is continued once on the
 * server; still cut off -> TRUNCATED (e.text = partial). Timeouts are never retried: show the
 * error state with a "Try again" button the user presses.
 */
import { AiError } from "./errors";
import { parseJson, splitSse } from "./json";
import type {
  AiErrorBody, CallOptions, CompleteRequest, CompleteResponse, Message, SearchOptions, SearchResponse, UsageRecord,
} from "./types";
import type { AiInfo } from "./server/service";

export type { AiInfo };

type Listener = (rows: UsageRecord[]) => void;
const listeners = new Set<Listener>();
/** The usage store subscribes here; every request's rows are delivered after it completes. */
export const onUsage = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

interface Ok<T> { ok: true; data: T; records?: UsageRecord[] }
interface Fail { ok: false; error: AiErrorBody }

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) throw new AiError("ABORTED", "The request was cancelled.");
    throw new AiError("NETWORK", "Could not reach the app server. Check that it is running and try again.");
  }
  let json: Ok<T> | Fail;
  try {
    json = (await res.json()) as Ok<T> | Fail;
  } catch {
    throw new AiError("HTTP", `The app server answered ${res.status} without a valid response. Try again.`, undefined, res.status);
  }
  if (!json.ok) throw AiError.fromBody(json.error, res.status);
  if (json.records?.length) listeners.forEach((fn) => fn(json.records!));
  return json.data;
}

function check(opts: CallOptions): void {
  if (!opts || !opts.label || !/^[a-z0-9-]+:[a-z0-9:._-]+$/i.test(opts.label)) {
    throw new Error(`AI call needs a label like "entry:gap-check", got "${opts?.label}".`);
  }
  if (opts.tier !== "small" && opts.tier !== "large") throw new Error(`AI call "${opts.label}" needs tier "small" or "large".`);
}

function request(messages: Message[], opts: CallOptions, json: boolean): CompleteRequest {
  check(opts);
  return { messages, label: opts.label, tier: opts.tier, reasoning: opts.reasoning, maxTokens: opts.maxTokens, schema: opts.schema, json: json || undefined };
}

/**
 * Streamed completion over /api/ai/stream. Calls onToken per piece and resolves with the final
 * response, like post(). Failures arrive as an "error" event and are thrown as AiError.
 */
async function stream(req: CompleteRequest, onToken: NonNullable<CallOptions["onToken"]>, signal?: AbortSignal): Promise<CompleteResponse> {
  let res: Response;
  try {
    res = await fetch("/api/ai/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal });
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) throw new AiError("ABORTED", "The request was cancelled.");
    throw new AiError("NETWORK", "Could not reach the app server. Check that it is running and try again.");
  }
  if (!res.ok || !res.body) throw new AiError("HTTP", `The app server answered ${res.status} without a stream. Try again.`, undefined, res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let result: CompleteResponse | null = null;
  let failure: AiError | null = null;
  const handle = (payload: string) => {
    let ev: { t?: string; text?: string; data?: CompleteResponse; records?: UsageRecord[]; error?: AiErrorBody };
    try { ev = JSON.parse(payload); } catch { return; }
    if (ev.t === "delta" && ev.text) { full += ev.text; onToken(ev.text, full); }
    else if (ev.t === "done" && ev.data) { result = ev.data; if (ev.records?.length) listeners.forEach((fn) => fn(ev.records!)); }
    else if (ev.t === "error" && ev.error) failure = AiError.fromBody(ev.error);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { payloads, rest } = splitSse(buffer);
      buffer = rest;
      payloads.forEach(handle);
    }
    splitSse(buffer + "\n").payloads.forEach(handle); // a last line without its newline
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) throw new AiError("ABORTED", "The request was cancelled.");
    throw new AiError("NETWORK", "The connection to the app server broke before the answer finished. Try again.");
  }
  if (failure) throw failure;
  if (!result) throw new AiError("NETWORK", "The answer stopped before it finished. Try again.");
  return result;
}

/** Low level: returns the text plus finish info. Prefer chat / json. With opts.onToken the answer streams. */
export function complete(messages: Message[], opts: CallOptions, json = false): Promise<CompleteResponse> {
  const req = request(messages, opts, json);
  return opts.onToken ? stream(req, opts.onToken, opts.signal) : post<CompleteResponse>("/api/ai/complete", req, opts.signal);
}

/** Text answer. Throws TRUNCATED (e.text = the partial answer) when still cut off after one continuation. */
export async function chat(messages: Message[], opts: CallOptions): Promise<string> {
  const r = await complete(messages, opts);
  if (r.truncated) throw new AiError("TRUNCATED", "The answer was still cut off after one continuation. Ask for less in one go, or lower reasoning.", r.text);
  return r.text;
}

/** Parsed JSON answer. opts.schema is enforced by the provider when it can be. */
export async function json<T = unknown>(messages: Message[], opts: CallOptions): Promise<T> {
  const r = await complete(messages, opts, true);
  if (r.truncated) throw new AiError("TRUNCATED", "The answer was still cut off after one continuation, before the JSON closed. Ask for less in one go, or lower reasoning.", r.text);
  const parsed = parseJson<T>(r.text);
  if (parsed === undefined) throw new AiError("BAD_JSON", "The model did not answer with valid JSON. Try again, or use a larger tier for this step.", r.text);
  return parsed;
}

/** Live web search. Empty result when search is off on the server: check canSearch() first. */
export function search(messages: Message[], opts: SearchOptions): Promise<SearchResponse> {
  check(opts);
  return post<SearchResponse>("/api/ai/search", { ...request(messages, opts, false), maxResults: opts.maxResults }, opts.signal);
}

let infoPromise: Promise<AiInfo> | null = null;
/** Provider, models, search mode and whether the server key is set. Cached; pass refresh to re-read. */
export function info(refresh = false): Promise<AiInfo> {
  if (!infoPromise || refresh) {
    infoPromise = fetch("/api/ai/info", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Ok<AiInfo> | Fail) => {
        if (!j.ok) throw AiError.fromBody(j.error);
        return j.data;
      })
      .catch((e) => {
        infoPromise = null;
        throw e instanceof AiError ? e : new AiError("NETWORK", "Could not reach the app server.");
      });
  }
  return infoPromise;
}

export const canSearch = async (): Promise<boolean> => (await info()).search !== "off";

export const ai = { complete, chat, json, search, info, canSearch, onUsage };
