import { logError } from "@/lib/server/logger";
import { fetchStockSectorHeatmap } from "@/lib/server/stockHeatmap";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const SUPPORTED_MARKETS = new Set(["us", "xetra", "lse"]);

export async function GET(request: Request) {
  const market = new URL(request.url).searchParams.get("market") ?? "us";
  if (!SUPPORTED_MARKETS.has(market)) {
    return Response.json({ error: "Unsupported heatmap market." }, { status: 400 });
  }
  try {
    return Response.json(await fetchStockSectorHeatmap(market), {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    logError("api.stockHeatmap.error", error, { market });
    return Response.json({ error: "Sector heatmap unavailable." }, { status: 503 });
  }
}
