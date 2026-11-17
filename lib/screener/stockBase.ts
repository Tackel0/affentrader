import type { OHLCV } from "@/types/trading";
import { atr, rsi } from "@/lib/ta";

export const STOCK_BASE_MARKETS = [
  { id: "us", label: "US · NYSE / Nasdaq", benchmark: "^GSPC", benchmarkLabel: "S&P 500" },
  { id: "xetra", label: "Germany · Xetra", benchmark: "^GDAXI", benchmarkLabel: "DAX" },
  { id: "lse", label: "UK · London", benchmark: "^FTSE", benchmarkLabel: "FTSE 100" },
] as const;
export const STOCK_BASE_PAGE_SIZE = 24;
export interface DailyStockBar extends OHLCV { session: string }
export interface StockBaseSetup {
  stage: "forming" | "reclaimed" | "breakout";
  score: number;
  scoreComponents: Record<"base" | "stage" | "relativeStrength" | "contraction" | "latestVolume" | "higherRetest" | "participation", number>;
  firstLow: { session: string; price: number };
  retest: { session: string; price: number };
  session: string;
  close: number;
  resistance: number;
  invalidation: number;
  drawdown: number;
  drawdownPeak?: { session: string; price: number };
  relativeStrength: number;
  retestReturn: number;
  retestRelativeStrength: number;
  relativeSessions: number;
  contraction: number;
  volumeRatio: number;
  breakoutEvidence: {
    session: string;
    confirmedOn: string;
    threshold: number;
    confirmation: "volume" | "two-closes";
    volumeRatio: number;
    consecutiveCloses: number;
  } | null;
  recoveryVolume: { upSessions: number; downSessions: number; ratio: number | null };
  rsiAtLow: number | null;
}
export type StockBaseStatus = "active" | "support-lost" | "breakout-failed" | "out-of-screen";
export const stockBaseLevelDistance = (level: number, close: number) => (level - close) / close * 100;
export interface StockBaseProgress {
  setup: StockBaseSetup;
  status: StockBaseStatus;
  firstSeen: string;
  firstInvalidation: number;
  latestSession: string;
  latestClose: number;
  latestRetestRelativeStrength?: number;
  statusSince: string;
  breakoutFailedOn?: string;
  supportLostOn?: string;
  milestones: { session: string; stage: StockBaseSetup["stage"]; score: number }[];
}
export interface StockBaseRow extends StockBaseSetup {
  symbol: string;
  name: string;
  currency: string;
  progress: Omit<StockBaseProgress, "setup">;
  chart: Pick<DailyStockBar, "session" | "open" | "high" | "low" | "close">[];
  followThrough: StockBaseFollowThrough[];
}

export interface StockBaseFollowThrough {
  sessions: number;
  through: string;
  stockChange: number;
  benchmarkChange: number;
  relativeChange: number;
  lowChange: number;
  highChange: number;
  invalidatedOn: string | null;
}

export function stockBaseFollowThrough(bars: readonly DailyStockBar[], benchmark: readonly DailyStockBar[], observed: string, invalidation: number): StockBaseFollowThrough[] {
  const start = bars.findIndex(bar => bar.session === observed);
  const marketStart = benchmark.findIndex(bar => bar.session === observed);
  if (start < 0 || marketStart < 0) return [];
  const outcomes: StockBaseFollowThrough[] = [];
  let low = Infinity, high = -Infinity, invalidatedOn: string | null = null;
  for (let offset = 1; offset <= 10; offset++) {
    const stock = bars[start + offset], market = benchmark[marketStart + offset];
    if (!stock || !market || stock.session !== market.session) break;
    low = Math.min(low, stock.low);
    high = Math.max(high, stock.high);
    if (invalidatedOn === null && stock.low < invalidation) invalidatedOn = stock.session;
    if (offset !== 1 && offset !== 5 && offset !== 10) continue;
    const a = stock.close / bars[start].close, b = market.close / benchmark[marketStart].close;
    outcomes.push({ sessions: offset, through: stock.session, stockChange: (a - 1) * 100, benchmarkChange: (b - 1) * 100, relativeChange: (a / b - 1) * 100,
      lowChange: (low / bars[start].close - 1) * 100, highChange: (high / bars[start].close - 1) * 100, invalidatedOn });
  }
  return outcomes;
}
export interface StockBaseScan {
  pendingRetests?: (PendingRetest & Pick<StockBaseRow, "symbol" | "name" | "currency" | "chart">)[];
  market: string;
  benchmark: string;
  benchmarkSession: string;
  benchmarkRevision: string;
  generatedAt: number;
  attempted: number;
  evaluated: number;
  excluded: number;
  universe: number;
  page: number;
  pages: number;
  rows: StockBaseRow[];
  unavailable: { symbol: string; reason: string }[];
}

export function comparePendingRetests(a: PendingRetest & { symbol: string }, b: PendingRetest & { symbol: string }) {
  return a.sessionsNeeded - b.sessionsNeeded || a.symbol.localeCompare(b.symbol);
}

export function mergeStockBasePages(previous: StockBaseScan | null, next: StockBaseScan): StockBaseScan {
  if (next.page !== (previous ? previous.page + 1 : 0) || previous && (
    previous.market !== next.market || previous.pages !== next.pages || previous.universe !== next.universe ||
    previous.benchmarkSession !== next.benchmarkSession || previous.benchmarkRevision !== next.benchmarkRevision
  )) throw new Error("Market data changed during the scan. Run the scan again.");
  if (!previous) return next;
  return {
    ...next,
    attempted: previous.attempted + next.attempted,
    evaluated: previous.evaluated + next.evaluated,
    excluded: previous.excluded + next.excluded,
    unavailable: [...previous.unavailable, ...next.unavailable],
    rows: [...previous.rows, ...next.rows].sort((a, b) => b.score - a.score || b.relativeStrength - a.relativeStrength || a.symbol.localeCompare(b.symbol)),
    pendingRetests: [...(previous.pendingRetests ?? []), ...(next.pendingRetests ?? [])].sort(comparePendingRetests),
  };
}

/** Wait for the following local date. This does not rely on assuming a fixed
 * closing bell, and works across holidays, early closes and DST transitions. */
export function completedStockDays(bars: readonly OHLCV[], timezone: string, now: number): DailyStockBar[] {
  const formatter = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const session = (time: number) => {
    const parts = formatter.formatToParts(time);
    return ["year", "month", "day"].map(part => parts.find(p => p.type === part)?.value).join("-");
  };
  const today = session(now), output: DailyStockBar[] = [];
  for (const bar of bars) {
    if (!Number.isSafeInteger(bar.time) || bar.time <= 0 || bar.time >= now) continue;
    const day = session(bar.time);
    if (day >= today) continue;
    if (output.length && day <= output.at(-1)!.session) throw new Error("Daily sessions are duplicated or out of order.");
    if (![bar.open, bar.high, bar.low, bar.close].every(n => Number.isFinite(n) && n > 0) || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)) throw new Error("Daily candle has invalid prices.");
    output.push({ ...bar, session: day });
  }
  return output;
}

/** Include the first possible peak used by the 12-session reconstruction.
 * Exchange holidays are represented by the benchmark's own session dates. */
export function stockBaseCoverageIssue(bars: readonly DailyStockBar[], benchmark: readonly DailyStockBar[]): string | null {
  if (bars.length < 70 || benchmark.length < 70) return "Fewer than 70 completed sessions.";
  if (bars.at(-1)!.session !== benchmark.at(-1)!.session) return "Latest completed session differs from benchmark.";
  const start = [bars[0].session, benchmark.at(-82)?.session ?? benchmark[0].session].sort()[1];
  const stockDates = new Set(bars.filter(bar => bar.session >= start).map(bar => bar.session));
  const marketDates = new Set(benchmark.filter(bar => bar.session >= start).map(bar => bar.session));
  if (marketDates.size < 70) return "Fewer than 70 comparable completed sessions.";
  const missing = [...marketDates].find(session => !stockDates.has(session));
  if (missing) return `Stock candle missing for benchmark session ${missing}.`;
  const unmatched = [...stockDates].find(session => !marketDates.has(session));
  return unmatched ? `Benchmark candle missing for stock session ${unmatched}.` : null;
}

const mean = (numbers: number[]) => numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
const pivot = (bars: readonly DailyStockBar[], i: number) => bars[i].low < Math.min(bars[i - 2].low, bars[i - 1].low) && bars[i].low <= Math.min(bars[i + 1].low, bars[i + 2].low);
const range = (b: DailyStockBar) => b.high - b.low;
const stageWeight = { forming: 0, reclaimed: 10, breakout: 20 };

function retestRangeRatio(bars: readonly DailyStockBar[], first: number, second: number) {
  const selloffRange = mean(bars.slice(first - 9, first + 1).map(range));
  return selloffRange > 0 ? mean(bars.slice(second - 2, second + 1).map(range)) / selloffRange : Infinity;
}

interface PendingRetest {
  firstLow: string;
  firstLowPrice?: number;
  drawdown?: number;
  drawdownPeak?: StockBaseSetup["drawdownPeak"];
  retest: string;
  price: number;
  resistance: number;
  invalidation: number;
  recoveryLevel: number;
  recoveryStrict: boolean;
  latestClose: number;
  sessionsNeeded: number;
  waitingFor?: "recovery" | "relative-strength";
  strength?: { window: number; sinceRetest: number };
}

function benchmarkRelativeReturn(close: number, initialClose: number, benchmarkClose: number, initialBenchmarkClose: number) {
  return 100 * ((close / initialClose) / (benchmarkClose / initialBenchmarkClose) - 1);
}

function retestRecoveryLevel(retest: DailyStockBar, resistance: number, unit: number) {
  const strictFloor = Math.max(retest.close, retest.low + .5 * (resistance - retest.low));
  const atrFloor = retest.low + unit;
  return { recoveryLevel: Math.max(strictFloor, atrFloor), recoveryStrict: strictFloor >= atrFloor };
}

function meetsRetestRecovery(close: number, floor: ReturnType<typeof retestRecoveryLevel>) {
  return floor.recoveryStrict ? close > floor.recoveryLevel : close >= floor.recoveryLevel;
}

function priorDrawdown(bars: readonly DailyStockBar[], index: number, unit: number) {
  let peak: DailyStockBar | undefined;
  for (const bar of bars.slice(Math.max(0, index - 45), index - 3)) {
    if (!peak || bar.high >= peak.high) peak = bar;
  }
  if (!peak || unit <= 0) return null;
  const drop = peak.high - bars[index].low;
  const percent = 100 * drop / peak.high;
  return drop >= 4 * unit && percent >= 12 ? { percent, peak: { session: peak.session, price: peak.high } } : null;
}

export function detectPendingRetest(bars: readonly DailyStockBar[], benchmark?: readonly DailyStockBar[], afterRetest?: string): PendingRetest | null {
  if (bars.length < 70) return null;
  const last = bars.length - 1;
  const volatility = atr(bars, 14);
  const market = new Map(benchmark?.map(bar => [bar.session, bar.close]));
  const current = bars[last];
  for (let second = last; second >= last - (benchmark ? 5 : 1); second--) {
    const retest = bars[second];
    if (afterRetest && retest.session <= afterRetest) break;
    const confirmed = last - second >= 2;
    if (retest.low >= Math.min(bars[second - 1].low, bars[second - 2].low) ||
      bars.slice(second + 1).some(b => b.low < retest.low)) continue;
    for (let first = second - 4; first >= last - 25; first--) {
      if (!pivot(bars, first)) continue;
      const low = bars[first], unit = volatility[first];
      const drawdown = priorDrawdown(bars, first, unit);
      if (!drawdown || retest.low < low.low - .35 * unit || retest.low > low.low + 2.25 * unit) continue;
      const between = bars.slice(first + 1, second);
      if (between.some(bar => bar.low < Math.min(low.low, retest.low))) continue;
      const resistance = Math.max(...between.map(b => b.high));
      const invalidation = Math.min(low.low, retest.low) - .35 * unit;
      if (invalidation <= 0 || resistance - low.low < 1.5 * unit ||
        bars.slice(first + 1).some(b => b.low < invalidation) || bars[last].close >= resistance) continue;
      if (retestRangeRatio(bars, first, second) > 1.15) continue;
      const recovery = retestRecoveryLevel(retest, resistance, unit);
      const candidate = { firstLow: low.session, firstLowPrice: low.low, drawdown: drawdown.percent, drawdownPeak: drawdown.peak, retest: retest.session, price: retest.low, resistance, invalidation, latestClose: current.close, ...recovery, sessionsNeeded: Math.max(0, 2 - (last - second)) };
      if (!confirmed) return candidate;
      if (bars.slice(second + 1).some(bar => bar.close > resistance + .1 * unit)) continue;
      const end = market.get(current.session), retestIndex = market.get(retest.session);
      const matched = bars.slice(first).filter(bar => market.has(bar.session)).slice(-11);
      if (!end || !retestIndex || matched.length < 7) continue;
      const start = matched[0];
      const strength = {
        window: benchmarkRelativeReturn(current.close, start.close, end, market.get(start.session)!),
        sinceRetest: benchmarkRelativeReturn(current.close, retest.close, end, retestIndex),
      };
      if (!meetsRetestRecovery(current.close, recovery)) return { ...candidate, strength, waitingFor: "recovery" };
      if (strength.sinceRetest <= 0 || strength.window < .5)
        return { ...candidate, strength, waitingFor: "relative-strength" };
    }
  }
  return null;
}

function recoveryVolume(bars: readonly DailyStockBar[], retest: number): StockBaseSetup["recoveryVolume"] {
  let upSessions = 0, downSessions = 0, upVolume = 0, downVolume = 0;
  for (let i = retest + 1; i < bars.length; i++) {
    const { close, volume } = bars[i], previous = bars[i - 1].close;
    if (close > previous) { upSessions++; upVolume += volume; }
    if (close < previous) { downSessions++; downVolume += volume; }
  }
  const ratio = upSessions >= 2 && downSessions >= 2 ? (upVolume / upSessions) / (downVolume / downSessions) : null;
  return { upSessions, downSessions, ratio: ratio !== null && Number.isFinite(ratio) ? ratio : null };
}

function stockBaseIndicators(bars: readonly DailyStockBar[]) {
  return { volatility: atr(bars, 14), momentum: rsi(bars.map(bar => bar.close), 14) };
}

export function detectStockBase(bars: readonly DailyStockBar[], benchmark: readonly DailyStockBar[], pair?: Pick<StockBaseSetup, "firstLow" | "retest">): StockBaseSetup | null {
  return detectStockBasePrefix(bars, benchmark, pair);
}

function detectStockBasePrefix(bars: readonly DailyStockBar[], benchmark: readonly DailyStockBar[],
  pair?: Pick<StockBaseSetup, "firstLow" | "retest">, indicators?: ReturnType<typeof stockBaseIndicators>): StockBaseSetup | null {
  if (bars.length < 70 || benchmark.length < 20) return null;
  const last = bars.length - 1, current = bars[last];
  if (current.session !== benchmark.at(-1)?.session || !bars.slice(-22).every(b => Number.isFinite(b.volume) && b.volume > 0)) return null;
  const market = new Map(benchmark.map(b => [b.session, b.close]));
  const { volatility, momentum } = indicators ?? stockBaseIndicators(bars);
  let best: StockBaseSetup | null = null;
  for (let first = last - 25; first <= last - 7; first++) {
    const low = bars[first];
    if (pair && low.session !== pair.firstLow.session) continue;
    if (!pivot(bars, first)) continue;
    const unit = volatility[first];
    const drawdown = priorDrawdown(bars, first, unit);
    if (drawdown === null) continue;

    for (let second = first + 4; second <= last - 2; second++) {
      const retest = bars[second];
      if (pair && retest.session !== pair.retest.session) continue;
      if (!pivot(bars, second) || retest.low < low.low - .35 * unit || retest.low > low.low + 2.25 * unit) continue;
      const between = bars.slice(first + 1, second), after = bars.slice(second + 1);
      if (between.some(bar => bar.low < Math.min(low.low, retest.low))) continue;
      const resistance = Math.max(...between.map(b => b.high));
      const support = Math.min(low.low, retest.low), invalidation = support - .35 * unit;
      if (invalidation <= 0 || resistance - low.low < 1.5 * unit || bars.slice(first + 1).some(b => b.low < invalidation)) continue;
      if (!meetsRetestRecovery(current.close, retestRecoveryLevel(retest, resistance, unit)) || current.close > resistance + 2 * unit) continue;

      const matched = bars.slice(first).filter(b => market.has(b.session)).slice(-11);
      if (matched.length < 7) continue;
      const start = matched[0];
      const relativeStrength = benchmarkRelativeReturn(current.close, start.close, market.get(current.session)!, market.get(start.session)!);
      if (relativeStrength < .5) continue;
      const retestBenchmark = market.get(retest.session);
      if (retestBenchmark === undefined) continue;
      const retestGrowth = current.close / retest.close;
      const retestReturn = 100 * (retestGrowth - 1);
      const retestRelativeStrength = benchmarkRelativeReturn(current.close, retest.close, market.get(current.session)!, retestBenchmark);
      if (retestReturn <= 0 || retestRelativeStrength <= 0) continue;
      const contraction = retestRangeRatio(bars, first, second);
      if (contraction > 1.15) continue;
      const earlierVolume = mean(bars.slice(last - 20, last).map(b => b.volume));
      const volumeRatio = current.volume / earlierVolume;
      const threshold = resistance + .1 * unit;
      const firstClear = after.findIndex(b => b.close > threshold);
      let breakoutEvidence: StockBaseSetup["breakoutEvidence"] = null;
      if (firstClear >= 0) {
        const run = after.slice(firstClear);
        if (run.length > 4) continue;
        const index = second + 1 + firstClear;
        const baseline = bars.slice(index - 20, index);
        const ratio = baseline.every(b => Number.isFinite(b.volume) && b.volume > 0)
          ? run[0].volume / mean(baseline.map(b => b.volume)) : 0;
        const firstCloseInsideBuffer = run.findIndex(bar => bar.close <= threshold);
        const consecutiveCloses = firstCloseInsideBuffer < 0 ? run.length : firstCloseInsideBuffer;
        const confirmationCloses = ratio >= 1.25 ? 1 : 2;
        if (consecutiveCloses >= confirmationCloses) {
          if (run.slice(confirmationCloses).some(bar => bar.close < resistance)) continue;
          breakoutEvidence = {
            session: run[0].session,
            confirmedOn: run[confirmationCloses - 1].session,
            threshold,
            confirmation: confirmationCloses === 1 ? "volume" : "two-closes",
            volumeRatio: ratio,
            consecutiveCloses,
          };
        } else if (run.length > 1) {
          // A later push cannot confirm an interrupted initial clearance.
          continue;
        }
      }
      const stage = breakoutEvidence ? "breakout" : current.close >= resistance - .25 * unit ? "reclaimed" : "forming";
      const participation = recoveryVolume(bars, second);
      const participationPoints = participation.ratio === null ? 0 : Math.max(-6, Math.min(6, (participation.ratio - 1) * 6));
      const scoreComponents = {
        base: 30,
        stage: stageWeight[stage],
        relativeStrength: Math.min(18, relativeStrength * 2),
        contraction: Math.min(12, Math.max(0, (1 - contraction) * 20)),
        latestVolume: Math.min(10, Math.max(0, (volumeRatio - .75) * 8)),
        higherRetest: retest.low > low.low ? 8 : 0,
        participation: participationPoints,
      };
      const score = Math.min(100, Math.round(Object.values(scoreComponents).reduce((sum, points) => sum + points, 0)));
      const setup: StockBaseSetup = { stage, score, scoreComponents, firstLow: { session: low.session, price: low.low }, retest: { session: retest.session, price: retest.low }, session: current.session, close: current.close, resistance, invalidation, drawdown: drawdown.percent, drawdownPeak: drawdown.peak, relativeStrength, retestReturn, retestRelativeStrength, relativeSessions: matched.length - 1, contraction, volumeRatio, breakoutEvidence, recoveryVolume: participation, rsiAtLow: Number.isFinite(momentum[first]) ? momentum[first] : null };
      if (!best || setup.score > best.score || setup.score === best.score && setup.retest.session > best.retest.session) best = setup;
    }
  }
  return best;
}

/** Recompute each observation from its own completed prefix. Track one pivot pair
 * so a newer, unrelated base cannot inherit an older setup's history. */
export function trackStockBase(bars: readonly DailyStockBar[], benchmark: readonly DailyStockBar[]): StockBaseProgress | null {
  const latest = bars.at(-1);
  if (bars.length < 70 || !latest || latest.session !== benchmark.at(-1)?.session) return null;
  // ATR and RSI only read prior/current bars, so their existing values are identical for every completed prefix.
  const indicators = stockBaseIndicators(bars);
  const observations: (StockBaseSetup | null)[] = [];
  const start = Math.max(69, bars.length - 12);
  for (let i = start; i < bars.length; i++) {
    const session = bars[i].session;
    observations.push(detectStockBasePrefix(bars.slice(0, i + 1), benchmark.filter(b => b.session <= session), undefined, indicators));
  }
  const setup = observations.findLast(row => row !== null);
  if (!setup) return null;
  const matching = observations.map((row, offset) => {
    if (!row || row.firstLow.session === setup.firstLow.session && row.retest.session === setup.retest.session) return row;
    const index = start + offset;
    const session = bars[index].session;
    if (session >= setup.session || session <= setup.retest.session) return null;
    return detectStockBasePrefix(bars.slice(0, index + 1), benchmark.filter(bar => bar.session <= session), setup, indicators);
  });
  const milestones: StockBaseProgress["milestones"] = [];
  for (const row of matching) {
    if (row && milestones.at(-1)?.stage !== row.stage) milestones.push({ session: row.session, stage: row.stage, score: row.score });
  }
  const after = bars.filter(bar => bar.session > setup.session);
  const lost = after.find(bar => bar.low < setup.invalidation);
  const breakout = matching.findLast(row => row?.stage === "breakout");
  const failed = breakout && after.find(bar => bar.close < breakout.resistance);
  let status: StockBaseStatus = "active", statusSince = milestones.at(-1)!.session;
  if (lost) { status = "support-lost"; statusSince = lost.session; }
  else if (failed) { status = "breakout-failed"; statusSince = failed.session; }
  else if (after.length) { status = "out-of-screen"; statusSince = after[0].session; }
  const retestClose = bars.find(bar => bar.session === setup.retest.session)?.close;
  const retestBenchmark = benchmark.find(bar => bar.session === setup.retest.session)?.close;
  const latestRetestRelativeStrength = retestClose && retestBenchmark
    ? benchmarkRelativeReturn(latest.close, retestClose, benchmark.at(-1)!.close, retestBenchmark)
    : undefined;
  return { setup, status, statusSince, breakoutFailedOn: failed?.session, supportLostOn: lost?.session, firstSeen: milestones[0].session, firstInvalidation: matching.find(row => row !== null)!.invalidation, latestSession: latest.session, latestClose: latest.close, latestRetestRelativeStrength, milestones };
}
