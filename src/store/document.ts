import { create } from "zustand";
import type { ChatDoc } from "@/lib/chat/types";
import { onNewBasis } from "./derived";

/**
 * The Entry document beyond its Topic (the Topic lives in the entry store): Answer, Cognitive Field
 * categories, Actions and Scratch pad notes. Chat reads and edits it today. `generated` stays false
 * until the graph/answer generation is ported; the graph slice will replace `categories` then
 * (legacy `semanticAnalysis.categories`) and keep these mutators as its edit API.
 */
export interface Note { id: string; text: string }

interface DocState {
  answer: string;
  generated: boolean;
  categories: ChatDoc["categories"];
  actions: ChatDoc["actions"];
  notes: Note[];

  setAnswer: (v: string) => void;
  addCategory: (label: string) => void;
  renameCategory: (i: number, label: string) => void;
  removeCategory: (i: number) => void;
  addTopic: (ci: number, label: string) => void;
  renameTopic: (ci: number, ti: number, label: string) => void;
  removeTopic: (ci: number, ti: number) => void;
  addAction: (text: string, tier: "suggested" | "available") => void;
  renameAction: (i: number, text: string) => void;
  removeAction: (i: number) => void;
  addNote: (text: string) => string;
  removeNote: (id: string) => void;
  reset: () => void;
}

const empty = { answer: "", generated: false, categories: [], actions: [], notes: [] } as const;
let noteSeq = 0;

export const useDocument = create<DocState>((set) => ({
  ...empty,
  categories: [],
  actions: [],
  notes: [],

  setAnswer: (answer) => set({ answer }),
  addCategory: (label) => set((s) => ({ categories: [...s.categories, { label, topics: [] }] })),
  renameCategory: (i, label) => set((s) => ({ categories: s.categories.map((c, k) => (k === i ? { ...c, label } : c)) })),
  removeCategory: (i) => set((s) => ({ categories: s.categories.filter((_, k) => k !== i) })),
  addTopic: (ci, label) => set((s) => ({ categories: s.categories.map((c, k) => (k === ci ? { ...c, topics: [...c.topics, label] } : c)) })),
  renameTopic: (ci, ti, label) => set((s) => ({ categories: s.categories.map((c, k) => (k === ci ? { ...c, topics: c.topics.map((t, j) => (j === ti ? label : t)) } : c)) })),
  removeTopic: (ci, ti) => set((s) => ({ categories: s.categories.map((c, k) => (k === ci ? { ...c, topics: c.topics.filter((_, j) => j !== ti) } : c)) })),
  addAction: (text, tier) => set((s) => ({ actions: [...s.actions, { text, tier }] })),
  renameAction: (i, text) => set((s) => ({ actions: s.actions.map((a, k) => (k === i ? { ...a, text } : a)) })),
  removeAction: (i) => set((s) => ({ actions: s.actions.filter((_, k) => k !== i) })),
  addNote: (text) => {
    const id = `note-${++noteSeq}`;
    set((s) => ({ notes: [...s.notes, { id, text }] }));
    return id;
  },
  removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
  reset: () => set({ ...empty, categories: [], actions: [], notes: [] }),
}));

onNewBasis(() => useDocument.getState().reset());
