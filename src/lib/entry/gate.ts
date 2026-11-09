/**
 * Prompt clarity gate: pure logic plus the one AI call. Ported from legacy/entry-v4.html
 * (10413-10707: classifyPromptClarity, gateItems, runPromptGate's check(), presentWeakPromptNote).
 * Prompt text is verbatim. The conversation itself (cards, waiting for answers) is in store/gate.ts.
 *
 * AI call: entry:prompt-gate, tier small (CLAUDE.md: "classify"). Move to large only if small
 * misclassifies real prompts, and say why here.
 *
 * Deviations from legacy, all forced by the project rules:
 *  - maxTokens 900 is dropped (the rules forbid a ceiling under 2000; the default guard applies).
 *  - The answer is requested with a strict schema. A strict schema lists every key, so a case's
 *    unused keys come back empty ("" / []) instead of absent. The prompt text is unchanged.
 *  - default_index is -1 for the cases that have no default (legacy: absent).
 *
 * The six cases: unclear, incomplete, ambiguous block until the user answers; broad and multi let
 * the flow continue and only offer a narrower prompt; clear goes straight on.
 */
import { json } from "../ai/client";
import type { JsonSchema } from "../ai/types";
import { LANGUAGE_PURITY_GUARD, isLikelyNonEnglish } from "../lang/detect";
import { enforceAnchorLanguage } from "../lang/enforce";
import { truncateForCard } from "../text";

export const PROMPT_GATE_INTRO = "I'd love to help — I just need a bit more context…";
/** After this many blocking rounds every card also offers "Continue anyway". */
export const PROMPT_GATE_MAX_ROUNDS = 3;

export type ClarityCase = "clear" | "unclear" | "incomplete" | "ambiguous" | "broad" | "multi";

/** An option the user can pick: a meaning, a narrower request, one of several separate requests. */
export interface GateItem { label: string; detail: string; prompt: string }

/** What Chat asked and what the person answered, in order. */
export interface GateTurn { q: string; a: string }

/** The classifier's verdict, with every field present (empty when the case does not use it). */
export interface Clarity {
  /** Normally a ClarityCase; an unknown value is treated like "clear", as in legacy. */
  case: string;
  /** The whole request rewritten as one clean request, merging Chat's answers. */
  prompt: string;
  intro: string;
  question: string;
  message: string;
  term: string;
  options: unknown;
  interpretations: unknown;
  suggestions: unknown;
  ideas: unknown;
  /** Index into interpretations, or undefined. */
  default_index: number | undefined;
}

const ITEM_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "detail", "prompt"],
  properties: { label: { type: "string" }, detail: { type: "string" }, prompt: { type: "string" } },
};
const items = (max: number): JsonSchema => ({ type: "array", maxItems: max, items: ITEM_SCHEMA });

export const CLARITY_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["case", "prompt", "intro", "question", "options", "message", "term", "interpretations", "default_index", "suggestions", "ideas"],
  properties: {
    // "clear" first: it is the value a schema-generated mock answer picks.
    case: { type: "string", enum: ["clear", "unclear", "incomplete", "ambiguous", "broad", "multi"] },
    prompt: { type: "string" },
    intro: { type: "string" },
    question: { type: "string" },
    options: items(3),
    message: { type: "string" },
    term: { type: "string" },
    interpretations: items(4),
    default_index: { type: "integer" },
    suggestions: items(4),
    ideas: items(4),
  },
};

export function clarityPrompt(original: string, turns: GateTurn[], attachments: string[]): string {
  const convo = turns.length ? `\n\nWhat the person has said since, in Chat:\n${turns.map((t) => `- Asked: ${t.q}\n  Answered: ${t.a}`).join("\n")}` : "";
  const files = attachments.length ? `\nFiles the person has attached: ${attachments.join(", ")}.` : "\nNo files are attached.";
  return `You check whether a request typed into CollabiQ's Entry Node is clear enough to start work on. Judge the request as a whole, including anything the person added in Chat since.

Original request: "${original}"${convo}${files}

Sort it into exactly one "case":
- "unclear": broken, fragmented, a single letter, or keywords only, so nobody could say what the person wants (e.g. "A", "sales").
- "incomplete": the ask is specific, but it refers to an input the person must supply that isn't here: a document, file, data, link or text to work on (e.g. "Analyze this document" with no file attached, "Summarize the email below" with no email). NOT missing details like dates, budget, headcount or preferences; those are asked later and are fine.
- "ambiguous": a key word or phrase could mean genuinely different things that lead to different work (e.g. "Amazon growth": the company's growth, growing sales on Amazon, or the rainforest regrowing).
- "broad": a real goal, but so broad there is no clear starting point (e.g. "Business strategy", "Marketing").
- "multi": two or more UNRELATED requests in one prompt that don't serve one shared goal (e.g. "plan my wedding and fix our churn model"). Tasks for the same goal or occasion are NOT multi: "book a Japan trip, reserve a client dinner and prepare a revenue presentation" is one client visit, so it is "clear".
- "clear": a stated goal and subject that work can start on, even with details missing (e.g. "Plan a two-day offsite for our design team in Bangkok", "Analyze our competitors in the SaaS market").
When in doubt between "clear" and a weaker case, choose "clear". Only flag a real problem.

Always return "prompt": the whole request rewritten as ONE clean request in the person's own voice, merging the original with everything added in Chat. Keep their words and facts; invent nothing.

Keys for each case:
- "unclear": ask what the WORDS THEMSELVES mean, never guess a task. "intro": one warm sentence meaning "I'd love to help — I just need a bit more context…"; "question": one short question about the exact words typed (e.g. for "A": what does "A" mean here?; for "sales": what about sales — whose sales, and which part?); "options": exactly 3 objects {"label","detail","prompt"}, three different things those exact words could literally refer to. For "A": the letter of the alphabet, a grade or rating, a name or label such as Plan A or Class A. For "sales": a team's sales figures, the sales team, a product's sales. "label" a short name for that meaning, "detail" one short clarifying phrase, "prompt" the original words restated with that meaning (e.g. "A — the letter of the alphabet"). NEVER offer tasks or project types the person might want (no "create a project", "write a report", "plan a strategy"). If the Chat answers already settled what the words mean but not what the person wants done with them, ask about that next, still built from their own words and answers.
- "incomplete": "message": one or two sentences restating what the person wants to do and naming the input that's missing.
- "ambiguous": "term": the ambiguous word or phrase, as written; "message": one short question asking which meaning they have in mind; "interpretations": 2-4 objects {"label","detail","prompt"} ("label" a short name, "detail" one short clarifying phrase, "prompt" that meaning as a full request), most common first; "default_index": the index of the most common meaning for someone using a work platform like this.
- "broad": "message": one sentence saying the request is broad and offering narrower versions; "suggestions": 2-4 objects {"label","prompt"}, narrower workable versions.
- "multi": "message": one sentence saying the prompt holds separate requests and offering to focus on one; "ideas": 2-4 objects {"label","prompt"}, each separate request on its own.

Write every human-readable string in the same language as the original request. ${LANGUAGE_PURITY_GUARD}

Respond ONLY with a raw JSON object with "case", "prompt" and that case's keys. No markdown, no code fences, no preamble.`;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Cleans what the model returned into a Clarity. Null when there is no usable "case". */
export function normalizeClarity(res: unknown): Clarity | null {
  if (!res || typeof res !== "object") return null;
  const r = res as Record<string, unknown>;
  if (typeof r.case !== "string") return null;
  return {
    case: r.case.trim().toLowerCase(),
    prompt: str(r.prompt),
    intro: str(r.intro),
    question: str(r.question),
    message: str(r.message),
    term: str(r.term),
    options: r.options,
    interpretations: r.interpretations,
    suggestions: r.suggestions,
    ideas: r.ideas,
    default_index: Number.isInteger(r.default_index) ? (r.default_index as number) : undefined,
  };
}

/**
 * Sorts the request into a case. One call. A failure is the caller's to swallow: a failed check
 * never strands the person, the flow carries on without it.
 */
export async function classifyPromptClarity(original: string, turns: GateTurn[], attachments: string[], signal?: AbortSignal): Promise<Clarity | null> {
  const res = await json<Record<string, unknown>>(
    [{ role: "user", content: clarityPrompt(original, turns, attachments) }],
    { label: "entry:prompt-gate", tier: "small", schema: CLARITY_SCHEMA, signal },
  );
  if (!res || typeof res.case !== "string") return null;
  // "case" and "default_index" are machine values: keep them out of the language pass, which would
  // happily translate "unclear".
  const { case: kase, default_index: defaultIndex } = res;
  delete res.case;
  delete res.default_index;
  const out = (await enforceAnchorLanguage(res, { where: "prompt clarity", anchor: original, signal })) || res;
  return normalizeClarity({ ...out, case: kase, default_index: defaultIndex });
}

/** True for text that cannot be a request however it is read: under 2 characters, or no letter or digit. */
export function promptLooksBroken(text: string): boolean {
  const t = String(text || "").trim();
  return t.length < 2 || !/[\p{L}\p{N}]/u.test(t);
}

/** Each option / interpretation / idea the classifier returns, cleaned up. */
export function gateItems(list: unknown, max: number): GateItem[] {
  return (Array.isArray(list) ? list : [])
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object" && typeof (o as Record<string, unknown>).label === "string" && !!str((o as Record<string, unknown>).label).trim())
    .slice(0, max)
    .map((o) => {
      const label = str(o.label).trim();
      return { label, detail: str(o.detail).trim(), prompt: str(o.prompt).trim() || label };
    });
}

/** The request as typed plus every answer, joined; used when the model gives no merged prompt. */
export const fallbackMerge = (original: string, turns: GateTurn[]): string => [original].concat(turns.map((t) => t.a)).join(" — ");

export interface GateContext { original: string; turns: GateTurn[]; attachments: string[] }

const EMPTY: Clarity = {
  case: "clear", prompt: "", intro: "", question: "", message: "", term: "",
  options: [], interpretations: [], suggestions: [], ideas: [], default_index: undefined,
};

/** What Chat does next, decided from the verdict. Mirrors legacy check() after the classifier returns. */
export type GateStep =
  | { kind: "unclear"; res: Clarity }
  | { kind: "incomplete"; res: Clarity; merged: string }
  | { kind: "ambiguous"; res: Clarity; merged: string; items: GateItem[] }
  /** Work can start on `target`; `weak` is the broad / multi verdict to offer a narrower prompt for. */
  | { kind: "finish"; target: string; weak: Clarity | null };

export function resolveGateStep(res: Clarity | null, ctx: GateContext): GateStep {
  const { original, turns, attachments } = ctx;
  // Caught locally so a dead classifier can't let "A" or "??" through.
  const stillBroken = !turns.length && !attachments.length && promptLooksBroken(original);
  if (!res) {
    return stillBroken ? { kind: "unclear", res: { ...EMPTY, case: "unclear" } } : { kind: "finish", target: turns.length ? fallbackMerge(original, turns) : original, weak: null };
  }
  const r = stillBroken && res.case !== "unclear" ? { ...EMPTY, case: "unclear" } : res;
  const merged = r.prompt.trim() || fallbackMerge(original, turns);
  if (r.case === "unclear") return { kind: "unclear", res: r };
  if (r.case === "incomplete") return { kind: "incomplete", res: r, merged };
  if (r.case === "ambiguous") {
    const list = gateItems(r.interpretations, 4);
    // Nothing to choose between after all.
    if (list.length < 2) return { kind: "finish", target: turns.length ? merged : original, weak: null };
    return { kind: "ambiguous", res: r, merged, items: list };
  }
  const target = turns.length ? merged : original; // with nothing added in Chat, keep the person's own words
  if (r.case === "broad" || r.case === "multi") return { kind: "finish", target, weak: r };
  return { kind: "finish", target, weak: null };
}

/** The "unclear" message: asks what the typed words mean, never which task the person might want. */
export function unclearMessage(res: Clarity, original: string): { intro: string; options: GateItem[]; historyText: string } {
  const english = !isLikelyNonEnglish(original);
  const lead = english ? PROMPT_GATE_INTRO : res.intro.trim() || PROMPT_GATE_INTRO;
  const question = res.question.trim() || (english ? `What do you mean by “${original}”?` : "");
  const intro = question ? `${lead} ${question}` : lead;
  const options = gateItems(res.options, 3);
  return { intro, options, historyText: intro + " " + options.map((o, i) => `${"ABC"[i]}. ${o.label}`).join(" ") };
}

export const incompleteMessage = (res: Clarity): string =>
  res.message.trim() || "I can see what you want to do, but the input to work on is missing.";

export function ambiguousMessage(res: Clarity): string {
  const term = res.term.trim();
  return res.message.trim() || (term ? `“${term}” could mean a few different things. Which one do you mean?` : "This could mean a few different things. Which one do you mean?");
}

/** The interpretation "Continue anyway" goes with: the model's default, else the first. */
export function ambiguousDefault(res: Clarity, list: GateItem[]): GateItem {
  const i = res.default_index;
  return (i !== undefined && list[i]) || list[0];
}

/** Non-blocking note for broad / multi prompts. Null when the model gave nothing to offer. */
export function weakPromptNote(weak: Clarity): { message: string; items: GateItem[]; hint: string } | null {
  const isMulti = weak.case === "multi";
  const list = gateItems(isMulti ? weak.ideas : weak.suggestions, 4);
  if (!list.length) return null;
  const message = weak.message.trim() || (isMulti
    ? "Your prompt holds a few separate requests. I'll work with all of them, or you can focus on one:"
    : "This is quite broad. I'll start with it as it is, or you can narrow it to one of these:");
  return { message, items: list, hint: "Optional — you can keep going without choosing." };
}

/** One attached file as a line of notes carried into the topic (legacy addFiles). */
export const fileNote = (title: string, text: string): string => `\n- ${title}: ${truncateForCard(String(text || "").replace(/\s+/g, " "), 600)}`;

/** What a card shows. Handlers are not state: they live in store/gate.ts, keyed by message id. */
export interface GateCardData {
  options: GateItem[];
  /** Label the options A, B, C. */
  letters: boolean;
  hint?: string;
  buttons: { id: string; label: string; primary?: boolean }[];
  /** True once answered (or replaced by a typed answer): every control is disabled. */
  locked: boolean;
  /** "o:<index>" or "b:<id>", the control the person pressed. */
  chosen?: string;
}
