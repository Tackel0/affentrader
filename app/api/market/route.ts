import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/server/logger";
import { coalesceInFlight } from "@/lib/server/cache";
import { NATIVE_API_INTERVALS } from "@/lib/market/klines";

export const dynamic = "force-dynamic";

let symbolCatalog: { expires: number; data: unknown } | null = null;
let ticker24hAll: { expires: number; data: unknown } | null = null;
const inflightResources = new Map<string, Promise<unknown>>();

const EXCHANGE_INFO_HEADERS = { "Cache-Control": "private, max-age=300" };
const TICKER_24H_HEADERS = { "Cache-Control": "private, max-age=10" };

function upstreamSignal(request: NextRequest, timeoutMs = 7000): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
}

async function fetchBinanceResource(
  resource: string,
  params: URLSearchParams,
  signal: AbortSignal,
  revalidateExchangeInfo: boolean,
): Promise<unknown> {
  let lastError: unknown;
  for (const host of [
    "https://data-api.binance.vision",
    "https://api.binance.com",
  ]) {
    if (signal.aborted) throw signal.reason ?? new Error("Aborted");
    try {
      const response = await fetch(`${host}/api/v3/${resource}?${params}`, {
        signal,
        ...(revalidateExchangeInfo
          ? { next: { revalidate: 3600 } }
          : { cache: "no-store" }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        lastError = new Error(`Binance responded with HTTP ${response.status}`);
        continue;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (signal.aborted) break;
      continue;
    }
  }
  throw lastError ?? new Error("Public exchange API unavailable.");
}

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
        if (symbolCatalog && symbolCatalog.expires > Date.now()) {
          return NextResponse.json(symbolCatalog.data, { headers: EXCHANGE_INFO_HEADERS });
        }
        params.set("symbolStatus", "TRADING");
        const compact = await coalesceInFlight(inflightResources, "exchangeInfo:all", async () => {
          const data = (await fetchBinanceResource(
            resource,
            params,
            AbortSignal.timeout(7000),
            false,
          )) as {
            symbols?: Array<{
              symbol: string;
              baseAsset: string;
              quoteAsset: string;
              status: string;
            }>;
          } | null;
          if (!data || typeof data !== "object" || !Array.isArray(data.symbols)) {
            throw new Error("Invalid exchangeInfo payload.");
          }
          const result = {
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
          symbolCatalog = { data: result, expires: Date.now() + 3600000 };
          return result;
        });
        return NextResponse.json(compact, { headers: EXCHANGE_INFO_HEADERS });
      }
    }
    if (resource === "ticker/24hr" && !symbol) {
      if (ticker24hAll && ticker24hAll.expires > Date.now()) {
        return NextResponse.json(ticker24hAll.data, { headers: TICKER_24H_HEADERS });
      }
      const rows = await coalesceInFlight(inflightResources, "ticker/24hr:all", async () => {
        const data = await fetchBinanceResource(resource, params, AbortSignal.timeout(7000), false);
        ticker24hAll = { data, expires: Date.now() + 5_000 };
        return data;
      });
      return NextResponse.json(rows, { headers: TICKER_24H_HEADERS });
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
    try {
      const data = await fetchBinanceResource(
        resource!,
        params,
        upstreamSignal(request, 7000),
        resource === "exchangeInfo" && Boolean(symbol),
      );
      return NextResponse.json(
        data,
        resource === "exchangeInfo"
          ? { headers: EXCHANGE_INFO_HEADERS }
          : resource === "ticker/24hr"
            ? { headers: TICKER_24H_HEADERS }
            : undefined,
      );
    } catch (lastError) {
      logError("api.market.unavailable", lastError, { resource });
      return NextResponse.json(
        { error: "Public exchange API unavailable. Simulation is available." },
        { status: 503 },
      );
    }
  } catch (error) {
    logError("api.market.error", error);
    return NextResponse.json(
      { error: "Public exchange API unavailable. Simulation is available." },
      { status: 503 },
    );
  }
}

