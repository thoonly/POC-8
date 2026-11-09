"use client";

import type { AiErrorCode } from "@/lib/ai/types";

interface Props {
  error: { code: AiErrorCode | "UNKNOWN"; message: string };
  /** Pressed by the user. Shown for errors where trying again can help. Never fired automatically. */
  onRetry?: () => void;
  onOpenSettings?: () => void;
  onDismiss?: () => void;
}

/**
 * Error state for an AI call, by code (CLAUDE.md):
 * NO_KEY -> open settings; NO_MODEL / HTTP / NETWORK -> message; TIMEOUT -> message + Try again;
 * TRUNCATED -> message only (the fix is a shorter request or less reasoning, not a retry);
 * BAD_JSON -> message + Try again.
 */
export function Banner({ error, onRetry, onOpenSettings, onDismiss }: Props) {
  const canRetry = !!onRetry && ["TIMEOUT", "NETWORK", "HTTP", "BAD_JSON", "UNKNOWN"].includes(error.code);
  const wantsSettings = !!onOpenSettings && (error.code === "NO_KEY" || error.code === "NO_MODEL");
  return (
    <div className="banner" role="alert">
      <span className="banner__text">{error.message}</span>
      <span className="banner__actions">
        {wantsSettings && <button type="button" className="btn btn-ghost" onClick={onOpenSettings}>Open AI settings</button>}
        {canRetry && <button type="button" className="btn btn-ghost" onClick={onRetry}>Try again</button>}
        {onDismiss && <button type="button" className="btn btn-ghost" onClick={onDismiss}>Dismiss</button>}
      </span>
    </div>
  );
}
