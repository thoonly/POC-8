/** "Help me decide": sanitize the coach's answer. Ported from legacy/entry-v4.html (13097-13133). */
import { sanitizeChatChoices } from "./choices";
import type { DecisionData, DecisionFit, DecisionRequest } from "./types";

const FITS: DecisionFit[] = ["best", "good", "weak", "unknown"];
const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && !!s.trim()).slice(0, 3) : []);
const text = (x: unknown): string => (typeof x === "string" ? x.trim() : "");

export function sanitizeDecision(res: unknown, d: Pick<DecisionRequest, "options">): DecisionData {
  const out: DecisionData = { intro: "", options: [], recommendation: null, prefs: [] };
  const r = res as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return out;
  out.intro = text(r.intro);

  const allowed = d.options.map((o) => o.toLowerCase());
  const seen = new Set<string>();
  for (const o of (Array.isArray(r.options) ? r.options : []) as Record<string, unknown>[]) {
    if (!o || typeof o.option !== "string") continue;
    let label = o.option.trim();
    if (allowed.length) {
      const idx = allowed.indexOf(label.toLowerCase());
      if (idx === -1) continue; // never let the coach silently swap in options that were not offered
      label = d.options[idx];
    }
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.options.push({
      option: label, summary: text(o.summary), pros: list(o.pros), cons: list(o.cons), best_if: text(o.best_if),
      fit: FITS.includes(o.fit as DecisionFit) ? (o.fit as DecisionFit) : "unknown",
    });
  }
  if (!allowed.length) out.options = out.options.slice(0, 5);

  const rec = r.recommendation as Record<string, unknown> | null;
  if (rec && typeof rec.option === "string" && rec.option.trim()) {
    const match = out.options.find((o) => o.option.toLowerCase() === (rec.option as string).trim().toLowerCase());
    if (match) {
      out.recommendation = {
        option: match.option, why: text(rec.why),
        confidence: ["high", "medium", "low"].includes(rec.confidence as string) ? (rec.confidence as "high" | "medium" | "low") : "medium",
      };
    }
  }
  if (out.recommendation) {
    const top = out.recommendation.option;
    out.options.sort((a, b) => Number(b.option === top) - Number(a.option === top));
  }
  const qs = (Array.isArray(r.preference_questions) ? r.preference_questions : []) as Record<string, unknown>[];
  out.prefs = sanitizeChatChoices(qs.map((q) => ({ prompt: q?.q, multi: q?.multi, options: q?.options }))).slice(0, 3);
  return out;
}
