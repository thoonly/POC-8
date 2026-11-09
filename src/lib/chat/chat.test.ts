import { describe, expect, it } from "vitest";
import { sanitizeChatChoices } from "./choices";
import { sanitizeDecision } from "./decision";
import { hideOpenMarkup, parseChatMd, parseInline } from "./markdown";
import { contextBlock, docSnapshot, historyBlock, langRules, routerPrompt, ROUTER_SCHEMA, RESEARCH_SCHEMA, DECISION_SCHEMA } from "./prompts";
import type { ChatDoc } from "./types";
import { truncateForCard } from "../text";

const doc: ChatDoc = {
  topic: "Plan a trip", answer: "", generated: true,
  categories: [{ label: "Budget", topics: ["Flights"] }, { label: "Skeleton", topics: [], skeleton: true }],
  actions: [{ text: "Book", tier: "suggested" }, { text: "Maybe visit", tier: "available" }], notes: ["remember visas"],
};

describe("parseChatMd", () => {
  it("handles bold, italics, bullets, headings and line breaks", () => {
    expect(parseInline("a **b** _c_ d")).toEqual([{ text: "a " }, { text: "b", b: true }, { text: " " }, { text: "c", i: true }, { text: " d" }]);
    const blocks = parseChatMd("### Title\nline one\nline two\n\n- x\n- y");
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "ul"]);
    expect(blocks[1]).toMatchObject({ t: "p", lines: [[{ text: "line one" }], [{ text: "line two" }]] });
  });
  it("turns pipe rows into a table and pads short rows", () => {
    const [t] = parseChatMd("| A | B |\n| --- | --- |\n| 1 |");
    expect(t).toMatchObject({ t: "table" });
    if (t.t === "table") { expect(t.head).toHaveLength(2); expect(t.rows[0]).toHaveLength(2); expect(t.rows[0][1]).toEqual([]); }
  });
  it("never produces markup: HTML in the text stays text", () => {
    const [b] = parseChatMd("<img src=x onerror=alert(1)>");
    expect(b).toEqual({ t: "p", lines: [[{ text: "<img src=x onerror=alert(1)>" }]] });
  });
  it("tolerates empty and non-string input", () => {
    expect(parseChatMd("")).toEqual([]);
    expect(parseChatMd(undefined as unknown as string)).toEqual([]);
  });
});

describe("hideOpenMarkup", () => {
  it("drops a bold marker that has not been closed yet, and keeps closed ones", () => {
    expect(hideOpenMarkup("Mock **What s")).toBe("Mock What s");
    expect(hideOpenMarkup("Mock **bold** and **tw")).toBe("Mock **bold** and tw");
    expect(hideOpenMarkup("all **closed**")).toBe("all **closed**");
  });
  it("drops an italic opener that has not been closed yet", () => {
    expect(hideOpenMarkup("see _ita")).toBe("see ita");
    expect(hideOpenMarkup("see _done_")).toBe("see _done_");
    expect(hideOpenMarkup("snake_case_name")).toBe("snake_case_name");
  });
  it("never changes text without markers, and once complete equals the final text", () => {
    expect(hideOpenMarkup("plain text")).toBe("plain text");
    const full = "A **bold** move, _really_.";
    for (let i = 0; i <= full.length; i++) {
      const shown = hideOpenMarkup(full.slice(0, i));
      expect(shown.length).toBeLessThanOrEqual(full.slice(0, i).length);
    }
    expect(hideOpenMarkup(full)).toBe(full);
  });
});

describe("sanitizeChatChoices", () => {
  it("keeps 2-5 unique trimmed options, drops weak groups, caps at 4 groups", () => {
    const out = sanitizeChatChoices([
      { prompt: " Which? ", multi: 1, options: [" a ", "a", "b", "", 3, "c", "d", "e", "f"] },
      { prompt: "Only one", options: ["x"] },
      { prompt: "", options: ["x", "y"] },
      ...Array.from({ length: 6 }, (_, i) => ({ prompt: `P${i}`, options: ["x", "y"] })),
    ]);
    expect(out[0]).toEqual({ prompt: "Which?", multi: true, options: ["a", "b", "c", "d", "e"] });
    expect(out.map((g) => g.prompt)).toEqual(["Which?", "P0"]); // only the first 4 groups are read; "Only one" and the empty prompt are dropped
    expect(sanitizeChatChoices("nope")).toEqual([]);
  });
});

describe("sanitizeDecision", () => {
  const res = {
    intro: " Intro ",
    options: [
      { option: "tokyo", summary: "s", pros: ["p1", "p2", "p3", "p4"], cons: [], best_if: "b", fit: "good" },
      { option: "Kyoto", fit: "excellent" },
      { option: "Paris", fit: "best" }, // not offered
    ],
    recommendation: { option: "KYOTO", why: "why", confidence: "certain" },
    preference_questions: [{ q: "Budget?", multi: false, options: ["low", "high"] }, { q: "x", options: ["only one"] }],
  };
  it("accepts only offered options, restores their spelling, and ranks the recommendation first", () => {
    const out = sanitizeDecision(res, { options: ["Tokyo", "Kyoto"] });
    expect(out.options.map((o) => o.option)).toEqual(["Kyoto", "Tokyo"]);
    expect(out.options[1].pros).toHaveLength(3);
    expect(out.options[0].fit).toBe("unknown");
    expect(out.recommendation).toEqual({ option: "Kyoto", why: "why", confidence: "medium" });
    expect(out.prefs).toHaveLength(1);
  });
  it("ignores a recommendation that is not among the options", () => {
    expect(sanitizeDecision({ ...res, recommendation: { option: "Paris", why: "", confidence: "high" } }, { options: ["Tokyo", "Kyoto"] }).recommendation).toBeNull();
  });
  it("is safe on garbage", () => expect(sanitizeDecision(null, { options: [] })).toEqual({ intro: "", options: [], recommendation: null, prefs: [] }));
});

describe("prompts", () => {
  it("lists stable ids, hides skeletons, and separates suggested from available actions", () => {
    const s = docSnapshot(doc);
    expect(s).toContain("[cat-0] Budget");
    expect(s).toContain("[topic-0-0] Flights");
    expect(s).not.toContain("Skeleton");
    expect(s).toMatch(/Suggested actions[\s\S]*\[action-0\] Book[\s\S]*Available actions[\s\S]*\[action-1\] Maybe visit/);
    expect(s).toContain("remember visas");
  });
  it("tells the model what is possible before anything is generated", () => {
    expect(docSnapshot({ ...doc, generated: false })).toContain("nothing generated yet");
  });
  it("budgets context and skips items still loading", () => {
    const items = [
      { id: "ctx-1", title: "A", kind: "text" as const, text: "x".repeat(5000), sources: [], loading: false },
      { id: "ctx-2", title: "B", kind: "file" as const, text: "", sources: [], loading: true },
    ];
    const b = contextBlock(items);
    expect(b).toContain("[ctx-1]");
    expect(b).not.toContain("[ctx-2]");
    expect(b.length).toBeLessThan(2400);
    expect(contextBlock([])).toBe("CONTEXT LIBRARY: (empty)");
  });
  it("keeps only the last 10 history lines", () => {
    const h = Array.from({ length: 14 }, (_, i) => ({ role: "user" as const, text: `m${i}` }));
    const b = historyBlock(h);
    expect(b).not.toContain("m3\n");
    expect(b).toContain("m13");
  });
  it("anchors the language to the originating prompt, not the message", () => {
    expect(langRules("ไปเที่ยวญี่ปุ่น")).toContain("ไปเที่ยวญี่ปุ่น");
    const p = routerPrompt({ doc, context: [], history: [], anchor: "Plan a trip" }, "hello", false);
    expect(p).toContain('USER MESSAGE: "hello"');
    expect(routerPrompt({ doc, context: [], history: [], anchor: "x" }, "ctx", true)).toContain('NEW CONTEXT EVENT: "ctx"');
  });

  // CLAUDE.md schema rules: object root, additionalProperties:false and every property required on every object, <= 3 levels.
  const walk = (s: Record<string, unknown>, depth: number, problems: string[]) => {
    if (s.type === "object") {
      const props = (s.properties ?? {}) as Record<string, Record<string, unknown>>;
      if (s.additionalProperties !== false) problems.push("additionalProperties");
      if (JSON.stringify(s.required) !== JSON.stringify(Object.keys(props))) problems.push("required");
      if (depth > 3) problems.push("depth");
      Object.values(props).forEach((p) => walk(p, depth + 1, problems));
    }
    if (s.type === "array") walk(s.items as Record<string, unknown>, depth + 1, problems);
  };
  for (const [name, schema] of Object.entries({ ROUTER_SCHEMA, RESEARCH_SCHEMA, DECISION_SCHEMA })) {
    it(`${name} follows the strict-schema rules`, () => {
      const problems: string[] = [];
      expect(schema.type).toBe("object");
      walk(schema, 1, problems);
      expect(problems).toEqual([]);
    });
  }
});

describe("truncateForCard", () => {
  it("leaves short text alone and cuts long text on a word with an ellipsis", () => {
    expect(truncateForCard("short", 10)).toBe("short");
    expect(truncateForCard("one two three four five", 14)).toBe("one two three…");
    expect(truncateForCard(null, 5)).toBe("");
  });
  it("never splits a Thai cluster", () => {
    const out = truncateForCard("ภาษาไทยเป็นภาษาที่มีวรรณยุกต์", 8);
    expect(out.endsWith("…")).toBe(true);
    expect(/^[ัิ-ฺ็-๎]/.test(out.slice(-2))).toBe(false);
  });
});
