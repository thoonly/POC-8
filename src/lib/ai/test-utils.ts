/** Shared by the AI tests only. */

/** An SSE response whose body arrives in the given pieces (so events can be cut anywhere). */
export const sseResponse = (pieces: string[], init: ResponseInit = { status: 200 }) =>
  new Response(new ReadableStream<Uint8Array>({
    start(c) { const enc = new TextEncoder(); pieces.forEach((p) => c.enqueue(enc.encode(p))); c.close(); },
  }), { headers: { "content-type": "text/event-stream" }, ...init });
