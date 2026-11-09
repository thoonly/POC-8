import { describe, expect, it } from "vitest";
import { CLARITY_SCHEMA, clarityPrompt, normalizeClarity, resolveGateStep } from "../../entry/gate";
import "./fixtures";
import { fromSchema, mockAnswer } from "./mock";

const gate = (original: string, turns: { q: string; a: string }[] = []) =>
  normalizeClarity(JSON.parse(mockAnswer({
    label: "entry:prompt-gate", tier: "small", schema: CLARITY_SCHEMA,
    messages: [{ role: "user", content: clarityPrompt(original, turns, []) }],
  })));

describe("entry:prompt-gate mock (AI_MOCK=1)", () => {
  it("each kind of request reaches its own card", () => {
    const kind = (text: string) => resolveGateStep(gate(text), { original: text, turns: [], attachments: [] }).kind;
    expect(kind("Plan a two-day offsite")).toBe("finish");
    expect(kind("A")).toBe("unclear");
    expect(kind("Analyze this document")).toBe("incomplete");
    expect(kind("Amazon growth")).toBe("ambiguous");
    expect(resolveGateStep(gate("Marketing"), { original: "Marketing", turns: [], attachments: [] })).toMatchObject({ kind: "finish", weak: { case: "broad" } });
    const both = "Plan my wedding and fix our churn model";
    expect(resolveGateStep(gate(both), { original: both, turns: [], attachments: [] })).toMatchObject({ kind: "finish", weak: { case: "multi" } });
  });
  it("once Chat has an answer the prompt is clear", () => {
    const turns = [{ q: "q", a: "the letter" }];
    expect(resolveGateStep(gate("A", turns), { original: "A", turns, attachments: [] })).toMatchObject({ kind: "finish", weak: null });
  });
  it("a schema-only mock answer (no fixture) is a clear prompt", () => {
    expect(normalizeClarity(fromSchema(CLARITY_SCHEMA))?.case).toBe("clear");
  });
});
