/** Claude API (Messages API). Request shapes ported from legacy/components/ai.js. */
import { AiError } from "../errors";
import { claudeSchema, withJsonInstruction } from "../json";
import type { Message, Reasoning, JsonSchema, SearchSource, Tier, Usage } from "../types";
import { CLAUDE_URL, CLAUDE_VERSION, effortFor, modelFor, requireKey, timeoutMs, type ServerConfig } from "./config";
import { errorDetail, fetchWithRetry, httpError, readSse } from "./http";
import { logPrompt, logResponse } from "./log-prompt";
import type { UsageSink } from "./usage";

export interface ProviderCall {
  messages: Message[];
  label: string;
  tier: Tier;
  reasoning?: Reasoning;
  maxTokens: number;
  schema?: JsonSchema;
  json?: boolean;
  signal?: AbortSignal;
  /** Streams the answer text as it is written. Usage and finish reason still arrive at the end. */
  onDelta?: (text: string) => void;
}

export interface RawResult {
  raw: string;
  finishReason: string;
  usage: Usage | null;
  model: string;
  /** The model produced thinking and no answer text. */
  thinkingOnly: boolean;
}

// USD per 1M tokens: [input, 5-min cache write, cache read, output] (Oct 2026). Cost estimate only.
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 5, 0.2, 20],
  "claude-sonnet-5-5": [2, 2.5, 0.1, 10],
  "claude-haiku-5-5": [0.1, 0.125, 0.01, 0.5],
  "claude-haiku-5-5>100k": [0.5, 0.625, 0.05, 2.5],
};
const SEARCH_USD = 0.01; // $10 per 1,000 web searches

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
}

export function claudeUsage(u: ClaudeUsage | undefined, model: string): Usage {
  const x = u || {};
  const fresh = x.input_tokens || 0, write = x.cache_creation_input_tokens || 0, read = x.cache_read_input_tokens || 0, out = x.output_tokens || 0;
  const prompt = fresh + write + read;
  const p = PRICES[model === "claude-haiku-5-5" && prompt > 100_000 ? "claude-haiku-5-5>100k" : model];
  const searches = x.server_tool_use?.web_search_requests || 0;
  const cost = p ? (fresh * p[0] + write * p[1] + read * p[2] + out * p[3]) / 1e6 + searches * SEARCH_USD : null;
  return { prompt_tokens: prompt, completion_tokens: out, cached_tokens: read, reasoning_tokens: 0, cost };
}

/**
 * Harness reasoning level -> Claude thinking + effort. Each model turns thinking off differently:
 * Haiku 5.5 takes { type: "disabled" }; Sonnet 5.5 { type: "between_tools" }; Opus 5.5 can't, so effort "low".
 */
export function claudeReasoning(model: string, effort: Reasoning): { thinking?: { type: string }; effort?: string } {
  if (effort !== "none") return { effort: effort === "minimal" ? "low" : effort };
  if (/claude-(opus|fable|mythos)-/.test(model)) return { effort: "low" };
  if (/claude-sonnet-5-5/.test(model)) return { thinking: { type: "between_tools" }, effort: "low" };
  return { thinking: { type: "disabled" }, effort: "low" };
}

// Settings a model rejected; later calls leave them out. Process-wide memo, as in ai.js.
const noFormat = new Set<string>();
const noReasoning = new Set<string>();
const noFallback = new Set<string>();

type Body = Record<string, unknown> & {
  thinking?: unknown;
  output_config?: { effort?: string; format?: unknown };
  fallbacks?: string;
  messages: { role: string; content: unknown }[];
};

function buildBody(messages: Message[], model: string, maxTokens: number, effort: Reasoning, extra: Record<string, unknown> = {}): Body {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const body: Body = {
    model,
    max_tokens: maxTokens,
    messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
    ...extra,
  };
  if (system) body.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  const r = noReasoning.has(model) ? {} : claudeReasoning(model, effort);
  if (r.thinking) body.thinking = r.thinking;
  if (r.effort) body.output_config = { effort: r.effort };
  // If a safety classifier declines, the API reruns on a fallback model (Opus / Sonnet 5.5 only).
  if (/claude-(opus|sonnet)-5-5/.test(model) && !noFallback.has(model)) body.fallbacks = "default";
  return body;
}

function headers(key: string, body: Body): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", "x-api-key": key, "anthropic-version": CLAUDE_VERSION };
  if (body.fallbacks) h["anthropic-beta"] = "server-side-fallback-2026-07-01";
  return h;
}

/** Drops a setting the model rejected (and remembers it). Returns true when the body changed. */
function dropRejected(body: Body, model: string, status: number, detail: string): boolean {
  if (![400, 404, 422].includes(status)) return false;
  if (body.fallbacks && /fallback/i.test(detail)) { noFallback.add(model); return true; }
  if ((body.thinking || body.output_config?.effort) && /thinking|effort/i.test(detail)) { noReasoning.add(model); return true; }
  return false;
}
const formatRejected = (status: number, detail: string) =>
  [400, 404, 422].includes(status) && /response_format|json_schema|json_object|structured|schema|format/i.test(detail);

interface ClaudeBlock { type: string; text?: string; citations?: { url: string; title?: string; cited_text?: string }[]; content?: { url: string; title?: string }[] }
interface ClaudeResponse { content?: ClaudeBlock[]; stop_reason?: string; stop_details?: { category?: string }; usage?: ClaudeUsage }

export async function claudeComplete(cfg: ServerConfig, call: ProviderCall, sink: UsageSink): Promise<RawResult> {
  const key = requireKey(cfg, "claude");
  const model = modelFor("claude", call.tier);
  const effort = effortFor(call.reasoning, call.tier);
  const formatKey = `${model} json_schema`;
  const wantsJson = !!(call.json || call.schema);

  for (let attempt = 0; attempt < 4; attempt++) {
    const useFormat = !!call.schema && !noFormat.has(formatKey);
    // Claude has no JSON mode without a schema: say it in the prompt (also when the schema was rejected).
    const msgs = wantsJson && !useFormat ? withJsonInstruction(call.messages, call.schema) : call.messages;
    const body = buildBody(msgs, model, call.maxTokens, effort, call.onDelta ? { stream: true } : {});
    if (useFormat) body.output_config = { ...body.output_config, format: { type: "json_schema", schema: claudeSchema(call.schema) } };

    logPrompt({ provider: "claude", label: call.label, tier: call.tier, model, messages: msgs, attempt });
    const t0 = Date.now();
    const res = await fetchWithRetry(`${CLAUDE_URL}/messages`, { method: "POST", headers: headers(key, body), body: JSON.stringify(body) }, {
      signal: call.signal, timeoutMs: timeoutMs(call.maxTokens), who: "The Claude API",
    });
    if (!res.ok) {
      const detail = await errorDetail(res);
      sink.add({ label: call.label, tier: call.tier, provider: "claude", model, maxTokens: call.maxTokens, usage: null, finish: `error:${res.status}`, ms: Date.now() - t0 });
      if (dropRejected(body, model, res.status, detail)) continue;
      if (useFormat && formatRejected(res.status, detail)) { noFormat.add(formatKey); continue; }
      throw httpError("claude", res.status, detail);
    }
    let raw = "";
    let thinking = false;
    let data: ClaudeResponse;
    if (call.onDelta) {
      data = await readClaudeStream(res, call.onDelta, call.signal, (t) => { raw += t; }, () => { thinking = true; });
    } else {
      data = (await res.json()) as ClaudeResponse;
      for (const b of data.content || []) {
        if (b.type === "text") raw += b.text || "";
        else if (b.type === "thinking") thinking = true;
      }
    }
    const stop = data.stop_reason || "";
    const finishReason = stop === "max_tokens" ? "length" : stop === "end_turn" ? "stop" : stop;
    const usage = claudeUsage(data.usage, model);
    sink.add({ label: call.label, tier: call.tier, provider: "claude", model, maxTokens: call.maxTokens, usage, finish: finishReason, ms: Date.now() - t0 });
    logResponse({ provider: "claude", label: call.label, model, text: raw, finish: finishReason, ms: Date.now() - t0 });
    if (stop === "refusal") {
      const cat = data.stop_details?.category;
      throw new AiError("HTTP", `Claude declined this request${cat ? ` (${cat})` : ""}. Rephrase it, or try another model.`);
    }
    return { raw, finishReason, usage, model, thinkingOnly: !raw.trim() && (thinking || finishReason === "length") };
  }
  throw new AiError("HTTP", "Claude API: the request was rejected after dropping unsupported settings.");
}

/**
 * Reads a Claude Messages stream: text deltas go to onDelta as they arrive; the returned object has the
 * stop reason, refusal details and usage in the shape of a non-streaming response.
 */
async function readClaudeStream(
  res: Response, onDelta: (t: string) => void, signal: AbortSignal | undefined, addText: (t: string) => void, onThinking: () => void,
): Promise<ClaudeResponse> {
  const out: ClaudeResponse = { usage: {} };
  await readSse(res, (payload) => {
    let ev: { type?: string; message?: { usage?: ClaudeUsage }; content_block?: { type?: string }; delta?: { type?: string; text?: string; stop_reason?: string; stop_details?: { category?: string } }; usage?: ClaudeUsage; error?: { message?: string } };
    try { ev = JSON.parse(payload); } catch { return; }
    if (ev.type === "message_start") out.usage = { ...ev.message?.usage };
    else if (ev.type === "content_block_start" && ev.content_block?.type === "thinking") onThinking();
    else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) { addText(ev.delta.text); onDelta(ev.delta.text); }
    else if (ev.type === "message_delta") {
      out.stop_reason = ev.delta?.stop_reason || out.stop_reason;
      if (ev.delta?.stop_details) out.stop_details = ev.delta.stop_details;
      Object.assign(out.usage!, ev.usage);
    } else if (ev.type === "message_stop") return true;
    else if (ev.type === "error") throw new AiError("HTTP", `Claude API: ${ev.error?.message || "the stream stopped with an error."}`);
  }, "The Claude API", signal);
  return out;
}

/**
 * Claude web search (server tool): up to 2 searches, answer with citations. Sources are the cited
 * pages first, then the other results returned, never URLs the model wrote. maxResults doesn't apply.
 */
export async function claudeSearch(cfg: ServerConfig, call: ProviderCall, sink: UsageSink): Promise<{ text: string; sources: SearchSource[] }> {
  const key = requireKey(cfg, "claude");
  const model = modelFor("claude", call.tier);
  const effort = effortFor(call.reasoning, call.tier);
  // The dynamic-filtering variant needs Opus / Sonnet; other models get the basic tool.
  const tool = { type: /claude-(opus|sonnet)-/.test(model) ? "web_search_20260209" : "web_search_20250305", name: "web_search", max_uses: 2 };
  let body = buildBody(call.messages, model, call.maxTokens, effort, { tools: [tool] });
  const first = body.messages.slice();
  const blocks: ClaudeBlock[] = [];
  let drops = 0;

  for (let round = 0; round < 3; round++) { // a long search turn can pause; continue it at most twice
    if (round === 0) logPrompt({ provider: "claude", label: call.label, tier: call.tier, model, messages: call.messages, web: true }); // later rounds resend the same prompt
    const t0 = Date.now();
    const res = await fetchWithRetry(`${CLAUDE_URL}/messages`, { method: "POST", headers: headers(key, body), body: JSON.stringify(body) }, {
      signal: call.signal, timeoutMs: Math.max(90_000, timeoutMs(call.maxTokens)), who: "The Claude API",
    });
    const tier = `${call.tier}+web`;
    if (!res.ok) {
      const detail = await errorDetail(res);
      sink.add({ label: call.label, tier, provider: "claude", model, maxTokens: call.maxTokens, usage: null, finish: `error:${res.status}`, ms: Date.now() - t0 });
      if (round === 0 && drops < 2 && dropRejected(body, model, res.status, detail)) {
        drops++;
        body = buildBody(call.messages, model, call.maxTokens, effort, { tools: [tool] }); // memo now omits the rejected setting
        round--;
        continue;
      }
      throw httpError("claude", res.status, detail, "Web search failed.");
    }
    const data = (await res.json()) as ClaudeResponse;
    sink.add({
      label: call.label, tier, provider: "claude", model, maxTokens: call.maxTokens, usage: claudeUsage(data.usage, model),
      finish: data.stop_reason === "max_tokens" ? "length" : data.stop_reason || "", ms: Date.now() - t0,
    });
    blocks.push(...(data.content || []));
    if (data.stop_reason !== "pause_turn") break;
    body.messages = first.concat({ role: "assistant", content: blocks.slice() });
  }

  const seen = new Map<string, SearchSource>();
  const add = (url?: string, title?: string, content?: string) => {
    if (url && !seen.has(url)) seen.set(url, { url, title: title || url, content: content || "" });
  };
  blocks.forEach((b) => (b.type === "text" && Array.isArray(b.citations) ? b.citations : []).forEach((c) => add(c.url, c.title, c.cited_text)));
  blocks.forEach((b) => { if (b.type === "web_search_tool_result" && Array.isArray(b.content)) b.content.forEach((r) => add(r.url, r.title, "")); });
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("");
  logResponse({ provider: "claude", label: call.label, model, text: `${text}\n(sources: ${seen.size})` });
  return { text, sources: [...seen.values()] };
}
