/**
 * Gap analysis: "is the size of this work already clear?" Ported from legacy/entry-v4.html
 * (10219-10272: buildGapAnalysisPrompt, runGapAnalysis). Prompt text is verbatim. The card that asks
 * the questions is components/chat/ChoiceCard.tsx; the flow is in store/gate.ts.
 *
 * AI call: entry:gap-analysis, tier small (CLAUDE.md: "yes/no checks", classify). The prompt calls
 * itself "a fast, cheap pre-check". Move to large only if small asks the wrong questions on real
 * prompts, and say why here.
 *
 * The reply is plain chat/completions JSON: choices[0].message.content is a JSON string,
 * { "gaps": [{ "question", "options", "multi" }] }, parsed by the AI client (lib/ai/client.ts).
 *
 * Deviations from legacy, all forced by the project rules:
 *  - maxTokens (900 x language multiplier) is dropped: the rules forbid a ceiling under 2000.
 *  - The answer is requested with a strict schema (maxItems 5 on gaps and on options).
 *  - Legacy used the clarified request as the topic and the originating prompt as the language anchor;
 *    both are kept (the caller passes them).
 */
import { json } from "../ai/client";
import { isAbort } from "../ai/errors";
import type { JsonSchema } from "../ai/types";
import type { ChoiceGroup } from "../chat/types";
import { LANGUAGE_PURITY_GUARD } from "../lang/detect";
import { enforceAnchorLanguage } from "../lang/enforce";
import { SPLIT_RULE, WHO_RULE, ledgerBlock, ledgerDropRepeats, type LedgerEntry } from "./ledger";

export const MAX_GAPS = 5;
export const MAX_GAP_OPTIONS = 5;

export const GAPS_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["gaps"],
  properties: {
    gaps: {
      type: "array",
      maxItems: MAX_GAPS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "options", "multi"],
        properties: {
          question: { type: "string" },
          options: { type: "array", maxItems: MAX_GAP_OPTIONS, items: { type: "string" } },
          multi: { type: "boolean" },
        },
      },
    },
  },
};

export function gapAnalysisPrompt(topic: string, ledger: readonly LedgerEntry[] = []): string {
  return `You are checking a user's topic for an Entry Node exploration inside CollabiQ, a workstream management platform, before anything is generated. This is a fast, cheap pre-check, not the real generation.

Topic (read the underlying task, even if it arrives relayed, quoted from someone else, or wrapped in a narrative — e.g. "I got an email from my boss asking me to...", "my client wants..." — judge what's actually being asked for, not the sentence frame it's wrapped in):
"${topic}"

${ledgerBlock(ledger)}
Your ONE job here: decide whether the SIZE of the work this becomes is already clear — how many separate workstreams it splits into, and how big each one is. Ask only the questions whose answer would change that: whether bundled tasks are really separate pieces of work, the scale (how many people, items, locations or audiences), how long it runs or the time span it covers, the budget level, the deadline or date, and what has to be delivered at the end. Test every candidate question: "If the answer changed, would the suggested workstream get bigger, smaller, split in two, or merge?" If not, do not ask it.

Do NOT ask about preferences or details that only matter later, inside the work itself (cuisine, colours, tone, exact wording, which vendor) — those get settled once the workstream exists. Judge each prompt on its own concrete content, not on what "kind" of request it seems to be.

Calibration example 1 — "Find a place for our company outing": the size-defining unknowns are how many people are joining, how many days it runs, the total budget, and the date or month. Each one changes how much planning the workstream holds (a 12-person afternoon vs. a 200-person two-day trip). Asking about food preferences would be wrong here.

Calibration example 2 — "I received an email from my boss: 'Can you book a business trip to Japan including reserve a restaurant for a client dinner and prepare a yearly revenue and profit presentation'": the size-defining unknowns are how many people are travelling and for how many days, whether the trip covers one city or several, and which period and business units the revenue and profit presentation covers. Asking which cuisine the client likes would be wrong at this stage.

${WHO_RULE} This is the one question allowed here that is not about size.

${SPLIT_RULE} (This one IS about size: it sets how much work each place gets.)

FACTS ONLY THE PERSON KNOWS: also ask for the basic facts the work stands on that only the person can give — nothing later can research or decide them for them: where exactly they are going when the place is set by their work (which city), who it is with or for (which client or company they're meeting, who must approve), when (the dates), and where they leave from. E.g. for "plan a business trip to Japan": which city, which client they're visiting, and the dates. Never ask these if the prompt or the known facts already say.

Never silently assume a size-defining detail just because a default seems obvious. But when the prompt already states everything above, return zero gaps — the suggested workstream is then shown right away, with no questions. Ask at most 5 questions, the most important first.

For each gap, write a short, warm, conversational "question" (not a form-field label) and, where sensible, 2-5 tappable "options" covering the likely answers. Also set "multi": true if more than one option could genuinely apply together and the person might reasonably pick several (e.g. "which cities are you considering?" — several can all be true at once), or false if this is really a pick-one question (e.g. "which city are you departing from?" — only one answer makes sense).

Respond in the SAME language as the Topic above. ${LANGUAGE_PURITY_GUARD}

Respond ONLY with a raw JSON object with exactly one key: "gaps" — an array, empty if nothing is genuinely missing, otherwise 1-5 objects each {"question","options","multi"}. No markdown, no code fences, no explanation, no preamble.`;
}

/**
 * Cleans the model's gaps into question groups: drops entries without a question, caps the counts,
 * trims the options. Null when the reply has no "gaps" array (an unreadable answer, not "no gaps").
 */
export function normalizeGaps(res: unknown): ChoiceGroup[] | null {
  const gaps = res && typeof res === "object" ? (res as { gaps?: unknown }).gaps : undefined;
  if (!Array.isArray(gaps)) return null;
  return gaps
    .filter((g): g is Record<string, unknown> => !!g && typeof g === "object" && typeof (g as Record<string, unknown>).question === "string" && !!String((g as Record<string, unknown>).question).trim())
    .slice(0, MAX_GAPS)
    .map((g) => ({
      prompt: String(g.question).trim(),
      options: Array.isArray(g.options) ? g.options.filter((o): o is string => typeof o === "string" && !!o.trim()).map((o) => o.trim()).slice(0, MAX_GAP_OPTIONS) : [],
      multi: !!g.multi,
    }));
}

export interface GapResult {
  /**
   * False when the check errored or came back unreadable, so "no questions" must not be read as
   * "nothing missing". True with no gaps means nothing is missing (or every question repeated one
   * already answered).
   */
  ok: boolean;
  gaps: ChoiceGroup[];
}

/**
 * One call. Never blocks the flow: any failure but an abort comes back as { ok: false } and the
 * caller carries on without questions. `anchor` is the originating prompt (the language anchor).
 */
export async function runGapAnalysis(topic: string, anchor: string, ledger: readonly LedgerEntry[], signal?: AbortSignal): Promise<GapResult> {
  try {
    const raw = await json<{ gaps?: unknown }>(
      [{ role: "user", content: gapAnalysisPrompt(topic, ledger) }],
      { label: "entry:gap-analysis", tier: "small", schema: GAPS_SCHEMA, signal },
    );
    const res = await enforceAnchorLanguage(raw, { where: "gap analysis", anchor: anchor || topic, signal });
    const gaps = normalizeGaps(res);
    if (!gaps) return { ok: false, gaps: [] };
    return { ok: true, gaps: ledgerDropRepeats(ledger, gaps, (g) => g.prompt) }; // never re-ask what was answered anywhere
  } catch (e) {
    if (isAbort(e)) throw e;
    console.error("[Gap analysis] call failed, going on without questions", e);
    return { ok: false, gaps: [] };
  }
}

/** The lines Continue puts into the Topic and the ledger: "question → a, b", only for answered questions. */
export function answerLines(groups: readonly ChoiceGroup[], picked: readonly string[][]): string[] {
  return groups.map((g, i) => (picked[i]?.length ? `${g.prompt} → ${picked[i].join(", ")}` : "")).filter(Boolean);
}

/** The Topic with the answers added, in the form the rest of the flow reads. */
export const withAdditionalDetails = (topic: string, lines: readonly string[]): string =>
  `${topic}\n\nAdditional details:\n${lines.map((l) => "- " + l).join("\n")}`;

/** Questions that got no answer while others did: still open, not dropped. */
export const unansweredQuestions = (groups: readonly ChoiceGroup[], picked: readonly string[][]): string[] =>
  groups.filter((_, i) => !picked[i]?.length).map((g) => g.prompt);
