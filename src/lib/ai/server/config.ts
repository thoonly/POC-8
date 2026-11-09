/**
 * Server-only AI configuration. Keys come from environment variables and never reach the browser.
 * Only import this folder from route handlers (src/app/api/ai/**) and server tests.
 */
import { AiError } from "../errors";
import type { Reasoning, Tier } from "../types";

export type Provider = "claude" | "openrouter";
export type Env = Record<string, string | undefined>;

export const CLAUDE_URL = "https://api.anthropic.com/v1";
export const CLAUDE_VERSION = "2026-10-21";
export const OPENROUTER_URL = "https://openrouter.ai/api/v1";
export const TAVILY_URL = "https://api.tavily.com/search";
export const DEFAULT_MAX_TOKENS = 8192; // runaway guard, not a length budget

const DEFAULT_MODELS: Record<Provider, Record<Tier, string>> = {
  claude: { small: "claude-haiku-5-5", large: "claude-opus-5-5" },
  openrouter: { small: "anthropic/claude-haiku-5.5", large: "anthropic/claude-sonnet-5.5" },
};

/** provider = the provider's own search (Claude web search / OpenRouter web plugin). */
export type SearchMode = "provider" | "tavily" | "off";

export interface ServerConfig {
  provider: Provider;
  search: SearchMode;
  mock: boolean;
  anthropicKey: string;
  openrouterKey: string;
  tavilyKey: string;
}

export function getConfig(env: Env = process.env): ServerConfig {
  const p = (env.AI_PROVIDER || "claude").toLowerCase();
  const s = (env.AI_SEARCH || "provider").toLowerCase();
  return {
    provider: p === "openrouter" ? "openrouter" : "claude",
    search: s === "tavily" || s === "off" ? s : "provider",
    mock: env.AI_MOCK === "1" || env.AI_MOCK === "true",
    anthropicKey: env.ANTHROPIC_API_KEY || "",
    openrouterKey: env.OPENROUTER_API_KEY || "",
    tavilyKey: env.TAVILY_API_KEY || "",
  };
}

export function modelFor(provider: Provider, tier: Tier, env: Env = process.env): string {
  const key =
    provider === "claude"
      ? tier === "small" ? "CLAUDE_MODEL_SMALL" : "CLAUDE_MODEL_LARGE"
      : tier === "small" ? "OPENROUTER_MODEL_SMALL" : "OPENROUTER_MODEL_LARGE";
  return env[key]?.trim() || DEFAULT_MODELS[provider][tier];
}

export function requireKey(cfg: ServerConfig, provider: Provider = cfg.provider): string {
  const key = provider === "claude" ? cfg.anthropicKey : cfg.openrouterKey;
  if (!key) {
    const name = provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY";
    throw new AiError("NO_KEY", `The server has no ${name}. Add it to .env.local and restart the dev server.`);
  }
  return key;
}

export const EFFORTS: readonly Reasoning[] = ["none", "minimal", "low", "medium", "high"];
export const effortFor = (r: Reasoning | undefined, tier: Tier): Reasoning =>
  r && EFFORTS.includes(r) ? r : tier === "small" ? "none" : "low";

/** Timeout for one request. Scales with the output ceiling; never retried (CLAUDE.md). */
export const timeoutMs = (maxTokens: number): number => Math.min(180_000, Math.max(45_000, maxTokens * 22));
