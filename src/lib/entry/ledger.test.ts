import { describe, expect, it } from "vitest";
import { ledgerAdd, ledgerBlock, ledgerDropRepeats, ledgerFacts, ledgerIsRepeat, type LedgerEntry } from "./ledger";

const L: LedgerEntry[] = [{ q: "How many people are joining?", a: "20", node: "entry" }];

describe("ledgerAdd", () => {
  it("adds without mutating, and ignores an empty question or answer", () => {
    const out = ledgerAdd([], "How long?", "2 days", "entry");
    expect(out).toEqual([{ q: "How long?", a: "2 days", node: "entry" }]);
    expect(ledgerAdd(L, " ", "x", "entry")).toEqual(L);
    expect(ledgerAdd(L, "q", "  ", "entry")).toEqual(L);
    expect(L).toHaveLength(1);
  });
  it("replaces the answer to the same question, ignoring case", () => {
    expect(ledgerAdd(L, "how many people are joining?", "30", "intent")).toEqual([{ q: "How many people are joining?", a: "30", node: "intent" }]);
  });
});

describe("ledgerFacts / ledgerBlock", () => {
  it("lists answers once, with any extra facts", () => {
    expect(ledgerFacts(L, ["Budget → low", "How many people are joining? → 20"])).toEqual(["How many people are joining? → 20", "Budget → low"]);
  });
  it("is empty until something is known", () => {
    expect(ledgerBlock([])).toBe("");
    expect(ledgerBlock(L)).toContain("- How many people are joining? → 20");
  });
});

describe("repeats", () => {
  it("flags a reworded repeat but not a different question", () => {
    expect(ledgerIsRepeat(L, "How many people are joining the trip?")).toBe(true);
    expect(ledgerIsRepeat(L, "What is the total budget?")).toBe(false);
  });
  it("never flags very short text", () => {
    expect(ledgerIsRepeat(L, "Who")).toBe(false);
  });
  it("drops repeats from a list", () => {
    const gaps = [{ question: "How many people are joining?" }, { question: "When is the deadline?" }];
    expect(ledgerDropRepeats(L, gaps, (g) => g.question)).toEqual([{ question: "When is the deadline?" }]);
  });
  it("works for Thai", () => {
    const th: LedgerEntry[] = [{ q: "มีคนเข้าร่วมกี่คน", a: "20", node: "entry" }];
    expect(ledgerIsRepeat(th, "มีคนเข้าร่วมกี่คน")).toBe(true);
  });
});
