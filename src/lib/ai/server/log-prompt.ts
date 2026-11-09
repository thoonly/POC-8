/**
 * Logs the messages of every request sent to a model provider (OpenRouter, Claude API), to the server console
 * (the terminal running `npm run dev`). Never logs the key or headers.
 *
 * On by default outside production. Override with AI_LOG_PROMPTS=1 (force on) or =0 (force off).
 * Prompts can hold confidential customer text, so keep it off in any shared or production deploy.
 */
interface LoggedCall { provider: string; label: string; tier: string; model: string; messages: unknown; attempt?: number; web?: boolean }

export function promptLogEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.AI_LOG_PROMPTS === "1") return true;
  if (env.AI_LOG_PROMPTS === "0") return false;
  return env.NODE_ENV !== "production";
}

export function logPrompt(call: LoggedCall): void {
  if (!promptLogEnabled()) return;
  const msgs = Array.isArray(call.messages) ? call.messages : [];
  const chars = msgs.reduce((n: number, m: { content?: unknown }) => n + (typeof m?.content === "string" ? m.content.length : JSON.stringify(m?.content ?? "").length), 0);
  const retry = call.attempt ? ` retry#${call.attempt}` : "";
  console.log(`[ai:prompt] ${new Date().toISOString()} ${call.label} (${call.provider}, ${call.tier}${call.web ? "+web" : ""}, ${call.model})${retry} ${msgs.length} msg, ${chars} chars`);
  for (const m of msgs as { role?: string; content?: unknown }[]) {
    const text = typeof m?.content === "string" ? m.content : JSON.stringify(m?.content);
    console.log(`  [${m?.role ?? "?"}] ${text}`);
  }
}

const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

/** Logs the model's reply for a call in green (ANSI), under the same AI_LOG_PROMPTS switch. */
export function logResponse(call: { provider: string; label: string; model: string; text: string; finish?: string; ms?: number }): void {
  if (!promptLogEnabled()) return;
  const meta = [call.finish && `finish=${call.finish}`, call.ms !== undefined && `${call.ms}ms`, `${call.text.length} chars`].filter(Boolean).join(", ");
  console.log(`${GREEN}[ai:response] ${new Date().toISOString()} ${call.label} (${call.provider}, ${call.model}) ${meta}\n${call.text || "(empty)"}${RESET}`);
}
