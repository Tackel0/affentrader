import { NextRequest, NextResponse } from "next/server";
import { yahooChart, yahooSearch, yahooSpark } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

/**
 * Yahoo Finance proxy for stocks, ETFs, indices, forex and futures:
 *   ?kind=chart&symbol=AAPL&interval=15m&period1=<s>&period2=<s>&extended=1
 *   ?kind=spark&symbols=AAPL,MSFT      (latest prices, up to 20)
 *   ?kind=search&q=apple
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  try {
    switch (q.get("kind")) {
      case "chart": {
        const chart = await yahooChart({
          ticker: (q.get("symbol") ?? "").toUpperCase(),
          interval: q.get("interval") ?? "",
          period1: Number(q.get("period1")),
          period2: Number(q.get("period2")),
          extended: q.get("extended") === "1",
        });
        return NextResponse.json({
          meta: chart.meta,
          rows: chart.bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume]),
          adj: chart.adjClose,
          events: chart.events,
        });
      }
      case "spark":
        return NextResponse.json({
          quotes: await yahooSpark((q.get("symbols") ?? "").toUpperCase().split(",")),
        });
      case "search":
        return NextResponse.json({ hits: await yahooSearch(q.get("q") ?? "") });
      default:
        return NextResponse.json({ error: "Unknown request." }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Yahoo Finance is unavailable.";
    const client = /Invalid|Unsupported|window|future|not found|no data/i.test(message);
    return NextResponse.json({ error: message }, { status: client ? 400 : 503 });
  }
}
