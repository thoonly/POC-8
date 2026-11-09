import { create } from "zustand";
import { ledgerAdd, type LedgerEntry } from "@/lib/entry/ledger";
import { onNewBasis } from "./derived";

interface LedgerState {
  entries: LedgerEntry[];
  /** Records an answer (or replaces the answer to the same question). */
  add: (q: string, a: string, node: string) => void;
  reset: () => void;
}

/** Answers the person has given, kept so no question is asked twice. A new prompt clears it. */
export const useLedger = create<LedgerState>((set) => ({
  entries: [],
  add: (q, a, node) => set((s) => ({ entries: ledgerAdd(s.entries, q, a, node) })),
  reset: () => set({ entries: [] }),
}));

onNewBasis(() => useLedger.getState().reset());
