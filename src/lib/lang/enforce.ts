/**
 * AI-backed language guard. Ported from legacy/entry-v4.html (resolveLanguage, enforceAnchorLanguage).
 * Detect -> if mismatched, rewrite only the human-readable strings -> re-check. Never blocks a reply.
 *
 * Calls (CLAUDE.md): lang:classify (small, only for short Latin-script text the stopword lists
 * can't settle, cached per text) and lang:repair (small, at most 2 attempts, only on a mismatch).
 */
import { json } from "../ai/client";
import { isAbort } from "../ai/errors";
import {
  LANGUAGE_PURITY_GUARD, LANG_NAMES, collectStrings, detectTextLanguage, languagesMatch, setLeaf, tokenBudgetMultiplier, type Lang,
} from "./detect";

const cache = new Map<string, Lang | null>();

/** Local detection, plus one tiny classification call when a short Latin-script text is ambiguous. */
export async function resolveLanguage(text: string, signal?: AbortSignal): Promise<Lang | null> {
  const local = detectTextLanguage(text);
  if (!local || local.script !== "latin" || local.lang) return local;
  const key = String(text).slice(0, 600);
  if (cache.has(key)) return cache.get(key) ?? null;
  let out: Lang | null = local;
  try {
    const r = await json<{ language?: string }>(
      [{ role: "user", content: `Identify the natural language this text is written in. Text: ${JSON.stringify(key)}\n\nRespond ONLY with a raw JSON object {"language": "<ISO 639-1 two-letter code>"}.` }],
      { label: "lang:classify", tier: "small", signal },
    );
    const code = typeof r?.language === "string" ? r.language.trim().toLowerCase().slice(0, 2) : "";
    if (/^[a-z]{2}$/.test(code)) out = { script: "latin", lang: code };
  } catch (e) {
    if (isAbort(e)) throw e;
    console.warn("[Language guard] classification failed", e);
  }
  cache.set(key, out);
  return out;
}

export interface EnforceOptions {
  /** The originating prompt (the language anchor). Nothing happens without one. */
  anchor: string;
  /** For logs only. */
  where?: string;
  signal?: AbortSignal;
}

/**
 * Makes every human-readable string in `obj` match the anchor's language. Mutates and returns obj.
 * Machine fields (ids, kinds, ops, urls...) are left byte-identical.
 */
export async function enforceAnchorLanguage<T>(obj: T, opts: EnforceOptions): Promise<T> {
  if (!obj || typeof obj !== "object") return obj;
  const anchor = (opts.anchor || "").trim();
  if (!anchor) return obj;
  const where = opts.where || "chat";
  const anchorLang = await resolveLanguage(anchor, opts.signal);
  const editable = collectStrings(obj);
  if (!editable.length) return obj;
  const outLang = await resolveLanguage(editable.map((l) => l.value).join("\n"), opts.signal);
  if (languagesMatch(anchorLang, outLang)) return obj;

  const items = editable.map((l) => l.value);
  const target = anchorLang?.lang && LANG_NAMES[anchorLang.lang] ? ` (that is: ${LANG_NAMES[anchorLang.lang]})` : "";
  const prompt = `Below is a JSON array of ${items.length} text items from an assistant's reply. Rewrite EVERY item so it is written entirely in the same language as this original prompt: "${anchor}"${target}. Whatever language that prompt is written in is the target — if it is English, write natural English. Keep each item's meaning, tone, length, markdown formatting, numbers, proper names, product names, and any bracketed IDs (like [cat-0]) exactly as they are. Items already in the target language stay as they are.

Items:
${JSON.stringify(items)}

Respond with ONLY a raw JSON object of the form {"items": [...]} containing exactly ${items.length} strings, in the same order. ${LANGUAGE_PURITY_GUARD}`;
  // maxTokens stays at the default guard unless a Thai/CJK rewrite could really exceed it.
  const estimate = Math.round(items.join(" ").length * 0.6 * tokenBudgetMultiplier(anchor));
  const maxTokens = estimate > 6000 ? Math.min(32000, estimate + 2000) : undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await json<{ items?: unknown }>([{ role: "user", content: prompt }], {
        label: "lang:repair", tier: "small", maxTokens, signal: opts.signal,
        schema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "string" } } } },
      });
      const fixed = Array.isArray(res?.items) ? (res.items as unknown[]) : null;
      if (!fixed || fixed.length !== items.length || fixed.some((x) => typeof x !== "string" || !x.trim())) {
        console.warn(`[Language guard] ${where}: repair returned ${fixed ? fixed.length : "no"} items for ${items.length}`);
        continue;
      }
      const strings = fixed as string[];
      const after = await resolveLanguage(strings.join("\n"), opts.signal);
      if (!languagesMatch(anchorLang, after) && !attempt) continue; // one more try, else keep best effort
      editable.forEach((l, i) => setLeaf(l, strings[i].trim()));
      return obj;
    } catch (e) {
      if (isAbort(e)) throw e;
      console.warn(`[Language guard] ${where}: repair call failed`, e);
    }
  }
  return obj; // never block the reply on the guard itself
}
