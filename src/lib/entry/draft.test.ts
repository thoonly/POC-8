import { describe, expect, it } from "vitest";
import { draftPrompt, pickTopic } from "./draft";

describe("pickTopic", () => {
  it("keeps the drafted topic when its language matches the prompt", () => {
    expect(pickTopic("Plan an offsite", "Explore options for a two-day team offsite.")).toBe("Explore options for a two-day team offsite.");
    expect(pickTopic("วางแผนทริป", "สำรวจตัวเลือกสำหรับทริป")).toBe("สำรวจตัวเลือกสำหรับทริป");
  });
  it("falls back to the raw prompt when the draft drifted language", () => {
    expect(pickTopic("Plan an offsite", "สำรวจตัวเลือกสำหรับทริป")).toBe("Plan an offsite");
    expect(pickTopic("วางแผนทริป", "Explore options for a trip.")).toBe("วางแผนทริป");
  });
  it("falls back to the raw prompt when there is no draft", () => {
    expect(pickTopic("Plan an offsite", undefined)).toBe("Plan an offsite");
    expect(pickTopic("Plan an offsite", "")).toBe("Plan an offsite");
  });
});

describe("draftPrompt", () => {
  it("embeds the raw prompt and the language guard", () => {
    const p = draftPrompt('Analyze "SaaS" rivals');
    expect(p).toContain('entered in the Universal Input Bar: "Analyze "SaaS" rivals"');
    expect(p).toContain("Do not mix in ANY word");
    expect(p).toContain("under 140 words");
  });
});
