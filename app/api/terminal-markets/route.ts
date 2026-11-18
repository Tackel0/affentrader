import { logError } from "@/lib/server/logger";
import { terminalMarkets } from "@/lib/server/terminalMarkets";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

export async function GET() {
  try {
    return Response.json({ rows: await terminalMarkets() });
  } catch (error) {
    logError("api.terminalMarkets.error", error);
    return Response.json({ error: "Market overview is unavailable." }, { status: 503 });
  }
}
