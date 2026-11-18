import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/server/logger";
import { hyperliquidAssets, hyperliquidCandles, hyperliquidRange, HyperliquidValidationError, lastWarnings } from "@/lib/server/hyperliquid";

export const dynamic = "force-dynamic";

/**
 * Hyperliquid public data (no key, no account):
 *   ?kind=assets                                    every perp market with its 24h context
 *   ?kind=candles&coin=BTC&interval=15m&start=<ms>&end=<ms>
 *   ?kind=range&coin=BTC                            complete closed-minute 24h window
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const kind = q.get("kind");
  try {
    switch (kind) {
      case "assets":
        return NextResponse.json({ assets: await hyperliquidAssets(), warnings: lastWarnings });
      case "candles": {
        const rawStart = q.get("start");
        const rawEnd = q.get("end");
        const startTime = Number(rawStart);
        const endTime = Number(rawEnd);
        if (rawStart === null || rawEnd === null || rawStart === "" || rawEnd === "" || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
          return NextResponse.json({ error: "Invalid time window." }, { status: 400 });
        }
        return NextResponse.json({
          candles: await hyperliquidCandles({
            coin: q.get("coin") ?? "",
            interval: q.get("interval") ?? "",
            startTime,
            endTime,
          }),
        });
      }
      case "range":
        return NextResponse.json({ range: await hyperliquidRange(q.get("coin") ?? "") });
      default:
        return NextResponse.json({ error: "Unknown request." }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof HyperliquidValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logError("api.hyperliquid.error", error, { kind });
    return NextResponse.json({ error: "Hyperliquid is unavailable." }, { status: 503 });
  }
}
