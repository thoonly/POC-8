/* ai.js — the ONLY place that talks to an LLM. Classic script (works on file://), exposes window.AI.
   Provider (picked in the settings dialog):
     openrouter — OpenRouter, needs the user's own API key (OpenAI-compatible)
     claude     — Anthropic's Claude API (Messages API), needs the user's own API key; everything else is preset
     lmstudio   — LM Studio's local server (default http://localhost:1234/v1, "Enable CORS" on)
     local      — any other local OpenAI-compatible server, e.g. Ollama (default http://localhost:11434/v1)
   Keys, URLs and models are stored in this browser's localStorage — prototype use only.

   <script src="components/ai.js"></script>

   AI.mountSettings(buttonEl)                        // wires a button to the settings dialog; returns { open }
   Every call takes { label, tier } — see CLAUDE.md. Optional: { reasoning, maxTokens (default 8192, a runaway guard), signal, model }.
   A cut-off answer is continued once automatically; still cut off → TRUNCATED.
   await AI.chat(messages, { label, tier, onToken })   // returns full text; streams if onToken is given
   await AI.json(messages, { label, tier, schema })    // returns the parsed object; schema = JSON Schema (optional)
   await AI.complete(messages, opts)                   // low level → { text, finishReason, truncated, continued, model, usage }
   await AI.search(messages, { label, maxTokens, maxResults })  // live web search → { text, sources: [{ url, title, content }] }
                                                       // provider: OpenRouter web plugin, Claude web search, or Tavily (AI.settings.searchProvider)
   AI.canSearch()                                      // false when web search is off
   AI.settings.provider / .baseUrl / .model / .smallModel / .isLocal // current values for the active provider
   AI.settings.apiKey / AI.settings.localKey           // OpenRouter key / optional local server key
   AI.settings.tavilyKey / AI.settings.searchProvider  // "openrouter" | "claude" | "tavily" | "off"
   AI.usageReport() / AI.usageTotals() / AI.resetUsage() / AI.usageLog  // token use this browser session, per label
   AI.AiError  (code: NO_KEY | NO_MODEL | HTTP | NETWORK | TRUNCATED | BAD_JSON; TRUNCATED/BAD_JSON carry e.text)
*/
(function () {
const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";
const DEFAULT_SMALL_MODEL = "anthropic/claude-haiku-5.5";
const DEFAULT_MAX_TOKENS = 8192;   // runaway guard, not a length budget: billing counts only what the model writes
const BASE_URL = "https://openrouter.ai/api/v1";
// Claude API: the user enters only the key. The browser header lets a page call the API directly (prototype only).
const CLAUDE_URL = "https://api.anthropic.com/v1";
const CLAUDE_VERSION = "2026-10-21";
const CLAUDE_MODEL = "claude-opus-5-5";
const CLAUDE_SMALL_MODEL = "claude-haiku-5-5";
const PROVIDERS = {
  openrouter: { label: "OpenRouter", url: BASE_URL },
  claude: { label: "Claude API", url: CLAUDE_URL },
  lmstudio: { label: "LM Studio", url: "http://localhost:1234/v1", local: true },
  local: { label: "Local server", url: "http://localhost:11434/v1", local: true },
};
const LS = {
  key: "proto.ai.key", model: "proto.ai.model", smallModel: "proto.ai.smallModel", models: "proto.ai.models", tavilyKey: "proto.ai.tavilyKey", searchProvider: "proto.ai.searchProvider",
  provider: "proto.ai.provider", usage: "proto.ai.usage",
  url: (p) => `proto.ai.${p}.url`, localKey: (p) => `proto.ai.${p}.key`, localModel: (p) => `proto.ai.${p}.model`, localSmallModel: (p) => `proto.ai.${p}.smallModel`,
};
const TAVILY_URL = "https://api.tavily.com/search";

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

class AiError extends Error {
  // codes: NO_KEY | NO_MODEL | HTTP | NETWORK | TRUNCATED | BAD_JSON (the last two carry the model's text in e.text)
  constructor(code, message, text) { super(message); this.code = code; if (text !== undefined) this.text = text; }
}

const cleanUrl = (u) => String(u || "").trim().replace(/\/+$/, "");
const providerOf = (p) => (PROVIDERS[p] ? p : "openrouter");

/** Values for one provider (the active one by default). Claude and local providers keep their own key and models. */
function providerConfig(p = settings.provider) {
  p = providerOf(p);
  if (p === "openrouter") return { provider: p, label: PROVIDERS[p].label, isLocal: false, baseUrl: BASE_URL, key: ls.get(LS.key) || "", model: ls.get(LS.model) || DEFAULT_MODEL, smallModel: ls.get(LS.smallModel) || DEFAULT_SMALL_MODEL };
  if (p === "claude") return {
    provider: p, label: PROVIDERS[p].label, isLocal: false, isClaude: true, baseUrl: CLAUDE_URL,
    key: ls.get(LS.localKey(p)) || "",
    model: ls.get(LS.localModel(p)) || CLAUDE_MODEL,
    smallModel: ls.get(LS.localSmallModel(p)) || CLAUDE_SMALL_MODEL,
  };
  return {
    provider: p, label: PROVIDERS[p].label, isLocal: true,
    baseUrl: cleanUrl(ls.get(LS.url(p))) || PROVIDERS[p].url,
    key: ls.get(LS.localKey(p)) || "",
    model: ls.get(LS.localModel(p)) || "",
    smallModel: ls.get(LS.localSmallModel(p)) || "",   // "" = use the main model
  };
}

const settings = {
  get provider() { return providerOf(ls.get(LS.provider)); },          // openrouter | claude | lmstudio | local
  get isLocal() { return !!PROVIDERS[this.provider].local; },
  get baseUrl() { return providerConfig().baseUrl; },
  get model() { return providerConfig().model; },                     // "" for a local server with no model picked yet
  get smallModel() { return providerConfig().smallModel; },           // tier "small"; "" on a local server = same as model
  get apiKey() { return ls.get(LS.key) || ""; },                      // OpenRouter key
  get localKey() { return this.isLocal ? providerConfig().key : ""; }, // optional key for the local server
  get tavilyKey() { return ls.get(LS.tavilyKey) || ""; },
  get searchProvider() {                                              // openrouter | claude | tavily | off
    const v = ls.get(LS.searchProvider), p = this.provider;
    if (v === "tavily" || v === "off") return v;
    // The OpenRouter web plugin and Claude web search each need their own provider to run the model.
    if (v === p && (v === "openrouter" || v === "claude")) return v;
    return p === "openrouter" || p === "claude" ? p : "off";
  },
  save({ provider, baseUrl, apiKey, model, smallModel, tavilyKey, searchProvider }) {
    const p = providerOf(provider || this.provider);
    ls.set(LS.provider, p);
    if (p === "openrouter") {
      if (typeof apiKey === "string") apiKey.trim() ? ls.set(LS.key, apiKey.trim()) : ls.del(LS.key);
      ls.set(LS.model, (model || "").trim() || DEFAULT_MODEL);
      ls.set(LS.smallModel, (smallModel || "").trim() || DEFAULT_SMALL_MODEL);
    } else if (p === "claude") {
      if (typeof apiKey === "string") apiKey.trim() ? ls.set(LS.localKey(p), apiKey.trim()) : ls.del(LS.localKey(p));
      ls.set(LS.localModel(p), (model || "").trim() || CLAUDE_MODEL);
      ls.set(LS.localSmallModel(p), (smallModel || "").trim() || CLAUDE_SMALL_MODEL);
    } else {
      ls.set(LS.url(p), cleanUrl(baseUrl) || PROVIDERS[p].url);
      if (typeof apiKey === "string") apiKey.trim() ? ls.set(LS.localKey(p), apiKey.trim()) : ls.del(LS.localKey(p));
      (model || "").trim() ? ls.set(LS.localModel(p), model.trim()) : ls.del(LS.localModel(p));
      (smallModel || "").trim() ? ls.set(LS.localSmallModel(p), smallModel.trim()) : ls.del(LS.localSmallModel(p));
    }
    if (typeof tavilyKey === "string") tavilyKey.trim() ? ls.set(LS.tavilyKey, tavilyKey.trim()) : ls.del(LS.tavilyKey);
    if (searchProvider) ls.set(LS.searchProvider, ["tavily", "off", "claude"].includes(searchProvider) ? searchProvider : "openrouter");
  },
  clearKey(provider = this.provider) { provider === "openrouter" ? ls.del(LS.key) : ls.del(LS.localKey(provider)); },
};

function headersFor(cfg, beta) {
  if (cfg.isClaude) {
    const h = {
      "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": CLAUDE_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",   // allows a browser page to call the API (prototype only)
    };
    if (beta) h["anthropic-beta"] = beta;
    return h;
  }
  const h = { "Content-Type": "application/json" };
  if (cfg.key) h.Authorization = `Bearer ${cfg.key}`;
  if (!cfg.isLocal) h["X-Title"] = "Prototype";   // local servers (Ollama) reject unknown headers in the CORS preflight
  return h;
}

const unreachable = (cfg) => cfg.isLocal
  ? `Could not reach ${cfg.label} at ${cfg.baseUrl}. Start the server and turn on CORS, then try again.`
  : cfg.isClaude ? "Could not reach the Claude API. Check your Claude API key in AI settings and your connection."
  : "Could not reach OpenRouter. Check your connection and try again.";

/** Models on a local server: GET {baseUrl}/models. Throws AiError so the settings dialog can say what is wrong. */
async function fetchLocalModels(cfg) {
  let res;
  try { res = await fetch(`${cfg.baseUrl}/models`, { headers: cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {} }); }
  catch { throw new AiError("NETWORK", unreachable(cfg)); }
  if (!res.ok) throw new AiError("HTTP", res.status === 401 ? `${cfg.label} rejected the API key.` : `${cfg.label} answered ${res.status}. Check the server URL; it usually ends in /v1.`);
  let data = [];
  try { data = (await res.json()).data || []; } catch {}
  return data.map((m) => ({ id: m.id, name: m.id })).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Model list for a provider (the active one by default).
 * OpenRouter: public endpoint, cached per browser session; falls back to the default.
 * Local: whatever the server has; [] when it can't be reached.
 */
async function listModels(provider, { baseUrl, key } = {}) {
  const cfg = providerConfig(provider);
  if (cfg.isLocal) {
    try { return await fetchLocalModels({ ...cfg, baseUrl: cleanUrl(baseUrl) || cfg.baseUrl, key: key ?? cfg.key }); }
    catch { return []; }
  }
  if (cfg.isClaude) return Object.keys(CLAUDE_PRICES).filter((id) => !id.includes(">")).map((id) => ({ id, name: id }));
  try {
    const cached = sessionStorage.getItem(LS.models);
    if (cached) return JSON.parse(cached);
  } catch {}
  try {
    const res = await fetch(`${BASE_URL}/models`);
    if (!res.ok) throw new Error(res.status);
    const { data } = await res.json();
    const models = data.map((m) => ({ id: m.id, name: m.name || m.id })).sort((a, b) => a.id.localeCompare(b.id));
    try { sessionStorage.setItem(LS.models, JSON.stringify(models)); } catch {}
    return models;
  } catch {
    return [{ id: DEFAULT_MODEL, name: "Anthropic: Claude Sonnet 5.5" }];
  }
}

/** The model to send: the chosen one, or for a local server with none chosen, the first model it lists. */
async function resolveModel(cfg, model) {
  if (model || cfg.model) return model || cfg.model;
  const models = await fetchLocalModels(cfg);
  if (!models.length) throw new AiError("NO_MODEL", `${cfg.label} has no model loaded. Load one, or pick one in AI settings.`);
  return models[0].id;
}

async function errorDetail(res) {
  try { const j = await res.json(); return j?.error?.message || (typeof j?.error === "string" ? j.error : ""); } catch { return ""; }
}

function httpError(cfg, res, detail, what = "Request failed.") {
  const hint = cfg.isLocal
    ? (res.status === 401 ? `${cfg.label} rejected the API key. Check it in AI settings.`
      : res.status === 404 ? `${cfg.label} doesn't have this model. Pick a loaded model in AI settings.`
      : `${cfg.label}: ${what}`)
    : cfg.isClaude
    ? (res.status === 401 ? "Your Claude API key was rejected. Check it in AI settings."
      : res.status === 404 ? "The Claude API doesn't know this model. Check the model id in AI settings."
      : res.status === 429 ? "Claude API rate limit. Wait a moment and retry."
      : res.status === 529 ? "The Claude API is overloaded. Wait a moment and retry."
      : `Claude API: ${what}`)
    : res.status === 401 ? "Your API key was rejected. Check it in AI settings."
    : res.status === 402 ? "Not enough OpenRouter credits for this model."
    : res.status === 429 ? "Rate limited. Wait a moment and retry."
    : what;
  return new AiError("HTTP", `${hint}${detail ? " (" + detail + ")" : ""}`);
}

/* ---------- Usage log: one row per request, kept for this browser session ---------- */
const usageLog = (() => { try { return JSON.parse(sessionStorage.getItem(LS.usage)) || []; } catch { return []; } })();

function record(row) {
  const u = row.usage || {};
  const rec = {
    at: Date.now(), label: row.label, tier: row.tier, provider: row.provider, model: row.model,
    input: u.prompt_tokens ?? null, output: u.completion_tokens ?? null,
    cached: u.prompt_tokens_details?.cached_tokens || 0,
    reasoning: u.completion_tokens_details?.reasoning_tokens || 0,
    cost: typeof u.cost === "number" ? u.cost : null,          // OpenRouter credits (USD); null on local servers
    maxTokens: row.maxTokens, ms: row.ms, finish: row.finish || "",
  };
  usageLog.push(rec);
  if (usageLog.length > 500) usageLog.splice(0, usageLog.length - 500);
  try { sessionStorage.setItem(LS.usage, JSON.stringify(usageLog)); } catch {}
  console.info(`[AI] ${rec.label} · ${rec.tier} · ${rec.model} · in ${rec.input ?? "?"}${rec.cached ? ` (${rec.cached} cached)` : ""} · out ${rec.output ?? "?"}/${rec.maxTokens}`
    + `${rec.cost != null ? ` · $${rec.cost.toFixed(4)}` : ""} · ${rec.ms} ms · ${rec.finish}`);
  document.dispatchEvent(new CustomEvent("ai:usage", { detail: rec }));
  return rec;
}

function usageTotals() {
  return usageLog.reduce((t, r) => ({
    calls: t.calls + 1, input: t.input + (r.input || 0), output: t.output + (r.output || 0), cached: t.cached + (r.cached || 0),
    cost: t.cost + (r.cost || 0), errors: t.errors + (/^error/.test(r.finish) ? 1 : 0), truncated: t.truncated + (r.finish === "length" ? 1 : 0),
  }), { calls: 0, input: 0, output: 0, cached: 0, cost: 0, errors: 0, truncated: 0 });
}

/** Per-label table (biggest first), printed with console.table and returned. */
function usageReport() {
  const by = new Map();
  usageLog.forEach((r) => {
    const k = r.label || "(none)";
    const a = by.get(k) || { label: k, tier: r.tier, model: r.model, calls: 0, errors: 0, truncated: 0, input: 0, output: 0, reasoning: 0, cached: 0, cost: 0, ms: 0 };
    a.calls++; a.input += r.input || 0; a.output += r.output || 0; a.reasoning += r.reasoning || 0; a.cached += r.cached || 0; a.cost += r.cost || 0; a.ms += r.ms || 0;
    if (/^error/.test(r.finish)) a.errors++;
    if (r.finish === "length") a.truncated++;
    by.set(k, a);
  });
  const rows = [...by.values()]
    .map((a) => ({ ...a, avgIn: Math.round(a.input / a.calls), avgOut: Math.round(a.output / a.calls), avgMs: Math.round(a.ms / a.calls), cost: +a.cost.toFixed(4) }))
    .sort((a, b) => (b.input + b.output) - (a.input + a.output));
  rows.forEach((r) => delete r.ms);
  console.table(rows);
  return rows;
}

function resetUsage() {
  usageLog.length = 0;
  try { sessionStorage.removeItem(LS.usage); } catch {}
  document.dispatchEvent(new CustomEvent("ai:usage", { detail: null }));
}

/** Fallback label when a call passes none: "auto:<calling function>". */
function callerLabel() {
  const own = /^(callerLabel|request|requestClaude|complete|chat|json|search|searchTavily|searchOpenRouter|searchClaude|Object\.|Promise|new )/;
  for (const line of String(new Error().stack || "").split("\n").slice(1)) {
    const m = /at (?:async )?([\w$.]+) \(/.exec(line) || /^([\w$.]+)@/.exec(line.trim());
    if (m && !own.test(m[1])) return `auto:${m[1]}`;
  }
  return "auto:unknown";
}

// Provider + model pairs that rejected response_format; later calls put the schema in the prompt instead.
const noFormat = new Set();
const formatRejected = (status, detail) => [400, 404, 422].includes(status) && /response_format|json_schema|json_object|structured|schema|parameter/i.test(detail);
// Models that refused the reasoning setting (e.g. thinking can't be turned off); later calls leave it to the model.
const EFFORTS = ["none", "minimal", "low", "medium", "high"];
const noReasoning = new Set();
const reasoningRejected = (status, detail) => [400, 404, 422].includes(status) && /reasoning|effort|thinking/i.test(detail);

/**
 * One request. Pages call complete / chat / json instead.
 * messages: [{ role: "system" | "user" | "assistant", content: string }]
 * opts: { label, tier: "small" | "large", reasoning?, maxTokens?, model?, signal?, onToken?(delta, fullText), schema?, json?, noContinue? }
 *   onToken enables streaming; schema (JSON Schema) or json: true asks for JSON output via response_format.
 * → { text, raw, finishReason, truncated, continued, model, usage }
 */
async function request(messages, opts = {}) {
  const { model, signal, onToken, schema, json } = opts;
  const cfg = providerConfig();
  if (!cfg.isLocal && !cfg.key) throw new AiError("NO_KEY", `Add your ${cfg.label} API key in AI settings first.`);
  if (cfg.isClaude) return requestClaude(messages, opts, cfg);
  const tier = opts.tier === "small" ? "small" : "large";
  const label = opts.label || callerLabel();
  const maxTokens = Math.max(16, Math.round(opts.maxTokens || DEFAULT_MAX_TOKENS));
  const stream = typeof onToken === "function";
  const useModel = await resolveModel(cfg, model || (tier === "small" ? cfg.smallModel : ""));

  const format = schema ? { type: "json_schema", json_schema: { name: "result", strict: true, schema } }
    : json ? { type: "json_object" } : null;
  const formatKey = format && `${cfg.provider} ${cfg.baseUrl} ${useModel} ${format.type}`;
  let msgs = messages;
  if (format && noFormat.has(formatKey)) msgs = withJsonInstruction(messages, schema);
  // Thinking: OpenRouter only (local servers have no common switch). Billed as output and counted in max_tokens.
  const effort = EFFORTS.includes(opts.reasoning) ? opts.reasoning : tier === "small" ? "none" : "low";
  const reasoningKey = `${cfg.provider} ${useModel}`;

  const body = { model: useModel, messages: msgs, stream, max_tokens: maxTokens };
  if (format && !noFormat.has(formatKey)) body.response_format = format;
  if (!cfg.isLocal && !noReasoning.has(reasoningKey)) body.reasoning = { effort };
  if (!cfg.isLocal) body.usage = { include: true };          // OpenRouter: token counts + cost in the response
  if (stream) body.stream_options = { include_usage: true };   // usage arrives in the last stream chunk

  const t0 = performance.now();
  const log = (finish, usage) => record({ label, tier, provider: cfg.provider, model: useModel, maxTokens, usage, finish, ms: Math.round(performance.now() - t0) });

  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, { method: "POST", signal, headers: headersFor(cfg), body: JSON.stringify(body) });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    log("error:network");
    throw new AiError("NETWORK", unreachable(cfg));
  }

  if (!res.ok) {
    const detail = await errorDetail(res);
    log(`error:${res.status}`);
    if (body.reasoning && reasoningRejected(res.status, detail)) {
      noReasoning.add(reasoningKey);
      console.info(`[AI] ${useModel} rejected reasoning effort "${effort}"; using the model's own default from now on.`);
      return request(messages, opts);
    }
    if (body.response_format && formatRejected(res.status, detail)) {
      noFormat.add(formatKey);
      console.info(`[AI] ${useModel} on ${cfg.label} has no response_format support; putting the JSON shape in the prompt instead.`);
      return request(messages, opts);
    }
    throw httpError(cfg, res, detail);
  }

  let raw = "", finishReason = "", usage = null, reasoning = false;
  if (!stream) {
    const data = await res.json();
    const ch = data.choices?.[0] || {};
    raw = dropThinking(ch.message?.content);
    finishReason = ch.finish_reason || "";
    usage = data.usage || null;
    reasoning = !!(ch.message?.reasoning_content || ch.message?.reasoning);
  } else {
    // Server-sent events: lines like `data: {...}`, comments start with ":", end with `data: [DONE]`
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", full = "", finished = false;
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") { finished = true; break; }
        try {
          const chunk = JSON.parse(payload), ch = chunk.choices?.[0];
          if (chunk.usage) usage = chunk.usage;
          if (ch?.finish_reason) finishReason = ch.finish_reason;
          if (ch?.delta?.reasoning || ch?.delta?.reasoning_content) reasoning = true;
          const delta = ch?.delta?.content;
          if (delta) { full += delta; onToken(delta, full); }
        } catch { /* ignore partial/keep-alive chunks */ }
      }
    }
    raw = dropThinking(full);
  }

  log(finishReason, usage);
  const text = raw.trim(), truncated = finishReason === "length";
  if (!text && (reasoning || truncated)) throw new AiError("TRUNCATED", thinkingOnly(cfg, maxTokens), "");
  return { text, raw, finishReason, truncated, continued: false, model: useModel, usage };
}

/* ---------- Claude API (Messages API) ---------- */

// USD per 1M tokens: [input, 5-min cache write, cache read, output] — platform.claude.com/docs/en/about-claude/pricing (Oct 2026).
// Used for the usage log's cost estimate only: the Claude API returns token counts, not a price.
const CLAUDE_PRICES = {
  "claude-opus-5-5": [4, 5, 0.20, 20],
  "claude-sonnet-5-5": [2, 2.5, 0.10, 10],
  "claude-haiku-5-5": [0.10, 0.125, 0.01, 0.50],
  "claude-haiku-5-5>100k": [0.50, 0.625, 0.05, 2.50],   // Haiku 5.5 prompts over 100,000 tokens
};
const CLAUDE_SEARCH_USD = 0.01;   // $10 per 1,000 web searches
const noFallback = new Set();     // models that refused the refusal-fallback setting

/** Claude usage → the OpenAI-style shape record() reads, with an estimated cost. */
function claudeUsage(u, model) {
  u = u || {};
  const fresh = u.input_tokens || 0, write = u.cache_creation_input_tokens || 0, read = u.cache_read_input_tokens || 0, out = u.output_tokens || 0;
  const prompt = fresh + write + read;
  const p = CLAUDE_PRICES[model === "claude-haiku-5-5" && prompt > 100000 ? "claude-haiku-5-5>100k" : model];
  const searches = u.server_tool_use?.web_search_requests || 0;
  const cost = p ? (fresh * p[0] + write * p[1] + read * p[2] + out * p[3]) / 1e6 + searches * CLAUDE_SEARCH_USD : undefined;
  return { prompt_tokens: prompt, completion_tokens: out, prompt_tokens_details: { cached_tokens: read }, cost };
}

/**
 * The harness's reasoning level → Claude's thinking + effort. Each model turns thinking off differently:
 * Haiku 5.5 takes { type: "disabled" }; Sonnet 5.5 takes { type: "between_tools" }; Opus 5.5 can't, so it gets effort "low".
 */
function claudeReasoning(model, effort) {
  if (effort !== "none") return { effort: effort === "minimal" ? "low" : effort };
  if (/claude-(opus|fable|mythos)-/.test(model)) return { effort: "low" };
  if (/claude-sonnet-5-5/.test(model)) return { thinking: { type: "between_tools" }, effort: "low" };
  return { thinking: { type: "disabled" }, effort: "low" };
}

/** Keywords Claude's structured outputs don't accept (they 400); the prompt still states the limits. */
function claudeSchema(s) {
  if (Array.isArray(s)) return s.map(claudeSchema);
  if (!s || typeof s !== "object") return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "uniqueItems"].includes(k)) continue;
    out[k] = claudeSchema(v);
  }
  return out;
}

/** System messages go in Claude's top-level `system`, cached when long enough (only a stable prefix is worth caching). */
function claudeBody(messages, model, maxTokens, effort, extra = {}) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const body = { model, max_tokens: maxTokens, messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })), ...extra };
  if (system) body.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  const r = noReasoning.has(`claude ${model}`) ? {} : claudeReasoning(model, effort);
  if (r.thinking) body.thinking = r.thinking;
  if (r.effort) body.output_config = { effort: r.effort };
  // If a safety classifier declines, the API reruns the request on a fallback model (Opus / Sonnet 5.5 only).
  if (/claude-(opus|sonnet)-5-5/.test(model) && !noFallback.has(model)) body.fallbacks = "default";
  return body;
}
const claudeBeta = (body) => (body.fallbacks ? "server-side-fallback-2026-07-01" : "");

/** Retries once without a setting the model rejected (and remembers it). Returns true when it changed the body. */
function claudeDrop(body, model, status, detail) {
  if (![400, 404, 422].includes(status)) return false;
  if (body.fallbacks && /fallback/i.test(detail)) { noFallback.add(model); return true; }
  if ((body.thinking || body.output_config?.effort) && /thinking|effort/i.test(detail)) { noReasoning.add(`claude ${model}`); return true; }
  return false;
}

async function requestClaude(messages, opts, cfg) {
  const { model, signal, onToken, schema, json } = opts;
  const tier = opts.tier === "small" ? "small" : "large";
  const label = opts.label || callerLabel();
  const maxTokens = Math.max(16, Math.round(opts.maxTokens || DEFAULT_MAX_TOKENS));
  const stream = typeof onToken === "function";
  const useModel = model || (tier === "small" ? cfg.smallModel : cfg.model);
  const effort = EFFORTS.includes(opts.reasoning) ? opts.reasoning : tier === "small" ? "none" : "low";
  const formatKey = `claude ${useModel} json_schema`;
  // No JSON mode without a schema on Claude: say it in the prompt. Same when the model rejected the schema.
  const useFormat = schema && !noFormat.has(formatKey);
  const msgs = (json || schema) && !useFormat ? withJsonInstruction(messages, schema) : messages;

  const body = claudeBody(msgs, useModel, maxTokens, effort, stream ? { stream: true } : {});
  if (useFormat) body.output_config = { ...body.output_config, format: { type: "json_schema", schema: claudeSchema(schema) } };

  const t0 = performance.now();
  const log = (finish, usage) => record({ label, tier, provider: cfg.provider, model: useModel, maxTokens, usage, finish, ms: Math.round(performance.now() - t0) });

  let res;
  try {
    res = await fetch(`${CLAUDE_URL}/messages`, { method: "POST", signal, headers: headersFor(cfg, claudeBeta(body)), body: JSON.stringify(body) });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    log("error:network");
    throw new AiError("NETWORK", unreachable(cfg));
  }
  if (!res.ok) {
    const detail = await errorDetail(res);
    log(`error:${res.status}`);
    if (claudeDrop(body, useModel, res.status, detail)) return requestClaude(messages, opts, cfg);
    if (useFormat && formatRejected(res.status, detail)) {
      noFormat.add(formatKey);
      console.info(`[AI] ${useModel} rejected the JSON schema; putting the JSON shape in the prompt instead.`);
      return requestClaude(messages, opts, cfg);
    }
    throw httpError(cfg, res, detail);
  }

  let raw = "", stop = "", usage = {}, reasoning = false, refusal = "";
  if (!stream) {
    const data = await res.json();
    (data.content || []).forEach((b) => { if (b.type === "text") raw += b.text; else if (b.type === "thinking") reasoning = true; });
    stop = data.stop_reason || "";
    usage = data.usage || {};
    refusal = data.stop_details?.category || "";
  } else {
    // Server-sent events: `event: <type>` + `data: {...}` pairs, ending with message_stop
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", finished = false;
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        let ev;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        if (ev.type === "message_start") usage = { ...ev.message?.usage };
        else if (ev.type === "content_block_start" && ev.content_block?.type === "thinking") reasoning = true;
        else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") { raw += ev.delta.text; onToken(ev.delta.text, raw); }
        else if (ev.type === "message_delta") { stop = ev.delta?.stop_reason || stop; refusal = ev.delta?.stop_details?.category || refusal; Object.assign(usage, ev.usage); }
        else if (ev.type === "message_stop") { finished = true; break; }
        else if (ev.type === "error") { log("error:stream", claudeUsage(usage, useModel)); throw new AiError("HTTP", `Claude API: ${ev.error?.message || "the stream stopped with an error."}`); }
      }
    }
  }

  const finishReason = stop === "max_tokens" ? "length" : stop === "end_turn" ? "stop" : stop;
  log(finishReason, claudeUsage(usage, useModel));
  if (stop === "refusal") throw new AiError("HTTP", `Claude declined this request${refusal ? ` (${refusal})` : ""}. Rephrase it, or try another model.`);
  const text = raw.trim(), truncated = finishReason === "length";
  if (!text && (reasoning || truncated)) throw new AiError("TRUNCATED", thinkingOnly(cfg, maxTokens), "");
  return { text, raw, finishReason, truncated, continued: false, model: useModel, usage: claudeUsage(usage, useModel) };
}

/** Checks a Claude key with a 1-token Haiku-sized request (GET /models sends no CORS header on a bad key). */
async function pingClaude(cfg) {
  const model = cfg.smallModel || CLAUDE_SMALL_MODEL;
  const body = claudeBody([{ role: "user", content: "Hi" }], model, 1, "none");
  let res;
  try { res = await fetch(`${CLAUDE_URL}/messages`, { method: "POST", headers: headersFor(cfg, claudeBeta(body)), body: JSON.stringify(body) }); }
  catch { throw new AiError("NETWORK", unreachable(cfg)); }
  if (!res.ok) throw httpError(cfg, res, await errorDetail(res), "Test failed.");
  const data = await res.json();
  record({ label: "settings:test-connection", tier: "small", provider: "claude", model, maxTokens: 1, usage: claudeUsage(data.usage, model), finish: "stop", ms: 0 });
  return model;
}

/**
 * One request, plus at most one continuation: when the answer is cut off (finish_reason "length"),
 * the model is asked once to go on from where it stopped and the parts are joined, so the text
 * already written (and paid for) is kept. Still cut off after that → truncated: true.
 */
async function complete(messages, opts = {}) {
  opts = { ...opts, label: opts.label || callerLabel() };
  const first = await request(messages, opts);
  if (!first.truncated || opts.noContinue) return first;
  const onToken = typeof opts.onToken === "function" ? (d, full) => opts.onToken(d, first.raw + full) : undefined;
  const more = await request(messages.concat(
    { role: "assistant", content: first.raw },
    { role: "user", content: "You were cut off. Continue exactly where you stopped. Output only the rest: no repeat of what you already wrote, no commentary." },
  ), { ...opts, label: `${opts.label}:continue`, onToken, schema: undefined, json: false });
  return { ...more, text: joinParts(first.raw, more.raw).trim(), continued: true };
}

/** Joins a cut-off answer and its continuation, dropping any overlap the model repeated. */
function joinParts(a, b) {
  b = b.replace(/^\s*```(?:json)?\s*/i, "");
  for (let k = Math.min(200, a.length, b.length); k > 8; k--) {
    if (a.endsWith(b.slice(0, k))) return a + b.slice(k);
  }
  return a + b;
}

/** Text answer. Throws TRUNCATED (with e.text = the partial answer) when still cut off after one continuation. */
async function chat(messages, opts = {}) {
  const r = await complete(messages, opts);
  if (r.truncated) throw new AiError("TRUNCATED", "The answer was still cut off after one continuation. Ask for less in one go, or lower reasoning.", r.text);
  return r.text;
}

/** Parsed JSON answer. opts.schema (JSON Schema) is enforced by the provider when it can be; otherwise JSON mode. */
async function json(messages, opts = {}) {
  const r = await complete(messages, { ...opts, json: true });
  if (r.truncated) throw new AiError("TRUNCATED", "The answer was still cut off after one continuation, before the JSON closed. Ask for less in one go, or lower reasoning.", r.text);
  const parsed = parseJson(r.text);
  if (parsed === undefined) throw new AiError("BAD_JSON", "The model did not answer with valid JSON. Try again, or use a larger model for this step.", r.text);
  return parsed;
}

function parseJson(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(t); } catch {}
  const a = t.search(/[{[]/), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return undefined;
}

/** For providers without response_format: say the shape in the last user message instead. */
function withJsonInstruction(messages, schema) {
  const note = schema ? `\n\nRespond ONLY with JSON matching this JSON Schema:\n${JSON.stringify(schema)}` : "\n\nRespond ONLY with a JSON object.";
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user" && typeof out[i].content === "string") { out[i] = { ...out[i], content: out[i].content + note }; return out; }
  }
  return out.concat({ role: "user", content: note.trim() });
}

/** Some local servers put a thinking model's reasoning inline as <think>…</think>; keep only the answer. */
const dropThinking = (t) => String(t ?? "").replace(/<think>[\s\S]*?(<\/think>|$)/gi, "");
const thinkingOnly = (cfg, max) => `The model used its whole output (${max} tokens) on thinking and gave no answer. Raise maxTokens, use a model without thinking, or turn thinking off for this model in ${cfg.label}.`;

/**
 * Live web search through OpenRouter's web plugin. The model answers with search
 * results in context; `sources` are the URLs OpenRouter actually returned
 * (url_citation annotations), never URLs the model wrote itself.
 * opts: { model?, signal?, maxResults? (default 5) }  → { text, sources: [{ url, title, content }] }
 * Cost: OpenRouter bills web results on top of the model (see openrouter.ai/docs → Web search).
 * With web search off this returns no results; check canSearch() first.
 */
async function search(messages, opts = {}) {
  const sp = settings.searchProvider;
  if (sp === "off") return { text: "", sources: [] };
  return sp === "tavily" ? searchTavily(messages, opts) : sp === "claude" ? searchClaude(messages, opts) : searchOpenRouter(messages, opts);
}

/**
 * Claude web search (server tool): Claude runs up to 2 searches and answers with citations.
 * `sources` are the cited pages first, then the other results the searches returned — never URLs the model wrote.
 * Cost: $10 per 1,000 searches plus the result tokens (billed as input). maxResults doesn't apply here.
 */
async function searchClaude(messages, { model, signal, label, tier, reasoning, maxTokens = DEFAULT_MAX_TOKENS } = {}) {
  const cfg = providerConfig("claude");
  if (!cfg.key) throw new AiError("NO_KEY", "Add your Claude API key in AI settings first.");
  label = label || callerLabel();
  const useModel = model || (tier === "small" ? cfg.smallModel : cfg.model);
  const effort = EFFORTS.includes(reasoning) ? reasoning : tier === "small" ? "none" : "low";
  // The dynamic-filtering variant needs Opus / Sonnet; other models get the basic tool.
  const tool = { type: /claude-(opus|sonnet)-/.test(useModel) ? "web_search_20260209" : "web_search_20250305", name: "web_search", max_uses: 2 };
  const body = claudeBody(messages, useModel, maxTokens, effort, { tools: [tool] });
  const first = body.messages.slice();
  const blocks = [];
  for (let round = 0; round < 3; round++) {   // a long search turn can pause (pause_turn); continue it at most twice
    const t0 = performance.now();
    const log = (finish, usage) => record({ label, tier: `${tier === "small" ? "small" : "large"}+web`, provider: "claude", model: useModel, maxTokens, usage, finish, ms: Math.round(performance.now() - t0) });
    let res;
    try { res = await fetch(`${CLAUDE_URL}/messages`, { method: "POST", signal, headers: headersFor(cfg, claudeBeta(body)), body: JSON.stringify(body) }); }
    catch (e) {
      if (e.name === "AbortError") throw e;
      log("error:network");
      throw new AiError("NETWORK", unreachable(cfg));
    }
    if (!res.ok) {
      const detail = await errorDetail(res);
      log(`error:${res.status}`);
      if (round === 0 && claudeDrop(body, useModel, res.status, detail)) return searchClaude(messages, { model, signal, label, tier, reasoning, maxTokens });
      throw httpError(cfg, res, detail, "Web search failed.");
    }
    const data = await res.json();
    log(data.stop_reason === "max_tokens" ? "length" : data.stop_reason || "", claudeUsage(data.usage, useModel));
    blocks.push(...(data.content || []));
    if (data.stop_reason !== "pause_turn") break;
    body.messages = first.concat({ role: "assistant", content: blocks.slice() });
  }
  const seen = new Map(), add = (url, title, content) => { if (url && !seen.has(url)) seen.set(url, { url, title: title || url, content: content || "" }); };
  blocks.forEach((b) => (b.type === "text" && Array.isArray(b.citations) ? b.citations : []).forEach((c) => add(c.url, c.title, c.cited_text)));
  blocks.forEach((b) => { if (b.type === "web_search_tool_result" && Array.isArray(b.content)) b.content.forEach((r) => add(r.url, r.title, "")); });
  return { text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""), sources: [...seen.values()] };
}

/** Whether a live web search is available with the current settings. */
const canSearch = () => settings.searchProvider !== "off";

/**
 * Tavily: the model writes 1-3 short queries for the task, Tavily runs them (basic depth = 1 credit each),
 * and the merged results come back in the same shape as the OpenRouter path: notes text + the pages found.
 */
const QUERY_SCHEMA = { type: "object", additionalProperties: false, required: ["queries"], properties: { queries: { type: "array", items: { type: "string" } } } };

async function searchTavily(messages, { model, signal, maxResults = 5, label } = {}) {
  if (!settings.tavilyKey) throw new AiError("NO_KEY", "Add your Tavily API key in AI settings, or choose another web search option.");
  const task = messages.map((m) => m.content).join("\n\n").slice(0, 6000);
  let queries = [];
  try {
    const out = await json([
      { role: "system", content: "You write web search queries." },
      { role: "user", content: `${task}\n\nWrite 1-3 short web search queries (max 12 words each, in the language that will find the best pages) that would find pages answering the task above. Answer as {"queries": ["..."]}.` },
    ], { model, signal, tier: "small", maxTokens: 200, schema: QUERY_SCHEMA, label: `${label || callerLabel()}:queries` });
    queries = (Array.isArray(out?.queries) ? out.queries : []).filter((q) => typeof q === "string" && q.trim()).slice(0, 3);
  } catch (e) {
    if (e.name === "AbortError" || e.code === "NO_KEY") throw e;
  }
  if (!queries.length) queries = [task.replace(/\s+/g, " ").slice(-380)]; // fallback: the end of the task text
  const per = Math.min(8, Math.ceil(maxResults / queries.length) + 1);
  const runs = await Promise.all(queries.map(async (query) => {
    let res;
    try {
      res = await fetch(TAVILY_URL, {
        method: "POST",
        signal,
        headers: { "Authorization": `Bearer ${settings.tavilyKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.slice(0, 400), search_depth: "basic", max_results: per, include_answer: false }),
      });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      // Tavily's error responses carry no CORS header, so a rejected key also lands here.
      throw new AiError("NETWORK", "Could not reach Tavily. Check your Tavily API key in AI settings and your connection.");
    }
    if (!res.ok) {
      const hint = res.status === 401 ? "Your Tavily API key was rejected. Check it in AI settings."
        : res.status === 429 ? "Tavily rate limit. Wait a moment and retry."
        : res.status === 432 || res.status === 433 ? "Your Tavily plan or credit limit is reached."
        : "Tavily search failed.";
      throw new AiError("HTTP", hint);
    }
    return (await res.json()).results || [];
  }));
  const seen = new Map();
  runs.flat().sort((a, b) => (b.score || 0) - (a.score || 0)).forEach((r) => {
    if (r && r.url && !seen.has(r.url)) seen.set(r.url, { url: r.url, title: r.title || r.url, content: String(r.content || "") });
  });
  const sources = [...seen.values()].slice(0, Math.max(maxResults, 3));
  const text = `Web search results (Tavily) for: ${queries.join(" | ")}\n` +
    sources.map((s) => `- [${s.title}](${s.url}): ${s.content.slice(0, 600)}`).join("\n");
  return { text, sources };
}

async function searchOpenRouter(messages, { model, signal, maxResults = 5, label, tier, reasoning, maxTokens = DEFAULT_MAX_TOKENS } = {}) {
  const cfg = providerConfig("openrouter");
  if (!cfg.key) throw new AiError("NO_KEY", "Add your OpenRouter API key in AI settings first.");
  const useModel = model || (tier === "small" ? cfg.smallModel : cfg.model);
  const effort = EFFORTS.includes(reasoning) ? reasoning : tier === "small" ? "none" : "low";
  const t0 = performance.now();
  const log = (finish, usage) => record({ label: label || callerLabel(), tier: `${tier === "small" ? "small" : "large"}+web`, provider: cfg.provider, model: useModel, maxTokens, usage, finish, ms: Math.round(performance.now() - t0) });
  let res;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      signal,
      headers: headersFor(cfg),
      body: JSON.stringify({ model: useModel, messages, max_tokens: maxTokens, usage: { include: true }, plugins: [{ id: "web", max_results: maxResults }],
        ...(noReasoning.has(`${cfg.provider} ${useModel}`) ? {} : { reasoning: { effort } }) }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    log("error:network");
    throw new AiError("NETWORK", unreachable(cfg));
  }
  if (!res.ok) { log(`error:${res.status}`); throw httpError(cfg, res, await errorDetail(res), res.status === 402 ? "Not enough OpenRouter credits for web search." : "Web search failed."); }
  const data = await res.json();
  log(data.choices?.[0]?.finish_reason || "", data.usage);
  const msg = data.choices?.[0]?.message || {};
  const seen = new Map();
  (msg.annotations || []).forEach((a) => {
    const c = a && a.type === "url_citation" && a.url_citation;
    if (c && c.url && !seen.has(c.url)) seen.set(c.url, { url: c.url, title: c.title || c.url, content: c.content || "" });
  });
  return { text: msg.content ?? "", sources: [...seen.values()] };
}

/** Builds the settings dialog once and opens it when `trigger` is clicked. Returns { open }. */
function mountAiSettings(trigger) {
  const dlg = document.createElement("dialog");
  dlg.className = "modal";
  dlg.id = "ai-settings";
  dlg.innerHTML = `
    <div class="modal__head">
      <h2>AI settings</h2>
      <button class="btn btn--ghost btn--sm" type="button" data-modal-close>Close</button>
    </div>
    <div class="modal__body">
      <div class="field">
        <label for="ai-provider">Connect via</label>
        <select class="select" id="ai-provider">
          <option value="openrouter">OpenRouter (cloud, needs an API key)</option>
          <option value="claude">Claude API by Anthropic (cloud, needs an API key)</option>
          <option value="lmstudio">LM Studio (local server)</option>
          <option value="local">Other local server (OpenAI-compatible, e.g. Ollama)</option>
        </select>
      </div>
      <div class="field" id="ai-url-field">
        <label for="ai-url">Server URL</label>
        <input class="input" id="ai-url" type="url" autocomplete="off" spellcheck="false">
        <span class="hint" id="ai-url-hint"></span>
      </div>
      <div class="field">
        <label for="ai-key" id="ai-key-label">OpenRouter API key</label>
        <input class="input" id="ai-key" type="password" autocomplete="off">
        <span class="hint" id="ai-key-hint"></span>
      </div>
      <div class="field">
        <label for="ai-model">Model</label>
        <input class="input" id="ai-model" list="ai-model-list" autocomplete="off" spellcheck="false">
        <datalist id="ai-model-list"></datalist>
        <span class="hint" id="ai-model-hint"></span>
      </div>
      <div class="field">
        <label for="ai-small-model">Small model</label>
        <input class="input" id="ai-small-model" list="ai-model-list" autocomplete="off" spellcheck="false">
        <span class="hint" id="ai-small-model-hint"></span>
      </div>
      <div class="field">
        <label for="ai-search-provider">Web search</label>
        <select class="select" id="ai-search-provider">
          <option value="openrouter">OpenRouter web plugin (uses your OpenRouter key)</option>
          <option value="claude">Claude web search (uses your Claude API key)</option>
          <option value="tavily">Tavily (needs a Tavily API key)</option>
          <option value="off">Off (answers come from the model's own knowledge)</option>
        </select>
        <span class="hint" id="ai-search-hint"></span>
      </div>
      <div class="field" id="ai-tavily-field">
        <label for="ai-tavily-key">Tavily API key</label>
        <input class="input" id="ai-tavily-key" type="password" autocomplete="off" placeholder="tvly-…">
        <span class="hint">Stored only in this browser. Get one at app.tavily.com.</span>
      </div>
      <div class="field">
        <span class="field__label" id="ai-usage-label">Usage this session</span>
        <div class="row" role="group" aria-labelledby="ai-usage-label">
          <span id="ai-usage" aria-live="polite"></span>
          <span class="spacer"></span>
          <button class="btn btn--ghost btn--sm" type="button" id="ai-usage-reset">Reset usage</button>
        </div>
        <span class="hint">For a table per call label, run AI.usageReport() in the browser console.</span>
      </div>
      <div class="banner banner--info" id="ai-status" role="status" hidden></div>
    </div>
    <div class="modal__foot">
      <button class="btn btn--ghost" type="button" id="ai-clear">Remove key</button>
      <button class="btn btn--ghost" type="button" id="ai-test">Test connection</button>
      <button class="btn" type="button" id="ai-save">Save settings</button>
    </div>`;
  document.body.appendChild(dlg);

  const $ = (s) => dlg.querySelector(s);
  const status = (msg) => { const el = $("#ai-status"); el.textContent = msg; el.hidden = !msg; };
  const chosen = () => providerOf($("#ai-provider").value);
  // The provider as filled in on the form (may differ from what is saved).
  const formCfg = () => {
    const p = chosen(), base = providerConfig(p);
    return { ...base, baseUrl: base.isLocal ? (cleanUrl($("#ai-url").value) || PROVIDERS[p].url) : base.baseUrl, key: $("#ai-key").value.trim(),
      smallModel: $("#ai-small-model").value.trim() || base.smallModel };
  };

  let listFor = "";   // provider + URL the model list was loaded for
  const fillModels = async () => {
    const cfg = formCfg(), id = `${cfg.provider} ${cfg.baseUrl}`;
    if (listFor === id) return;
    listFor = id;
    const list = $("#ai-model-list");
    list.innerHTML = "";
    const models = await listModels(cfg.provider, { baseUrl: cfg.baseUrl, key: cfg.key });
    if (listFor !== id) return;   // provider or URL changed while loading
    models.forEach((m) => {
      const o = document.createElement("option");
      o.value = m.id; o.label = m.name; list.appendChild(o);
    });
  };

  // The Tavily key field only shows when Tavily is the chosen web search.
  const syncSearch = () => {
    const v = $("#ai-search-provider").value, hint = $("#ai-search-hint");
    $("#ai-tavily-field").hidden = v !== "tavily";
    hint.textContent = v === "tavily" ? `Tavily runs 1-3 searches per lookup at 1 credit each. The model reads the results through ${PROVIDERS[chosen()].label}.`
      : v === "claude" ? "Claude runs up to 2 searches per lookup at $10 per 1,000 searches, plus the result tokens."
      : v === "off" ? "Steps that need sources will say their values are model estimates."
      : "";
    hint.hidden = !hint.textContent;
  };

  // Show the fields for the chosen provider, filled with what is saved for it.
  const showProvider = () => {
    const cfg = providerConfig(chosen()), local = cfg.isLocal, claude = !!cfg.isClaude;
    $("#ai-url-field").hidden = !local;
    $("#ai-url").value = local ? cfg.baseUrl : "";
    $("#ai-url").placeholder = local ? PROVIDERS[cfg.provider].url : "";
    $("#ai-url-hint").textContent = cfg.provider === "lmstudio"
      ? "In LM Studio, open Developer, start the server, and turn on Enable CORS so this page can reach it."
      : "Any server with an OpenAI-compatible /v1 API. For Ollama, set OLLAMA_ORIGINS=* so this page can reach it.";
    $("#ai-key-label").textContent = local ? "API key (optional)" : claude ? "Claude API key" : "OpenRouter API key";
    $("#ai-key").placeholder = local ? "Only if your server asks for one" : claude ? "sk-ant-…" : "sk-or-v1-…";
    $("#ai-key").value = cfg.key;
    $("#ai-key-hint").textContent = local
      ? "Stored only in this browser and sent only to the server above."
      : claude ? "Stored only in this browser and sent only to api.anthropic.com. Never commit or share a prototype with a key in it."
      : "Stored only in this browser. Never commit or share a prototype with a key in it.";
    $("#ai-model").value = cfg.model;
    $("#ai-model").placeholder = local ? "First loaded model" : claude ? CLAUDE_MODEL : DEFAULT_MODEL;
    $("#ai-model-hint").textContent = local
      ? "Pick a model the server has loaded. Leave empty to use the first one it lists."
      : claude ? `Used for main results and multi-step reasoning. Default: ${CLAUDE_MODEL} ($4 / $20 per million tokens in / out). claude-sonnet-5-5 is $2 / $10.`
      : `Used for main results and multi-step reasoning. Type to search all OpenRouter models. Default: ${DEFAULT_MODEL}`;
    $("#ai-small-model").value = cfg.smallModel;
    $("#ai-small-model").placeholder = local ? "Same as Model" : claude ? CLAUDE_SMALL_MODEL : DEFAULT_SMALL_MODEL;
    $("#ai-small-model-hint").textContent = local
      ? "Used for quick steps (classify, extract, rewrite). Leave empty to use the model above."
      : claude ? `Used for quick steps (classify, extract, rewrite). Default: ${CLAUDE_SMALL_MODEL} ($0.10 / $0.50 per million tokens).`
      : `Used for quick steps (classify, extract, rewrite). Default: ${DEFAULT_SMALL_MODEL}`;
    $("#ai-test").hidden = !(local || claude);
    $("#ai-clear").hidden = !cfg.key;
    // The OpenRouter web plugin and Claude web search only work when their own provider runs the model.
    const sp = $("#ai-search-provider");
    sp.querySelector('option[value="openrouter"]').disabled = cfg.provider !== "openrouter";
    sp.querySelector('option[value="claude"]').disabled = !claude;
    if (sp.selectedOptions[0]?.disabled) sp.value = local ? "off" : cfg.provider;
    syncSearch();
    status(!local && !cfg.key ? `No API key yet. Get one at ${claude ? "platform.claude.com" : "openrouter.ai/keys"}.` : "");
    fillModels();
  };

  const showUsage = () => {
    const t = usageTotals(), n = (x) => x.toLocaleString();
    $("#ai-usage").textContent = !t.calls ? "No AI calls yet."
      : `${n(t.calls)} call${t.calls === 1 ? "" : "s"} · ${n(t.input)} in${t.cached ? ` (${n(t.cached)} cached)` : ""} · ${n(t.output)} out`
        + `${t.cost ? ` · $${t.cost.toFixed(4)}` : ""}${t.errors ? ` · ${t.errors} failed` : ""}${t.truncated ? ` · ${t.truncated} cut off` : ""}`;
    $("#ai-usage-reset").hidden = !t.calls;
  };
  document.addEventListener("ai:usage", () => { if (dlg.open) showUsage(); });
  $("#ai-usage-reset").addEventListener("click", () => { resetUsage(); showUsage(); });

  const open = () => {
    showUsage();
    $("#ai-provider").value = settings.provider;
    $("#ai-search-provider").value = settings.searchProvider;
    $("#ai-tavily-key").value = settings.tavilyKey;
    showProvider();
    dlg.showModal();
  };

  $("#ai-provider").addEventListener("change", showProvider);
  $("#ai-search-provider").addEventListener("change", syncSearch);
  $("#ai-url").addEventListener("change", () => { $("#ai-model").value = ""; fillModels(); });

  $("#ai-test").addEventListener("click", async () => {
    const cfg = formCfg();
    status(`Connecting to ${cfg.baseUrl}…`);
    if (cfg.isClaude) {
      if (!cfg.key) { status("Add your Claude API key first."); $("#ai-key").focus(); return; }
      try { status(`Connected to the Claude API. Your key works with ${await pingClaude(cfg)}.`); }
      catch (e) { status(e.message); }
      return;
    }
    try {
      const models = await fetchLocalModels(cfg);
      status(models.length
        ? `Connected to ${cfg.label}. ${models.length} model${models.length === 1 ? "" : "s"} available.`
        : `Connected to ${cfg.label}, but no model is loaded. Load one, then test again.`);
      listFor = ""; fillModels();
    } catch (e) {
      status(e.message);
    }
  });

  $("#ai-save").addEventListener("click", () => {
    if ($("#ai-search-provider").value === "tavily" && !$("#ai-tavily-key").value.trim()) {
      status("Add your Tavily API key, or choose another web search option.");
      $("#ai-tavily-key").focus();
      return;
    }
    const url = $("#ai-url").value.trim();
    if (PROVIDERS[chosen()].local && url && !/^https?:\/\/\S+$/i.test(url)) {
      status("Enter the server URL starting with http:// or https://, for example http://localhost:1234/v1.");
      $("#ai-url").focus();
      return;
    }
    settings.save({ provider: chosen(), baseUrl: url, apiKey: $("#ai-key").value, model: $("#ai-model").value, smallModel: $("#ai-small-model").value, tavilyKey: $("#ai-tavily-key").value, searchProvider: $("#ai-search-provider").value });
    document.dispatchEvent(new CustomEvent("ai:settings-changed"));
    dlg.close();
  });
  $("#ai-clear").addEventListener("click", () => {
    settings.clearKey(chosen()); $("#ai-key").value = ""; $("#ai-clear").hidden = true;
    document.dispatchEvent(new CustomEvent("ai:settings-changed"));
    status("API key removed from this browser.");
  });

  trigger?.addEventListener("click", open);
  return { open };
}

window.AI = {
  DEFAULT_MODEL, DEFAULT_SMALL_MODEL, DEFAULT_MAX_TOKENS, PROVIDERS, AiError, settings, listModels,
  complete, chat, json, search, canSearch, mountSettings: mountAiSettings,
  usageLog, usageTotals, usageReport, resetUsage,
};
})();
