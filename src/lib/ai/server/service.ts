/**
 * The one server entry point for model calls. Route handlers validate nothing themselves; they
 * call runComplete / runSearch / runInfo and map AiError to a response.
 */
import { AiError } from "../errors";
import { joinParts, parseJson } from "../json";
import type { CompleteRequest, CompleteResponse, Message, SearchOptions, SearchResponse, UsageRecord } from "../types";
import { claudeComplete, claudeSearch, type ProviderCall, type RawResult } from "./claude";
import { DEFAULT_MAX_TOKENS, getConfig, modelFor, type ServerConfig } from "./config";
import "./fixtures";
import { fromSchema, mockAnswer } from "./mock";
import { openrouterComplete, openrouterSearch } from "./openrouter";
import { QUERY_SCHEMA, tavilySearch } from "./tavily";
import { UsageSink } from "./usage";

export interface Envelope<T> { data: T; records: UsageRecord[] }

const THINKING_ONLY = (max: number) =>
  `The model used its whole output (${max} tokens) on thinking and gave no answer. Lower reasoning for this call or ask for less.`;

function validate(req: Partial<CompleteRequest>): CompleteRequest {
  if (!req || !Array.isArray(req.messages) || !req.messages.length) throw new AiError("HTTP", "The request has no messages.", undefined, 400);
  if (!req.label || typeof req.label !== "string") throw new AiError("HTTP", "Every AI call needs a label (\"<screen>:<task>\").", undefined, 400);
  if (req.tier !== "small" && req.tier !== "large") throw new AiError("HTTP", `Call "${req.label}" needs tier "small" or "large".`, undefined, 400);
  for (const m of req.messages as Message[]) {
    if (!m || !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string") {
      throw new AiError("HTTP", "Each message needs a role (system, user, assistant) and string content.", undefined, 400);
    }
  }
  return req as CompleteRequest;
}

const maxTokensOf = (req: { maxTokens?: number }) => Math.max(16, Math.round(req.maxTokens || DEFAULT_MAX_TOKENS));

function providerCall(cfg: ServerConfig, call: ProviderCall, sink: UsageSink): Promise<RawResult> {
  return cfg.provider === "claude" ? claudeComplete(cfg, call, sink) : openrouterComplete(cfg, call, sink);
}

/**
 * One request, plus at most one continuation: when the answer is cut off (finish "length"), the
 * model is asked once to go on from where it stopped and the parts are joined, so the text already
 * written (and paid for) is kept. Still cut off after that -> truncated: true.
 */
export async function runComplete(
  input: Partial<CompleteRequest>, signal?: AbortSignal, cfg: ServerConfig = getConfig(), onDelta?: (text: string) => void,
): Promise<Envelope<CompleteResponse>> {
  const req = validate(input);
  const sink = new UsageSink();
  const maxTokens = maxTokensOf(req);

  if (cfg.mock) {
    const t0 = Date.now();
    const text = mockAnswer(req);
    if (onDelta) { // stream it in small pieces so streaming UI can be checked without a key
      for (let i = 0; i < text.length; i += 24) {
        if (signal?.aborted) throw new AiError("ABORTED", "The request was cancelled.");
        onDelta(text.slice(i, i + 24));
        await new Promise((r) => setTimeout(r, 12));
      }
    }
    sink.add({ label: req.label, tier: req.tier, provider: "mock", model: "mock", maxTokens, usage: { prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, cost: 0 }, finish: "stop", ms: Date.now() - t0 });
    return { data: { text, finishReason: "stop", truncated: false, continued: false, model: "mock", usage: null }, records: sink.records };
  }

  const call: ProviderCall = { messages: req.messages, label: req.label, tier: req.tier, reasoning: req.reasoning, maxTokens, schema: req.schema, json: req.json, signal, onDelta };
  const first = await providerCall(cfg, call, sink);
  if (first.thinkingOnly) throw new AiError("TRUNCATED", THINKING_ONLY(maxTokens), "");
  if (first.finishReason !== "length") {
    return { data: { text: first.raw.trim(), finishReason: first.finishReason, truncated: false, continued: false, model: first.model, usage: first.usage }, records: sink.records };
  }
  const more = await providerCall(cfg, {
    ...call,
    label: `${req.label}:continue`,
    schema: undefined,
    json: false,
    messages: req.messages.concat(
      { role: "assistant", content: first.raw },
      { role: "user", content: "You were cut off. Continue exactly where you stopped. Output only the rest: no repeat of what you already wrote, no commentary." },
    ),
  }, sink);
  if (more.thinkingOnly) throw new AiError("TRUNCATED", THINKING_ONLY(maxTokens), first.raw.trim());
  return {
    data: { text: joinParts(first.raw, more.raw).trim(), finishReason: more.finishReason, truncated: more.finishReason === "length", continued: true, model: more.model, usage: more.usage },
    records: sink.records,
  };
}

/** Web search. The provider's own search by default, or Tavily (the model writes the queries first). */
export async function runSearch(
  input: Partial<CompleteRequest> & Pick<SearchOptions, "maxResults">, signal?: AbortSignal, cfg: ServerConfig = getConfig(),
): Promise<Envelope<SearchResponse>> {
  const req = validate(input);
  const sink = new UsageSink();
  const maxResults = input.maxResults || 5;
  if (cfg.search === "off") return { data: { text: "", sources: [] }, records: [] };

  if (cfg.mock) {
    sink.add({ label: req.label, tier: `${req.tier}+web`, provider: "mock", model: "mock", maxTokens: maxTokensOf(req), usage: null, finish: "stop", ms: 0 });
    return {
      data: {
        text: `Mock search notes for ${req.label}.`,
        sources: [{ url: "https://example.com/mock-1", title: "Mock source one", content: "Mock content." }, { url: "https://example.com/mock-2", title: "Mock source two", content: "Mock content." }],
      },
      records: sink.records,
    };
  }

  const call: ProviderCall = { messages: req.messages, label: req.label, tier: req.tier, reasoning: req.reasoning, maxTokens: maxTokensOf(req), signal };

  if (cfg.search === "tavily") {
    const task = req.messages.map((m) => m.content).join("\n\n").slice(0, 6000);
    let queries: string[] = [];
    try {
      const q = await runComplete({
        label: `${req.label}:queries`, tier: "small", maxTokens: 200, schema: QUERY_SCHEMA,
        messages: [
          { role: "system", content: "You write web search queries." },
          { role: "user", content: `${task}\n\nWrite 1-3 short web search queries (max 12 words each, in the language that will find the best pages) that would find pages answering the task above. Answer as {"queries": ["..."]}.` },
        ],
      }, signal, cfg);
      sink.records.push(...q.records);
      const out = parseJson<{ queries?: unknown }>(q.data.text);
      queries = (Array.isArray(out?.queries) ? out.queries : []).filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 3);
    } catch (e) {
      if (e instanceof AiError && (e.code === "ABORTED" || e.code === "NO_KEY")) throw e;
    }
    if (!queries.length) queries = [task.replace(/\s+/g, " ").slice(-380)]; // fallback: the end of the task text
    return { data: await tavilySearch(cfg, queries, maxResults, signal), records: sink.records };
  }

  const data = cfg.provider === "claude" ? await claudeSearch(cfg, call, sink) : await openrouterSearch(cfg, call, maxResults, sink);
  return { data, records: sink.records };
}

export interface AiInfo {
  provider: string;
  /** Which search the server will use; "off" means canSearch() is false. */
  search: "provider" | "tavily" | "off";
  mock: boolean;
  models: { small: string; large: string };
  /** true when the key for the active provider is set (or mock is on). Never the key itself. */
  ready: boolean;
}

export function runInfo(cfg: ServerConfig = getConfig()): AiInfo {
  const key = cfg.provider === "claude" ? cfg.anthropicKey : cfg.openrouterKey;
  return {
    provider: cfg.provider,
    search: cfg.search === "tavily" && !cfg.tavilyKey && !cfg.mock ? "off" : cfg.search,
    mock: cfg.mock,
    models: { small: modelFor(cfg.provider, "small"), large: modelFor(cfg.provider, "large") },
    ready: cfg.mock || !!key,
  };
}

/** Exposed for tests. */
export const __test = { fromSchema };
