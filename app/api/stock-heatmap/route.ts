import { fetchStockSectorHeatmap } from "@/lib/server/stockHeatmap";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request) {
  const market = new URL(request.url).searchParams.get("market") ?? "us";
  try {
    return Response.json(await fetchStockSectorHeatmap(market));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sector heatmap unavailable.";
    return Response.json({ error: message }, { status: 503 });
  }
}
