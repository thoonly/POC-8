/** Choice groups: turn an answer into a one-tap document update. Ported from legacy/entry-v4.html (12869-12881). */
import type { ChoiceGroup } from "./types";

export const CHAT_CHOICES_SPEC = `- "choices": array of 0-4 groups, each {"prompt": short question to the user, "multi": true/false, "options": array of 2-5 short options}. Include them when:
  (a) your reply presents alternatives or recommendations the user might adopt into the document, and you have NOT already added them via "actions" — one group framing that decision, options being the concrete alternatives;
  (b) the user asks what is unclear, missing, open or undecided, or asks for help clarifying — one group per unclear point, each with plausible answers.
  "multi" is true only when several options can genuinely apply together. Write choices in the same language as your reply. Do not add a closing question in "reply" asking whether to add them — the choices card does that. Otherwise return an empty array.`;

export function sanitizeChatChoices(raw: unknown): ChoiceGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 4)
    .map((g: Record<string, unknown> | null) => ({
      prompt: g && typeof g.prompt === "string" ? g.prompt.trim() : "",
      multi: !!(g && g.multi),
      options: g && Array.isArray(g.options)
        ? [...new Set(g.options.filter((o): o is string => typeof o === "string" && !!o.trim()).map((o) => o.trim()))].slice(0, 5)
        : [],
    }))
    .filter((g) => g.prompt && g.options.length >= 2);
}
