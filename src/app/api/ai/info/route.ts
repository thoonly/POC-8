import { respond } from "@/lib/ai/server/route";
import { runInfo } from "@/lib/ai/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which provider, models and search the server uses, and whether its key is set. Never returns a key. */
export async function GET() {
  return respond(async () => ({ data: runInfo() }));
}
