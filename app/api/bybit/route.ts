import { NextRequest, NextResponse } from "next/server";
import { BYBIT_NATIVES } from "@/lib/market/bybit";
import { bybitCandlePage, bybitTickers, bybitTradingIncrements } from "@/lib/server/bybit";
import { bybitMarket } from "@/lib/symbolId";
import { logError } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const kind = query.get("kind");
  try {
    if (kind === "tickers") {
      const category = query.get("category");
      if (category === "spot" || category === "linear")
        return NextResponse.json({ tickers: await bybitTickers(category) });
    }
    const symbol = query.get("symbol") ?? "";
    if (kind === "instrument" && bybitMarket(symbol))
      return NextResponse.json(await bybitTradingIncrements(symbol));
    if (kind === "candles") {
      const interval = query.get("interval") ?? "";
      const limit = Number(query.get("limit") ?? "600");
      const rawEnd = query.get("end"), end = rawEnd === null ? undefined : Number(rawEnd);
      if (bybitMarket(symbol) && BYBIT_NATIVES.some(native => native.api === interval)
        && Number.isInteger(limit) && limit >= 1 && limit <= 1000
        && (end === undefined || (Number.isSafeInteger(end) && end > 0))) {
        return NextResponse.json({ candles: await bybitCandlePage(symbol, interval, limit, end) });
      }
    }
    return NextResponse.json({ error: "Invalid Bybit market request." }, { status: 400 });
  } catch (error) {
    logError("api.bybit.unavailable", error, { kind });
    return NextResponse.json({ error: "Bybit market data is temporarily unavailable." }, { status: 503 });
  }
}
