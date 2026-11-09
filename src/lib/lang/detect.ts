/**
 * Language detection and guards. Pure, no network. Ported from legacy/entry-v4.html (3935-4109, 4800).
 * Anchored to the Entry node's originating prompt: every answer must come back in its language.
 */

export const LANGUAGE_PURITY_GUARD =
  `Do not mix in ANY word, phrase, or spelling from a different language — not even a single loanword, a near-synonym you happen to know in another language, or a foreign word that just "fits" the meaning well. Every single word in your response must be native to the one language you are responding in, with no exceptions. Before finalizing, re-scan every word you wrote one at a time and replace anything that isn't genuinely native to that language.`;

/**
 * Prompts size their word limits against English, but Thai and CJK use roughly 2-2.5x the tokens
 * for the same content. Multiply any output-size estimate by this before comparing with a ceiling.
 */
export function tokenBudgetMultiplier(sampleText: string): number {
  const s = String(sampleText || "");
  if (/[฀-๿]/.test(s)) return 2.8; // Thai
  if (/[一-鿿぀-ヿ가-힯]/.test(s)) return 2.8; // Han / Kana / Hangul
  return 1;
}

const SCRIPTS: [string, RegExp][] = [
  ["thai", /[฀-๿]/g], ["han", /[一-鿿]/g], ["kana", /[぀-ヿ]/g],
  ["hangul", /[가-힯ᄀ-ᇿ]/g], ["cyrillic", /[Ѐ-ӿ]/g],
  ["arabic", /[؀-ۿ]/g], ["hebrew", /[֐-׿]/g],
  ["devanagari", /[ऀ-ॿ]/g], ["greek", /[Ͱ-Ͽ]/g],
  ["latin", /[A-Za-zÀ-ɏ]/g],
];

// Small function-word lists, only to tell Latin-script languages apart.
const LATIN_STOPWORDS: Record<string, string> = {
  en: "the and of to in is are for with on that this what how our we you it be as by or from an at not can should which who will would next my i a do does was were has have your their its about than more when where why get",
  fr: "le la les des du un une et est sont pour avec dans sur que qui ce cette nous vous pas au aux par ou",
  es: "el la los las del un una y es son para con en que por como nuestro nuestra se lo al pero o",
  de: "der die das den dem und ist sind für mit auf nicht ein eine zu von wie wir sie oder im auch",
  pt: "o a os as do da dos das um uma e é são para com em que por como nosso nossa não ou se",
  it: "il lo la gli le del della un una e è sono per con che di come nostro nostra non o si",
  nl: "de het een en is zijn voor met op dat dit wat hoe wij jullie niet van te of ook",
  id: "yang dan di ke dari untuk dengan ini itu adalah tidak kami kita apa bagaimana atau pada",
  vi: "và của là các những cho không được trong có một này với để người khi đã sẽ",
};
const STOP_SETS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(LATIN_STOPWORDS).map(([k, v]) => [k, new Set(v.split(" "))]),
);

export interface Lang {
  script: string;
  /** Language code or script name; null when a Latin-script text is too short to tell. */
  lang: string | null;
}

export function detectTextLanguage(text: string): Lang | null {
  const s = String(text || "");
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [name, re] of SCRIPTS) {
    const n = (s.match(re) || []).length;
    counts[name] = n;
    total += n;
  }
  if (total < 2) return null;
  let script: string;
  if (counts.kana > 0 && counts.kana + counts.han >= total * 0.3) script = "japanese";
  else script = Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a));
  if (script !== "latin") return { script, lang: script };
  const words = s.toLowerCase().match(/[a-zÀ-ɏ]+/g) || [];
  const scores = Object.fromEntries(Object.keys(STOP_SETS).map((k) => [k, 0]));
  for (const w of words) for (const k of Object.keys(STOP_SETS)) if (STOP_SETS[k].has(w)) scores[k]++;
  const [top, second] = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const confident = top[1] >= 2 && top[1] >= second[1] * 2;
  return { script: "latin", lang: confident ? top[0] : null };
}

export const LANG_NAMES: Record<string, string> = {
  en: "English", fr: "French", es: "Spanish", de: "German", pt: "Portuguese", it: "Italian", nl: "Dutch",
  id: "Indonesian", vi: "Vietnamese", thai: "Thai", han: "Chinese", japanese: "Japanese", hangul: "Korean",
  cyrillic: "the Cyrillic-script language of the prompt", arabic: "the Arabic-script language of the prompt",
};

/** Can't tell -> true: don't "fix" what may not be broken. */
export function languagesMatch(anchor: Lang | null, out: Lang | null): boolean {
  if (!anchor || !out) return true;
  if (anchor.script !== out.script) return false;
  if (anchor.script === "latin" && anchor.lang && out.lang) return anchor.lang === out.lang;
  return true;
}

/** Share of non-ASCII characters above 15% counts as non-English (Thai, Chinese, Japanese, Arabic...). */
export function isLikelyNonEnglish(text: string): boolean {
  if (!text) return false;
  const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
  return nonAscii > text.length * 0.15;
}

// Keys whose values are machine fields, ids or labels that must stay byte-identical
// (e.g. a decision's "option" must match the offered list).
const SKIP_KEYS = new Set([
  "role", "depth", "layout", "kind", "op", "target", "id", "type", "url", "uid", "state", "search_query",
  "multi", "fit", "option", "needs_research", "citations", "answer_type",
]);

export interface StringLeaf {
  ref: Record<string, unknown> | unknown[];
  k: string | number;
  value: string;
}

/** Every human-readable string leaf in a JSON value, with where to write a replacement back. */
export function collectStrings(node: unknown, out: StringLeaf[] = [], key?: string): StringLeaf[] {
  if (Array.isArray(node)) {
    node.forEach((v, i) => {
      if (typeof v === "string") { if (v.trim() && !(key && SKIP_KEYS.has(key))) out.push({ ref: node, k: i, value: v }); }
      else collectStrings(v, out, key);
    });
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = obj[k];
      if (typeof v === "string") { if (v.trim()) out.push({ ref: obj, k, value: v }); }
      else collectStrings(v, out, k);
    }
  }
  return out;
}

export function setLeaf(leaf: StringLeaf, value: string): void {
  (leaf.ref as Record<string | number, unknown>)[leaf.k] = value;
}
