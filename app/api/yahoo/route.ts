import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/server/logger";
import { yahooChart, yahooSearch, yahooSpark, YahooValidationError } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

/**
 * Yahoo Finance proxy for stocks, ETFs, indices, forex and futures:
 *   ?kind=chart&symbol=AAPL&interval=15m&period1=<s>&period2=<s>&extended=1
 *   ?kind=spark&symbols=AAPL,MSFT      (latest prices, up to 20)
 *   ?kind=search&q=apple
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const kind = q.get("kind");
  try {
    switch (kind) {
      case "chart": {
        const rawPeriod1 = q.get("period1");
        const rawPeriod2 = q.get("period2");
        const rawExtended = q.get("extended");
        const period1 = Number(rawPeriod1);
        const period2 = Number(rawPeriod2);
        if (
          rawPeriod1 === null ||
          rawPeriod2 === null ||
          rawPeriod1 === "" ||
          rawPeriod2 === "" ||
          !Number.isFinite(period1) ||
          !Number.isFinite(period2)
        ) {
          return NextResponse.json({ error: "Invalid time window." }, { status: 400 });
        }
        if (rawExtended !== null && rawExtended !== "" && rawExtended !== "0" && rawExtended !== "1") {
          return NextResponse.json({ error: "Invalid extended flag." }, { status: 400 });
        }
        const chart = await yahooChart({
          ticker: (q.get("symbol") ?? "").toUpperCase(),
          interval: q.get("interval") ?? "",
          period1,
          period2,
          extended: rawExtended === "1",
        });
        return NextResponse.json({
          meta: chart.meta,
          rows: chart.bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume]),
          adj: chart.adjClose,
          events: chart.events,
        });
      }
      case "spark": {
        const symbols = (q.get("symbols") ?? "").trim();
        if (!symbols) {
          return NextResponse.json({ error: "Symbols required." }, { status: 400 });
        }
        if (symbols.length > 512) {
          return NextResponse.json({ error: "Symbols list too long." }, { status: 400 });
        }
        return NextResponse.json({
          quotes: await yahooSpark(symbols.toUpperCase().split(",")),
        });
      }
      case "search": {
        const query = q.get("q") ?? "";
        if (query.trim().length > 128) {
          return NextResponse.json({ error: "Search query too long." }, { status: 400 });
        }
        return NextResponse.json({ hits: await yahooSearch(query) });
      }
      default:
        return NextResponse.json({ error: "Unknown request." }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof YahooValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logError("api.yahoo.error", error, { kind });
    return NextResponse.json({ error: "Yahoo Finance is unavailable." }, { status: 503 });
  }
}
