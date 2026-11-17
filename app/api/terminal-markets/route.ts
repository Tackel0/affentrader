import { terminalMarkets } from "@/lib/server/terminalMarkets";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

export async function GET() {
  try {
    return Response.json({ rows: await terminalMarkets() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Market overview is unavailable." },
      { status: 503 },
    );
  }
}
