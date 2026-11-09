/**
 * Chat actions: parse ids, sanitize what the model proposed against the LIVE document, and decide
 * deterministically which changes apply at once and which wait for the user. The model never
 * decides that. Ported from legacy/entry-v4.html (12233-12372).
 */
import { truncateForCard } from "../text";
import {
  CHAT_BULK_LIMIT, CHAT_OPS, CHAT_REFINE_RETENTION,
  type ChatAction, type ChatDoc, type ChatOp, type ParsedTarget,
} from "./types";

// ---------- id resolution ----------
export function parseTarget(id: string | null | undefined): ParsedTarget | null {
  let m: RegExpExecArray | null;
  if ((m = /^action-(\d+)$/.exec(id || ""))) return { type: "action", i: +m[1] };
  if ((m = /^topic-(\d+)-(\d+)$/.exec(id || ""))) return { type: "topic", ci: +m[1], ti: +m[2] };
  if ((m = /^cat-(\d+)$/.exec(id || ""))) return { type: "category", i: +m[1] };
  return null;
}

export function textAt(doc: ChatDoc, t: ParsedTarget | null): string | null {
  if (!t) return null;
  if (t.type === "action") return doc.actions[t.i]?.text ?? null;
  if (t.type === "category") return doc.categories[t.i]?.label ?? null;
  return doc.categories[t.ci]?.topics[t.ti] ?? null;
}

/**
 * Pending proposals can sit for a while and the user may edit the document in between, so a target
 * is found again by its ORIGINAL text, not trusted by index. Not found = the action is stale.
 */
export function locate(a: ChatAction, doc: ChatDoc): ParsedTarget | null {
  const t = a.parsedTarget;
  if (!t) return null;
  if (t.type === "action") { const i = doc.actions.findIndex((x) => x.text === a.targetText); return i === -1 ? null : { type: "action", i }; }
  if (t.type === "category") { const i = doc.categories.findIndex((c) => c.label === a.targetText); return i === -1 ? null : { type: "category", i }; }
  const ci = doc.categories.findIndex((c) => c.label === a.targetCatText);
  if (ci === -1) return null;
  const ti = doc.categories[ci].topics.findIndex((x) => x === a.targetText);
  return ti === -1 ? null : { type: "topic", ci, ti };
}

// ---------- sanitize ----------
export interface SanitizeOptions {
  /** Ops this build can actually apply. Anything else is dropped. Default: all. */
  allowed?: ReadonlySet<ChatOp>;
  /** Gives each action its uid. */
  uid: () => string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function sanitizeChatActions(raw: unknown, doc: ChatDoc, opts: SanitizeOptions): ChatAction[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAction[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || !(CHAT_OPS as readonly unknown[]).includes(r.op)) continue;
    const op = r.op as ChatOp;
    if (opts.allowed && !opts.allowed.has(op)) continue;
    const a: ChatAction = { op, value: str(r.value), reason: str(r.reason), conflict: str(r.conflict), target: str(r.target), state: "pending", uid: opts.uid() };

    // Before anything is generated the Cognitive Field, Answer and Actions don't exist to be targeted.
    if (!doc.generated && !["refine_topic", "set_topic", "add_scratch_note", "regenerate_output"].includes(op)) continue;
    if (!["remove_item", "regenerate_output"].includes(op) && !a.value) continue;

    if (op === "add_topic") {
      const t = parseTarget(a.target);
      if (!t || t.type !== "category") continue;
      const label = textAt(doc, t);
      if (label == null) continue; // a hallucinated cat id is dropped, never guessed
      a.targetCatIndex = t.i;
      a.targetCatText = label;
    }
    if (op === "edit_item" || op === "remove_item") {
      a.parsedTarget = parseTarget(a.target);
      if (!a.parsedTarget) continue;
      const txt = textAt(doc, a.parsedTarget);
      if (txt == null || !txt.trim()) continue;
      a.targetText = txt;
      if (a.parsedTarget.type === "topic") a.targetCatText = doc.categories[a.parsedTarget.ci].label;
    }
    // Drop exact duplicates of what is already there.
    if (op === "add_category" && doc.categories.some((c) => c.label === a.value)) continue;
    if ((op === "add_suggested_action" || op === "add_available_action") && doc.actions.some((x) => x.text === a.value)) continue;
    if ((op === "set_topic" || op === "refine_topic") && a.value === doc.topic.trim()) continue;
    if ((op === "set_answer" || op === "refine_answer") && a.value === doc.answer.trim()) continue;
    if (op === "edit_item" && a.value === a.targetText) continue;
    out.push(a);
  }
  return out;
}

// ---------- retention (language-agnostic: Intl.Segmenter handles Thai) ----------
function bigrams(text: string): Set<string> {
  const g = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text || ""), (s) => s.segment);
  const set = new Set<string>();
  for (let i = 0; i < g.length - 1; i++) set.add(g[i] + g[i + 1]);
  return set;
}

/** Share (0-1) of the old text's character pairs that survive in the new text. */
export function retention(oldText: string, newText: string): number {
  const old = bigrams(oldText);
  if (!old.size) return 1;
  const next = bigrams(newText);
  let kept = 0;
  old.forEach((b) => { if (next.has(b)) kept++; });
  return kept / old.size;
}

// ---------- THE POLICY ----------
export interface PolicyContext { fromResearch?: boolean; bulk?: boolean }

export function confirmPolicy(a: ChatAction, ctx: PolicyContext, doc: ChatDoc): { confirm: boolean; why: string } {
  if (ctx.fromResearch) return { confirm: true, why: "Based on outside web research — review before it enters your document" };
  if (a.conflict) return { confirm: true, why: "May contradict the current Topic/Answer" };
  if (ctx.bulk) return { confirm: true, why: `Large change (more than ${CHAT_BULK_LIMIT} edits at once)` };
  const pct = (k: number) => Math.round(k * 100);
  switch (a.op) {
    case "refine_topic": {
      const kept = retention(doc.topic.trim(), a.value);
      return kept >= CHAT_REFINE_RETENTION ? { confirm: false, why: "" } : { confirm: true, why: `Changes more of the Topic than just adding the new detail (${pct(kept)}% of the current wording kept)` };
    }
    case "refine_answer": {
      const kept = retention(doc.answer.trim(), a.value);
      return kept >= CHAT_REFINE_RETENTION ? { confirm: false, why: "" } : { confirm: true, why: `Changes more of the Answer than just adding the new detail (${pct(kept)}% of the current wording kept)` };
    }
    case "set_topic": return { confirm: true, why: "The Topic is the root everything else (Graph, Answer, Actions) is generated from" };
    case "set_answer": return { confirm: true, why: "Rewrites the Answer wholesale rather than adding to it" };
    case "edit_item": return { confirm: true, why: "Rewrites wording that is already on the graph/Output" };
    case "remove_item": return { confirm: true, why: "Removes something already on the graph/Output" };
    case "regenerate_output": return { confirm: true, why: doc.generated ? "Regenerating replaces the current Cognitive Field, Answer, and Actions" : "Generates the Cognitive Field, Answer, and Actions for the first time" };
    default: return { confirm: false, why: "" }; // additive ops
  }
}

export function describe(a: ChatAction, generated: boolean): string {
  const map: Record<ChatOp, string> = {
    set_topic: "Rewrite your request", refine_topic: "Update your request",
    set_answer: "Rewrite Answer", refine_answer: "Update Answer",
    add_category: "Add category", add_topic: `Add topic to: ${truncateForCard(a.targetCatText || "", 50)}`,
    add_suggested_action: "Add next step", add_available_action: "Add next step (lower confidence)",
    add_scratch_note: "Add Scratch pad note",
    edit_item: "Edit item", remove_item: "Remove item",
    regenerate_output: generated ? "Regenerate Cognitive Field, Answer & Actions" : "Generate Cognitive Field, Answer & Actions",
  };
  return map[a.op] || a.op;
}

export function beforeText(a: ChatAction, doc: ChatDoc): string {
  if (a.op === "set_topic" || a.op === "refine_topic") return doc.topic.trim();
  if (a.op === "set_answer" || a.op === "refine_answer") return doc.answer.trim();
  if (a.op === "edit_item" || a.op === "remove_item") return a.targetText || "";
  return "";
}

/** Fills in needsConfirm / why / label / beforeSnap on every action and returns them. */
export function routeActions(actions: ChatAction[], ctx: PolicyContext, doc: ChatDoc): ChatAction[] {
  const bulk = actions.length > CHAT_BULK_LIMIT;
  for (const a of actions) {
    const p = confirmPolicy(a, { ...ctx, bulk }, doc);
    a.needsConfirm = p.confirm;
    a.why = p.why;
    a.label = describe(a, doc.generated);
    a.beforeSnap = beforeText(a, doc);
  }
  return actions;
}
