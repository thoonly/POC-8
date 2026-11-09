/**
 * Drafts the Entry node's name, context and topic from the originating prompt.
 * Ported from legacy/entry-v4.html draftNodeFromPrompt (11806-11839). Prompt text is verbatim.
 *
 * AI call: entry:draft-node. tier large, reasoning low (the default for large), no schema: this is
 * the payload the team specified for /chat/completions (model anthropic/claude-sonnet-5.5,
 * stream false, max_tokens 8192, reasoning.effort low, usage.include, a single user message, no
 * response_format). It matches the legacy call. small + schema would be cheaper; revisit after
 * comparing against this on real prompts.
 */
import { chat } from "../ai/client";
import { AiError } from "../ai/errors";
import { parseJson } from "../ai/json";
import { LANGUAGE_PURITY_GUARD, isLikelyNonEnglish } from "../lang/detect";

export interface NodeDraft {
  nodeName: string;
  context: string;
  topic: string;
}

export function draftPrompt(raw: string): string {
  return `You are the AI drafting assistant inside CollabiQ, a workstream management platform. A user just created an Entry Node from this prompt, entered in the Universal Input Bar: "${raw}"

Draft three fields for this Entry Node:
1. "node_name": a short, polished name for this Entry Node (2-6 words) — a real title someone would recognize on a list of nodes, not a restatement of the prompt sentence. E.g. for "Analyze our competitors in the SaaS market", a good name is "SaaS Competitor Landscape", not the prompt repeated back.
2. "context": 2-3 sentences describing the origin — what prompted this Entry Node, at a high level. Do not invent specific facts beyond what the prompt implies.
3. "topic": 2-3 sentences stating what this Entry Node explores and why.

Respond in the SAME language as the prompt above (if it is in Thai, respond entirely in Thai; if English, respond in English). ${LANGUAGE_PURITY_GUARD}

Respond ONLY with a raw JSON object with exactly these three keys: "node_name", "context", "topic". No markdown, no code fences, no explanation, no preamble. Keep every value as a single line with no literal line breaks inside it. Keep the ENTIRE response (all fields combined) under 140 words total — concise over exhaustive.`;
}

/**
 * GUARANTEE, not a hope: the drafted "topic" feeds the graph's content generation downstream. If
 * the model drifted language despite being told not to, the graph would be fed content in the wrong
 * language. So check explicitly; on a mismatch fall back to the raw prompt itself.
 */
export function pickTopic(raw: string, drafted: string | undefined): string {
  if (!drafted) return raw;
  return isLikelyNonEnglish(drafted) === isLikelyNonEnglish(raw) ? drafted : raw;
}

export async function draftNodeFromPrompt(raw: string, signal?: AbortSignal): Promise<NodeDraft> {
  // Plain chat call, not ai.json: the request carries no response_format (the prompt itself asks for
  // raw JSON), exactly the payload the legacy prototype sent. The reply is parsed here.
  const text = await chat(
    [{ role: "user", content: draftPrompt(raw) }],
    { label: "entry:draft-node", tier: "large", signal },
  );
  const result = parseJson<{ node_name?: string; context?: string; topic?: string }>(text);
  if (!result) throw new AiError("BAD_JSON", "The model did not answer with valid JSON. Try again.", text);
  return {
    nodeName: (result.node_name || "").trim() || raw,
    context: (result.context || "").trim(),
    topic: pickTopic(raw, result.topic?.trim()),
  };
}
