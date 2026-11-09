import { AiError } from "@/lib/ai/errors";
import { readJson } from "@/lib/ai/server/route";
import { runComplete } from "@/lib/ai/server/service";
import type { AiErrorBody } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streamed completion as server-sent events: { t: "delta", text } while the model writes, then
 * { t: "done", data, records } or { t: "error", error }. Errors are events, not HTTP statuses,
 * because the response has already started by the time most of them happen.
 */
export async function POST(req: Request) {
  const enc = new TextEncoder();
  const send = (c: ReadableStreamDefaultController<Uint8Array>, ev: unknown) => {
    try { c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)); } catch { /* the client already left */ }
  };

  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      try {
        const input = await readJson(req);
        const { data, records } = await runComplete(input, req.signal, undefined, (text) => send(c, { t: "delta", text }));
        send(c, { t: "done", data, records });
      } catch (e) {
        const err = e instanceof AiError ? e : new AiError("HTTP", e instanceof Error ? e.message : "Unexpected server error.");
        if (err.code !== "ABORTED") console.error(`[AI] ${err.code}: ${err.message}`);
        send(c, { t: "error", error: err.toBody() satisfies AiErrorBody });
      } finally {
        try { c.close(); } catch { /* the client already left */ }
      }
    },
  });

  return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}
