import { nextBucket, parseInterval, planSource } from "@/lib/market/intervals";
import { KRAKEN_NATIVES } from "@/lib/market/kraken";
import { HYPERLIQUID_NATIVES } from "@/lib/market/hyperliquid";
import { YAHOO_NATIVES } from "@/lib/market/yahoo";
import { providerOf } from "@/lib/symbolId";
import type { OHLCV } from "@/types/trading";
import type { StrategyDataset, StrategyMagnifierSummary, StrategySettings } from "@/types/strategy";
import { loadStrategyDataset } from "./data";

export const MAX_INTRABAR_BARS = 200_000;
export interface StrategyIntrabarPath { prices: number[]; gaps: number[] }

/** Choose a finer, divisible resolution; never consume a candle spanning two parent bars. */
export function magnifierInterval(dataset: StrategyDataset, requested = "auto"): string {
  const parent = parseInterval(dataset.market.timeframe)!;
  const provider = dataset.market.provider ?? providerOf(dataset.market.symbol);
  const available = provider === "alpaca" ? [{ id: "1m", api: "1Min", ms: 60_000 }, { id: "1D", api: "1Day", ms: 86_400_000 }] : provider === "yahoo" ? YAHOO_NATIVES : provider === "hyperliquid" ? HYPERLIQUID_NATIVES : provider === "kraken" ? KRAKEN_NATIVES : undefined;
  const supports = (id: string) => {
    const lower = parseInterval(id)!;
    return lower.unit !== "T" && lower.ms < parent.ms &&
      (parent.unit === "M" ? lower.unit !== "W" && lower.unit !== "M" && 86_400_000 % lower.ms === 0 : parent.ms % lower.ms === 0) &&
      Boolean(planSource(id, available));
  };
  if (requested !== "auto") {
    const lower = parseInterval(requested);
    if (!lower || !supports(lower.id))
      throw new Error("The magnifier interval must be finer, divide the chart interval, and be supported by this provider.");
    return lower.id;
  }
  const target = parent.ms < 30_000 ? 1000 : parent.ms < 60_000 ? 5000 : parent.ms < 300_000 ? 10_000 :
    parent.ms < 600_000 ? 30_000 : parent.ms < 900_000 ? 60_000 : parent.ms < 1_800_000 ? 120_000 :
    parent.ms < 3_600_000 ? 300_000 : parent.ms < 14_400_000 ? 600_000 : parent.ms < 86_400_000 ? 1_800_000 :
    parent.ms < 259_200_000 ? 3_600_000 : parent.ms < 604_800_000 ? 14_400_000 : 86_400_000;
  const candidates = ["1s", "5s", "10s", "15s", "30s", "1m", "2m", "3m", "5m", "10m", "15m", "30m", "1h", "4h", "1D"];
  const choices = candidates.filter(supports);
  const chosen = choices.filter(id => parseInterval(id)!.ms <= target).at(-1) ?? choices[0];
  if (!chosen) throw new Error("No finer historical candle interval is available for this chart and provider.");
  return chosen;
}

/** Frozen lower history is loaded backwards, with the same venue, symbol and adjustment settings. */
export async function loadMagnifierDataset(
  dataset: StrategyDataset, settings: StrategySettings, signal: AbortSignal,
  progress: (message: string) => void = () => {},
  loader: typeof loadStrategyDataset = loadStrategyDataset,
): Promise<StrategyDataset> {
  if (!settings.useBarMagnifier) return dataset;
  if (dataset.source === "simulation")
    throw new Error("Bar magnifier needs independently recorded lower-timeframe history. Select exchange history; synthetic parent candles do not supply it.");
  const timeframe = magnifierInterval(dataset, settings.intrabarInterval ?? "auto");
  const provider = dataset.market.provider ?? providerOf(dataset.market.symbol);
  const natives = provider === "alpaca" ? [{ id: "1m", api: "1Min", ms: 60_000 }, { id: "1D", api: "1Day", ms: 86_400_000 }] : provider === "yahoo" ? YAHOO_NATIVES : provider === "hyperliquid" ? HYPERLIQUID_NATIVES : provider === "kraken" ? KRAKEN_NATIVES : undefined;
  const plan = planSource(timeframe, natives)!;
  const batchLimit = Math.max(100, Math.min(10_000, Math.floor(39_000 / plan.factor)));
  const first = dataset.bars[0].time;
  let cursor = nextBucket(dataset.market.timeframe, dataset.bars.at(-1)!.time);
  const end = cursor, rows = new Map<number, OHLCV>(), notices = new Set<string>();
  const stamp = (time: number) => new Date(time).toISOString().slice(0, 19);
  while (cursor > first && rows.size < MAX_INTRABAR_BARS) {
    signal.throwIfAborted();
    progress(`Loading ${timeframe} intrabars · ${rows.size.toLocaleString()} / ${MAX_INTRABAR_BARS.toLocaleString()}`);
    let batch: StrategyDataset;
    try {
      batch = await loader(dataset.market.symbol, timeframe, {
        ...settings, useBarMagnifier: false, from: stamp(first), to: stamp(cursor),
        bars: Math.max(100, Math.min(batchLimit, MAX_INTRABAR_BARS - rows.size)),
      }, signal, undefined, dataset.market);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && error.message.includes("fewer than two completed candles")) break;
      throw error;
    }
    if (batch.source !== dataset.source || batch.market.symbol !== dataset.market.symbol || batch.market.timeframe !== timeframe)
      throw new Error("Intrabar history did not match the frozen strategy source.");
    let oldest = cursor;
    for (const bar of batch.bars) {
      if (bar.time >= first && nextBucket(timeframe, bar.time) <= cursor) {
        rows.set(bar.time, bar);
        oldest = Math.min(oldest, bar.time);
      }
    }
    for (const warning of batch.warnings) notices.add(warning);
    if (oldest >= cursor) break;
    cursor = oldest;
  }
  signal.throwIfAborted();
  const bars = [...rows.values()].filter(b => b.time >= first && nextBucket(timeframe, b.time) <= end)
    .sort((a, b) => a.time - b.time).slice(-MAX_INTRABAR_BARS);
  return { ...dataset, warnings: [...dataset.warnings, ...[...notices].map(w => `Intrabars: ${w}`)], intrabars: { timeframe, bars } };
}

/** Reject partial or inconsistent parent coverage instead of inventing its missing chronology. */
export function prepareMagnifier(dataset: StrategyDataset, enabled: boolean) {
  const lower = dataset.intrabars;
  const paths = new Map<number, StrategyIntrabarPath>();
  const summary: StrategyMagnifierSummary = {
    enabled, timeframe: lower?.timeframe ?? null, sourceBars: lower?.bars.length ?? 0,
    coveredBars: 0, fallbackBars: enabled ? dataset.bars.length : 0, incompleteBars: 0, mismatchedBars: 0,
    firstCoveredTime: null, lastCoveredTime: null,
  };
  if (!enabled) return { paths, summary };
  if (!lower || !lower.bars.length) throw new Error("Bar magnifier is enabled but no lower-timeframe history was supplied.");
  if (lower.bars.length > MAX_INTRABAR_BARS) throw new Error("Intrabar history exceeds 200,000 candles.");
  magnifierInterval(dataset, lower.timeframe);
  let previous = -Infinity;
  for (const b of lower.bars) {
    if (b.time <= previous || ![b.time, b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) ||
      b.low <= 0 || b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close) || b.volume < 0)
      throw new Error("Intrabar history must contain ordered, unique, valid OHLCV candles.");
    previous = b.time;
  }
  let cursor = 0;
  const tolerance = Math.max(dataset.market.tickSize * 0.51, 1e-8);
  for (let i = 0; i < dataset.bars.length; i++) {
    const parent = dataset.bars[i], end = Math.min(nextBucket(dataset.market.timeframe, parent.time), dataset.bars[i + 1]?.time ?? Infinity);
    while (cursor < lower.bars.length && lower.bars[cursor].time < parent.time) cursor++;
    const start = cursor;
    while (cursor < lower.bars.length && lower.bars[cursor].time < end) cursor++;
    const children = lower.bars.slice(start, cursor);
    if (!children.length || children[0].time !== parent.time || nextBucket(lower.timeframe, children.at(-1)!.time) !== end ||
      children.some((b, j) => j > 0 && nextBucket(lower.timeframe, children[j - 1].time) !== b.time)) {
      summary.incompleteBars++;
      continue;
    }
    const equal = (a: number, b: number) => Math.abs(a - b) <= tolerance &&
      Math.round(a / dataset.market.tickSize) === Math.round(b / dataset.market.tickSize);
    if (!equal(children[0].open, parent.open) || !equal(children.at(-1)!.close, parent.close) ||
      !equal(children.reduce((high, b) => Math.max(high, b.high), -Infinity), parent.high) ||
      !equal(children.reduce((low, b) => Math.min(low, b.low), Infinity), parent.low)) {
      summary.mismatchedBars++;
      continue;
    }
    const prices: number[] = [], gaps: number[] = [];
    for (const bar of children) {
      if (prices.length && prices.at(-1) !== bar.open) gaps.push(prices.length);
      const tick = dataset.market.tickSize;
      const openTick = Math.round(bar.open / tick), highTick = Math.round(bar.high / tick), lowTick = Math.round(bar.low / tick);
      const highFirst = highTick - openTick <= openTick - lowTick;
      prices.push(bar.open, highFirst ? bar.high : bar.low, highFirst ? bar.low : bar.high, bar.close);
    }
    paths.set(parent.time, { prices, gaps });
    summary.coveredBars++;
    summary.firstCoveredTime ??= parent.time;
    summary.lastCoveredTime = parent.time;
  }
  summary.fallbackBars -= summary.coveredBars;
  if (!paths.size) throw new Error("No chart candles have complete, OHLC-matching intrabar coverage. Choose a more recent window or another finer interval.");
  return { paths, summary };
}
