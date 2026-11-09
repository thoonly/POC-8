import { describe, expect, it } from "vitest";
import { confirmPolicy, locate, parseTarget, retention, routeActions, sanitizeChatActions } from "./actions";
import type { ChatDoc, ChatOp } from "./types";

const empty: ChatDoc = { topic: "Plan a trip to Japan", answer: "", generated: false, categories: [], actions: [], notes: [] };
const full: ChatDoc = {
  topic: "Plan a trip to Japan", answer: "A two week trip.", generated: true,
  categories: [{ label: "Budget", topics: ["Flights", "Hotels"] }, { label: "Food", topics: ["Ramen"] }],
  actions: [{ text: "Build a Full Plan: Japan", tier: "suggested" }, { text: "Book flights", tier: "available" }],
  notes: [],
};
let n = 0;
const uid = () => `a${++n}`;
const run = (raw: unknown, doc: ChatDoc, allowed?: ReadonlySet<ChatOp>) => sanitizeChatActions(raw, doc, { uid, allowed });

describe("parseTarget", () => {
  it("reads the three id shapes", () => {
    expect(parseTarget("cat-2")).toEqual({ type: "category", i: 2 });
    expect(parseTarget("topic-1-3")).toEqual({ type: "topic", ci: 1, ti: 3 });
    expect(parseTarget("action-0")).toEqual({ type: "action", i: 0 });
  });
  it("rejects anything else", () => {
    expect(parseTarget("cat-x")).toBeNull();
    expect(parseTarget("")).toBeNull();
    expect(parseTarget(undefined)).toBeNull();
  });
});

describe("sanitizeChatActions", () => {
  it("returns nothing for non-arrays and unknown ops", () => {
    expect(run(null, full)).toEqual([]);
    expect(run([{ op: "drop_table", value: "x" }, null], full)).toEqual([]);
  });

  it("before generation only topic, scratch note and regenerate are possible", () => {
    const out = run([
      { op: "add_category", value: "New" }, { op: "set_answer", value: "x" },
      { op: "refine_topic", value: "Plan a trip to Japan in spring" }, { op: "add_scratch_note", value: "note" },
    ], empty);
    expect(out.map((a) => a.op)).toEqual(["refine_topic", "add_scratch_note"]);
  });

  it("drops ops this build cannot apply", () => {
    const allowed = new Set<ChatOp>(["add_scratch_note"]);
    expect(run([{ op: "regenerate_output" }, { op: "add_scratch_note", value: "a" }], empty, allowed).map((a) => a.op)).toEqual(["add_scratch_note"]);
  });

  it("needs a value, except remove_item and regenerate_output", () => {
    expect(run([{ op: "add_category", value: "  " }], full)).toEqual([]);
    expect(run([{ op: "remove_item", target: "cat-0" }], full)).toHaveLength(1);
  });

  it("drops hallucinated ids and never guesses", () => {
    expect(run([{ op: "edit_item", target: "cat-9", value: "x" }], full)).toEqual([]);
    expect(run([{ op: "remove_item", target: "topic-0-9" }], full)).toEqual([]);
    expect(run([{ op: "add_topic", target: "cat-9", value: "x" }], full)).toEqual([]);
    expect(run([{ op: "add_topic", target: "topic-0-0", value: "x" }], full)).toEqual([]);
  });

  it("remembers the target's text and category text", () => {
    const [a] = run([{ op: "edit_item", target: "topic-0-1", value: "Ryokans" }], full);
    expect(a.targetText).toBe("Hotels");
    expect(a.targetCatText).toBe("Budget");
    const [b] = run([{ op: "add_topic", target: "cat-1", value: "Sushi" }], full);
    expect(b.targetCatText).toBe("Food");
  });

  it("drops duplicates of what is already there", () => {
    expect(run([
      { op: "add_category", value: "Budget" },
      { op: "add_suggested_action", value: "Book flights" },
      { op: "set_topic", value: "Plan a trip to Japan" },
      { op: "set_answer", value: "A two week trip." },
      { op: "edit_item", target: "cat-0", value: "Budget" },
    ], full)).toEqual([]);
  });

  it("trims strings and starts every action pending", () => {
    const [a] = run([{ op: "add_scratch_note", value: "  hi  ", reason: " why ", conflict: 5 }], empty);
    expect(a).toMatchObject({ value: "hi", reason: "why", conflict: "", state: "pending" });
  });
});

describe("locate", () => {
  it("finds a target again by its text after the list was reordered", () => {
    const [a] = run([{ op: "edit_item", target: "topic-0-1", value: "Ryokans" }], full);
    const moved: ChatDoc = { ...full, categories: [full.categories[1], { label: "Budget", topics: ["Hotels", "Flights"] }] };
    expect(locate(a, moved)).toEqual({ type: "topic", ci: 1, ti: 0 });
  });
  it("returns null once the text is gone (stale)", () => {
    const [a] = run([{ op: "remove_item", target: "action-1" }], full);
    expect(locate(a, { ...full, actions: [] })).toBeNull();
  });
});

describe("retention", () => {
  it("is 1 when nothing is kept out", () => expect(retention("hello world", "hello world and more")).toBe(1));
  it("drops when the wording is replaced", () => expect(retention("hello world", "zzzzzz qqqqq")).toBeLessThan(0.2));
  it("is 1 for empty old text", () => expect(retention("", "anything")).toBe(1));
  it("works on Thai", () => expect(retention("วางแผนเที่ยวญี่ปุ่น", "วางแผนเที่ยวญี่ปุ่น ช่วงฤดูใบไม้ผลิ")).toBe(1));
});

describe("confirmPolicy", () => {
  const act = (op: string, value: string, extra = {}) => run([{ op, value, ...extra }], full)[0] ?? ({ op, value, conflict: "", ...extra } as never);

  it("research always waits", () => expect(confirmPolicy(act("add_category", "Transport"), { fromResearch: true }, full).confirm).toBe(true));
  it("a flagged conflict waits", () => expect(confirmPolicy(act("add_category", "Transport", { conflict: "contradicts" }), {}, full).confirm).toBe(true));
  it("a bulk change waits", () => expect(confirmPolicy(act("add_category", "Transport"), { bulk: true }, full).confirm).toBe(true));
  it("additive ops apply at once", () => {
    for (const op of ["add_category", "add_suggested_action", "add_available_action", "add_scratch_note"]) {
      expect(confirmPolicy(act(op, "Something new"), {}, full).confirm).toBe(false);
    }
  });
  it("rewrites, edits and removals wait", () => {
    expect(confirmPolicy(act("set_topic", "Something else"), {}, full).confirm).toBe(true);
    expect(confirmPolicy(act("set_answer", "Something else"), {}, full).confirm).toBe(true);
    expect(confirmPolicy(act("edit_item", "Cost", { target: "cat-0" }), {}, full).confirm).toBe(true);
    expect(confirmPolicy(act("remove_item", "", { target: "cat-0" }), {}, full).confirm).toBe(true);
  });
  it("a refine that keeps the old wording applies at once", () => {
    expect(confirmPolicy(act("refine_topic", "Plan a trip to Japan in spring"), {}, full).confirm).toBe(false);
  });
  it("a refine that loses the old wording waits, and says how much was kept", () => {
    const p = confirmPolicy(act("refine_topic", "Quarterly revenue report"), {}, full);
    expect(p.confirm).toBe(true);
    expect(p.why).toMatch(/\d+% of the current wording kept/);
  });
});

describe("routeActions", () => {
  it("fills in policy, label and before-text, and treats more than 4 edits as bulk", () => {
    const five = run(Array.from({ length: 5 }, (_, i) => ({ op: "add_suggested_action", value: `Step ${i}` })), full);
    routeActions(five, {}, full);
    expect(five.every((a) => a.needsConfirm && /Large change/.test(a.why!))).toBe(true);
    const one = routeActions(run([{ op: "edit_item", target: "cat-0", value: "Money" }], full), {}, full)[0];
    expect(one).toMatchObject({ needsConfirm: true, label: "Edit item", beforeSnap: "Budget" });
  });
});
