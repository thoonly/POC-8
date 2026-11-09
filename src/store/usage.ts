import { create } from "zustand";
import { onUsage } from "@/lib/ai/client";
import type { UsageRecord } from "@/lib/ai/types";

const MAX_ROWS = 500;

export interface UsageTotals {
  calls: number; input: number; output: number; cached: number; cost: number; errors: number; truncated: number;
}

export interface LabelRow {
  label: string; tier: string; model: string; calls: number; errors: number; truncated: number;
  input: number; output: number; reasoning: number; cached: number; cost: number; avgIn: number; avgOut: number; avgMs: number;
}

const isError = (r: UsageRecord) => /^error/.test(r.finish);

export function totalsOf(rows: readonly UsageRecord[]): UsageTotals {
  return rows.reduce<UsageTotals>((t, r) => ({
    calls: t.calls + 1, input: t.input + (r.input || 0), output: t.output + (r.output || 0), cached: t.cached + r.cached,
    cost: t.cost + (r.cost || 0), errors: t.errors + (isError(r) ? 1 : 0), truncated: t.truncated + (r.finish === "length" ? 1 : 0),
  }), { calls: 0, input: 0, output: 0, cached: 0, cost: 0, errors: 0, truncated: 0 });
}

/** Per-label table, biggest first. A label that is called more often than the flow needs shows up here. */
export function reportOf(rows: readonly UsageRecord[]): LabelRow[] {
  const by = new Map<string, LabelRow & { ms: number }>();
  for (const r of rows) {
    const a = by.get(r.label) || { label: r.label, tier: r.tier, model: r.model, calls: 0, errors: 0, truncated: 0, input: 0, output: 0, reasoning: 0, cached: 0, cost: 0, avgIn: 0, avgOut: 0, avgMs: 0, ms: 0 };
    a.calls++; a.input += r.input || 0; a.output += r.output || 0; a.reasoning += r.reasoning; a.cached += r.cached; a.cost += r.cost || 0; a.ms += r.ms;
    if (isError(r)) a.errors++;
    if (r.finish === "length") a.truncated++;
    by.set(r.label, a);
  }
  return [...by.values()]
    .map(({ ms, ...a }) => ({ ...a, avgIn: Math.round(a.input / a.calls), avgOut: Math.round(a.output / a.calls), avgMs: Math.round(ms / a.calls), cost: +a.cost.toFixed(4) }))
    .sort((a, b) => b.input + b.output - (a.input + a.output));
}

interface UsageState {
  rows: UsageRecord[];
  add: (rows: UsageRecord[]) => void;
  reset: () => void;
}

export const useUsage = create<UsageState>((set) => ({
  rows: [],
  add: (rows) => set((s) => ({ rows: [...s.rows, ...rows].slice(-MAX_ROWS) })),
  reset: () => set({ rows: [] }),
}));

// Every request's usage rows (from /api/ai/*) land here. Also on window for the console:
// window.__aiUsage() prints the per-label table, like AI.usageReport() did in the prototype.
if (typeof window !== "undefined") {
  onUsage((rows) => useUsage.getState().add(rows));
  (window as unknown as { __aiUsage: () => LabelRow[] }).__aiUsage = () => {
    const r = reportOf(useUsage.getState().rows);
    console.table(r);
    return r;
  };
}
