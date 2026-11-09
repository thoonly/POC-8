/**
 * The answer ledger: every answer the person gives to a question (Entry's size questions, later
 * the other nodes' questions) is kept here so nothing with the same idea is asked again.
 * Ported from legacy/entry-v4.html 10166-10217 (ANSWER_LEDGER, ledgerAdd/Facts/Block/Bigrams/
 * IsRepeat/DropRepeats, WHO_RULE, SPLIT_RULE). Prompt text is verbatim. Pure: the store that holds
 * the entries is store/ledger.ts.
 *
 * Not ported: legacy ledgerFacts() also lists the known rows of the Grounded statement; pass them
 * as `extra` when that lands.
 */

export interface LedgerEntry { q: string; a: string; node: string }

/** Who "we" are: research can't look anything up about "our product" without it. */
export const WHO_RULE = `ABOUT THE USER: if the request refers to the user's own organisation, team, product or customers ("our product", "we", "my company", or the same in any language) and nothing known above says which one it is or what it does, include ONE question asking exactly that — which company or product, what it does, and who its main customers are. Everything later (research, web search, comparisons) depends on it. Give 3-4 example answer types as options; the user can type their own. If it is already known, never ask it.`;

/** Several places in one request: without the time split the plan can't size each place. */
export const SPLIT_RULE = `SEVERAL PLACES: if the request names two or more places to go to or cover (cities, countries, areas, venues) and nothing known above says how the time is split between them, include ONE question asking how many days (or how much time) go to each place. Offer 3-4 plausible splits written with the real place names, plus "Not decided yet". If the split is already known, never ask it.`;

/** Returns a new ledger with the answer added, or replacing the answer to the same question. */
export function ledgerAdd(ledger: readonly LedgerEntry[], q: string, a: string, node: string): LedgerEntry[] {
  const question = String(q || "").trim();
  const answer = String(a || "").trim();
  if (!question || !answer) return ledger.slice();
  const key = question.toLowerCase();
  if (ledger.some((x) => x.q.toLowerCase() === key)) return ledger.map((x) => (x.q.toLowerCase() === key ? { q: x.q, a: answer, node } : x));
  return [...ledger, { q: question, a: answer, node }];
}

/** "question → answer" lines, without duplicates. `extra` are further known facts in the same form. */
export function ledgerFacts(ledger: readonly LedgerEntry[], extra: readonly string[] = []): string[] {
  return [...new Set([...ledger.map((x) => `${x.q} → ${x.a}`), ...extra])];
}

/** The block a question-asking prompt carries, or "" when nothing is known yet. */
export function ledgerBlock(ledger: readonly LedgerEntry[], extra: readonly string[] = []): string {
  const f = ledgerFacts(ledger, extra);
  return f.length ? `\nAlready answered by the user earlier (in any node). Treat these as known facts. NEVER ask about any of them again — not reworded, not narrowed, not folded into another question:\n${f.map((x) => "- " + x).join("\n")}\n` : "";
}

/** Character pairs of a text, ignoring case and punctuation. Works for any script. */
function bigrams(s: string): Set<string> {
  const t = String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const set = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

/** True when the question is plainly a repeat of one already answered (Dice overlap of 0.7 or more). */
export function ledgerIsRepeat(ledger: readonly LedgerEntry[], question: string): boolean {
  const b = bigrams(question);
  if (b.size < 4) return false;
  return ledger.some((x) => {
    const c = bigrams(x.q);
    let n = 0;
    b.forEach((g) => { if (c.has(g)) n++; });
    return (2 * n) / (b.size + c.size) >= 0.7;
  });
}

/** Safety net after the model: drops every question that repeats one already answered. */
export function ledgerDropRepeats<T>(ledger: readonly LedgerEntry[], list: readonly T[], getQ: (item: T) => string): T[] {
  return list.filter((item) => !ledgerIsRepeat(ledger, getQ(item)));
}
