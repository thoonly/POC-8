import { AiError } from "../errors";
import type { AiErrorBody } from "../types";

const STATUS: Record<string, number> = { NO_KEY: 503, NO_MODEL: 503, NETWORK: 502, TIMEOUT: 504, TRUNCATED: 422, BAD_JSON: 422, ABORTED: 499 };

/** Runs a handler and returns { ok: true, ...result } or { ok: false, error } with a matching HTTP status. */
export async function respond<T extends object>(fn: () => Promise<T>): Promise<Response> {
  try {
    const result = await fn();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError("HTTP", e instanceof Error ? e.message : "Unexpected server error.");
    const status = err.code === "HTTP" ? (err.status && err.status >= 400 && err.status < 600 ? (err.status === 401 || err.status === 403 ? 502 : err.status) : 502) : STATUS[err.code] || 500;
    if (err.code !== "ABORTED") console.error(`[AI] ${err.code}: ${err.message}`);
    return Response.json({ ok: false, error: err.toBody() satisfies AiErrorBody }, { status });
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    throw new AiError("HTTP", "The request body is not valid JSON.", undefined, 400);
  }
}
