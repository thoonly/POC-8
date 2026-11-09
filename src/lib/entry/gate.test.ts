import { describe, expect, it } from "vitest";
import {
  CLARITY_SCHEMA, PROMPT_GATE_INTRO, ambiguousDefault, ambiguousMessage, clarityPrompt, fallbackMerge, fileNote, gateItems,
  incompleteMessage, normalizeClarity, promptLooksBroken, resolveGateStep, unclearMessage, weakPromptNote, type Clarity,
} from "./gate";

const clarity = (over: Partial<Clarity> = {}): Clarity => ({
  case: "clear", prompt: "", intro: "", question: "", message: "", term: "",
  options: [], interpretations: [], suggestions: [], ideas: [], default_index: undefined, ...over,
});
const two = [{ label: "The company", detail: "its growth", prompt: "Amazon the company's growth" }, { label: "Sales on Amazon", detail: "", prompt: "Grow my sales on Amazon" }];
const ctx = (over: Partial<{ original: string; turns: { q: string; a: string }[]; attachments: string[] }> = {}) => ({ original: "Plan an offsite", turns: [], attachments: [], ...over });

describe("promptLooksBroken", () => {
  it("flags text that cannot be a request", () => {
    for (const t of ["", " ", "A", "??", "—", "!!"]) expect(promptLooksBroken(t)).toBe(true);
  });
  it("accepts short but real text in any script", () => {
    for (const t of ["AI", "ขาย", "销售", "Q3"]) expect(promptLooksBroken(t)).toBe(false);
  });
});

describe("gateItems", () => {
  it("drops items without a label, trims, and fills a missing prompt from the label", () => {
    const out = gateItems([{ label: " A ", detail: " d ", prompt: " p " }, { label: "  " }, null, { label: "B" }, "x"], 4);
    expect(out).toEqual([{ label: "A", detail: "d", prompt: "p" }, { label: "B", detail: "", prompt: "B" }]);
  });
  it("caps the list and tolerates a non-array", () => {
    expect(gateItems([{ label: "a" }, { label: "b" }, { label: "c" }], 2)).toHaveLength(2);
    expect(gateItems(undefined, 3)).toEqual([]);
    expect(gateItems("nope", 3)).toEqual([]);
  });
});

describe("normalizeClarity", () => {
  it("lowercases the case and keeps only usable fields", () => {
    const c = normalizeClarity({ case: " Broad ", prompt: "p", message: 5, default_index: 1.5, suggestions: [] });
    expect(c).toMatchObject({ case: "broad", prompt: "p", message: "", default_index: undefined });
  });
  it("keeps an integer default_index", () => {
    expect(normalizeClarity({ case: "ambiguous", default_index: 1 })?.default_index).toBe(1);
  });
  it("is null without a case", () => {
    expect(normalizeClarity({ prompt: "x" })).toBeNull();
    expect(normalizeClarity(null)).toBeNull();
  });
});

describe("resolveGateStep", () => {
  it("a clear prompt finishes on the person's own words, ignoring the model's rewrite", () => {
    expect(resolveGateStep(clarity({ prompt: "Plan an offsite, rewritten" }), ctx())).toEqual({ kind: "finish", target: "Plan an offsite", weak: null });
  });
  it("after Chat turns, finishes on the merged prompt", () => {
    const turns = [{ q: "q", a: "Bangkok" }];
    expect(resolveGateStep(clarity({ prompt: "Plan an offsite in Bangkok" }), ctx({ turns }))).toEqual({ kind: "finish", target: "Plan an offsite in Bangkok", weak: null });
  });
  it("falls back to joining the answers when the model gave no merged prompt", () => {
    const turns = [{ q: "q", a: "Bangkok" }, { q: "q2", a: "20 people" }];
    expect(resolveGateStep(clarity(), ctx({ turns }))).toMatchObject({ kind: "finish", target: "Plan an offsite — Bangkok — 20 people" });
  });
  it("broad and multi finish but carry the verdict", () => {
    const broad = clarity({ case: "broad", suggestions: [{ label: "x", prompt: "y" }] });
    const step = resolveGateStep(broad, ctx());
    expect(step).toMatchObject({ kind: "finish", target: "Plan an offsite" });
    expect(step.kind === "finish" && step.weak).toBe(broad);
    expect(resolveGateStep(clarity({ case: "multi" }), ctx())).toMatchObject({ kind: "finish" });
  });
  it("unclear, incomplete and ambiguous block", () => {
    expect(resolveGateStep(clarity({ case: "unclear" }), ctx()).kind).toBe("unclear");
    expect(resolveGateStep(clarity({ case: "incomplete", prompt: "Analyze this document" }), ctx())).toMatchObject({ kind: "incomplete", merged: "Analyze this document" });
    expect(resolveGateStep(clarity({ case: "ambiguous", interpretations: two }), ctx())).toMatchObject({ kind: "ambiguous" });
  });
  it("an ambiguous verdict with fewer than two meanings is not a choice", () => {
    expect(resolveGateStep(clarity({ case: "ambiguous", interpretations: [two[0]] }), ctx())).toMatchObject({ kind: "finish", weak: null });
  });
  it("an unknown case is treated as clear", () => {
    expect(resolveGateStep(clarity({ case: "weird" }), ctx())).toMatchObject({ kind: "finish", weak: null });
  });
  it("a broken prompt is unclear whatever the model says, until the person adds something", () => {
    expect(resolveGateStep(clarity({ case: "clear" }), ctx({ original: "A" })).kind).toBe("unclear");
    expect(resolveGateStep(null, ctx({ original: "??" })).kind).toBe("unclear");
    expect(resolveGateStep(clarity({ case: "clear" }), ctx({ original: "A", turns: [{ q: "q", a: "the letter A" }] })).kind).toBe("finish");
    expect(resolveGateStep(clarity({ case: "clear" }), ctx({ original: "A", attachments: ["a.txt"] })).kind).toBe("finish");
  });
  it("a failed check carries on with what there is", () => {
    expect(resolveGateStep(null, ctx())).toEqual({ kind: "finish", target: "Plan an offsite", weak: null });
    expect(resolveGateStep(null, ctx({ turns: [{ q: "q", a: "Bangkok" }] }))).toEqual({ kind: "finish", target: "Plan an offsite — Bangkok", weak: null });
  });
});

describe("unclearMessage", () => {
  it("English: fixed intro, the model's question, at most 3 lettered options in the history", () => {
    const m = unclearMessage(clarity({ case: "unclear", intro: "ignored", question: "What does “A” mean here?", options: [{ label: "A letter" }, { label: "A grade" }, { label: "Plan A" }, { label: "extra" }] }), "A");
    expect(m.intro).toBe(`${PROMPT_GATE_INTRO} What does “A” mean here?`);
    expect(m.options).toHaveLength(3);
    expect(m.historyText).toBe(`${m.intro} A. A letter B. A grade C. Plan A`);
  });
  it("English: asks about the typed words itself when the model gave no question", () => {
    expect(unclearMessage(clarity(), "sales").intro).toBe(`${PROMPT_GATE_INTRO} What do you mean by “sales”?`);
  });
  it("non-English: uses the model's own intro and no canned question", () => {
    expect(unclearMessage(clarity({ intro: "ยินดีช่วย ขอบริบทเพิ่มหน่อย…" }), "ขาย").intro).toBe("ยินดีช่วย ขอบริบทเพิ่มหน่อย…");
    expect(unclearMessage(clarity(), "ขาย").intro).toBe(PROMPT_GATE_INTRO);
  });
});

describe("messages", () => {
  it("incomplete and ambiguous have defaults", () => {
    expect(incompleteMessage(clarity())).toContain("input to work on is missing");
    expect(ambiguousMessage(clarity({ term: "Amazon" }))).toBe("“Amazon” could mean a few different things. Which one do you mean?");
    expect(ambiguousMessage(clarity())).toBe("This could mean a few different things. Which one do you mean?");
    expect(ambiguousMessage(clarity({ message: "Which Amazon?", term: "Amazon" }))).toBe("Which Amazon?");
  });
  it("ambiguousDefault follows default_index and falls back to the first", () => {
    const list = gateItems(two, 4);
    expect(ambiguousDefault(clarity({ default_index: 1 }), list).label).toBe("Sales on Amazon");
    expect(ambiguousDefault(clarity({ default_index: -1 }), list).label).toBe("The company");
    expect(ambiguousDefault(clarity({ default_index: 9 }), list).label).toBe("The company");
    expect(ambiguousDefault(clarity(), list).label).toBe("The company");
  });
});

describe("weakPromptNote", () => {
  it("broad offers suggestions with a default message", () => {
    const n = weakPromptNote(clarity({ case: "broad", suggestions: [{ label: "Pricing", prompt: "Plan pricing" }] }));
    expect(n?.message).toContain("quite broad");
    expect(n?.items).toEqual([{ label: "Pricing", detail: "", prompt: "Plan pricing" }]);
  });
  it("multi offers ideas, and the model's message wins", () => {
    const n = weakPromptNote(clarity({ case: "multi", message: "Two requests.", ideas: [{ label: "Wedding", prompt: "Plan my wedding" }] }));
    expect(n?.message).toBe("Two requests.");
    expect(n?.items[0].prompt).toBe("Plan my wedding");
  });
  it("is null when there is nothing to offer", () => {
    expect(weakPromptNote(clarity({ case: "broad" }))).toBeNull();
  });
});

describe("fallbackMerge / fileNote", () => {
  it("joins the original and every answer", () => {
    expect(fallbackMerge("A", [{ q: "", a: "the letter" }])).toBe("A — the letter");
  });
  it("collapses whitespace and caps a file's excerpt at 600 characters", () => {
    expect(fileNote("a.txt", "one\n\n two")).toBe("\n- a.txt: one two");
    expect(fileNote("b.txt", "x".repeat(2000)).length).toBeLessThanOrEqual("\n- b.txt: ".length + 600);
  });
});

describe("clarityPrompt", () => {
  it("embeds the request, the Chat turns, the attachments and the language guard", () => {
    const p = clarityPrompt("Analyze this", [{ q: "Which?", a: "The Q3 report" }], ["q3.txt"]);
    expect(p).toContain('Original request: "Analyze this"');
    expect(p).toContain("- Asked: Which?\n  Answered: The Q3 report");
    expect(p).toContain("Files the person has attached: q3.txt.");
    expect(p).toContain("Do not mix in ANY word");
  });
  it("says so when nothing is attached or said", () => {
    const p = clarityPrompt("Plan", [], []);
    expect(p).toContain("No files are attached.");
    expect(p).not.toContain("What the person has said since");
  });
});

describe("CLARITY_SCHEMA", () => {
  it("follows the strict-schema rules from CLAUDE.md", () => {
    const check = (s: Record<string, unknown>) => {
      if (s.type !== "object") return;
      expect(s.additionalProperties).toBe(false);
      expect(s.required).toEqual(Object.keys(s.properties as object));
      Object.values(s.properties as Record<string, Record<string, unknown>>).forEach((p) => { check(p); if (p.items) check(p.items as Record<string, unknown>); });
    };
    check(CLARITY_SCHEMA);
  });
  it("lists \"clear\" first so a schema-generated mock answer is a clear prompt", () => {
    expect((CLARITY_SCHEMA.properties as { case: { enum: string[] } }).case.enum[0]).toBe("clear");
  });
});
