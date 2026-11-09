import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/ai/errors";

// The model is scripted: draft-node echoes the request, prompt-gate answers with h.gate(content).
const h = vi.hoisted(() => ({
  calls: [] as { label: string; content: string }[],
  gate: (_content: string): unknown | Promise<unknown> => ({}),
  gaps: (_content: string): unknown | Promise<unknown> => ({ gaps: [] }),
}));

vi.mock("@/lib/ai/client", () => {
  const json = vi.fn(async (messages: { content: string }[], opts: { label: string }) => {
    const content = messages[messages.length - 1].content;
    h.calls.push({ label: opts.label, content });
    if (opts.label === "entry:prompt-gate") return await h.gate(content);
    if (opts.label === "entry:gap-analysis") return await h.gaps(content);
    if (opts.label === "lang:classify") return { language: "en" };
    return {};
  });
  // entry:draft-node is a plain chat call whose text is JSON (no response_format).
  const chat = vi.fn(async (messages: { content: string }[], opts: { label: string }) => {
    const content = messages[messages.length - 1].content;
    h.calls.push({ label: opts.label, content });
    const raw = /Universal Input Bar: "([\s\S]*?)"\n\nDraft three fields/.exec(content)?.[1] ?? "";
    if (raw.includes("FAIL-DRAFT")) throw new AiError("HTTP", "The model is down.");
    return JSON.stringify({ node_name: `Node: ${raw.slice(0, 20)}`, context: "Context.", topic: `Topic: ${raw}` });
  });
  return { json, chat, search: vi.fn(), complete: vi.fn(), info: vi.fn(), canSearch: vi.fn(), onUsage: () => () => {}, ai: { json, chat, search: vi.fn(), complete: vi.fn(), info: vi.fn(), canSearch: vi.fn(), onUsage: () => () => {} } };
});

import { useChat, type ChatItem } from "./chat";
import { useEntry } from "./entry";
import { clearPromptGate, gapActions, gateActions, startEntryNode } from "./gate";
import { useGateRoute } from "./gateRoute";
import { useLedger } from "./ledger";
import { useUi } from "./ui";

const reply = (over: Record<string, unknown> = {}) => ({
  case: "clear", prompt: "", intro: "", question: "", options: [], message: "", term: "",
  interpretations: [], default_index: -1, suggestions: [], ideas: [], ...over,
});
const opt = (label: string, prompt: string, detail = "") => ({ label, detail, prompt });
const unclearA = (c: string) => (c.includes("What the person has said since")
  ? reply({ prompt: "A — the letter A" })
  : reply({ case: "unclear", question: "What does “A” mean here?", options: [opt("The letter", "A — the letter", "of the alphabet"), opt("A grade", "A — a grade")] }));

const labels = () => h.calls.map((c) => c.label).filter((l) => !l.startsWith("lang:"));
const items = () => useChat.getState().items;
const cards = () => items().filter((m): m is Extract<ChatItem, { type: "assistant" }> => m.type === "assistant" && !!m.gate);
const waitForAnswer = () => vi.waitFor(() => expect(useGateRoute.getState().route?.onText).toBeTypeOf("function"));

beforeEach(() => {
  h.calls.length = 0;
  h.gate = () => reply();
  h.gaps = () => ({ gaps: [] });
  clearPromptGate();
  useLedger.getState().reset();
  useChat.getState().reset();
  useEntry.setState({ status: "idle", error: null, prompt: "", nodeName: "Entry node", context: "", topic: "" });
  useUi.setState({ prompt: "", screen: "home" });
});

describe("startEntryNode", () => {
  it("a clear prompt: draft, the person's own prompt as the first bubble, one gate check, one gap check, nothing else", async () => {
    await startEntryNode("  Plan an offsite for the design team ");
    expect(labels()).toEqual(["entry:draft-node", "entry:prompt-gate", "entry:gap-analysis"]);
    expect(items()).toMatchObject([{ type: "user", text: "Plan an offsite for the design team" }]);
    expect(useChat.getState().history).toEqual([{ role: "user", text: "Plan an offsite for the design team" }]);
    expect(useEntry.getState()).toMatchObject({ status: "ready", prompt: "Plan an offsite for the design team", topic: "Topic: Plan an offsite for the design team" });
    expect(useUi.getState()).toMatchObject({ screen: "node", prompt: "Plan an offsite for the design team" });
    expect(useGateRoute.getState().route).toBeNull();
    expect(useChat.getState().status).toBeNull();
  });

  it("a failed draft stops before Chat: no bubble, no gate call, the error is on the entry store", async () => {
    await startEntryNode("FAIL-DRAFT please");
    expect(labels()).toEqual(["entry:draft-node"]);
    expect(items()).toEqual([]);
    expect(useEntry.getState()).toMatchObject({ status: "error", error: { code: "HTTP" } });
    expect(useUi.getState().screen).toBe("home");
  });

  it("an unclear prompt blocks on a lettered card; picking an option re-checks, then redrafts from the merged request", async () => {
    h.gate = unclearA;
    const p = startEntryNode("A");
    await waitForAnswer();

    const [card] = cards();
    expect(card.gate).toMatchObject({ letters: true, locked: false, hint: "Pick one, or type what you mean below." });
    expect(card.gate!.options.map((o) => o.label)).toEqual(["The letter", "A grade"]);
    expect(card.text).toBe("I'd love to help — I just need a bit more context… What does “A” mean here?");
    expect(useChat.getState().history.at(-1)?.text).toContain("A. The letter B. A grade"); // what the model is told Chat said

    gateActions.pick(card.id, 0);
    await p;

    expect(labels()).toEqual(["entry:draft-node", "entry:prompt-gate", "entry:prompt-gate", "entry:draft-node", "entry:gap-analysis"]);
    expect(h.calls.filter((c) => c.label === "entry:prompt-gate")[1].content).toContain("Answered: A — the letter (of the alphabet)");
    expect(cards()[0].gate).toMatchObject({ locked: true, chosen: "o:0" });
    expect(items().map((m) => m.text)).toContain("A. The letter");
    expect(items().at(-1)).toMatchObject({ type: "system", text: "Updated your request: “A — the letter A”" });
    expect(useEntry.getState()).toMatchObject({ prompt: "A — the letter A", topic: "Topic: A — the letter A" });
    expect(useGateRoute.getState().route).toBeNull();
  });

  it("while a question is open, a typed message is the answer, not a chat turn", async () => {
    h.gate = unclearA;
    const p = startEntryNode("A");
    await waitForAnswer();
    await useChat.getState().send("the letter A");
    await p;

    expect(h.calls.map((c) => c.label)).not.toContain("chat:router");
    expect(items().filter((m) => m.type === "user").map((m) => m.text)).toEqual(["A", "the letter A"]);
    expect(cards()[0].gate!.locked).toBe(true); // a typed answer closes the open card
    expect(h.calls.filter((c) => c.label === "entry:prompt-gate")[1].content).toContain("Answered: the letter A");
    expect(useEntry.getState().prompt).toBe("A — the letter A");
  });

  it("while the check is running a typed message is held, not lost to the chat router", async () => {
    let release!: (v: unknown) => void;
    h.gate = () => new Promise((r) => { release = r; });
    const p = startEntryNode("Plan an offsite");
    await vi.waitFor(() => expect(useChat.getState().status).toBe("Reading your request…"));
    expect(useGateRoute.getState().route).toEqual({}); // held: the composer is disabled

    await useChat.getState().send("hello?");
    expect(items().filter((m) => m.type === "user")).toHaveLength(1);
    expect(items().at(-1)).toMatchObject({ type: "system", text: "One moment — finishing the current reply first." });

    release(reply());
    await p;
    expect(useChat.getState().status).toBeNull();
  });

  it("a new prompt replaces a question still waiting: the old flow ends, the chat starts over", async () => {
    h.gate = (c) => (c.includes('Original request: "A"') ? unclearA(c) : reply());
    const first = startEntryNode("A");
    await waitForAnswer();
    expect(cards()).toHaveLength(1);

    await startEntryNode("Plan an offsite");
    await first; // released, not left hanging

    expect(cards()).toEqual([]);
    expect(items()).toMatchObject([{ type: "user", text: "Plan an offsite" }]);
    expect(useEntry.getState().prompt).toBe("Plan an offsite");
    expect(useGateRoute.getState().route).toBeNull();
  });

  it("incomplete: restates the ask; Attach a file keeps the card open, a file answer finishes with the file in the topic", async () => {
    h.gate = () => reply({ case: "incomplete", prompt: "Analyze this document", message: "You want to analyze a document, but none is attached." });
    const p = startEntryNode("Analyze this document");
    await waitForAnswer();

    const [card] = cards();
    expect(card.gate!.buttons.map((b) => b.id)).toEqual(["attach", "details", "continue"]);
    gateActions.press(card.id, "attach");
    expect(cards()[0].gate!.locked).toBe(false); // opening the picker is not an answer

    await useChat.getState().contextTurn([{ id: "ctx-1", title: "q3.txt", kind: "file", text: "Revenue  grew\n 12%", sources: [], loading: false }]);
    await p;

    expect(h.calls.filter((c) => c.label === "entry:prompt-gate")).toHaveLength(1); // the file ends the gate without another check
    expect(useEntry.getState().prompt).toBe("Analyze this document (q3.txt)");
    expect(useEntry.getState().topic).toBe("Topic: Analyze this document (q3.txt)\n\nAttached files:\n- q3.txt: Revenue grew 12%");
    expect(useGateRoute.getState().route).toBeNull();
  });

  it("ambiguous: Continue anyway goes with the model's default meaning", async () => {
    h.gate = () => reply({ case: "ambiguous", term: "Amazon", message: "Which Amazon?", default_index: 1, interpretations: [opt("The company", "Analyze Amazon the company"), opt("Selling on Amazon", "Grow my sales on Amazon"), opt("The rainforest", "Analyze the rainforest")] });
    const p = startEntryNode("Amazon growth");
    await waitForAnswer();

    const [card] = cards();
    expect(card.gate).toMatchObject({ letters: false });
    expect(card.gate!.buttons.map((b) => b.label)).toEqual(["None of these", "Continue anyway"]);
    gateActions.press(card.id, "continue");
    await p;

    expect(items().map((m) => m.text)).toEqual(expect.arrayContaining(["Continue anyway", "Going with the most common meaning: Selling on Amazon."]));
    expect(useEntry.getState().prompt).toBe("Grow my sales on Amazon");
  });

  it("ambiguous: None of these asks in the person's own words and waits again", async () => {
    h.gate = (c) => (c.includes("What the person has said since")
      ? reply({ prompt: "Analyze the Amazon rainforest" })
      : reply({ case: "ambiguous", term: "Amazon", interpretations: [opt("The company", "x"), opt("The rainforest", "y")] }));
    const p = startEntryNode("Amazon growth");
    await waitForAnswer();
    gateActions.press(cards()[0].id, "none");
    expect(items().at(-1)).toMatchObject({ type: "assistant", text: "No problem. In your own words, what do you mean by “Amazon”?" });
    await useChat.getState().send("the rainforest");
    await p;
    expect(useEntry.getState().prompt).toBe("Analyze the Amazon rainforest");
  });

  it("after 3 blocking rounds every unclear card also offers Continue anyway", async () => {
    h.gate = () => reply({ case: "unclear", question: "What does “A” mean?", options: [opt("The letter", "A — the letter")] });
    const p = startEntryNode("A");
    for (let round = 1; round <= 3; round++) {
      await vi.waitFor(() => expect(cards()).toHaveLength(round));
      await waitForAnswer();
      const ids = cards().at(-1)!.gate!.buttons.map((b) => b.id);
      expect(ids).toEqual(round < 3 ? [] : ["continue"]);
      if (round < 3) await useChat.getState().send(`try ${round}`);
    }
    gateActions.press(cards().at(-1)!.id, "continue");
    await p;
    expect(useEntry.getState().prompt).toBe("A — try 1 — try 2");
    expect(useGateRoute.getState().route).toBeNull();
  });

  it("broad: the flow goes on, then offers narrower prompts; picking one starts a new node from it", async () => {
    h.gate = (c) => (c.includes('Original request: "Marketing"')
      ? reply({ case: "broad", message: "That is broad.", suggestions: [opt("Pricing", "Marketing: plan our pricing"), opt("Launch", "Marketing: plan a launch")] })
      : reply());
    await startEntryNode("Marketing");

    const [note] = cards();
    expect(note.text).toBe("That is broad.");
    expect(note.gate).toMatchObject({ hint: "Optional — you can keep going without choosing.", buttons: [] });
    expect(useGateRoute.getState().route).toBeNull(); // not blocking: Chat works normally

    gateActions.pick(note.id, 1);
    await vi.waitFor(() => expect(useEntry.getState().prompt).toBe("Marketing: plan a launch"));
    await vi.waitFor(() => expect(cards()).toEqual([]));
    expect(items()).toMatchObject([{ type: "user", text: "Marketing: plan a launch" }]);
  });

  it("a failed clarity check never strands the person: the flow goes on with the original request", async () => {
    h.gate = () => { throw new AiError("HTTP", "boom"); };
    await startEntryNode("Plan an offsite");
    expect(labels()).toEqual(["entry:draft-node", "entry:prompt-gate", "entry:gap-analysis"]);
    expect(cards()).toEqual([]);
    expect(useGateRoute.getState().route).toBeNull();
    expect(useEntry.getState().prompt).toBe("Plan an offsite");
  });

  it("a broken prompt stays blocked even when the check fails", async () => {
    h.gate = () => { throw new AiError("HTTP", "boom"); };
    const p = startEntryNode("??");
    await waitForAnswer();
    expect(cards()).toHaveLength(1);
    expect(cards()[0].text).toBe("I'd love to help — I just need a bit more context… What do you mean by “??”?");
    clearPromptGate();
    await p;
  });
});

const gapCards = () => items().filter((m): m is Extract<ChatItem, { type: "assistant" }> => m.type === "assistant" && !!m.gaps);
const twoGaps = {
  gaps: [
    { question: "How many people are joining?", options: ["10", "20"], multi: false },
    { question: "Which parts do you need?", options: ["Plan", "Bookings"], multi: true },
  ],
};

describe("gap questions", () => {
  it("a clear but unsized prompt gets the questions card; the card does not hold the composer", async () => {
    h.gaps = () => twoGaps;
    await startEntryNode("Plan an offsite for the design team");
    const [card] = gapCards();
    expect(card.text).toBe("Before I suggest a workstream, a few answers will tell me how big this work is. Skip if you'd rather I use my best judgment.");
    expect(card.gaps).toEqual({
      groups: [{ prompt: "How many people are joining?", options: ["10", "20"], multi: false }, { prompt: "Which parts do you need?", options: ["Plan", "Bookings"], multi: true }],
      resolved: false,
    });
    expect(useChat.getState().history.map((x) => x.role)).toEqual(["user"]); // a bubble only, as in legacy
    expect(useGateRoute.getState().route).toBeNull();
    expect(useChat.getState().status).toBeNull();
  });

  it("the check reads the drafted topic", async () => {
    await startEntryNode("Plan an offsite");
    const call = h.calls.find((c) => c.label === "entry:gap-analysis")!;
    expect(call.content).toContain('"Topic: Plan an offsite"');
  });

  it("Skip locks the card and says so; nothing is added to the topic or the ledger", async () => {
    h.gaps = () => twoGaps;
    await startEntryNode("Plan an offsite");
    const [card] = gapCards();
    gapActions.skip(card.id);
    expect(gapCards()[0].gaps!.resolved).toBe(true);
    expect(items().at(-1)).toMatchObject({ type: "system", text: "Skipped — using my best judgment." });
    expect(useEntry.getState().topic).toBe("Topic: Plan an offsite");
    expect(useLedger.getState().entries).toEqual([]);
    gapActions.skip(card.id); // pressing it again does nothing
    expect(items().filter((m) => m.type === "system")).toHaveLength(1);
  });

  it("Continue records the answers, adds them to the topic and locks the card", async () => {
    h.gaps = () => twoGaps;
    await startEntryNode("Plan an offsite");
    const [card] = gapCards();
    gapActions.send(card.id, card.gaps!.groups, [["20"], []]);
    expect(gapCards()[0].gaps!.resolved).toBe(true);
    expect(useEntry.getState().topic).toBe("Topic: Plan an offsite\n\nAdditional details:\n- How many people are joining? → 20");
    expect(useLedger.getState().entries).toEqual([{ q: "How many people are joining?", a: "20", node: "entry" }]);
  });

  it("Continue with nothing answered does nothing", async () => {
    h.gaps = () => twoGaps;
    await startEntryNode("Plan an offsite");
    const [card] = gapCards();
    gapActions.send(card.id, card.gaps!.groups, [[], []]);
    expect(gapCards()[0].gaps!.resolved).toBe(false);
    expect(useEntry.getState().topic).toBe("Topic: Plan an offsite");
  });

  it("a failed check says so and the flow goes on without a card", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.gaps = () => { throw new AiError("HTTP", "boom"); };
    await startEntryNode("Plan an offsite");
    expect(gapCards()).toEqual([]);
    expect(items().at(-1)).toMatchObject({ type: "system", text: "I couldn't check what's missing from this prompt, so I went ahead without questions. Tell me any details in Chat." });
    expect(useChat.getState().status).toBeNull();
  });

  it("an unreadable reply is a failed check, not 'nothing missing'; an empty list is silent", async () => {
    h.gaps = () => ({ nope: 1 });
    await startEntryNode("Plan an offsite");
    expect(items().at(-1)).toMatchObject({ type: "system" });
    h.gaps = () => ({ gaps: [] });
    await startEntryNode("Plan an offsite again");
    expect(items()).toMatchObject([{ type: "user", text: "Plan an offsite again" }]);
  });

  it("a new prompt while the check runs cancels it: no card, no note from the old flow", async () => {
    let release!: (v: unknown) => void;
    h.gaps = (c) => (c.includes('"Topic: First prompt"') ? new Promise((r) => { release = r; }) : { gaps: [] });
    const first = startEntryNode("First prompt");
    await vi.waitFor(() => expect(useChat.getState().status).toBe("Checking what's missing from this prompt…"));
    await startEntryNode("Second prompt");
    release(twoGaps);
    await first;
    expect(gapCards()).toEqual([]);
    expect(items()).toMatchObject([{ type: "user", text: "Second prompt" }]);
  });
});
