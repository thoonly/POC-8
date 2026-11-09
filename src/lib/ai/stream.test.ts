import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ai, onUsage } from "./client";
import { peekJsonField, splitSse } from "./json";
import { sseResponse } from "./test-utils";


describe("splitSse", () => {
  it("returns complete data lines and keeps the unfinished rest", () => {
    expect(splitSse('data: {"a":1}\n\ndata: {"b"')).toEqual({ payloads: ['{"a":1}'], rest: 'data: {"b"' });
  });
  it("ignores comments, other fields and CRLF", () => {
    expect(splitSse(": keep-alive\r\nevent: x\r\ndata: one\r\n\r\ndata:two\n").payloads).toEqual(["one", "two"]);
  });
  it("is empty for an empty buffer", () => expect(splitSse("")).toEqual({ payloads: [], rest: "" }));
});

describe("peekJsonField", () => {
  it("is undefined until the key has appeared, and for non-objects", () => {
    expect(peekJsonField("", "reply")).toBeUndefined();
    expect(peekJsonField('{"kind":"que', "reply")).toBeUndefined();
    expect(peekJsonField('{"kind":"question","reply"', "reply")).toBeUndefined();
    expect(peekJsonField('["reply"]', "reply")).toBeUndefined();
  });

  it("returns a string value as far as it is written, then complete", () => {
    expect(peekJsonField('{"kind":"question","reply":"Hel', "reply")).toEqual({ value: "Hel", complete: false });
    expect(peekJsonField('{"kind":"question","reply":"Hello there","actions":[', "reply")).toEqual({ value: "Hello there", complete: true });
  });

  it("decodes escapes and waits for half-written ones", () => {
    expect(peekJsonField('{"reply":"a\\nb \\"q\\" \\u0e44\\u0e17', "reply")?.value).toBe('a\nb "q" ไท');
    expect(peekJsonField('{"reply":"x\\', "reply")).toEqual({ value: "x", complete: false });
    expect(peekJsonField('{"reply":"x\\u0e4', "reply")).toEqual({ value: "x", complete: false });
  });

  it("reads booleans, and only once the literal is whole", () => {
    expect(peekJsonField('{"needs_research":true,"reply":"', "needs_research")).toEqual({ value: true, complete: true });
    expect(peekJsonField('{"needs_research":false}', "needs_research")?.value).toBe(false);
    expect(peekJsonField('{"needs_research":tr', "needs_research")).toBeUndefined();
  });

  it("skips other fields, including nested objects, arrays and key-like text inside strings", () => {
    const text = '{"kind":"q","decision_help":{"question":"reply","options":["a","}"]},"facts":[{"field":"reply"}],"n":1,"reply":"found it"}';
    expect(peekJsonField(text, "reply")).toEqual({ value: "found it", complete: true });
    expect(peekJsonField('{"decision_help":{"question":"x","opt', "reply")).toBeUndefined(); // nested value unfinished
    expect(peekJsonField('{"kind":"the \\"reply\\": nope","reply":"real"}', "reply")?.value).toBe("real");
  });

  it("only looks at the top level", () => {
    expect(peekJsonField('{"decision_help":{"reply":"nested"}}', "reply")).toBeUndefined();
  });

  it("never returns a value that is not there for any prefix of a real answer", () => {
    const full = '{"kind":"command","needs_research":false,"search_query":"","reply":"Added it, \\"done\\".","actions":[{"op":"x","value":"reply"}]}';
    let last = "";
    for (let i = 0; i <= full.length; i++) {
      const v = peekJsonField(full.slice(0, i), "reply")?.value;
      if (typeof v === "string") {
        expect("Added it, \"done\".".startsWith(v)).toBe(true);
        expect(v.length).toBeGreaterThanOrEqual(last.length); // only ever grows
        last = v;
      }
    }
    expect(last).toBe('Added it, "done".');
  });
});

describe("ai client streaming", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
  const done = (text: string) => ev({ t: "done", data: { text, finishReason: "stop", truncated: false, continued: false, model: "m", usage: null }, records: [{ label: "x:y" }] });
  const opts = { label: "chat:test", tier: "small" as const };

  it("calls onToken per piece with the text so far, resolves with the final answer, and reports usage", async () => {
    // the second event is cut in half across two network chunks
    const second = ev({ t: "delta", text: "wor" });
    fetchMock.mockResolvedValueOnce(sseResponse([ev({ t: "delta", text: "Hello " }), second.slice(0, 9), second.slice(9) + ev({ t: "delta", text: "ld" }), done("Hello world")]));
    const seen: [string, string][] = [];
    const rows: unknown[] = [];
    const off = onUsage((r) => rows.push(...r));
    const out = await ai.chat([{ role: "user", content: "hi" }], { ...opts, onToken: (d, f) => seen.push([d, f]) });
    off();
    expect(out).toBe("Hello world");
    expect(seen).toEqual([["Hello ", "Hello "], ["wor", "Hello wor"], ["ld", "Hello world"]]);
    expect(rows).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai/stream");
  });

  it("parses the streamed JSON for ai.json", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([ev({ t: "delta", text: '{"a":' }), ev({ t: "delta", text: "1}" }), done('{"a":1}')]));
    expect(await ai.json([{ role: "user", content: "x" }], { ...opts, onToken: () => {} })).toEqual({ a: 1 });
  });

  it("throws the AiError carried by an error event, keeping its code and text", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([ev({ t: "delta", text: "par" }), ev({ t: "error", error: { code: "TIMEOUT", message: "too slow" } })]));
    await expect(ai.chat([{ role: "user", content: "x" }], { ...opts, onToken: () => {} })).rejects.toMatchObject({ code: "TIMEOUT", message: "too slow" });
  });

  it("treats a stream that ends without done as a network error", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([ev({ t: "delta", text: "par" })]));
    await expect(ai.chat([{ role: "user", content: "x" }], { ...opts, onToken: () => {} })).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("maps a refused connection and a non-200 to AiError, and an abort to ABORTED", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(ai.chat([{ role: "user", content: "x" }], { ...opts, onToken: () => {} })).rejects.toMatchObject({ code: "NETWORK" });
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    await expect(ai.chat([{ role: "user", content: "x" }], { ...opts, onToken: () => {} })).rejects.toMatchObject({ code: "HTTP" });
    const ac = new AbortController();
    ac.abort();
    fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    await expect(ai.chat([{ role: "user", content: "x" }], { ...opts, onToken: () => {}, signal: ac.signal })).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("without onToken it still uses /api/ai/complete", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, data: { text: "plain", finishReason: "stop", truncated: false, continued: false, model: "m", usage: null } }));
    expect(await ai.chat([{ role: "user", content: "x" }], opts)).toBe("plain");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai/complete");
  });

  it("still validates label and tier before streaming", async () => {
    await expect(ai.chat([{ role: "user", content: "x" }], { label: "bad", tier: "small", onToken: () => {} })).rejects.toThrow(/label/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
