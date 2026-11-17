import { describe, expect, it } from "vitest";
import { completedStockDays, detectPendingRetest, detectStockBase, mergeStockBasePages, stockBaseCoverageIssue, trackStockBase, type DailyStockBar, type StockBaseScan } from "@/lib/screener/stockBase";
import { terminalCapm } from "@/lib/terminal/capm";
import { stockBaseFollowThrough } from "@/lib/screener/stockBase";
import { pendingRetestsCsv, stockBaseCsv } from "@/lib/screener/stockBaseCsv";
import { scanStockBases } from "@/lib/server/stockBase";
import { parseMeta } from "@/lib/market/yahoo";

const day = 86_400_000;
const prices = [...Array.from({ length: 62 }, (_, i) => 120 + i % 3 * .6), 117, 114, 110, 108, 106, 103, 100, 98, 95, 94, 96, 98, 100, 101, 99.5, 98, 97, 96, 97.5, 98, 99, 100, 102.5, 103];
const fixture = prices.map((close, i): DailyStockBar => {
  const time = Date.UTC(2026, 1, 1, 15) + i * day, spread = i >= 76 ? .55 : 1.6;
  return { time, session: new Date(time).toISOString().slice(0, 10), close, open: close, high: close + spread, low: close - spread, volume: i === prices.length - 1 ? 170 : 100 };
});
const benchmark = fixture.map((b, i) => ({ ...b, close: 100 + i * .03 }));

describe("stock base scanner", () => {
  it("returns both event candles and dates through the scan response and CSV", async () => {
    const last = fixture.at(-1)!;
    const failed = new Date(last.time + day).toISOString().slice(0, 10);
    const lost = new Date(last.time + 2 * day).toISOString().slice(0, 10);
    const stock = [
      ...fixture.map((bar, i) => i === 30 ? { ...bar, high: 125 } : bar),
      { ...last, session: failed, time: last.time + day, low: 99, close: 100 },
      { ...last, session: lost, time: last.time + 2 * day, low: 88, close: 90 },
    ];
    const index = [...benchmark, ...stock.slice(-2).map((bar, i) => ({ ...bar, close: 103 + i * .03 }))];
    const scan = await scanStockBases("us", 0, last.time + 3 * day, async ({ ticker }) => {
      const bars = ticker === "^GSPC"
        ? index.map(bar => ({ ...bar, open: bar.close, high: bar.close + 1, low: bar.close - 1 }))
        : stock;
      return {
        meta: parseMeta({ symbol: ticker, currency: "USD", exchangeTimezoneName: "America/New_York", instrumentType: ticker === "^GSPC" ? "INDEX" : "EQUITY" }),
        bars,
        adjClose: bars.map(bar => bar.close),
        events: { dividends: [], splits: [] },
      };
    }, ["AAPL"]);
    expect(scan.unavailable).toEqual([]);
    expect(scan.rows).toHaveLength(1);
    expect(scan.rows[0].progress).toMatchObject({ status: "support-lost", statusSince: lost, breakoutFailedOn: failed, supportLostOn: lost });
    expect(scan.rows[0].chart.slice(-2).map(bar => bar.session)).toEqual([failed, lost]);
    expect(scan.rows[0].drawdownPeak).toEqual({ session: fixture[30].session, price: 125 });
    expect(scan.rows[0].chart[0]).toMatchObject({ session: fixture[30].session, high: 125 });
    const [header, record] = stockBaseCsv(scan, scan.rows).split("\r\n");
    const columns = header.split(",");
    const values = record.split(",");
    expect(values[columns.indexOf("breakout_failed_on")]).toBe(failed);
    expect(values[columns.indexOf("support_lost_on")]).toBe(lost);
    expect(Number(values[columns.indexOf("distance_to_invalidation_pct")])).toBeCloseTo((scan.rows[0].invalidation / 90 - 1) * 100);
    expect(Number(values[columns.indexOf("distance_to_resistance_pct")])).toBeCloseTo((scan.rows[0].resistance / 90 - 1) * 100);
    const retestIndex = fixture.findIndex(bar => bar.session === scan.rows[0].retest.session);
    expect(Number(values[columns.indexOf("latest_retest_relative_strength_pct")])).toBeCloseTo(100 * ((90 / fixture[retestIndex].close) / (103.03 / benchmark[retestIndex].close) - 1));
    expect(values[columns.indexOf("prior_peak_session")]).toBe(fixture[30].session);
    expect(values[columns.indexOf("prior_peak_price")]).toBe("125");
    expect(Number(values[columns.indexOf("prior_drawdown_pct")])).toBeCloseTo(100 * (125 - scan.rows[0].firstLow.price) / 125);
  });
  it("exports pending retest thresholds, missing strength and partial scan coverage", () => {
    const bars = fixture.slice(0, 80);
    const retest = detectPendingRetest(bars)!;
    const scan: StockBaseScan = {
      market: "us", benchmark: "S&P 500", benchmarkSession: bars.at(-1)!.session, benchmarkRevision: "a",
      generatedAt: 0, attempted: 24, evaluated: 23, excluded: 1, universe: 25, page: 0, pages: 2, rows: [], unavailable: [],
      pendingRetests: [{ ...retest, symbol: "YF:TEST", name: "=Formula", currency: "USD", chart: [] }],
    };
    const [header, record] = pendingRetestsCsv(scan).split("\r\n");
    const fields = header.split(",");
    const values = record.split(",");
    expect(values).toHaveLength(fields.length);
    const data = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
    expect(data).toMatchObject({
      name: "'=Formula", groups_loaded: "1", groups_total: "2", waiting_for: "pivot-confirmation",
      recovery_close: String(retest.recoveryLevel), recovery_operator: retest.recoveryStrict ? ">" : ">=",
      relative_strength_pct: "", retest_relative_strength_pct: "",
    });
    const peak = bars.find(bar => bar.session === data.prior_peak_session)!;
    const low = bars.find(bar => bar.session === data.first_low_date)!;
    expect(Number(data.prior_peak_price)).toBe(peak.high);
    expect(Number(data.first_low_price)).toBe(low.low);
    expect(Number(data.prior_drawdown_pct)).toBeCloseTo(100 * (peak.high - low.low) / peak.high);
  });
  it("retains the first qualifying day when another valid pivot pair scored higher that day", () => {
    const tail = [98.2, 98.2, 100.5, 98.5, 97.6, 99.8, 101.1, 103.7];
    const bars = [...fixture.slice(0, 83), ...tail.map((close, index) => {
      const time = fixture[82].time + (index + 1) * day;
      return { time, session: new Date(time).toISOString().slice(0, 10), open: close, close, low: close - .55, high: close + .55, volume: 100 };
    })];
    const market = bars.map((bar, index) => ({ ...bar, close: 100 + index * .03 }));
    const earlyBars = bars.slice(0, 90), earlyMarket = market.slice(0, 90);
    const later = detectStockBase(bars, market)!;
    const earlyWinner = detectStockBase(earlyBars, earlyMarket)!;
    const earlierMatch = detectStockBase(earlyBars, earlyMarket, later)!;
    expect(later.retest.session).toBe(bars[87].session);
    expect(earlyWinner.retest.session).toBe(later.retest.session);
    expect(earlyWinner.firstLow.session).not.toBe(later.firstLow.session);
    expect(earlyWinner.score).toBeGreaterThan(earlierMatch.score);
    expect(trackStockBase(bars, market)).toMatchObject({ firstSeen: bars[89].session, setup: later });
  });
  it("checks the requested pivot pair without substituting the highest-scoring pair", () => {
    const best = detectStockBase(fixture, benchmark)!;
    expect(detectStockBase(fixture, benchmark, best)).toEqual(best);
    expect(detectStockBase(fixture, benchmark, {
      firstLow: best.firstLow,
      retest: { ...best.retest, session: fixture[80].session },
    })).toBeNull();
  });
  it("keeps a pending retest newer than the active setup and excludes the same or an older retest", () => {
    const bars = fixture.slice(0, 80);
    const market = benchmark.slice(0, 80);
    expect(detectPendingRetest(bars, market, fixture[71].session)?.retest).toBe(fixture[79].session);
    expect(detectPendingRetest(bars, market, fixture[79].session)).toBeNull();
  });
  it("keeps a failed breakout dated to the first close below resistance after a rebound", () => {
    const last = fixture.at(-1)!;
    const extra = [100, 103].map((close, index) => {
      const time = last.time + (index + 1) * day;
      return { ...last, time, session: new Date(time).toISOString().slice(0, 10), open: close, close, low: close - 1, high: close + 1 };
    });
    const market = [...benchmark, ...extra.map(bar => ({ ...bar, close: benchmark.at(-1)!.close }))];
    expect(trackStockBase([...fixture, ...extra], market)).toMatchObject({
      status: "breakout-failed", statusSince: extra[0].session, latestClose: 103,
    });
  });
  it("does not pair two lows across a lower intermediate low inside the invalidation buffer", () => {
    const intermediate = fixture.map((bar, index) => index === 75 ? { ...bar, low: 92.3 } : bar);
    expect(detectStockBase(fixture, benchmark)?.firstLow.session).toBe(fixture[71].session);
    expect(detectStockBase(intermediate, benchmark)?.firstLow.session).not.toBe(fixture[71].session);
    expect(detectPendingRetest(intermediate.slice(0, 80))?.firstLow).not.toBe(fixture[71].session);
  });
  it("exports the chart breakout threshold and leaves it blank for a base without a breakout", () => {
    const { setup, ...progress } = trackStockBase(fixture, benchmark)!;
    const row = { ...setup, progress, symbol: "YF:TEST", name: "Example", currency: "USD", chart: [], followThrough: [] };
    const scan: StockBaseScan = {
      market: "us", benchmark: "S&P 500", benchmarkSession: setup.session, benchmarkRevision: "a",
      generatedAt: 0, attempted: 2, evaluated: 2, excluded: 0, universe: 2, page: 0, pages: 1, rows: [], unavailable: [],
    };
    const inactive = { ...row, progress: { ...progress, status: "breakout-failed" as const, latestSession: "2026-05-01", latestClose: 100 } };
    const [header, confirmed, forming, failed] = stockBaseCsv(scan, [row, { ...row, stage: "forming", breakoutEvidence: null }, inactive]).split("\r\n");
    const columns = header.split(",");
    const thresholdColumn = columns.indexOf("breakout_threshold");
    expect(thresholdColumn).toBeGreaterThanOrEqual(0);
    expect(confirmed.split(",")).toHaveLength(columns.length);
    expect(forming.split(",")).toHaveLength(columns.length);
    expect(Number(confirmed.split(",")[thresholdColumn])).toBe(setup.breakoutEvidence!.threshold);
    expect(confirmed.split(",")[columns.indexOf("status_since")]).toBe(progress.statusSince);
    const failedValues = failed.split(",");
    expect(failedValues[columns.indexOf("latest_completed_session")]).toBe("2026-05-01");
    expect(failedValues[columns.indexOf("last_qualified")]).toBe(setup.session);
    expect(Number(failedValues[columns.indexOf("latest_close")])).toBe(100);
    expect(Number(failedValues[columns.indexOf("last_qualified_close")])).toBe(setup.close);
    expect(forming.split(",")[thresholdColumn]).toBe("");
  });
  it("flags a potential second pivot only while its confirmation candles are pending", () => {
    const retest = fixture.length - 7;
    const prefix = fixture.slice(0, retest + 1);
    expect(detectPendingRetest(prefix)).toMatchObject({ retest: fixture[retest].session, sessionsNeeded: 2 });
    expect(detectPendingRetest(fixture.slice(0, retest + 2))).toMatchObject({ retest: fixture[retest].session, sessionsNeeded: 1 });
    expect(detectPendingRetest(fixture.slice(0, retest + 3))).toBeNull();
    const confirmed = detectPendingRetest(fixture.slice(0, retest + 3), benchmark.slice(0, retest + 3));
    expect(confirmed)
      .toMatchObject({ retest: fixture[retest].session, sessionsNeeded: 0, waitingFor: "recovery" });
    const latest = retest + 2;
    expect(confirmed?.strength?.sinceRetest).toBeCloseTo(
      100 * (fixture[latest].close * benchmark[retest].close / (fixture[retest].close * benchmark[latest].close) - 1),
    );
  });
  it("excludes a wide-range retest from monitoring before and after pivot confirmation", () => {
    const retest = fixture.length - 7;
    const wide = fixture.map((bar, index) => index === retest ? { ...bar, high: bar.high + 12 } : bar);
    for (const sessions of [0, 1, 2]) {
      const end = retest + sessions + 1;
      expect(detectPendingRetest(wide.slice(0, end), benchmark.slice(0, end))).toBeNull();
    }
    expect(detectStockBase(wide, benchmark)).toBeNull();
  });
  it("dates breakout evidence at the first clearance and requires an uninterrupted run", () => {
    const quiet = fixture.map((bar, i) => i === fixture.length - 2
      ? { ...bar, close: 103, high: 103.5, volume: 100 }
      : { ...bar, volume: 100 });
    expect(detectStockBase(quiet.slice(0, -1), benchmark.slice(0, -1))?.stage).toBe("reclaimed");
    const breakout = detectStockBase(quiet, benchmark)!;
    expect(breakout.breakoutEvidence).toMatchObject({ session: quiet.at(-2)!.session, confirmedOn: quiet.at(-1)!.session, confirmation: "two-closes", volumeRatio: 1, consecutiveCloses: 2 });
    expect(breakout.breakoutEvidence!.threshold).toBeGreaterThan(breakout.resistance);
    expect(breakout.breakoutEvidence!.threshold).toBeLessThan(quiet.at(-2)!.close);
    const dayOne = quiet.slice(0, -1);
    dayOne[dayOne.length - 1] = { ...dayOne.at(-1)!, volume: 150 };
    expect(detectStockBase(dayOne, benchmark.slice(0, -1))?.breakoutEvidence).toMatchObject({ session: dayOne.at(-1)!.session, confirmedOn: dayOne.at(-1)!.session, confirmation: "volume", volumeRatio: 1.5, consecutiveCloses: 1 });
    const next = { ...quiet.at(-1)!, close: 101, open: 101, low: 100, high: 102 };
    const renewed = { ...quiet.at(-1)!, time: next.time + day, session: new Date(next.time + day).toISOString().slice(0, 10) };
    expect(detectStockBase([...dayOne, next, renewed], [...benchmark, { ...benchmark.at(-1)!, session: renewed.session }])?.breakoutEvidence).toBeUndefined();
  });
  it("keeps a confirmed breakout when price closes at the original resistance", () => {
    const base = detectStockBase(fixture, benchmark)!;
    const last = fixture.at(-1)!, time = last.time + day, session = new Date(time).toISOString().slice(0, 10);
    const pullback = { ...last, time, session, low: base.resistance - .1, close: base.resistance, volume: 100 };
    const market = [...benchmark, { ...benchmark.at(-1)!, time, session }];
    const tracked = trackStockBase([...fixture, pullback], market);
    expect(tracked).toMatchObject({ status: "active", setup: { stage: "breakout", breakoutEvidence: base.breakoutEvidence } });
  });
  it("only measures follow-through at completed horizons without skipping a missing session", () => {
    const observed = fixture[74].session;
    const outcomes = stockBaseFollowThrough(fixture, benchmark, observed, 95);
    expect(outcomes.map(x => x.sessions)).toEqual([1, 5, 10]);
    expect(outcomes[1].relativeChange).toBeCloseTo((fixture[79].close / fixture[74].close / (benchmark[79].close / benchmark[74].close) - 1) * 100);
    expect(stockBaseFollowThrough(fixture, benchmark.filter((_, i) => i !== 76), observed, 95).map(x => x.sessions)).toEqual([1]);
    expect(stockBaseFollowThrough(fixture, benchmark, fixture.at(-1)!.session, 95)).toEqual([]);
    const changed = fixture.map((bar, i) => i === 76 ? { ...bar, low: 94, high: 120 } : bar);
    const breached = stockBaseFollowThrough(changed, benchmark, observed, 95);
    expect(breached[0].invalidatedOn).toBeNull();
    expect(breached[1].invalidatedOn).toBe(fixture[76].session);
    expect(breached[1].lowChange).toBeCloseTo((94 / fixture[74].close - 1) * 100);
    expect(breached[1].highChange).toBeCloseTo((120 / fixture[74].close - 1) * 100);
  });
  it("keeps batches with revised or newer benchmark data out of the same ranking", () => {
    const first: StockBaseScan = { market: "us", benchmark: "S&P 500", benchmarkSession: "2026-11-12", benchmarkRevision: "a", generatedAt: 0, attempted: 24, evaluated: 23, excluded: 1, universe: 25, page: 0, pages: 2, rows: [], unavailable: [] };
    const second = { ...first, page: 1, attempted: 1, evaluated: 1, excluded: 0 };
    expect(mergeStockBasePages(first, second)).toMatchObject({ attempted: 25, evaluated: 24, excluded: 1 });
    expect(() => mergeStockBasePages(first, { ...second, benchmarkRevision: "b" })).toThrow(/changed/);
    expect(() => mergeStockBasePages(first, { ...second, benchmarkSession: "2026-11-13" })).toThrow(/changed/);
  });
  it("orders pending retests by confirmation across groups", () => {
    const prefix = fixture.slice(0, fixture.length - 6);
    const awaiting = detectPendingRetest(prefix)!;
    const confirmed = detectPendingRetest(fixture.slice(0, prefix.length + 2), benchmark.slice(0, prefix.length + 2))!;
    const details = { name: "Example", currency: "USD", chart: [] };
    const first: StockBaseScan = {
      market: "us", benchmark: "S&P 500", benchmarkSession: "2026-11-12", benchmarkRevision: "a",
      generatedAt: 0, attempted: 24, evaluated: 24, excluded: 0, universe: 26, page: 0, pages: 2, rows: [], unavailable: [],
      pendingRetests: [{ ...awaiting, ...details, symbol: "YF:AAA" }],
    };
    const next = { ...first, page: 1, attempted: 2, evaluated: 2, pendingRetests: [
      { ...confirmed, ...details, symbol: "YF:CCC" },
      { ...awaiting, ...details, symbol: "YF:BBB" },
    ] };
    expect(mergeStockBasePages(first, next).pendingRetests?.map(row => row.symbol)).toEqual(["YF:CCC", "YF:AAA", "YF:BBB"]);
  });
  it("uses mean volume in each direction only with enough post-retest observations", () => {
    expect(detectStockBase(fixture, benchmark)?.recoveryVolume.ratio).toBeNull();
    const pullbacks = fixture.map((bar, i) => i === 81 ? { ...bar, close: 97, low: 97, volume: 50 } : i === 83 ? { ...bar, close: 98, low: 98, volume: 50 } : bar);
    const setup = detectStockBase(pullbacks, benchmark);
    expect(setup?.recoveryVolume).toEqual({ upSessions: 4, downSessions: 2, ratio: 2.35 });
  });
  it("rejects an interior gap on either side without counting shared holidays as gaps", () => {
    const without = (bars: DailyStockBar[]) => bars.filter((_, i) => i !== 74);
    expect(stockBaseCoverageIssue(without(fixture), benchmark)).toContain(fixture[74].session);
    expect(stockBaseCoverageIssue(fixture, without(benchmark))).toContain(fixture[74].session);
    expect(stockBaseCoverageIssue(without(fixture), without(benchmark))).toBeNull();
  });
  it("keeps only milestones visible at each completed prefix and dates a later support loss", () => {
    const active = trackStockBase(fixture, benchmark)!;
    expect(active.status).toBe("active");
    expect(active.milestones.at(-1)?.stage).toBe("breakout");
    for (const milestone of active.milestones) {
      const prefix = detectStockBase(fixture.filter(b => b.session <= milestone.session), benchmark.filter(b => b.session <= milestone.session));
      expect(prefix).toMatchObject({ stage: milestone.stage, score: milestone.score });
    }
    const last = fixture.at(-1)!, time = last.time + day, session = new Date(time).toISOString().slice(0, 10);
    const laterMarket = [...benchmark, { ...benchmark.at(-1)!, time, session }];
    const supportLost = trackStockBase([...fixture, { ...last, time, session, low: 88, close: 90 }], laterMarket);
    expect(supportLost).toMatchObject({ status: "support-lost", statusSince: session, latestClose: 90, setup: active.setup, milestones: active.milestones });
    const failed = { ...last, time, session, low: 99, close: 100 };
    expect(trackStockBase([...fixture, failed], laterMarket)).toMatchObject({ status: "breakout-failed", breakoutFailedOn: session });
    const nextTime = time + day;
    const nextSession = new Date(nextTime).toISOString().slice(0, 10);
    const afterLoss = trackStockBase(
      [...fixture, failed, { ...last, time: nextTime, session: nextSession, low: 88, close: 90 }],
      [...laterMarket, { ...benchmark.at(-1)!, time: nextTime, session: nextSession }],
    );
    expect(afterLoss).toMatchObject({ status: "support-lost", statusSince: nextSession, breakoutFailedOn: session, supportLostOn: nextSession });
  });
  it("detects the paired lows and breakout after the selloff", () => {
    const setup = detectStockBase(fixture, benchmark);
    expect(setup).toMatchObject({ stage: "breakout", firstLow: { session: fixture[71].session, price: 92.4 }, retest: { session: fixture[79].session, price: 95.45 }, session: fixture.at(-1)!.session });
    expect(setup!.relativeStrength).toBeGreaterThan(0.5);
    expect(setup!.invalidation).toBeLessThan(setup!.firstLow.price);
  });
  it("rejects persistent selling, unconfirmed retests and benchmark underperformance", () => {
    const falling = fixture.map((b, i) => ({ ...b, open: 150 - i, close: 150 - i, high: 151 - i, low: 149 - i }));
    expect(detectStockBase(falling, benchmark)).toBeNull();
    expect(detectStockBase(fixture.slice(0, 81), benchmark.slice(0, 81))).toBeNull();
    expect(detectStockBase(fixture, benchmark.map((b, i) => ({ ...b, close: 100 + i ** 3 / 100 })))).toBeNull();
  });
  it("rejects invalidated support and stale or missing benchmark sessions", () => {
    expect(detectStockBase(fixture.map((b, i) => i === 82 ? { ...b, low: 89 } : b), benchmark)).toBeNull();
    expect(detectStockBase(fixture, benchmark.slice(0, -1))).toBeNull();
    expect(detectStockBase(fixture, benchmark.slice(0, -18).concat(benchmark.at(-1)!))).toBeNull();
  });
  it("excludes today's local daily candle and future data across the DST transition", () => {
    const bars = [Date.UTC(2026, 2, 6, 14, 30), Date.UTC(2026, 2, 9, 13, 30), Date.UTC(2026, 2, 10, 13, 30)].map(time => ({ ...fixture[0], time }));
    expect(completedStockDays(bars, "America/New_York", Date.UTC(2026, 2, 10, 1)).map(b => b.session)).toEqual(["2026-03-06"]);
    expect(completedStockDays(bars, "America/New_York", Date.UTC(2026, 2, 10, 5)).map(b => b.session)).toEqual(["2026-03-06", "2026-03-09"]);
  });
});

it("recovers known CAPM beta and excludes returns with unmatched endpoints", () => {
  const market = fixture.map((b, i) => ({ ...b, close: 100 * Math.exp(i * .001 + Math.sin(i) * .02) }));
  const asset = market.map(b => ({ ...b, close: 100 * (b.close / 100) ** 1.5 }));
  const stats = terminalCapm(asset.filter((_, i) => i !== 30), market, 0)!;
  expect(stats.observations).toBe(asset.length - 3);
  expect(stats.beta).toBeCloseTo(1.5, 12);
  expect(stats.alpha).toBeCloseTo(0, 12);
  expect(stats.r2).toBeCloseTo(1, 12);
});
