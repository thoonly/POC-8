import { beforeEach, describe, expect, it, vi } from "vitest";

const json = vi.fn();
vi.mock("../ai/client", () => ({ json: (...a: unknown[]) => json(...a) }));
vi.mock("../lang/enforce", () => ({ enforceAnchorLanguage: async (o: unknown) => o }));

import { AiError } from "../ai/errors";
import {
  GAPS_SCHEMA, answerLines, gapAnalysisPrompt, normalizeGaps, runGapAnalysis, unansweredQuestions, withAdditionalDetails,
} from "./gaps";

beforeEach(() => { json.mockReset(); }); // a block: a returned function would run as a teardown

describe("normalizeGaps", () => {
  it("drops entries without a question, trims, caps options at 5 and gaps at 5", () => {
    const out = normalizeGaps({
      gaps: [
        { question: " How many people? ", options: [" 10 ", "", 5, "20", "30", "40", "50", "60"], multi: 1 },
        { question: "  ", options: ["x"], multi: false },
        null,
        { options: ["y"] },
        { question: "When?", options: "nope", multi: false },
        ...Array.from({ length: 6 }, (_, i) => ({ question: `Q${i}`, options: [], multi: false })),
      ],
    });
    expect(out).toHaveLength(5);
    expect(out![0]).toEqual({ prompt: "How many people?", options: ["10", "20", "30", "40", "50"], multi: true });
    expect(out![1]).toEqual({ prompt: "When?", options: [], multi: false });
  });
  it("tells an unreadable answer (null) from no gaps ([])", () => {
    expect(normalizeGaps({ gaps: [] })).toEqual([]);
    expect(normalizeGaps({})).toBeNull();
    expect(normalizeGaps(null)).toBeNull();
    expect(normalizeGaps({ gaps: "x" })).toBeNull();
  });
});

describe("gapAnalysisPrompt", () => {
  it("carries the topic and the rules, and the ledger only when something is known", () => {
    const p = gapAnalysisPrompt("Plan an offsite");
    expect(p).toContain('"Plan an offsite"');
    expect(p).toContain("ABOUT THE USER:");
    expect(p).toContain("SEVERAL PLACES:");
    expect(p).not.toContain("Already answered by the user earlier");
    expect(gapAnalysisPrompt("Plan an offsite", [{ q: "How many?", a: "20", node: "entry" }])).toContain("- How many? → 20");
  });
});

describe("GAPS_SCHEMA", () => {
  it("is strict: every object closed, every key required, at most 3 levels", () => {
    // Depth counts objects and arrays only (root = 1); a string leaf is not a level of nesting.
    const check = (s: Record<string, unknown>, depth: number): number => {
      let deepest = s.type === "object" || s.type === "array" ? depth : depth - 1;
      if (s.type === "object") {
        expect(s.additionalProperties).toBe(false);
        expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties as object).sort());
        for (const v of Object.values(s.properties as Record<string, Record<string, unknown>>)) deepest = Math.max(deepest, check(v, depth + 1));
      }
      if (s.type === "array") deepest = Math.max(deepest, check(s.items as Record<string, unknown>, depth + 1));
      return deepest;
    };
    expect(check(GAPS_SCHEMA as Record<string, unknown>, 1)).toBeLessThanOrEqual(4); // root, then gaps (1), item (2), options (3)
  });
});

describe("runGapAnalysis", () => {
  it("returns the questions, labelled and small, with the strict schema", async () => {
    json.mockResolvedValue({ gaps: [{ question: "How many people?", options: ["10", "20"], multi: false }] });
    const r = await runGapAnalysis("Plan an offsite", "Plan an offsite", []);
    expect(r).toEqual({ ok: true, gaps: [{ prompt: "How many people?", options: ["10", "20"], multi: false }] });
    const [messages, opts] = json.mock.calls[0];
    expect(messages).toHaveLength(1);
    expect(opts).toMatchObject({ label: "entry:gap-analysis", tier: "small", schema: GAPS_SCHEMA });
    expect(opts.maxTokens).toBeUndefined();
  });
  it("drops a question that repeats an answered one", async () => {
    json.mockResolvedValue({ gaps: [{ question: "How many people are joining?", options: [], multi: false }, { question: "What is the budget?", options: [], multi: false }] });
    const r = await runGapAnalysis("t", "t", [{ q: "How many people are joining the trip?", a: "20", node: "entry" }]);
    expect(r.gaps.map((g) => g.prompt)).toEqual(["What is the budget?"]);
  });
  it("is ok with no gaps when nothing is missing", async () => {
    json.mockResolvedValue({ gaps: [] });
    expect(await runGapAnalysis("t", "t", [])).toEqual({ ok: true, gaps: [] });
  });
  it("is not ok when the answer is unreadable or the call fails", async () => {
    json.mockResolvedValueOnce({ nope: true });
    expect(await runGapAnalysis("t", "t", [])).toEqual({ ok: false, gaps: [] });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    json.mockRejectedValueOnce(new AiError("HTTP", "boom"));
    expect(await runGapAnalysis("t", "t", [])).toEqual({ ok: false, gaps: [] });
    err.mockRestore();
  });
  it("lets an abort through", async () => {
    json.mockImplementation(async () => { throw new AiError("ABORTED", "aborted"); });
    const err = await runGapAnalysis("t", "t", []).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("ABORTED");
  });
});

describe("answers", () => {
  const groups = [
    { prompt: "How many people?", options: [], multi: false },
    { prompt: "Which cities?", options: [], multi: true },
    { prompt: "When?", options: [], multi: false },
  ];
  const picked = [["20"], ["Tokyo", "Kyoto"], []];
  it("lists only answered questions", () => {
    expect(answerLines(groups, picked)).toEqual(["How many people? → 20", "Which cities? → Tokyo, Kyoto"]);
  });
  it("keeps the unanswered ones open", () => {
    expect(unansweredQuestions(groups, picked)).toEqual(["When?"]);
  });
  it("adds the answers to the topic", () => {
    expect(withAdditionalDetails("Plan a trip", ["A → 1", "B → 2"])).toBe("Plan a trip\n\nAdditional details:\n- A → 1\n- B → 2");
  });
});
