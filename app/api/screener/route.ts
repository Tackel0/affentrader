import { NextRequest, NextResponse } from "next/server";
import { runScreener, type ScreenerMarket } from "@/lib/server/screener";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Technical and market screener over the most liquid USDT pairs. */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const limit = Number(q.get("limit") ?? 80);
  const timeframe = q.get("timeframe");
  try {
    return NextResponse.json(
      await runScreener({
        timeframe: timeframe || null,
        limit: Number.isFinite(limit) ? limit : 80,
        minTurnover: Number(q.get("minTurnover") ?? 1_000_000) || 0,
        market: (q.get("market") ?? "binance") as ScreenerMarket,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Screener failed.";
    return NextResponse.json({ error: message }, { status: /interval|Unknown market/.test(message) ? 400 : 503 });
  }
}
