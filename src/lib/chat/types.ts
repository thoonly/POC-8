/**
 * Chat engine types. Ported from legacy/entry-v4.html (11930-13260, the "Chat" module).
 *
 * The engine never touches React or the DOM. It reads a ChatDoc (a plain snapshot of the Entry
 * document) and returns ChatActions; the store applies them through its own mutators.
 */

export const CHAT_OPS = [
  "refine_topic", "set_topic", "refine_answer", "set_answer", "add_category", "add_topic",
  "add_suggested_action", "add_available_action", "add_scratch_note", "edit_item", "remove_item", "regenerate_output",
] as const;
export type ChatOp = (typeof CHAT_OPS)[number];

/** More than this many proposed edits in one turn always waits for the user. */
export const CHAT_BULK_LIMIT = 4;
/** A refine that keeps less than this share of the old wording needs confirmation. */
export const CHAT_REFINE_RETENTION = 0.6;

/** What the engine can read of the Entry document. Topic is the node's Topic text, not the raw prompt. */
export interface ChatDoc {
  topic: string;
  answer: string;
  /** false until the Cognitive Field, Answer and Actions have been generated. */
  generated: boolean;
  categories: { label: string; topics: string[]; skeleton?: boolean }[];
  actions: { text: string; tier: "suggested" | "available" }[];
  notes: string[];
}

export type ParsedTarget =
  | { type: "action"; i: number }
  | { type: "topic"; ci: number; ti: number }
  | { type: "category"; i: number };

export type ActionState = "pending" | "applied" | "skipped" | "undone" | "stale";

export interface ChatAction {
  /** Stable id for this proposal ("a12"). */
  uid: string;
  op: ChatOp;
  value: string;
  reason: string;
  /** Empty, or one sentence saying how this change contradicts the current Topic/Answer. */
  conflict: string;
  /** cat-N / topic-N-M / action-N, only for edit_item, remove_item and add_topic. */
  target: string;
  state: ActionState;
  parsedTarget?: ParsedTarget | null;
  /** The target's text when proposed. A target is found again by this text, never by index. */
  targetText?: string;
  targetCatText?: string;
  targetCatIndex?: number;
  needsConfirm?: boolean;
  /** Why the policy asks for confirmation. */
  why?: string;
  label?: string;
  /** Text before the change, shown struck through on the card. */
  beforeSnap?: string;
  staleMsg?: string;
  /** true while an Undo is available (the closure itself lives in the store, not in state). */
  undoable?: boolean;
}

export interface ChoiceGroup {
  prompt: string;
  multi: boolean;
  options: string[];
}

export type DecisionFit = "best" | "good" | "weak" | "unknown";

export interface DecisionRequest {
  question: string;
  options: string[];
  preferences: { q: string; a: string }[];
}

export interface DecisionData {
  intro: string;
  options: { option: string; summary: string; pros: string[]; cons: string[]; best_if: string; fit: DecisionFit }[];
  recommendation: { option: string; why: string; confidence: "high" | "medium" | "low" } | null;
  prefs: ChoiceGroup[];
}

export interface ChatSource { url: string; title: string }

export interface ContextItem {
  id: string;
  title: string;
  kind: "text" | "file" | "research";
  text: string;
  sources: ChatSource[];
  loading: boolean;
}

export interface HistoryItem { role: "user" | "assistant"; text: string }

export type MsgKind = "question" | "command" | "context" | "research" | "decision";

export interface Fact { field: string; value: string }

/** The router's answer after sanitizing. Actions are checked against the live document later. */
export interface RouterResult {
  kind: "question" | "command" | "context" | "research";
  needsResearch: boolean;
  searchQuery: string;
  reply: string;
  actions: unknown[];
  choices: unknown[];
  decisionHelp: { question: string; options: string[] } | null;
  presentation: boolean;
  exploreMore: boolean;
  facts: Fact[];
}
