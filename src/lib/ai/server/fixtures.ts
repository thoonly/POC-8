/**
 * Mock fixtures (AI_MOCK=1), one per label prefix, registered next to the server so the browser
 * bundle never contains them. Calls with a schema but no fixture get a value generated from the
 * schema (mock.ts). Add a fixture when a screen needs believable text to be checked.
 */
import { registerMock } from "./mock";

/** The prompt the user typed, pulled back out of the draft prompt (see lib/entry/draft.ts). */
const quoted = (content: string): string =>
  /Universal Input Bar: "([\s\S]*?)"\n\nDraft three fields/.exec(content)?.[1]?.trim() || "your prompt";

// ---- chat (lib/chat/prompts.ts): trigger words in the user's message pick the branch ----
const lastContent = (req: { messages: { content: string }[] }) => req.messages[req.messages.length - 1]?.content || "";
const userMessage = (c: string) => /(?:USER MESSAGE|NEW CONTEXT EVENT|USER REQUEST): "([\s\S]*?)"\n/.exec(c)?.[1]?.trim() || "";
const topicOf = (c: string) => /\[topic\] Topic: "([\s\S]*?)"\n/.exec(c)?.[1]?.trim() || "";
const act = (op: string, value: string, extra: Record<string, string> = {}) => ({ op, value, reason: "Mock reason.", conflict: "", target: "", ...extra });
const routerBase = { kind: "question", needs_research: false, search_query: "", reply: "", actions: [] as unknown[], choices: [] as unknown[], decision_help: { question: "", options: [] as string[] }, presentation: false, explore_more: false, facts: [] as unknown[] };

registerMock("chat:router", (req) => {
  const c = lastContent(req);
  const msg = userMessage(c);
  const topic = topicOf(c);
  if (/research|search|look up/i.test(msg)) return { ...routerBase, kind: "research", needs_research: true, search_query: msg.slice(0, 60), reply: "I’ll look that up." };
  if (/decide|which .*best|recommend/i.test(msg)) return { ...routerBase, reply: "Let me compare them.", decision_help: { question: "Which option fits best?", options: ["Option A", "Option B", "Option C"] } };
  if (/rewrite|replace|start over/i.test(msg)) return { ...routerBase, kind: "command", reply: "I’ll reword the Topic around that.", actions: [act("set_topic", `Mock: ${msg}`, { conflict: "Mock: this changes the focus of the Topic." })] };
  if (/\b(add|update|include|note|focus|also)\b/i.test(msg)) {
    return {
      ...routerBase, kind: "command", reply: "Added that to your request and made a note.",
      actions: [act("refine_topic", `${topic} ${msg}`.trim()), act("add_scratch_note", msg)],
    };
  }
  return {
    ...routerBase, kind: c.includes("NEW CONTEXT EVENT") ? "context" : "question",
    reply: `Mock answer about: **${msg || "your exploration"}**.\n- One idea\n- Another idea`,
    choices: [{ prompt: "Which direction fits?", multi: false, options: ["Direction one", "Direction two"] }],
  };
});

registerMock("chat:research-reply", (req) => {
  const c = lastContent(req);
  return {
    reply: `Mock research summary for “${userMessage(c)}”.`,
    findings: ["Mock finding with a figure: 42%.", "Another mock finding."],
    context_title: "Mock research",
    actions: [act("add_scratch_note", "Mock research finding")],
    choices: [],
  };
});

registerMock("chat:decision", (req) => {
  const c = lastContent(req);
  const listed = [...c.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1].trim());
  const options = listed.length ? listed : ["Option A", "Option B"];
  const withPrefs = /Preferences the user has told you for this decision:\n- /.test(c);
  return {
    intro: "Mock comparison: the main trade-off is cost versus effort.",
    options: options.map((o, i) => ({ option: o, summary: `Mock summary of ${o}.`, pros: ["Mock pro"], cons: ["Mock con"], best_if: "You value speed.", fit: i === 0 ? "best" : "good" })),
    recommendation: { option: withPrefs ? options[0] : "", why: "Mock: fits what you told me.", confidence: "medium" },
    preference_questions: withPrefs ? [] : [{ q: "What matters most?", multi: false, options: ["Speed", "Cost"] }],
  };
});

// ---- prompt clarity gate (lib/entry/gate.ts): the request text picks the case, so every card can be tried ----
const gateBase = { case: "clear", prompt: "", intro: "", question: "", options: [] as unknown[], message: "", term: "", interpretations: [] as unknown[], default_index: -1, suggestions: [] as unknown[], ideas: [] as unknown[] };
const gateOpt = (label: string, detail: string, prompt: string) => ({ label, detail, prompt });

registerMock("entry:prompt-gate", (req) => {
  const c = lastContent(req);
  const original = /Original request: "([\s\S]*?)"\n/.exec(c)?.[1]?.trim() || "";
  if (c.includes("What the person has said since")) return { ...gateBase, prompt: `${original} (clarified in Chat)` }; // answered: now clear
  if (original.replace(/[^\p{L}\p{N}]/gu, "").length < 2) {
    return { ...gateBase, case: "unclear", intro: "Mock intro.", question: `What does “${original}” mean here?`, options: [gateOpt("A letter", "of the alphabet", `${original} — the letter`), gateOpt("A grade", "a rating", `${original} — a grade`), gateOpt("A label", "such as Plan A", `${original} — a label`)] };
  }
  if (/this (document|file|report)/i.test(original)) return { ...gateBase, case: "incomplete", message: "You want to analyze a document, but none is attached." };
  if (/amazon/i.test(original)) {
    return { ...gateBase, case: "ambiguous", term: "Amazon", message: "Which Amazon do you mean?", default_index: 0, interpretations: [gateOpt("The company", "its growth", "Analyze the growth of Amazon the company"), gateOpt("Selling on Amazon", "your sales there", "Grow my sales on Amazon"), gateOpt("The rainforest", "its regrowth", "Analyze the regrowth of the Amazon rainforest")] };
  }
  if (/^(business strategy|marketing)$/i.test(original)) return { ...gateBase, case: "broad", message: "That is broad. Pick a narrower version:", suggestions: [gateOpt("Pricing", "", `${original}: plan our pricing`), gateOpt("Launch", "", `${original}: plan a launch`)] };
  if (/wedding/i.test(original) && /churn/i.test(original)) return { ...gateBase, case: "multi", message: "These are two separate requests.", ideas: [gateOpt("Wedding", "", "Plan my wedding"), gateOpt("Churn model", "", "Fix our churn model")] };
  return gateBase;
});

// ---- gap analysis (lib/entry/gaps.ts): a topic that already states its size gets no questions ----
registerMock("entry:gap-analysis", (req) => {
  const topic = /Topic \([\s\S]*?\):\n"([\s\S]*?)"\n/.exec(lastContent(req))?.[1]?.trim() || "";
  if (/Additional details:|\b\d+[- ]?(day|person|people)\b.*\b(budget|baht|usd)\b/i.test(topic)) return { gaps: [] };
  return {
    gaps: [
      { question: "How many people are joining?", options: ["Under 10", "10–20", "20–50", "50 or more"], multi: false },
      { question: "How long will it run?", options: ["Half a day", "One day", "Two days"], multi: false },
      { question: "Which parts do you need delivered?", options: ["A plan", "Bookings", "A budget"], multi: true },
      { question: "What is the total budget level?", options: ["Low", "Medium", "High"], multi: false },
      { question: "When does it need to happen?", options: [], multi: false },
    ],
  };
});

registerMock("entry:draft-node", (req) => {
  const raw = quoted(req.messages[req.messages.length - 1]?.content || "");
  const words = raw.replace(/["“”]/g, "").split(/\s+/).filter(Boolean);
  const name = words.slice(0, 4).join(" ");
  return {
    node_name: name ? name.charAt(0).toUpperCase() + name.slice(1) : "Mock node",
    context: `This node starts from a request: "${raw.slice(0, 120)}". Mock context for checking the UI.`,
    topic: `Explore what is needed to deliver this request and why it matters. Mock topic for checking the UI.`,
  };
});
