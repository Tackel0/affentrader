import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/server/logger";
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
  const kind = q.get("kind");
  try {
    switch (kind) {
      case "news": {
        const rawScope = q.get("scope");
        if (rawScope !== null && rawScope !== "" && !["all", "crypto", "equities"].includes(rawScope)) {
          return NextResponse.json({ error: "Unsupported news scope." }, { status: 400 });
        }
        const scope = (rawScope === "crypto" || rawScope === "equities" ? rawScope : "all") as
          | "all"
          | "crypto"
          | "equities";
        return NextResponse.json(await fetchMarketNews(scope));
      }
      case "economic": {
        const rawWeek = q.get("week");
        if (rawWeek !== null && rawWeek !== "" && rawWeek !== "this" && rawWeek !== "next") {
          return NextResponse.json({ error: "Unsupported calendar week." }, { status: 400 });
        }
        return NextResponse.json({
          events: await fetchEconomicCalendar(rawWeek === "next" ? "next" : "this"),
        });
      }
      case "earnings": {
        const date = q.get("date") ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return NextResponse.json({ error: "Date must be YYYY-MM-DD." }, { status: 400 });
        }
        return NextResponse.json({ events: await fetchEarnings(date) });
      }
      case "dividends": {
        const date = q.get("date") ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return NextResponse.json({ error: "Date must be YYYY-MM-DD." }, { status: 400 });
        }
        return NextResponse.json({ events: await fetchDividends(date) });
      }
      case "yields":
        return NextResponse.json({ curves: await fetchYields() });
      case "macro":
        return NextResponse.json(await fetchGlobalMacroPulse());
      default:
        return NextResponse.json({ error: "Unknown feed." }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/YYYY/.test(message)) {
      return NextResponse.json({ error: "Date must be YYYY-MM-DD." }, { status: 400 });
    }
    logError("api.feeds.error", error, { kind });
    return NextResponse.json({ error: "Feed unavailable." }, { status: 503 });
  }
}
