import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { runComplete } from "./service";
import { sseResponse } from "../test-utils";

const claudeCfg = getConfig({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "k" });
const orCfg = getConfig({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" });
const mockCfg = getConfig({ AI_MOCK: "1" });
const msgs = [{ role: "user" as const, content: "hi" }];
const base = { messages: msgs, label: "chat:test", tier: "small" as const };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); vi.spyOn(console, "info").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ce = (type: string, o: object = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
const claudeStream = (parts: string[], stop = "end_turn", extra: object = {}) => [
  ce("message_start", { message: { usage: { input_tokens: 12, output_tokens: 1 } } }),
  ce("content_block_start", { content_block: { type: "text" } }),
  ...parts.map((t) => ce("content_block_delta", { delta: { type: "text_delta", text: t } })),
  ce("message_delta", { delta: { stop_reason: stop, ...extra }, usage: { output_tokens: 7 } }),
  ce("message_stop"),
];

describe("streaming on Claude", () => {
  it("sends stream:true, emits deltas in order and returns the joined text with usage", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(claudeStream(["Hel", "lo ", "there"])));
    const got: string[] = [];
    const { data, records } = await runComplete(base, undefined, claudeCfg, (t) => got.push(t));
    expect(got).toEqual(["Hel", "lo ", "there"]);
    expect(data).toMatchObject({ text: "Hello there", finishReason: "stop", truncated: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ label: "chat:test", input: 12, output: 7, finish: "stop" });
  });

  it("copes with events cut at arbitrary byte positions", async () => {
    const all = claudeStream(["ab", "cd"]).join("");
    const pieces = all.match(/[\s\S]{1,17}/g)!;
    fetchMock.mockResolvedValueOnce(sseResponse(pieces));
    const got: string[] = [];
    const { data } = await runComplete(base, undefined, claudeCfg, (t) => got.push(t));
    expect(got.join("")).toBe("abcd");
    expect(data.text).toBe("abcd");
  });

  it("continues a cut-off stream once, streaming the continuation too, and joins the parts", async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse(claudeStream(["The quick brown fox"], "max_tokens")))
      .mockResolvedValueOnce(sseResponse(claudeStream([" jumps."], "end_turn")));
    const got: string[] = [];
    const { data, records } = await runComplete(base, undefined, claudeCfg, (t) => got.push(t));
    expect(got).toEqual(["The quick brown fox", " jumps."]);
    expect(data).toMatchObject({ text: "The quick brown fox jumps.", continued: true, truncated: false });
    expect(records.map((r) => r.label)).toEqual(["chat:test", "chat:test:continue"]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).stream).toBe(true);
  });

  it("turns a refusal that arrives in the stream into an error", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(claudeStream([], "refusal", { stop_details: { category: "policy" } })));
    await expect(runComplete(base, undefined, claudeCfg, () => {})).rejects.toMatchObject({ code: "HTTP", message: expect.stringContaining("declined") });
  });

  it("turns an error event mid-stream into an HTTP error carrying the message", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([ce("message_start", { message: { usage: {} } }), ce("error", { error: { message: "overloaded" } })]));
    await expect(runComplete(base, undefined, claudeCfg, () => {})).rejects.toMatchObject({ code: "HTTP", message: expect.stringContaining("overloaded") });
  });

  it("flags a stream that only thought as TRUNCATED", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([ce("message_start", { message: { usage: {} } }), ce("content_block_start", { content_block: { type: "thinking" } }), ce("message_delta", { delta: { stop_reason: "max_tokens" } }), ce("message_stop")]));
    await expect(runComplete(base, undefined, claudeCfg, () => {})).rejects.toMatchObject({ code: "TRUNCATED" });
  });

  it("a failed request is retried before any delta, per the retry rules", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "slow" } }), { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(sseResponse(claudeStream(["ok"])));
    const got: string[] = [];
    await runComplete(base, undefined, claudeCfg, (t) => got.push(t));
    expect(got).toEqual(["ok"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("without onDelta the call is not streamed", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ content: [{ type: "text", text: "x" }], stop_reason: "end_turn", usage: {} }));
    await runComplete(base, undefined, claudeCfg);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBeUndefined();
  });
});

describe("streaming on OpenRouter", () => {
  const chunk = (o: object) => `data: ${JSON.stringify(o)}\n\n`;

  it("asks for usage in the stream, emits deltas and reads finish reason and usage from the chunks", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([
      ": OPENROUTER PROCESSING\n\n",
      chunk({ choices: [{ delta: { content: "Hi" } }] }),
      chunk({ choices: [{ delta: { content: " you" }, finish_reason: "stop" }] }),
      chunk({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 3, cost: 0.001 } }),
      "data: [DONE]\n\n",
    ]));
    const got: string[] = [];
    const { data, records } = await runComplete(base, undefined, orCfg, (t) => got.push(t));
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(got).toEqual(["Hi", " you"]);
    expect(data).toMatchObject({ text: "Hi you", finishReason: "stop" });
    expect(records[0]).toMatchObject({ input: 9, output: 3, cost: 0.001 });
  });

  it("ignores partial JSON chunks and drops inline <think> from the final text", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([
      chunk({ choices: [{ delta: { content: "<think>hmm</think>Answer" }, finish_reason: "stop" }] }),
      "data: {not json\n\n",
      "data: [DONE]\n\n",
    ]));
    const { data } = await runComplete(base, undefined, orCfg, () => {});
    expect(data.text).toBe("Answer");
  });
});

describe("streaming in mock mode", () => {
  it("streams the canned answer in pieces that add up to the text", async () => {
    const got: string[] = [];
    const { data } = await runComplete({ ...base, label: "entry:draft-node", schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false } }, undefined, mockCfg, (t) => got.push(t));
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got.join("")).toBe(data.text);
  });

  it("stops when the caller aborts", async () => {
    const ac = new AbortController();
    const got: string[] = [];
    const p = runComplete({ ...base, label: "chat:router", messages: [{ role: "user", content: 'USER MESSAGE: "hello"\n' }] }, ac.signal, mockCfg, (t) => { got.push(t); ac.abort(); });
    await expect(p).rejects.toMatchObject({ code: "ABORTED" });
    expect(got).toHaveLength(1);
  });
});
