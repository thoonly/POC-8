import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "../errors";
import { getConfig, modelFor, timeoutMs } from "./config";
import { claudeReasoning, claudeUsage } from "./claude";
import { fromSchema } from "./mock";
import { runComplete, runInfo, runSearch } from "./service";

const claudeCfg = { ...getConfig({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "k" }) };
const orCfg = { ...getConfig({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" }) };
const msgs = [{ role: "user" as const, content: "hi" }];

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const claudeText = (text: string, stop = "end_turn") => reply({ content: [{ type: "text", text }], stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("config", () => {
  it("resolves tier models with defaults and env overrides", () => {
    expect(modelFor("claude", "small", {})).toBe("claude-haiku-5-5");
    expect(modelFor("claude", "large", {})).toBe("claude-opus-5-5");
    expect(modelFor("openrouter", "small", {})).toBe("anthropic/claude-haiku-5.5");
    expect(modelFor("claude", "large", { CLAUDE_MODEL_LARGE: "x" })).toBe("x");
  });
  it("scales the timeout with the output ceiling and clamps it", () => {
    expect(timeoutMs(100)).toBe(45_000);
    expect(timeoutMs(8192)).toBe(180_000);
    expect(timeoutMs(3000)).toBe(66_000);
  });
});

describe("claude reasoning + usage", () => {
  it("maps none per model", () => {
    expect(claudeReasoning("claude-opus-5-5", "none")).toEqual({ effort: "low" });
    expect(claudeReasoning("claude-sonnet-5-5", "none")).toEqual({ thinking: { type: "between_tools" }, effort: "low" });
    expect(claudeReasoning("claude-haiku-5-5", "none")).toEqual({ thinking: { type: "disabled" }, effort: "low" });
    expect(claudeReasoning("claude-haiku-5-5", "minimal")).toEqual({ effort: "low" });
    expect(claudeReasoning("claude-haiku-5-5", "high")).toEqual({ effort: "high" });
  });
  it("estimates cost from the price table", () => {
    const u = claudeUsage({ input_tokens: 50_000, output_tokens: 1_000_000 }, "claude-haiku-5-5");
    expect(u.cost).toBeCloseTo(0.005 + 0.5);
    // Haiku 5.5 prompts over 100k tokens use the higher price tier.
    expect(claudeUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "claude-haiku-5-5").cost).toBeCloseTo(0.5 + 2.5);
    expect(claudeUsage({ input_tokens: 1 }, "unknown-model").cost).toBeNull();
  });
});

describe("runComplete validation", () => {
  it("rejects a call without label or tier", async () => {
    await expect(runComplete({ messages: msgs, tier: "small" }, undefined, claudeCfg)).rejects.toMatchObject({ code: "HTTP" });
    await expect(runComplete({ messages: msgs, label: "a:b" }, undefined, claudeCfg)).rejects.toMatchObject({ code: "HTTP" });
    await expect(runComplete({ messages: [], label: "a:b", tier: "small" }, undefined, claudeCfg)).rejects.toMatchObject({ code: "HTTP" });
  });
  it("reports a missing key as NO_KEY without calling the network", async () => {
    const cfg = getConfig({ AI_PROVIDER: "claude" });
    await expect(runComplete({ messages: msgs, label: "a:b", tier: "small" }, undefined, cfg)).rejects.toMatchObject({ code: "NO_KEY" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("runComplete on Claude", () => {
  it("sends system as top-level, tier model, key header and strips unsupported schema keywords", async () => {
    fetchMock.mockResolvedValueOnce(claudeText('{"a":1}'));
    const schema = { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "array", maxItems: 2, items: { type: "string" } } } };
    const { data, records } = await runComplete({
      messages: [{ role: "system", content: "rules" }, { role: "user", content: "go" }], label: "t:x", tier: "small", schema,
    }, undefined, claudeCfg);
    expect(data.text).toBe('{"a":1}');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ label: "t:x", tier: "small", provider: "claude", model: "claude-haiku-5-5", finish: "stop" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("k");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.system[0].text).toBe("rules");
    expect(body.messages).toEqual([{ role: "user", content: "go" }]);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config.format.schema.properties.a).toEqual({ type: "array", items: { type: "string" } });
  });

  it("continues once when cut off and joins the parts", async () => {
    fetchMock
      .mockResolvedValueOnce(claudeText("The quick brown fox jumps ov", "max_tokens"))
      .mockResolvedValueOnce(claudeText("brown fox jumps over the lazy dog."));
    const { data, records } = await runComplete({ messages: msgs, label: "t:long", tier: "large" }, undefined, claudeCfg);
    expect(data.continued).toBe(true);
    expect(data.truncated).toBe(false);
    // The model repeated "brown fox jumps ov" (18 chars); the overlap is dropped.
    expect(data.text).toBe("The quick brown fox jumps over the lazy dog.");
    expect(records.map((r) => r.label)).toEqual(["t:long", "t:long:continue"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("flags truncated when still cut off after the continuation, and never continues twice", async () => {
    fetchMock.mockResolvedValueOnce(claudeText("aaa", "max_tokens")).mockResolvedValueOnce(claudeText("bbb", "max_tokens"));
    const { data } = await runComplete({ messages: msgs, label: "t:long", tier: "large" }, undefined, claudeCfg);
    expect(data.truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps a 401 to an actionable HTTP error and does not retry it", async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: { message: "bad key" } }, 401));
    await expect(runComplete({ messages: msgs, label: "t:x", tier: "small" }, undefined, claudeCfg)).rejects.toMatchObject({
      code: "HTTP", message: expect.stringContaining("ANTHROPIC_API_KEY"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 429 and then succeeds", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(reply({ error: { message: "slow down" } }, 429)).mockResolvedValueOnce(claudeText("ok"));
    const p = runComplete({ messages: msgs, label: "t:x", tier: "small" }, undefined, claudeCfg);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await p).data.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 3 transient retries (4 requests)", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => reply({ error: { message: "down" } }, 503));
    const p = runComplete({ messages: msgs, label: "t:x", tier: "small" }, undefined, claudeCfg);
    const assertion = expect(p).rejects.toMatchObject({ code: "HTTP" });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("drops a rejected schema, remembers it, and retries with the shape in the prompt", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ error: { message: "output_config.format: schema not supported" } }, 400))
      .mockResolvedValueOnce(claudeText('{"a":1}'));
    const schema = { type: "object", properties: { a: { type: "number" } } };
    const { data } = await runComplete({ messages: msgs, label: "t:fmt", tier: "large", schema }, undefined, claudeCfg);
    expect(data.text).toBe('{"a":1}');
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.output_config.format).toBeUndefined();
    expect(second.messages[0].content).toContain("Respond ONLY with JSON");
  });

  it("throws TRUNCATED when the model only thought and wrote no answer", async () => {
    fetchMock.mockResolvedValueOnce(reply({ content: [{ type: "thinking", thinking: "..." }], stop_reason: "max_tokens", usage: {} }));
    await expect(runComplete({ messages: msgs, label: "t:think", tier: "large", maxTokens: 500 }, undefined, claudeCfg)).rejects.toMatchObject({ code: "TRUNCATED" });
  });

  it("does not retry a timeout and reports TIMEOUT", async () => {
    // fetch rejects with a "TimeoutError" DOMException when AbortSignal.timeout fires.
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    await expect(runComplete({ messages: msgs, label: "t:slow", tier: "small", maxTokens: 100 }, undefined, claudeCfg)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports ABORTED when the caller cancels", async () => {
    const ac = new AbortController();
    fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }));
    const p = runComplete({ messages: msgs, label: "t:x", tier: "small" }, ac.signal, claudeCfg);
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: "ABORTED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("runComplete on OpenRouter", () => {
  it("uses chat/completions with response_format, reasoning effort and usage cost", async () => {
    fetchMock.mockResolvedValueOnce(reply({
      choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 7, completion_tokens: 3, cost: 0.0012, prompt_tokens_details: { cached_tokens: 2 } },
    }));
    const schema = { type: "object", properties: {} };
    const { data, records } = await runComplete({ messages: msgs, label: "t:or", tier: "large", schema }, undefined, orCfg);
    expect(data.text).toBe('{"ok":true}');
    expect(records[0]).toMatchObject({ provider: "openrouter", model: "anthropic/claude-sonnet-5.5", input: 7, output: 3, cached: 2, cost: 0.0012 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer k");
    const body = JSON.parse(init.body);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "result", strict: true, schema } });
    expect(body.reasoning).toEqual({ effort: "low" });
  });

  it("sends the entry:draft-node payload exactly as specified (sonnet, effort low, no response_format)", async () => {
    fetchMock.mockResolvedValueOnce(reply({
      choices: [{ finish_reason: "stop", message: { content: '{"node_name":"n","context":"c","topic":"t"}' } }],
      usage: { prompt_tokens: 587, completion_tokens: 170, cost: 0.002874 },
    }));
    const { draftPrompt } = await import("@/lib/entry/draft");
    const prompt = draftPrompt("Plan a two-day offsite for our 20-person design team in Bangkok");
    await runComplete({ messages: [{ role: "user", content: prompt }], label: "entry:draft-node", tier: "large" }, undefined, orCfg);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: "anthropic/claude-sonnet-5.5",
      messages: [{ role: "user", content: prompt }],
      stream: false,
      max_tokens: 8192,
      reasoning: { effort: "low" },
      usage: { include: true },
    });
  });

  it("reads a real chat/completions reply: content is a JSON string, reasoning is null, usage carries cost and details", async () => {
    // Shape of the reply the team pasted (ids and numbers from it; the text is a fake example).
    fetchMock.mockResolvedValueOnce(reply({
      id: "gen-1793952416-8hHvskkufzPsSAEVo3Zx",
      model: "anthropic/claude-sonnet-5.5",
      object: "chat.completion",
      choices: [{
        index: 0, finish_reason: "stop", native_finish_reason: "end_turn",
        message: { role: "assistant", content: '{"node_name":"Bangkok Design Offsite","context":"A request to plan an offsite.","topic":"Explore what the offsite needs."}', refusal: null, reasoning: null },
      }],
      usage: {
        prompt_tokens: 587, completion_tokens: 170, total_tokens: 757, cost: 0.002874,
        prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 },
      },
    }));
    const { data, records } = await runComplete({ messages: msgs, label: "entry:draft-node", tier: "large" }, undefined, orCfg);
    expect(data.finishReason).toBe("stop");
    expect(data.truncated).toBe(false);
    expect(JSON.parse(data.text)).toEqual({
      node_name: "Bangkok Design Offsite", context: "A request to plan an offsite.", topic: "Explore what the offsite needs.",
    });
    expect(records[0]).toMatchObject({ model: "anthropic/claude-sonnet-5.5", input: 587, output: 170, cost: 0.002874 });
  });

  it("uses json_object for json:true without a schema and strips <think>", async () => {
    fetchMock.mockResolvedValueOnce(reply({ choices: [{ finish_reason: "stop", message: { content: "<think>hm</think>{}" } }] }));
    const { data } = await runComplete({ messages: msgs, label: "t:or2", tier: "small", json: true }, undefined, orCfg);
    expect(data.text).toBe("{}");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toEqual({ type: "json_object" });
  });
});

describe("runSearch", () => {
  it("is empty when search is off", async () => {
    const cfg = { ...claudeCfg, search: "off" as const };
    expect((await runSearch({ messages: msgs, label: "t:s", tier: "small" }, undefined, cfg)).data).toEqual({ text: "", sources: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Claude search collects cited pages first, then other results, and marks the tier +web", async () => {
    fetchMock.mockResolvedValueOnce(reply({
      stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50, server_tool_use: { web_search_requests: 1 } },
      content: [
        { type: "web_search_tool_result", content: [{ url: "https://b.test", title: "B" }, { url: "https://a.test", title: "A" }] },
        { type: "text", text: "answer", citations: [{ url: "https://a.test", title: "A", cited_text: "quote" }] },
      ],
    }));
    const { data, records } = await runSearch({ messages: msgs, label: "t:s", tier: "large" }, undefined, claudeCfg);
    expect(data.text).toBe("answer");
    expect(data.sources.map((s) => s.url)).toEqual(["https://a.test", "https://b.test"]);
    expect(records[0].tier).toBe("large+web");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools[0]).toMatchObject({ name: "web_search", max_uses: 2, type: "web_search_20260209" });
  });

  it("Tavily search writes queries with the small tier first, then merges results by score", async () => {
    const cfg = { ...claudeCfg, search: "tavily" as const, tavilyKey: "tk" };
    fetchMock
      .mockResolvedValueOnce(claudeText('{"queries":["alpha","beta"]}'))
      .mockImplementation(async (_u: string, init: RequestInit) => {
        const q = JSON.parse(String(init.body)).query;
        return reply({ results: q === "alpha" ? [{ url: "https://x.test", title: "X", content: "cx", score: 0.2 }] : [{ url: "https://y.test", title: "Y", content: "cy", score: 0.9 }] });
      });
    const { data, records } = await runSearch({ messages: msgs, label: "t:s", tier: "large" }, undefined, cfg);
    expect(records[0].label).toBe("t:s:queries");
    expect(data.sources.map((s) => s.url)).toEqual(["https://y.test", "https://x.test"]);
    expect(data.text).toContain("alpha | beta");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer tk");
  });

  it("Tavily without a key is NO_KEY", async () => {
    const cfg = { ...claudeCfg, search: "tavily" as const, tavilyKey: "" };
    fetchMock.mockResolvedValueOnce(claudeText('{"queries":["q"]}'));
    await expect(runSearch({ messages: msgs, label: "t:s", tier: "large" }, undefined, cfg)).rejects.toBeInstanceOf(AiError);
  });
});

describe("mock mode", () => {
  const mockCfg = { ...claudeCfg, mock: true };
  it("answers without a key or the network, generating JSON from the schema", async () => {
    const cfg = { ...mockCfg, anthropicKey: "" };
    const schema = {
      type: "object", required: ["label", "items", "kind", "n"],
      properties: { label: { type: "string" }, items: { type: "array", maxItems: 3, items: { type: "string" } }, kind: { type: "string", enum: ["a", "b"] }, n: { type: "integer" } },
    };
    const { data, records } = await runComplete({ messages: msgs, label: "t:m", tier: "small", schema }, undefined, cfg);
    expect(JSON.parse(data.text)).toEqual({ label: "Mock text", items: ["Mock text", "Mock text"], kind: "a", n: 0 });
    expect(records[0].provider).toBe("mock");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("returns a placeholder for prose and {} for json without a schema", async () => {
    expect((await runComplete({ messages: msgs, label: "t:p", tier: "small" }, undefined, mockCfg)).data.text).toBe("Mock answer for t:p.");
    expect((await runComplete({ messages: msgs, label: "t:j", tier: "small", json: true }, undefined, mockCfg)).data.text).toBe("{}");
  });
  it("uses the entry:draft-node fixture: a believable name, context and topic from the prompt", async () => {
    const { draftPrompt } = await import("@/lib/entry/draft");
    const { data } = await runComplete(
      { messages: [{ role: "user", content: draftPrompt("Analyze our competitors in the SaaS market") }], label: "entry:draft-node", tier: "large" },
      undefined, mockCfg,
    );
    const out = JSON.parse(data.text);
    expect(out.node_name).toBe("Analyze our competitors in");
    expect(out.context).toContain("Analyze our competitors in the SaaS market");
    expect(Object.keys(out).sort()).toEqual(["context", "node_name", "topic"]);
  });
  it("fromSchema respects minItems/maxItems", () => {
    expect(fromSchema({ type: "array", minItems: 3, maxItems: 5, items: { type: "string" } })).toHaveLength(3);
    expect(fromSchema({ type: "array", maxItems: 1, items: { type: "string" } })).toHaveLength(1);
  });
});

describe("runInfo", () => {
  it("reports readiness without exposing keys", () => {
    const info = runInfo(claudeCfg);
    expect(info).toEqual({ provider: "claude", search: "provider", mock: false, models: { small: "claude-haiku-5-5", large: "claude-opus-5-5" }, ready: true });
    expect(JSON.stringify(info)).not.toContain('"k"');
    expect(runInfo({ ...claudeCfg, anthropicKey: "" }).ready).toBe(false);
    expect(runInfo({ ...claudeCfg, search: "tavily", tavilyKey: "" }).search).toBe("off");
  });
});
