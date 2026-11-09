/**
 * Pure helpers for model text. Ported from entry-v4.html (repairUnescapedQuotes,
 * extractJsonCandidates, runWithConcurrencyLimit) and components/ai.js (parseJson, joinParts,
 * withJsonInstruction, dropThinking). No DOM, no network.
 */
import type { JsonSchema, Message } from "./types";

/**
 * Best-effort repair for the most common way a model's JSON breaks: a literal, unescaped `"`
 * used as punctuation inside a string value. A real closing quote is always followed (ignoring
 * whitespace) by `,` `}` `]` or `:`; any other quote inside a string gets escaped.
 */
export function repairUnescapedQuotes(str: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      i++;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      if (i + 1 < str.length) {
        out += str[i + 1];
        i += 2;
      } else i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < str.length && /\s/.test(str[j])) j++;
      const next = str[j];
      if (next === "," || next === "}" || next === "]" || next === ":" || j >= str.length) {
        out += ch;
        inString = false;
        i++;
      } else {
        out += '\\"';
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Every balanced top-level {...} in the text; braces inside JSON strings are skipped. */
export function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

/**
 * Parses model text to JSON. Strips code fences, then tries the whole text, the outermost
 * {...}/[...] slice, the LAST balanced {...} (models sometimes think aloud first), and finally
 * the same candidates after repairUnescapedQuotes. Returns undefined when nothing parses.
 */
export function parseJson<T = unknown>(text: string): T | undefined {
  const t = String(text ?? "").replace(/```(?:json)?/gi, "").trim();
  const tryParse = (s: string): T | undefined => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return undefined;
    }
  };
  let v = tryParse(t);
  if (v !== undefined) return v;
  const a = t.search(/[{[]/);
  const b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a >= 0 && b > a) {
    v = tryParse(t.slice(a, b + 1));
    if (v !== undefined) return v;
  }
  const cands = extractJsonCandidates(t);
  for (let i = cands.length - 1; i >= 0; i--) {
    v = tryParse(cands[i]);
    if (v !== undefined) return v;
  }
  v = tryParse(repairUnescapedQuotes(t));
  if (v !== undefined) return v;
  for (let i = cands.length - 1; i >= 0; i--) {
    v = tryParse(repairUnescapedQuotes(cands[i]));
    if (v !== undefined) return v;
  }
  return undefined;
}

export type Settled<T> = { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown };

/**
 * Runs async tasks with at most `limit` in flight; results keep input order and use the
 * Promise.allSettled shape. A small cap avoids a burst that hits a rate limit all at once.
 */
export async function runWithConcurrencyLimit<I, O>(
  items: readonly I[],
  limit: number,
  task: (item: I, index: number) => Promise<O>,
): Promise<Settled<O>[]> {
  const results = new Array<Settled<O>>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await task(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Joins a cut-off answer and its continuation, dropping any overlap the model repeated. */
export function joinParts(a: string, b: string): string {
  b = b.replace(/^\s*```(?:json)?\s*/i, "");
  for (let k = Math.min(200, a.length, b.length); k > 8; k--) {
    if (a.endsWith(b.slice(0, k))) return a + b.slice(k);
  }
  return a + b;
}

/** For providers/models without response_format: state the shape in the last user message. */
export function withJsonInstruction(messages: Message[], schema?: JsonSchema): Message[] {
  const note = schema
    ? `\n\nRespond ONLY with JSON matching this JSON Schema:\n${JSON.stringify(schema)}`
    : "\n\nRespond ONLY with a JSON object.";
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user") {
      out[i] = { ...out[i], content: out[i].content + note };
      return out;
    }
  }
  return out.concat({ role: "user", content: note.trim() });
}

/** Some models put reasoning inline as <think>...</think>; keep only the answer. */
export const dropThinking = (t: unknown): string =>
  String(t ?? "").replace(/<think>[\s\S]*?(<\/think>|$)/gi, "");

/**
 * Keywords Claude's structured outputs reject (they 400). The prompt still states the limits.
 * Applied recursively to a JSON Schema.
 */
const CLAUDE_UNSUPPORTED = new Set([
  "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "multipleOf", "minItems", "maxItems", "uniqueItems",
]);
export function claudeSchema<T>(s: T): T {
  if (Array.isArray(s)) return s.map(claudeSchema) as unknown as T;
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (CLAUDE_UNSUPPORTED.has(k)) continue;
    out[k] = claudeSchema(v);
  }
  return out as T;
}

// ---------- streaming helpers (used by the server's SSE readers and the browser client) ----------

/**
 * Splits a server-sent-events buffer into the payloads of its `data: ` lines and the unfinished
 * rest (keep it and prepend the next chunk). Comment lines (": keep-alive") and other fields are ignored.
 */
export function splitSse(buffer: string): { payloads: string[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const payloads: string[] = [];
  for (const line of lines) {
    const l = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (l.startsWith("data:")) payloads.push(l.slice(5).trimStart());
  }
  return { payloads, rest };
}

export interface Peeked { value: string | boolean; /** false while the value is still being written */ complete: boolean }

const ESC: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "/": "/", "\\": "\\", '"': '"' };

/** Decodes a JSON string that starts at s[i] === '"'. `complete` is false if the closing quote is not there yet. */
function readJsonString(s: string, i: number): { value: string; end: number; complete: boolean } {
  let out = "";
  let p = i + 1;
  while (p < s.length) {
    const c = s[p];
    if (c === '"') return { value: out, end: p + 1, complete: true };
    if (c !== "\\") { out += c; p++; continue; }
    const e = s[p + 1];
    if (e === undefined) break; // the escape itself is not here yet
    if (e === "u") {
      const hex = s.slice(p + 2, p + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break; // half a \uXXXX: wait for the rest
      out += String.fromCharCode(parseInt(hex, 16));
      p += 6;
    } else { out += ESC[e] ?? e; p += 2; }
  }
  return { value: out, end: s.length, complete: false };
}

/**
 * Reads ONE top-level field out of JSON that is still being written, e.g. the "reply" of a router
 * answer so it can be shown while the rest (actions, choices) is still coming. Supports string and
 * boolean values; objects, arrays, numbers and null are skipped. Returns undefined while the key
 * has not appeared yet (or the text is not an object). A string value comes back as far as it is
 * written, with complete: false until its closing quote arrives.
 */
export function peekJsonField(partial: string, key: string): Peeked | undefined {
  const s = partial;
  const n = s.length;
  const ws = (i: number) => { while (i < n && /\s/.test(s[i])) i++; return i; };
  let i = ws(0);
  if (s[i] !== "{") return undefined;
  i++;
  for (;;) {
    i = ws(i);
    while (s[i] === ",") i = ws(i + 1);
    if (i >= n || s[i] !== '"') return undefined; // end of object, end of text, or malformed
    const k = readJsonString(s, i);
    if (!k.complete) return undefined;
    i = ws(k.end);
    if (s[i] !== ":") return undefined;
    i = ws(i + 1);
    if (i >= n) return undefined;
    const found = k.value === key;
    const c = s[i];
    if (c === '"') {
      const v = readJsonString(s, i);
      if (found) return { value: v.value, complete: v.complete };
      if (!v.complete) return undefined;
      i = v.end;
    } else if (s.startsWith("true", i) || s.startsWith("false", i)) {
      const v = s.startsWith("true", i);
      if (found) return { value: v, complete: true };
      i += v ? 4 : 5;
    } else if (c === "{" || c === "[") {
      let depth = 0;
      let p = i;
      for (; p < n; p++) {
        if (s[p] === '"') { const v = readJsonString(s, p); if (!v.complete) return undefined; p = v.end - 1; }
        else if (s[p] === "{" || s[p] === "[") depth++;
        else if (s[p] === "}" || s[p] === "]") { depth--; if (!depth) break; }
      }
      if (p >= n) return undefined; // the nested value is still being written
      i = p + 1;
    } else {
      let p = i;
      while (p < n && !/[,}\s]/.test(s[p])) p++;
      if (p >= n) return undefined; // number / null / partial literal not finished
      i = p;
    }
  }
}
