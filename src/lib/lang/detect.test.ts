import { describe, expect, it } from "vitest";
import { collectStrings, detectTextLanguage, isLikelyNonEnglish, languagesMatch, setLeaf, tokenBudgetMultiplier } from "./detect";

describe("detectTextLanguage", () => {
  it("detects non-Latin scripts", () => {
    expect(detectTextLanguage("วางแผนทริปญี่ปุ่นสำหรับทีม")).toEqual({ script: "thai", lang: "thai" });
    expect(detectTextLanguage("分析我们的竞争对手")?.script).toBe("han");
    expect(detectTextLanguage("日本への出張を予約してください")?.script).toBe("japanese");
  });
  it("tells Latin-script languages apart by function words", () => {
    expect(detectTextLanguage("What is the plan for our team and how should we do it")).toEqual({ script: "latin", lang: "en" });
    expect(detectTextLanguage("Wir sind nicht sicher, wie die Planung mit dem Team ist")).toEqual({ script: "latin", lang: "de" });
  });
  it("returns lang null for short Latin text, null for no letters", () => {
    expect(detectTextLanguage("Bangkok offsite")).toEqual({ script: "latin", lang: null });
    expect(detectTextLanguage("123 456")).toBeNull();
    expect(detectTextLanguage("")).toBeNull();
  });
});

describe("languagesMatch", () => {
  it("treats unknown as a match, differing scripts as a mismatch", () => {
    expect(languagesMatch(null, { script: "thai", lang: "thai" })).toBe(true);
    expect(languagesMatch({ script: "thai", lang: "thai" }, { script: "latin", lang: "en" })).toBe(false);
    expect(languagesMatch({ script: "latin", lang: "en" }, { script: "latin", lang: "de" })).toBe(false);
    expect(languagesMatch({ script: "latin", lang: "en" }, { script: "latin", lang: null })).toBe(true);
  });
});

describe("isLikelyNonEnglish / tokenBudgetMultiplier", () => {
  it("flags text with >15% non-ASCII", () => {
    expect(isLikelyNonEnglish("สวัสดีครับ")).toBe(true);
    expect(isLikelyNonEnglish("Plan an offsite")).toBe(false);
    expect(isLikelyNonEnglish("")).toBe(false);
  });
  it("budgets 2.8x for Thai/CJK and 1x otherwise", () => {
    expect(tokenBudgetMultiplier("สวัสดี")).toBe(2.8);
    expect(tokenBudgetMultiplier("你好")).toBe(2.8);
    expect(tokenBudgetMultiplier("hello")).toBe(1);
  });
});

describe("collectStrings", () => {
  it("collects text leaves, skips machine keys, and writes replacements back", () => {
    const obj = { id: "cat-1", kind: "idea", label: "Venue", items: ["one", "two"], nested: { detail: "d", type: "x" }, n: 3 };
    const leaves = collectStrings(obj);
    expect(leaves.map((l) => l.value)).toEqual(["Venue", "one", "two", "d"]);
    leaves.forEach((l) => setLeaf(l, l.value.toUpperCase()));
    expect(obj).toEqual({ id: "cat-1", kind: "idea", label: "VENUE", items: ["ONE", "TWO"], nested: { detail: "D", type: "x" }, n: 3 });
  });
  it("skips blank strings", () => {
    expect(collectStrings({ a: "  ", b: ["", "x"] }).map((l) => l.value)).toEqual(["x"]);
  });
});
