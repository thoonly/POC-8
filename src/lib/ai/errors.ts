import type { AiErrorBody, AiErrorCode } from "./types";

/**
 * codes: NO_KEY | NO_MODEL | HTTP | NETWORK | TIMEOUT | TRUNCATED | BAD_JSON | ABORTED
 * TRUNCATED and BAD_JSON carry the model's text in `text`.
 * Handling (CLAUDE.md): NO_KEY/NO_MODEL/HTTP/NETWORK/TIMEOUT -> banner (TIMEOUT with "Try again");
 * TRUNCATED/BAD_JSON -> error state, never an automatic retry.
 */
export class AiError extends Error {
  code: AiErrorCode;
  text?: string;
  status?: number;
  constructor(code: AiErrorCode, message: string, text?: string, status?: number) {
    super(message);
    this.name = "AiError";
    this.code = code;
    if (text !== undefined) this.text = text;
    if (status !== undefined) this.status = status;
  }
  toBody(): AiErrorBody {
    return { code: this.code, message: this.message, ...(this.text !== undefined ? { text: this.text } : {}) };
  }
  static fromBody(b: AiErrorBody, status?: number): AiError {
    return new AiError(b.code, b.message, b.text, status);
  }
}

export const isAiError = (e: unknown): e is AiError => e instanceof AiError;
export const isAbort = (e: unknown): boolean =>
  (e instanceof AiError && e.code === "ABORTED") || (e instanceof DOMException && e.name === "AbortError");
