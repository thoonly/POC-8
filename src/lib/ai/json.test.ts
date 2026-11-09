import { describe, expect, it } from "vitest";
import {
  claudeSchema, dropThinking, extractJsonCandidates, joinParts, parseJson, repairUnescapedQuotes, runWithConcurrencyLimit, withJsonInstruction,
} from "./json";

describe("parseJson", () => {
  it("parses plain and fenced JSON", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("takes the JSON out of surrounding prose", () => {
    expect(parseJson('Here you go: {"a":[1,2]} hope it helps')).toEqual({ a: [1, 2] });
  });
  it("prefers the LAST balanced object when the model thinks aloud first", () => {
    expect(parseJson('First idea {"x": } no. Final: {"x": 2}')).toEqual({ x: 2 });
  });
  it("repairs unescaped quotes inside a string value", () => {
    expect(parseJson('{"t":"She said "hello" to him","n":1}')).toEqual({ t: 'She said "hello" to him', n: 1 });
  });
  it("returns undefined when nothing parses", () => {
    expect(parseJson("no json here")).toBeUndefined();
    expect(parseJson("")).toBeUndefined();
  });
});

describe("extractJsonCandidates", () => {
  it("ignores braces inside strings", () => {
    expect(extractJsonCandidates('{"t":"a } b { c"} {"u":1}')).toEqual(['{"t":"a } b { c"}', '{"u":1}']);
  });
  it("finds nothing in an unterminated object", () => {
    expect(extractJsonCandidates('{"a":1')).toEqual([]);
  });
});

describe("repairUnescapedQuotes", () => {
  it("leaves valid JSON untouched", () => {
    const s = '{"a":"b","c":["d"]}';
    expect(repairUnescapedQuotes(s)).toBe(s);
  });
  it("keeps escaped quotes", () => {
    const s = '{"a":"x \\" y"}';
    expect(repairUnescapedQuotes(s)).toBe(s);
  });
});

describe("runWithConcurrencyLimit", () => {
  it("keeps order, settles rejections and never exceeds the limit", async () => {
    let live = 0, peak = 0;
    const out = await runWithConcurrencyLimit([1, 2, 3, 4, 5], 2, async (n) => {
      live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      if (n === 3) throw new Error("boom");
      return n * 10;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(out.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled"]);
    expect(out[4]).toEqual({ status: "fulfilled", value: 50 });
  });
  it("handles an empty list", async () => {
    expect(await runWithConcurrencyLimit([], 3, async () => 1)).toEqual([]);
  });
});

describe("joinParts", () => {
  it("drops text the continuation repeated", () => {
    expect(joinParts('{"a":"hello wor', 'hello world"}')).toBe('{"a":"hello world"}');
  });
  it("joins when nothing overlaps", () => {
    expect(joinParts("abc", "def")).toBe("abcdef");
  });
  it("strips a code fence the continuation started with", () => {
    expect(joinParts("abc", "```json\ndef")).toBe("abcdef");
  });
});

describe("withJsonInstruction", () => {
  it("appends the schema to the last user message", () => {
    const out = withJsonInstruction([{ role: "user", content: "hi" }, { role: "assistant", content: "ok" }], { type: "object" });
    expect(out[0].content).toContain("hi");
    expect(out[0].content).toContain('{"type":"object"}');
  });
  it("adds a user message when there is none", () => {
    expect(withJsonInstruction([{ role: "system", content: "s" }])).toHaveLength(2);
  });
});

describe("dropThinking", () => {
  it("removes closed and unclosed think blocks", () => {
    expect(dropThinking("<think>a</think>answer")).toBe("answer");
    expect(dropThinking("answer<think>never closed")).toBe("answer");
  });
});

describe("claudeSchema", () => {
  it("removes keywords Claude rejects, at any depth", () => {
    const s = { type: "object", properties: { a: { type: "array", maxItems: 3, items: { type: "string", maxLength: 9 } } }, required: ["a"] };
    expect(claudeSchema(s)).toEqual({ type: "object", properties: { a: { type: "array", items: { type: "string" } } }, required: ["a"] });
  });
});
