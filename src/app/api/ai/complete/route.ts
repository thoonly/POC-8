import { readJson, respond } from "@/lib/ai/server/route";
import { runComplete } from "@/lib/ai/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return respond(async () => {
    const { data, records } = await runComplete(await readJson(req), req.signal);
    return { data, records };
  });
}
