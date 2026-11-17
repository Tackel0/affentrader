import { generateHistory } from "@/lib/market/mock";
import { getSymbol } from "@/lib/symbols";
import { isSymbolId, providerOf, tickerOf } from "@/lib/symbolId";
import { bucketStart, nextBucket, parseInterval } from "@/lib/market/intervals";
import { loadKlines } from "@/lib/market/klines";
import { loadYahooBars } from "@/lib/market/yahooClient";
import {
  loadHyperliquidAssets,
  loadHyperliquidBars,
} from "@/lib/market/hyperliquidClient";
import { priceTick } from "@/lib/market/hyperliquid";
import type { OHLCV, Timeframe } from "@/types/trading";
import type {
  StrategyDataset,
  StrategyMarket,
  StrategySettings,
} from "@/types/strategy";
import { utcTimestamp, validateStrategySettings } from "./settings";

export function strategyTimeframe(value: string): Timeframe {
  const minutes = /^\d+$/.test(value) ? Number(value) : 0;
  const interval = parseInterval(
    minutes >= 60 && minutes % 60 === 0
      ? `${minutes / 60}h`
      : value.replace(/(\d)S$/, "$1s"),
  );
  if (!interval) throw new Error(`Invalid backtest timeframe: ${value}.`);
  if (interval.unit === "T")
    throw new Error(
      "Tick backtests require an event-time strategy provider; synthetic chart timestamps cannot be used for historical fills.",
    );
  return interval.id;
}
export function strategyRuntimeTimeframe(value: string): string {
  const interval = parseInterval(strategyTimeframe(value))!;
  return interval.unit === "h"
    ? String(interval.value * 60)
    : interval.unit === "m"
      ? String(interval.value)
      : interval.unit === "s"
        ? `${interval.value}S`
        : interval.id;
}
export function normalizeStrategyBars(rows: unknown): OHLCV[] {
  if (!Array.isArray(rows))
    throw new Error("Provider returned invalid candle data.");
  const bars = new Map<number, OHLCV>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6)
      throw new Error("Provider returned a malformed candle.");
    const [time, open, high, low, close, volume] = row.slice(0, 6).map(Number);
    if (
      ![time, open, high, low, close, volume].every(Number.isFinite) ||
      time < 0 ||
      low <= 0 ||
      high < Math.max(open, close, low) ||
      low > Math.min(open, close) ||
      volume < 0
    )
      throw new Error("Provider returned an invalid OHLCV value.");
    bars.set(time, { time, open, high, low, close, volume });
  }
  return [...bars.values()].sort((a, b) => a.time - b.time);
}
export const strategyCurrency = (market: StrategyMarket) =>
  market.currency ?? "USDT";
export const strategyVenue = (market: StrategyMarket) =>
  market.provider === "alpaca" ? "Alpaca · IEX only" : market.provider === "yahoo"
    ? "Yahoo Finance · delayed"
    : market.provider === "hyperliquid"
      ? "Hyperliquid"
      : market.provider === "kraken" ? "Kraken" : "Binance";
export async function loadStrategyDataset(
  symbol: string,
  rawTimeframe: Timeframe,
  settings: StrategySettings,
  signal: AbortSignal,
  progress: (message: string) => void = () => {},
  frozenMarket?: StrategyMarket,
): Promise<StrategyDataset> {
  validateStrategySettings(settings);
  if (!isSymbolId(symbol)) throw new Error("Invalid strategy symbol.");
  const timeframe = strategyTimeframe(rawTimeframe),
    interval = parseInterval(timeframe)!;
  const duration = interval.ms,
    provider = providerOf(symbol),
    ticker = tickerOf(symbol);
  const from = utcTimestamp(settings.from),
    end = Math.min(utcTimestamp(settings.to) ?? Date.now(), Date.now());
  const closedBoundary = bucketStart(timeframe, end);
  const fetcher: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(20000),
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
  const json = async (url: string) => {
    const response = await fetcher(url);
    if (!response.ok)
      throw new Error(
        `Historical provider data unavailable (HTTP ${response.status}).`,
      );
    return response.json();
  };
  let market: StrategyMarket = {
    symbol,
    timeframe,
    provider,
    tickSize: getSymbol(symbol).seedPrice < 1 ? 0.000001 : 0.01,
    quantityStep: 0.000001,
    base: provider === "kraken" ? ticker.split("/")[0] : getSymbol(symbol).base,
    currency: provider === "hyperliquid" ? "USDC" : provider === "kraken" ? ticker.split("/")[1] : "USDT",
    timezone: "Etc/UTC",
    type: "crypto",
    pointValue: 1,
    tickSource: "estimated",
    quantitySource: "estimated",
  };
  const warnings: string[] = [];
  if (frozenMarket) {
    if (frozenMarket.symbol !== symbol || (frozenMarket.provider ?? providerOf(frozenMarket.symbol)) !== provider ||
      ![frozenMarket.tickSize, frozenMarket.quantityStep, frozenMarket.pointValue ?? 1].every(v => Number.isFinite(v) && v > 0))
      throw new Error("Frozen trading rules do not match this strategy market.");
    market = { ...frozenMarket, timeframe };
  }
  let bars: OHLCV[];
  if (settings.source === "simulation") {
    bars = generateHistory(
      symbol,
      timeframe,
      settings.bars,
      closedBoundary - duration,
    );
    let cursor = closedBoundary;
    for (let i = bars.length - 1; i >= 0; i--) {
      cursor = bucketStart(timeframe, cursor - 1);
      bars[i] = { ...bars[i], time: cursor };
    }
    warnings.push(
      "Synthetic simulation data. These results do not represent provider history.",
    );
    if (provider === "yahoo") {
      market.currency = "SIM";
      warnings.push(
        "Simulation accounting uses synthetic SIM units; no live currency or exchange rules were retrieved.",
      );
    }
  } else if (provider === "kraken") {
    progress("Loading closed Kraken spot candles…");
    const { loadKrakenClosedBars, loadKrakenTradingIncrements } = await import("@/lib/market/kraken");
    bars = await loadKrakenClosedBars(ticker, timeframe, fetcher);
    if (!frozenMarket) {
      try {
        const increments = await loadKrakenTradingIncrements(ticker, fetcher);
        market = { ...market, ...increments, tickSource: "exchange", quantitySource: "exchange" };
      } catch {
        signal.throwIfAborted();
        warnings.push("Kraken trading increments are unavailable. Strategy tick and quantity steps use estimates unless overridden.");
      }
    }
    warnings.push("Kraken supplies up to 720 recent closed candles.");
  } else if (provider === "alpaca") {
    progress("Loading IEX-only unadjusted history…");
    const { loadIexBars } = await import("@/lib/market/alpacaClient");
    bars = (await loadIexBars(symbol, timeframe, Math.min(20000, settings.bars + 1), end, fetcher)).bars;
    market = { ...market, currency: "USD", timezone: "America/New_York", type: "stock", quantityStep: 1, tickSize: 0.01 };
    warnings.push("IEX-only unadjusted bars, including available extended hours. Incomplete US exchange coverage; no consolidated volume. History is bounded to 20,000 source bars per request. Trading increments are estimates, not broker rules.");
  } else if (provider === "yahoo") {
    progress("Loading Yahoo history and symbol metadata…");
    const data = await loadYahooBars({
      ticker,
      timeframe,
      count: Math.min(20000, settings.bars + 1),
      end,
      extended: settings.extended ?? false,
      adjustDividends: settings.adjustDividends ?? false,
      preserveSessionTimes: true,
      fetcher,
    });
    if (!data.meta?.currency)
      throw new Error(
        "Yahoo did not supply the quote currency; strategy accounting cannot be identified.",
      );
    const kind = data.meta.type;
    if (kind === "future" && !(settings.pointValue && settings.pointValue > 0))
      throw new Error(
        "Set the verified contract point value in Strategy properties before testing this futures contract. Yahoo does not supply its multiplier.",
      );
    market = {
      ...market,
      base: ticker,
      currency: data.meta.currency,
      timezone: data.meta.timezone,
      type: kind,
      tickSize: kind === "forex" ? 0.00001 : 0.01,
      quantityStep: kind === "forex" ? 0.000001 : 1,
    };
    bars =
      kind === "stock" || kind === "etf"
        ? data.bars.filter(
            (b) =>
              !(
                b.volume === 0 &&
                b.open === b.high &&
                b.high === b.low &&
                b.low === b.close
              ),
          )
        : data.bars;
    if (bars.length < data.bars.length)
      warnings.push(
        `${data.bars.length - bars.length} flat zero-volume provider rows were omitted; they do not supply a traded bar for stock/ETF fills.`,
      );
    warnings.push(
      "Yahoo Finance history is delayed and unofficial. Tick and quantity steps are estimates unless overridden; no exchange execution rules are supplied.",
    );
    warnings.push(
      "Yahoo session gaps are retained. Daily and larger bars are conservatively considered complete only after the full calendar period; time_close uses calendar interval boundaries.",
    );
    if (settings.adjustDividends)
      warnings.push(
        "Dividend-adjusted OHLC prices are used; cash dividends are not added a second time to P&L.",
      );
    if (kind === "index")
      warnings.push(
        "This is a cash index series, not a tradable contract. Select the actual derivative and point value to model its contract P&L.",
      );
  } else if (provider === "hyperliquid") {
    progress("Loading Hyperliquid contract rules and history…");
    if (!frozenMarket) {
      const asset = (await loadHyperliquidAssets(fetcher)).find(
        (a) => a.symbol === symbol,
      );
      if (!asset)
        throw new Error("Hyperliquid contract metadata is unavailable.");
      market = {
        ...market,
        base: asset.name,
        currency: "USDC",
        type: "future",
        tickSize: priceTick(asset.mark, asset.szDecimals),
        quantityStep: Number(`1e-${asset.szDecimals}`),
        quantitySource: "exchange",
      };
    }
    bars = await loadHyperliquidBars({
      coin: ticker,
      timeframe,
      count: Math.min(5000, settings.bars + 1),
      end: closedBoundary - 1,
      fetcher,
    });
    warnings.push(
      "Hyperliquid serves at most the latest 5,000 native candles per interval. Perpetual P&L is denominated in USDC; funding, borrow charges and exchange-specific liquidation are not modeled.",
    );
    warnings.push(
      "Hyperliquid price precision varies with price magnitude. The fixed broker tick uses the metadata snapshot price unless a tick override is specified.",
    );
  } else {
    progress(frozenMarket ? "Using frozen Binance trading rules…" : "Loading Binance trading rules…");
    if (!frozenMarket) {
      const info = await json(
        `/api/market?resource=exchangeInfo&symbol=${symbol}`,
      );
      const entry = info.symbols?.find(
        (s: { symbol: string }) => s.symbol === symbol,
      );
      const filters = entry?.filters as
        | { filterType: string; tickSize?: string; stepSize?: string }[]
        | undefined;
      const tickSize = Number(
        filters?.find((f) => f.filterType === "PRICE_FILTER")?.tickSize,
      );
      const quantityStep = Number(
        filters?.find((f) => f.filterType === "LOT_SIZE")?.stepSize,
      );
      if (!entry || !(tickSize > 0) || !(quantityStep > 0))
        throw new Error(
          "Exchange symbol rules are unavailable; tick-sized slippage cannot be verified.",
        );
      market = {
        ...market,
        base: entry.baseAsset,
        currency: entry.quoteAsset ?? "USDT",
        tickSize,
        quantityStep,
        tickSource: "exchange",
        quantitySource: "exchange",
      };
    }
    bars = await loadKlines(
      async (request) => {
        signal.throwIfAborted();
        const params = new URLSearchParams({
          resource: "klines",
          symbol,
          interval: request.api,
          limit: String(request.limit),
        });
        if (request.endTime !== undefined)
          params.set("endTime", String(request.endTime));
        const batch = normalizeStrategyBars(
          await json(`/api/market?${params}`),
        );
        progress(
          `Loading ${timeframe} history · ${batch.length.toLocaleString()} source bars received`,
        );
        return batch.map((b) => [
          b.time,
          b.open,
          b.high,
          b.low,
          b.close,
          b.volume,
        ]);
      },
      {
        symbol,
        timeframe,
        count: settings.bars,
        end: closedBoundary - 1,
        concurrency: 3,
      },
    );
  }
  if ((settings.tickSize ?? 0) > 0) {
    market.tickSize = settings.tickSize!;
    market.tickSource = "user";
  }
  if ((settings.quantityStep ?? 0) > 0) {
    market.quantityStep = settings.quantityStep!;
    market.quantitySource = "user";
  }
  if ((settings.pointValue ?? 0) > 0) market.pointValue = settings.pointValue!;
  bars = normalizeStrategyBars(
    bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume]),
  )
    .filter(
      (b) =>
        nextBucket(timeframe, b.time) <= end &&
        (from === undefined || b.time >= from),
    )
    .slice(-settings.bars);
  if (bars.length < 2)
    throw new Error(
      "The selected window contains fewer than two completed candles.",
    );
  if (from !== undefined && bars[0].time - from >= duration)
    warnings.push(
      `Requested start is outside returned history. The actual test starts at ${new Date(bars[0].time).toISOString()}; ${bars.length.toLocaleString()} bars were supplied.`,
    );
  if (
    provider !== "yahoo" &&
    bars.some(
      (b, i) => i > 0 && nextBucket(timeframe, bars[i - 1].time) !== b.time,
    )
  )
    warnings.push(
      "The returned series has gaps. Missing provider candles were not synthesized.",
    );
  signal.throwIfAborted();
  return { market, bars, source: settings.source, warnings };
}
