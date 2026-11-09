/**
 * Tavily search. A small-model call writes 1-3 short queries, Tavily runs them (basic depth =
 * 1 credit each), and the merged results come back as notes text + the pages found.
 */
import { AiError } from "../errors";
import type { JsonSchema, SearchSource } from "../types";
import { TAVILY_URL, type ServerConfig } from "./config";
import { fetchWithRetry, httpError } from "./http";

export const QUERY_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["queries"],
  properties: { queries: { type: "array", items: { type: "string" } } },
};

export interface TavilyHit { url: string; title?: string; content?: string; score?: number }

export async function tavilySearch(
  cfg: ServerConfig, queries: string[], maxResults: number, signal?: AbortSignal,
): Promise<{ text: string; sources: SearchSource[] }> {
  if (!cfg.tavilyKey) throw new AiError("NO_KEY", "The server has no TAVILY_API_KEY. Add it to .env.local, or choose another search provider.");
  const per = Math.min(8, Math.ceil(maxResults / Math.max(1, queries.length)) + 1);
  const runs = await Promise.all(queries.map(async (query): Promise<TavilyHit[]> => {
    const res = await fetchWithRetry(TAVILY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.tavilyKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: query.slice(0, 400), search_depth: "basic", max_results: per, include_answer: false }),
    }, { signal, timeoutMs: 30_000, who: "Tavily" });
    if (!res.ok) throw httpError("tavily", res.status, "");
    return ((await res.json()) as { results?: TavilyHit[] }).results || [];
  }));
  const seen = new Map<string, SearchSource>();
  runs.flat().sort((a, b) => (b.score || 0) - (a.score || 0)).forEach((r) => {
    if (r?.url && !seen.has(r.url)) seen.set(r.url, { url: r.url, title: r.title || r.url, content: String(r.content || "") });
  });
  const sources = [...seen.values()].slice(0, Math.max(maxResults, 3));
  const text =
    `Web search results (Tavily) for: ${queries.join(" | ")}\n` +
    sources.map((s) => `- [${s.title}](${s.url}): ${s.content.slice(0, 600)}`).join("\n");
  return { text, sources };
}
