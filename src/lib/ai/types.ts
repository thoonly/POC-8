/** Shared between the browser client and the /api/ai route handlers. */

export type Tier = "small" | "large";
export type Reasoning = "none" | "minimal" | "low" | "medium" | "high";
export type Role = "system" | "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

/** JSON Schema (object at the root, additionalProperties:false, everything required: see CLAUDE.md). */
export type JsonSchema = Record<string, unknown>;

export interface CallOptions {
  /** "<screen>:<task>", e.g. "entry:gap-check". Required on every call. */
  label: string;
  /** small = classify/extract/rewrite/short labels; large = reasoning, main results. */
  tier: Tier;
  reasoning?: Reasoning;
  /** Runaway guard, not a length budget. Default 8192. */
  maxTokens?: number;
  schema?: JsonSchema;
  signal?: AbortSignal;
  /**
   * Streams the answer: called with each new piece and the text so far. With a schema or json the
   * text is the JSON as it is written (see peekJsonField to read one field early). The returned
   * value is still the complete, final answer.
   */
  onToken?: (delta: string, full: string) => void;
}

export interface SearchOptions extends CallOptions {
  /** Not used by the Claude web search. Default 5. */
  maxResults?: number;
}

/** What the browser posts to /api/ai/complete. */
export interface CompleteRequest {
  messages: Message[];
  label: string;
  tier: Tier;
  reasoning?: Reasoning;
  maxTokens?: number;
  schema?: JsonSchema;
  /** true = JSON mode without a schema (OpenRouter json_object; prompt instruction on Claude). */
  json?: boolean;
}

export interface Usage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_tokens: number;
  reasoning_tokens: number;
  /** USD. OpenRouter reports it; Claude is estimated from a price table. */
  cost: number | null;
}

export interface CompleteResponse {
  text: string;
  finishReason: string;
  truncated: boolean;
  continued: boolean;
  model: string;
  usage: Usage | null;
}

export interface SearchSource {
  url: string;
  title: string;
  content: string;
}

export interface SearchResponse {
  text: string;
  sources: SearchSource[];
}

/** One row of the usage log (kept on the server, mirrored to the browser store). */
export interface UsageRecord {
  at: number;
  label: string;
  tier: string;
  provider: string;
  model: string;
  input: number | null;
  output: number | null;
  cached: number;
  reasoning: number;
  cost: number | null;
  maxTokens: number;
  ms: number;
  finish: string;
}

export type AiErrorCode =
  | "NO_KEY"
  | "NO_MODEL"
  | "HTTP"
  | "NETWORK"
  | "TIMEOUT"
  | "TRUNCATED"
  | "BAD_JSON"
  | "ABORTED";

export interface AiErrorBody {
  code: AiErrorCode;
  message: string;
  /** TRUNCATED / BAD_JSON carry the model's text. */
  text?: string;
}
