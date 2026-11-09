/**
 * Tiny, safe markdown for chat bubbles. Ported from legacy/entry-v4.html (chatMd, 11988).
 * Returns blocks, not HTML: React renders them, so model text is never injected as markup.
 * Supports **bold**, _italic_, "- " bullets, "### " headings and pipe tables.
 */

export interface Span { text: string; b?: boolean; i?: boolean }

export type Block =
  | { t: "p"; lines: Span[][] }
  | { t: "ul"; items: Span[][] }
  | { t: "h"; spans: Span[] }
  | { t: "table"; head: Span[][]; rows: Span[][][] };

const INLINE = /\*\*(.+?)\*\*|(?<=^|[\s(])_([^_\n]+?)_(?=[\s).,;:!?]|$)/g;

export function parseInline(text: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push(m[1] !== undefined ? { text: m[1], b: true } : { text: m[2], i: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const cells = (line: string): string[] => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function parseChatMd(src: string): Block[] {
  const blocks: Block[] = [];
  let para: Span[][] | null = null;
  let list: Span[][] | null = null;
  let table: string[][] | null = null;

  const flushPara = () => { if (para?.length) blocks.push({ t: "p", lines: para }); para = null; };
  const flushList = () => { if (list?.length) blocks.push({ t: "ul", items: list }); list = null; };
  const flushTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    blocks.push({ t: "table", head: head.map(parseInline), rows: body.map((r) => head.map((_, i) => parseInline(r[i] || ""))) });
    table = null;
  };

  for (const line of String(src ?? "").split(/\r?\n/)) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara(); flushList();
      if (!line.replace(/[|\s:-]/g, "")) continue; // the "| --- |" separator row
      (table ??= []).push(cells(line));
      continue;
    }
    flushTable();
    const li = /^\s*[-•*]\s+(.*)$/.exec(line);
    if (li) { flushPara(); (list ??= []).push(parseInline(li[1])); continue; }
    flushList();
    const hd = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (hd) { flushPara(); blocks.push({ t: "h", spans: parseInline(hd[1]) }); continue; }
    if (!line.trim()) { flushPara(); continue; }
    (para ??= []).push(parseInline(line));
  }
  flushPara(); flushList(); flushTable();
  return blocks;
}

/**
 * For text that is still being written: removes a marker that has been opened but not closed yet
 * (a trailing odd "**", or a "_" that starts an italic), so the bubble never shows literal marker
 * characters that disappear a moment later when the closing one arrives.
 */
export function hideOpenMarkup(text: string): string {
  let out = text;
  const bold = out.split("**").length - 1;
  if (bold % 2 === 1) { const i = out.lastIndexOf("**"); out = out.slice(0, i) + out.slice(i + 2); }
  return out.replace(/(^|[\s(])_([^_\n]*)$/, "$1$2");
}
