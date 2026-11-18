import { NextRequest, NextResponse } from "next/server";
import { isValidInterval } from "@/lib/market/intervals";
import { logError } from "@/lib/server/logger";
import { runScreener, SCREENER_MARKETS, ScreenerValidationError, type ScreenerMarket } from "@/lib/server/screener";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Technical and market screener over the most liquid USDT pairs. */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const rawTimeframe = q.get("timeframe");
  const timeframe = rawTimeframe ? rawTimeframe : null;
  const market = q.get("market") ?? "binance";
  const rawLimit = q.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? 80 : Number(rawLimit);
  const rawMinTurnover = q.get("minTurnover");
  const minTurnover = rawMinTurnover === null || rawMinTurnover === "" ? 1_000_000 : Number(rawMinTurnover);

  if (!SCREENER_MARKETS.includes(market as ScreenerMarket)) {
    return NextResponse.json({ error: "Unknown market." }, { status: 400 });
  }
  if (timeframe && (!isValidInterval(timeframe) || timeframe.endsWith("T"))) {
    return NextResponse.json({ error: "Choose a time-based interval." }, { status: 400 });
  }
  if (!Number.isFinite(limit) || limit < 1) {
    return NextResponse.json({ error: "Invalid limit." }, { status: 400 });
  }
  if (!Number.isFinite(minTurnover) || minTurnover < 0) {
    return NextResponse.json({ error: "Invalid minTurnover." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await runScreener({
        timeframe,
        limit,
        minTurnover,
        market: market as ScreenerMarket,
      }),
    );
  } catch (error) {
    if (error instanceof ScreenerValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logError("api.screener.error", error, { market, timeframe });
    return NextResponse.json({ error: "Screener service is unavailable." }, { status: 503 });
  }
}
