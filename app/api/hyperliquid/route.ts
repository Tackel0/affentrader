import { NextRequest, NextResponse } from "next/server";
import { hyperliquidAssets, hyperliquidCandles, hyperliquidRange, lastWarnings } from "@/lib/server/hyperliquid";

export const dynamic = "force-dynamic";

/**
 * Hyperliquid public data (no key, no account):
 *   ?kind=assets                                    every perp market with its 24h context
 *   ?kind=candles&coin=BTC&interval=15m&start=<ms>&end=<ms>
 *   ?kind=range&coin=BTC                            complete closed-minute 24h window
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  try {
    switch (q.get("kind")) {
      case "assets":
        return NextResponse.json({ assets: await hyperliquidAssets(), warnings: lastWarnings });
      case "candles":
        return NextResponse.json({
          candles: await hyperliquidCandles({
            coin: q.get("coin") ?? "",
            interval: q.get("interval") ?? "",
            startTime: Number(q.get("start")),
            endTime: Number(q.get("end")),
          }),
        });
      case "range":
        return NextResponse.json({ range: await hyperliquidRange(q.get("coin") ?? "") });
      default:
        return NextResponse.json({ error: "Unknown request." }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hyperliquid is unavailable.";
    const client = /^Invalid|^Unsupported|window/i.test(message);
    return NextResponse.json({ error: message }, { status: client ? 400 : 503 });
  }
}
