import type { Usage, UsageRecord } from "../types";

/**
 * Collects usage rows for ONE request (a call plus its continuation, or a search plus its query
 * call). The route returns them to the browser, whose store keeps the session log and totals.
 */
export class UsageSink {
  readonly records: UsageRecord[] = [];

  add(row: {
    label: string; tier: string; provider: string; model: string; maxTokens: number;
    usage: Usage | null; finish: string; ms: number;
  }): UsageRecord {
    const u = row.usage;
    const rec: UsageRecord = {
      at: Date.now(), label: row.label, tier: row.tier, provider: row.provider, model: row.model,
      input: u?.prompt_tokens ?? null, output: u?.completion_tokens ?? null,
      cached: u?.cached_tokens ?? 0, reasoning: u?.reasoning_tokens ?? 0,
      cost: u?.cost ?? null, maxTokens: row.maxTokens, ms: row.ms, finish: row.finish,
    };
    this.records.push(rec);
    console.info(
      `[AI] ${rec.label} · ${rec.tier} · ${rec.model} · in ${rec.input ?? "?"}${rec.cached ? ` (${rec.cached} cached)` : ""}` +
        ` · out ${rec.output ?? "?"}/${rec.maxTokens}${rec.cost != null ? ` · $${rec.cost.toFixed(4)}` : ""} · ${rec.ms} ms · ${rec.finish}`,
    );
    return rec;
  }
}
