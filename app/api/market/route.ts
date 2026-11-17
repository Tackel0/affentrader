import { NextRequest, NextResponse } from "next/server";
import { NATIVE_API_INTERVALS } from "@/lib/market/klines";
let symbolCatalog: { expires: number; data: unknown } | null = null;
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const resource = q.get("resource");
  if (
    !["klines", "aggTrades", "ticker/24hr", "ticker/price", "exchangeInfo"].includes(
      resource ?? "",
    )
  )
    return NextResponse.json(
      { error: "Unsupported market resource" },
      { status: 400 },
    );
  const params = new URLSearchParams();
  const symbol = q.get("symbol");
  if (symbol && !/^[A-Z0-9]{4,24}$/.test(symbol))
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  if (symbol) params.set("symbol", symbol);
  if (resource === "exchangeInfo") {
    params.set("showPermissionSets", "false");
    if (!symbol) {
      if (symbolCatalog && symbolCatalog.expires > Date.now())
        return NextResponse.json(symbolCatalog.data);
      params.set("symbolStatus", "TRADING");
    }
  }
  if (resource === "klines") {
    if (
      !symbol ||
      !NATIVE_API_INTERVALS.includes(q.get("interval") ?? "")
    )
      return NextResponse.json(
        { error: "Symbol and valid interval required" },
        { status: 400 },
      );
    params.set("interval", q.get("interval")!);
    params.set(
      "limit",
      String(Math.max(1, Math.min(1000, Number(q.get("limit")) || 600))),
    );
    for (const key of ["startTime", "endTime"]) {
      const value = q.get(key);
      if (value && /^\d{1,16}$/.test(value)) params.set(key, value);
    }
  }
  if (resource === "aggTrades") {
    if (!symbol)
      return NextResponse.json({ error: "Symbol required" }, { status: 400 });
    params.set(
      "limit",
      String(Math.max(1, Math.min(1000, Number(q.get("limit")) || 1000))),
    );
    for (const key of ["fromId", "startTime", "endTime"]) {
      const value = q.get(key);
      if (value && /^\d{1,16}$/.test(value)) params.set(key, value);
    }
  }
  for (const host of [
    "https://data-api.binance.vision",
    "https://api.binance.com",
  ]) {
    try {
      const response = await fetch(`${host}/api/v3/${resource}?${params}`, {
        signal: AbortSignal.timeout(7000),
        ...(resource === "exchangeInfo" && symbol
          ? { next: { revalidate: 3600 } }
          : { cache: "no-store" }),
      });
      if (response.ok) {
        const data = await response.json();
        if (resource === "exchangeInfo" && !symbol) {
          const compact = {
            symbols: data.symbols
              .filter(
                (s: { quoteAsset: string; status: string }) =>
                  s.quoteAsset === "USDT" && s.status === "TRADING",
              )
              .map(
                (s: {
                  symbol: string;
                  baseAsset: string;
                  quoteAsset: string;
                  status: string;
                }) => ({
                  symbol: s.symbol,
                  baseAsset: s.baseAsset,
                  quoteAsset: s.quoteAsset,
                  status: s.status,
                }),
              ),
          };
          symbolCatalog = { data: compact, expires: Date.now() + 3600000 };
          return NextResponse.json(compact);
        }
        return NextResponse.json(data);
      }
    } catch {
      continue;
    }
  }
  return NextResponse.json(
    { error: "Public exchange API unavailable. Simulation is available." },
    { status: 503 },
  );
}

