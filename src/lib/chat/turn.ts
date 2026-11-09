/**
 * The model calls of one chat turn. No React, no DOM, no store: callers pass the prompt context and
 * get plain data back. Ported from legacy/entry-v4.html (runChatTurn 12573, decisionCore 13152).
 *
 * Calls (CLAUDE.md), per user action at most three:
 *   chat:router          large  the reply the user reads + proposed changes; the first call of every turn
 *   chat:research        small  web search notes (only when the router says it needs outside facts)
 *   chat:research-reply  large  notes -> reply, findings, proposed changes
 *   chat:decision-search small  facts for a comparison (only when search is on)
 *   chat:decision        large  the option comparison
 * Tiers follow the tier table in CLAUDE.md (user-read result = large, search/extract = small). They
 * have not been compared against `small` on a real key yet: if router replies read thin, check there first.
 */
import { ai } from "../ai/client";
import { peekJsonField } from "../ai/json";
import { enforceAnchorLanguage } from "../lang/enforce";
import { sanitizeDecision } from "./decision";
import { DECISION_SCHEMA, RESEARCH_SCHEMA, ROUTER_SCHEMA, decisionNotesPrompt, decisionPrompt, researchNotesPrompt, researchSynthPrompt, routerPrompt, type PromptCtx } from "./prompts";
import type { ChatSource, DecisionData, DecisionRequest, Fact, RouterResult } from "./types";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * The router answers in one JSON object. With onReply, its "reply" is handed over while it is still
 * being written (one call, no second "prose" call). Nothing is shown when the router has already
 * said it will search the web: that reply is a lead-in the turn does not display.
 */
export async function routeTurn(
  c: PromptCtx, userText: string, isContextTurn: boolean, signal?: AbortSignal, onReply?: (textSoFar: string) => void,
): Promise<RouterResult> {
  let shown = "";
  const raw = await ai.json<Record<string, unknown>>([{ role: "user", content: routerPrompt(c, userText, isContextTurn) }], {
    label: "chat:router", tier: "large", schema: ROUTER_SCHEMA, signal,
    onToken: onReply ? (_delta, full) => {
      if (peekJsonField(full, "needs_research")?.value === true) return;
      const reply = peekJsonField(full, "reply");
      if (typeof reply?.value === "string" && reply.value !== shown) { shown = reply.value; onReply(shown); }
    } : undefined,
  });
  const r = await enforceAnchorLanguage(raw, { anchor: c.anchor, where: "chat reply", signal });
  const kinds = ["question", "command", "context", "research"] as const;
  let kind = kinds.find((k) => k === r.kind) ?? "question";
  if (isContextTurn) kind = "context";
  const dh = r.decision_help as { question?: unknown; options?: unknown } | null;
  const facts: Fact[] = arr(r.facts)
    .filter((f): f is Fact => !!f && typeof (f as Fact).field === "string" && !!(f as Fact).field.trim() && typeof (f as Fact).value === "string" && !!(f as Fact).value.trim())
    .slice(0, 6);
  return {
    kind,
    needsResearch: r.needs_research === true,
    searchQuery: str(r.search_query).trim(),
    reply: str(r.reply),
    actions: arr(r.actions),
    choices: arr(r.choices),
    decisionHelp: dh && str(dh.question).trim() ? { question: str(dh.question).trim(), options: arr(dh.options).filter((o): o is string => typeof o === "string" && !!o.trim()) } : null,
    presentation: r.presentation === true,
    exploreMore: r.explore_more === true,
    facts,
  };
}

const toSources = (s: { url: string; title: string }[]): ChatSource[] => s.slice(0, 6).map((x) => ({ url: x.url, title: x.title || x.url }));

/** Notes + sources from the server's web search; null when search is off. */
async function gather(prompt: string, label: string, signal?: AbortSignal): Promise<{ notes: string; sources: ChatSource[] } | null> {
  if (!(await ai.canSearch())) return null;
  // check-ignore: label is a parameter; both callers pass a literal ("chat:research", "chat:decision-search")
  const r = await ai.search([{ role: "user", content: prompt }], { label, tier: "small", signal });
  return { notes: r.text.trim(), sources: toSources(r.sources) };
}

export interface ResearchResult {
  reply: string;
  findings: string[];
  contextTitle: string;
  actions: unknown[];
  choices: unknown[];
  sources: ChatSource[];
}

export async function researchTurn(c: PromptCtx, userText: string, query: string, signal?: AbortSignal): Promise<ResearchResult | null> {
  const got = await gather(researchNotesPrompt(c.doc.topic, userText, query), "chat:research", signal);
  if (!got) return null;
  const sourcesLine = got.sources.map((s) => s.url).join(", ");
  const raw = await ai.json<Record<string, unknown>>([{ role: "user", content: researchSynthPrompt(c, userText, got.notes, sourcesLine) }], {
    label: "chat:research-reply", tier: "large", schema: RESEARCH_SCHEMA, signal,
  });
  const res = await enforceAnchorLanguage(raw, { anchor: c.anchor, where: "chat research", signal });
  return {
    reply: str(res.reply).trim(),
    findings: arr(res.findings).filter((f): f is string => typeof f === "string" && !!f.trim()).slice(0, 6),
    contextTitle: str(res.context_title).trim(),
    actions: arr(res.actions),
    choices: arr(res.choices),
    sources: got.sources,
  };
}

export async function decisionTurn(c: PromptCtx, d: DecisionRequest, signal?: AbortSignal): Promise<{ data: DecisionData; sources: ChatSource[] }> {
  const got = await gather(decisionNotesPrompt(c.doc.topic, d), "chat:decision-search", signal);
  const raw = await ai.json<Record<string, unknown>>([{ role: "user", content: decisionPrompt(c, d, got?.notes ?? "") }], {
    label: "chat:decision", tier: "large", schema: DECISION_SCHEMA, signal,
  });
  const fixed = await enforceAnchorLanguage(raw, { anchor: c.anchor, where: "decision help", signal });
  return { data: sanitizeDecision(fixed, d), sources: got?.sources ?? [] };
}
