/** OpenRouter (OpenAI-compatible chat/completions). Request shapes ported from legacy/components/ai.js. */
import { dropThinking, withJsonInstruction } from "../json";
import type { SearchSource, Usage } from "../types";
import { OPENROUTER_URL, effortFor, modelFor, requireKey, timeoutMs, type ServerConfig } from "./config";
import { errorDetail, fetchWithRetry, httpError, readSse } from "./http";
import { logPrompt, logResponse } from "./log-prompt";
import type { ProviderCall, RawResult } from "./claude";
import type { UsageSink } from "./usage";

// Models that rejected response_format / reasoning; later calls leave the setting out.
const noFormat = new Set<string>();
const noReasoning = new Set<string>();
const rejected = (status: number, detail: string, re: RegExp) => [400, 404, 422].includes(status) && re.test(detail);

interface OrUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}
const toUsage = (u: OrUsage | undefined): Usage | null =>
  u ? {
    prompt_tokens: u.prompt_tokens ?? null, completion_tokens: u.completion_tokens ?? null,
    cached_tokens: u.prompt_tokens_details?.cached_tokens || 0, reasoning_tokens: u.completion_tokens_details?.reasoning_tokens || 0,
    cost: typeof u.cost === "number" ? u.cost : null,
  } : null;

interface OrChoice { finish_reason?: string; message?: { content?: string; reasoning?: string; reasoning_content?: string; annotations?: { type: string; url_citation?: { url: string; title?: string; content?: string } }[] } }
interface OrResponse { choices?: OrChoice[]; usage?: OrUsage }

function headers(key: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Title": "CollabIQ Cognitive Workplace" };
}

export async function openrouterComplete(cfg: ServerConfig, call: ProviderCall, sink: UsageSink): Promise<RawResult> {
  const key = requireKey(cfg, "openrouter");
  const model = modelFor("openrouter", call.tier);
  const effort = effortFor(call.reasoning, call.tier);
  const format = call.schema
    ? { type: "json_schema", json_schema: { name: "result", strict: true, schema: call.schema } }
    : call.json ? { type: "json_object" } : null;
  const formatKey = format ? `${model} ${format.type}` : "";

  for (let attempt = 0; attempt < 4; attempt++) {
    const useFormat = !!format && !noFormat.has(formatKey);
    const messages = format && !useFormat ? withJsonInstruction(call.messages, call.schema) : call.messages;
    const body: Record<string, unknown> = { model, messages, stream: !!call.onDelta, max_tokens: call.maxTokens, usage: { include: true } };
    if (call.onDelta) body.stream_options = { include_usage: true }; // usage arrives in the last chunk
    if (useFormat) body.response_format = format;
    if (!noReasoning.has(model)) body.reasoning = { effort };

    logPrompt({ provider: "openrouter", label: call.label, tier: call.tier, model, messages, attempt });
    const t0 = Date.now();
    const res = await fetchWithRetry(`${OPENROUTER_URL}/chat/completions`, { method: "POST", headers: headers(key), body: JSON.stringify(body) }, {
      signal: call.signal, timeoutMs: timeoutMs(call.maxTokens), who: "OpenRouter",
    });
    if (!res.ok) {
      const detail = await errorDetail(res);
      sink.add({ label: call.label, tier: call.tier, provider: "openrouter", model, maxTokens: call.maxTokens, usage: null, finish: `error:${res.status}`, ms: Date.now() - t0 });
      if (body.reasoning && rejected(res.status, detail, /reasoning|effort|thinking/i)) { noReasoning.add(model); continue; }
      if (useFormat && rejected(res.status, detail, /response_format|json_schema|json_object|structured|schema|parameter/i)) { noFormat.add(formatKey); continue; }
      throw httpError("openrouter", res.status, detail);
    }
    let raw: string;
    let finishReason = "";
    let thought = false;
    let data: OrResponse = {};
    if (call.onDelta) {
      let full = "";
      await readSse(res, (payload) => {
        if (payload === "[DONE]") return true;
        let chunk: { choices?: { finish_reason?: string; delta?: { content?: string; reasoning?: string; reasoning_content?: string } }[]; usage?: OrUsage };
        try { chunk = JSON.parse(payload); } catch { return; } // partial or keep-alive chunk
        if (chunk.usage) data.usage = chunk.usage;
        const c = chunk.choices?.[0];
        if (c?.finish_reason) finishReason = c.finish_reason;
        if (c?.delta?.reasoning || c?.delta?.reasoning_content) thought = true;
        if (c?.delta?.content) { full += c.delta.content; call.onDelta!(c.delta.content); }
      }, "OpenRouter", call.signal);
      raw = dropThinking(full);
    } else {
      data = (await res.json()) as OrResponse;
      const ch = data.choices?.[0] || {};
      raw = dropThinking(ch.message?.content);
      finishReason = ch.finish_reason || "";
      thought = !!(ch.message?.reasoning_content || ch.message?.reasoning);
    }
    const usage = toUsage(data.usage);
    sink.add({ label: call.label, tier: call.tier, provider: "openrouter", model, maxTokens: call.maxTokens, usage, finish: finishReason, ms: Date.now() - t0 });
    logResponse({ provider: "openrouter", label: call.label, model, text: raw, finish: finishReason, ms: Date.now() - t0 });
    return { raw, finishReason, usage, model, thinkingOnly: !raw.trim() && (thought || finishReason === "length") };
  }
  throw httpError("openrouter", 400, "unsupported settings", "The request was rejected after dropping unsupported settings.");
}

/** OpenRouter web plugin. Sources are the url_citation annotations it returned, never URLs the model wrote. */
export async function openrouterSearch(
  cfg: ServerConfig, call: ProviderCall, maxResults: number, sink: UsageSink,
): Promise<{ text: string; sources: SearchSource[] }> {
  const key = requireKey(cfg, "openrouter");
  const model = modelFor("openrouter", call.tier);
  const effort = effortFor(call.reasoning, call.tier);
  const body: Record<string, unknown> = {
    model, messages: call.messages, max_tokens: call.maxTokens, usage: { include: true },
    plugins: [{ id: "web", max_results: maxResults }],
    ...(noReasoning.has(model) ? {} : { reasoning: { effort } }),
  };
  logPrompt({ provider: "openrouter", label: call.label, tier: call.tier, model, messages: call.messages, web: true });
  const t0 = Date.now();
  const res = await fetchWithRetry(`${OPENROUTER_URL}/chat/completions`, { method: "POST", headers: headers(key), body: JSON.stringify(body) }, {
    signal: call.signal, timeoutMs: Math.max(90_000, timeoutMs(call.maxTokens)), who: "OpenRouter",
  });
  const tier = `${call.tier}+web`;
  if (!res.ok) {
    sink.add({ label: call.label, tier, provider: "openrouter", model, maxTokens: call.maxTokens, usage: null, finish: `error:${res.status}`, ms: Date.now() - t0 });
    throw httpError("openrouter", res.status, await errorDetail(res), res.status === 402 ? "Not enough OpenRouter credits for web search." : "Web search failed.");
  }
  const data = (await res.json()) as OrResponse;
  sink.add({ label: call.label, tier, provider: "openrouter", model, maxTokens: call.maxTokens, usage: toUsage(data.usage), finish: data.choices?.[0]?.finish_reason || "", ms: Date.now() - t0 });
  const msg = data.choices?.[0]?.message || {};
  const seen = new Map<string, SearchSource>();
  for (const a of msg.annotations || []) {
    const c = a?.type === "url_citation" ? a.url_citation : undefined;
    if (c?.url && !seen.has(c.url)) seen.set(c.url, { url: c.url, title: c.title || c.url, content: c.content || "" });
  }
  logResponse({ provider: "openrouter", label: call.label, model, text: `${msg.content ?? ""}\n(sources: ${seen.size})`, finish: data.choices?.[0]?.finish_reason, ms: Date.now() - t0 });
  return { text: msg.content ?? "", sources: [...seen.values()] };
}
