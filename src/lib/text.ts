/** Small text helpers. Ported from legacy/entry-v4.html (truncateForCard, 4698). */

/**
 * Shortens `text` to at most `max` characters, ending in an ellipsis. Cuts on a grapheme boundary
 * (so a Thai consonant never loses its vowel mark) and backs up to a word boundary when one is near.
 */
export function truncateForCard(text: string | null | undefined, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  const toWord = (s: string) => {
    const i = s.lastIndexOf(" ");
    return i > s.length * 0.6 ? s.slice(0, i) : s;
  };
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const clusters = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
    if (clusters.length <= max) return text;
    return toWord(clusters.slice(0, max - 1).join("")) + "…";
  }
  return toWord(text.slice(0, max - 1)) + "…";
}
