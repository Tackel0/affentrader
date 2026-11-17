import { NextRequest, NextResponse } from "next/server";
import {
  fetchDividends,
  fetchEarnings,
  fetchEconomicCalendar,
  fetchMarketNews,
  fetchYields,
} from "@/lib/server/feeds";
import { fetchGlobalMacroPulse } from "@/lib/server/macroAndSentimentSources";

export const dynamic = "force-dynamic";

/**
 * Public data feeds behind one endpoint:
 *   ?kind=news&scope=all|crypto|equities | economic&week=this|next | earnings&date= | dividends&date= | yields | macro
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  try {
    switch (q.get("kind")) {
      case "news": {
        const rawScope = q.get("scope");
        const scope = rawScope === "crypto" || rawScope === "equities" ? rawScope : "all";
        return NextResponse.json(await fetchMarketNews(scope));
      }
      case "economic":
        return NextResponse.json({
          events: await fetchEconomicCalendar(q.get("week") === "next" ? "next" : "this"),
        });
      case "earnings":
        return NextResponse.json({ events: await fetchEarnings(q.get("date") ?? "") });
      case "dividends":
        return NextResponse.json({ events: await fetchDividends(q.get("date") ?? "") });
      case "yields":
        return NextResponse.json({ curves: await fetchYields() });
      case "macro":
        return NextResponse.json(await fetchGlobalMacroPulse());
      default:
        return NextResponse.json({ error: "Unknown feed." }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Feed unavailable.";
    return NextResponse.json({ error: message }, { status: /YYYY/.test(message) ? 400 : 503 });
  }
}
