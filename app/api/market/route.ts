import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/server/logger";
import { NATIVE_API_INTERVALS } from "@/lib/market/klines";

export const dynamic = "force-dynamic";

let symbolCatalog: { expires: number; data: unknown } | null = null;

export async function GET(request: NextRequest) {
  try {
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
      const rawLimit = q.get("limit");
      let limit = 600;
      if (rawLimit !== null && rawLimit !== "") {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
          return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
        }
        limit = parsed;
      }
      params.set("limit", String(limit));
      for (const key of ["startTime", "endTime"]) {
        const value = q.get(key);
        if (value && /^\d{1,16}$/.test(value)) params.set(key, value);
      }
    }
    if (resource === "aggTrades") {
      if (!symbol)
        return NextResponse.json({ error: "Symbol required" }, { status: 400 });
      const rawLimit = q.get("limit");
      let limit = 1000;
      if (rawLimit !== null && rawLimit !== "") {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
          return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
        }
        limit = parsed;
      }
      params.set("limit", String(limit));
      for (const key of ["fromId", "startTime", "endTime"]) {
        const value = q.get(key);
        if (value && /^\d{1,16}$/.test(value)) params.set(key, value);
      }
    }
    let lastError: unknown;
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
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          lastError = new Error(`Binance responded with HTTP ${response.status}`);
          continue;
        }
        const data = (await response.json()) as {
          symbols?: Array<{
            symbol: string;
            baseAsset: string;
            quoteAsset: string;
            status: string;
          }>;
        } | null;
        if (resource === "exchangeInfo" && !symbol) {
          if (!data || typeof data !== "object" || !Array.isArray(data.symbols)) {
            lastError = new Error("Invalid exchangeInfo payload.");
            continue;
          }
          const compact = {
            symbols: data.symbols
              .filter(
                (s) =>
                  s && s.quoteAsset === "USDT" && s.status === "TRADING",
              )
              .map((s) => ({
                symbol: s.symbol,
                baseAsset: s.baseAsset,
                quoteAsset: s.quoteAsset,
                status: s.status,
              })),
          };
          symbolCatalog = { data: compact, expires: Date.now() + 3600000 };
          return NextResponse.json(compact);
        }
        return NextResponse.json(data);
      } catch (error) {
        lastError = error;
        continue;
      }
    }
    logError("api.market.unavailable", lastError, { resource });
    return NextResponse.json(
      { error: "Public exchange API unavailable. Simulation is available." },
      { status: 503 },
    );
  } catch (error) {
    logError("api.market.error", error);
    return NextResponse.json(
      { error: "Public exchange API unavailable. Simulation is available." },
      { status: 503 },
    );
  }
}

