import { describe, expect, it, vi } from "vitest";
import {
  accountStats,
  createAccount,
  placeOrder,
  positionOf,
  processPrice,
} from "@/lib/trading/broker";
import { maxSellableAt, type Lot } from "@/lib/portfolio";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import type { AlertRule } from "@/types/alerts";
import { rangeBars } from "@/lib/chart/transforms";
import { detectChartPatterns } from "@/lib/patterns/chart";
import { adx, mfi } from "@/lib/ta";
import { auditTrades } from "@/lib/strategy/audit";
import type { StrategyReport } from "@/types/strategy";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { validSubscription } from "@/lib/server/push";
import { yahooSpark } from "@/lib/server/yahoo";
import { createDebouncedStorage, createShallowPersistStorage } from "@/lib/debouncedStorage";
import { buildNoiseDataset, evaluateNextDayForecast, evaluateNoiseScenario } from "@/lib/terminal/noiseMeter";
import type { OHLCV, Tick } from "@/types/trading";

describe("deep bug fixes regression suite", () => {
  it("does not count opening fills with fees as losing trades in accountStats", () => {
    let account = createAccount({ initialBalance: 10_000, feeRate: 0.001, slippageBps: 0 });
    account = placeOrder(account, { symbol: "BTCUSDT", side: "buy", type: "market", quantity: 10 }, { BTCUSDT: 100 }, 1).account;
    const afterOpen = accountStats(account, { BTCUSDT: 100 });
    expect(afterOpen.trades).toBe(0);
    expect(afterOpen.winRate).toBeNull();

    account = placeOrder(account, { symbol: "BTCUSDT", side: "sell", type: "market", quantity: 10 }, { BTCUSDT: 120 }, 2).account;
    const afterClose = accountStats(account, { BTCUSDT: 120 });
    expect(afterClose.trades).toBe(1);
    expect(afterClose.winRate).toBe(100);
    expect(afterClose.profitFactor).toBe(Infinity);
  });

  it("enforces order-type price fields, post-fill buying power, single-order immediate matching, and clean bracket/reversal handling", () => {
    const base = createAccount({ initialBalance: 10_000, feeRate: 0.001, slippageBps: 0, leverage: 1 });
    // Unsupported price field on stop order
    const badStop = placeOrder(base, { symbol: "BTCUSDT", side: "buy", type: "stop", quantity: 1, price: 50_000, stopPrice: 95_000 }, { BTCUSDT: 90_000 }, 1);
    expect(badStop.order.status).toBe("rejected");
    expect(badStop.order.reason).toMatch(/does not support this price field/i);

    // Immediate buy stop bypasses naive stopPrice buying-power check when market is 150
    const bypass = placeOrder(base, { symbol: "BTCUSDT", side: "buy", type: "stop", quantity: 99, stopPrice: 100 }, { BTCUSDT: 150 }, 2);
    expect(bypass.order.status).toBe("rejected");
    expect(bypass.order.reason).toMatch(/executable price/i);
    expect(bypass.account.cash).toBe(10_000);
    expect(bypass.account.positions).toHaveLength(0);

    // Collateral resting order must not be matched when placing another order on the same symbol
    const resting = placeOrder(base, { symbol: "BTCUSDT", side: "buy", type: "limit", quantity: 1, price: 95 }, { BTCUSDT: 100 }, 3);
    expect(resting.order.status).toBe("working");
    const another = placeOrder(resting.account, { symbol: "BTCUSDT", side: "buy", type: "limit", quantity: 1, price: 85 }, { BTCUSDT: 90 }, 4);
    expect(another.fills).toHaveLength(0);
    expect(another.account.orders.find((o) => o.id === resting.order.id)?.status).toBe("working");

    // Reversal cancels prior reduceOnly orders and closing fill with TP/SL creates no orphaned brackets
    const zeroFee = createAccount({ initialBalance: 100_000, feeRate: 0, slippageBps: 0 });
    const long5 = placeOrder(zeroFee, { symbol: "BTCUSDT", side: "buy", type: "market", quantity: 5, takeProfit: 120, stopLoss: 80 }, { BTCUSDT: 100 }, 10).account;
    expect(long5.orders.filter((o) => o.status === "working" && o.reduceOnly)).toHaveLength(2);
    const flipped = placeOrder(long5, { symbol: "BTCUSDT", side: "sell", type: "market", quantity: 10 }, { BTCUSDT: 100 }, 11).account;
    expect(positionOf(flipped, "BTCUSDT")?.quantity).toBe(-5);
    expect(flipped.orders.filter((o) => o.status === "working" && o.reduceOnly)).toHaveLength(0);

    const flatWithBracket = placeOrder(flipped, { symbol: "BTCUSDT", side: "buy", type: "market", quantity: 5, takeProfit: 120, stopLoss: 80 }, { BTCUSDT: 100 }, 12).account;
    expect(positionOf(flatWithBracket, "BTCUSDT")).toBeUndefined();
    expect(flatWithBracket.orders.filter((o) => o.status === "working" && o.reduceOnly)).toHaveLength(0);
  });

  it("validates chronological sellable portfolio holdings for backdated sells", () => {
    const lots: Lot[] = [
      { id: "1", symbol: "BTCUSDT", side: "buy", quantity: 1, price: 90_000, fee: 0, time: Date.parse("2026-11-20") },
    ];
    expect(maxSellableAt(lots, "BTCUSDT", Date.parse("2026-11-15"))).toBe(0);
    expect(maxSellableAt(lots, "BTCUSDT", Date.parse("2026-11-20"))).toBe(1);
    expect(maxSellableAt(lots, "BTCUSDT", Date.parse("2026-11-25"))).toBe(1);
  });

  it("waits for all same-cadence symbols to close in multi-symbol bar-close composite rules", () => {
    const MINUTE = 60_000;
    const T0 = 1_700_000_100_000 - (1_700_000_100_000 % (15 * MINUTE));
    const T1 = T0 + 15 * MINUTE;
    let now = T1 + 50;
    const btcBars: OHLCV[] = [
      { time: T0 - 15 * MINUTE, open: 99_000, high: 99_500, low: 98_500, close: 99_000, volume: 10 },
      { time: T0, open: 99_000, high: 101_500, low: 99_000, close: 101_000, volume: 10 },
    ];
    const ethBars: OHLCV[] = [
      { time: T0 - 15 * MINUTE, open: 3900, high: 3950, low: 3850, close: 3900, volume: 10 },
      { time: T0, open: 3900, high: 3999, low: 3900, close: 3999, volume: 10 },
    ];
    const rule: AlertRule = {
      id: "multi-close-1",
      name: "BTC & ETH 15m close",
      kind: "technical",
      status: "active",
      scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "15m" },
      condition: {
        op: "all",
        conditions: [
          { op: "leaf", leaf: { type: "compare", symbol: "BTCUSDT", left: { type: "quote", field: "price" }, comparator: ">", right: { type: "number", value: 100_000 } } },
          { op: "leaf", leaf: { type: "compare", symbol: "ETHUSDT", left: { type: "quote", field: "price" }, comparator: ">", right: { type: "number", value: 4000 } } },
        ],
      },
      frequency: "close",
      repeat: true,
      trigger: "once_per_close",
      cooldownMs: 0,
      sound: false,
      browserNotification: false,
      serverSide: false,
      createdAt: T0 - 30 * MINUTE,
    };
    const fired: string[] = [];
    const engine = new BrowserRuleEngine({
      rules: () => [rule],
      bars: (sym) => (sym === "BTCUSDT" ? btcBars : ethBars),
      quote: () => undefined,
      ensure: async () => {},
      fire: (r) => fired.push(r.id),
      now: () => now,
    });
    // Prime on previous closed bar T0 - 15m
    now = T0 + 1000;
    engine.prime();
    // At T1 + 50ms BTC closes at 101k while ETH is still 3999 (unfinalized)
    now = T1 + 50;
    engine.onClose("BTCUSDT", "15m", T0);
    expect(fired).toHaveLength(0);
    // 70ms later ETH finalizes at 4005 and emits onClose
    ethBars[1] = { ...ethBars[1], high: 4010, close: 4005 };
    now = T1 + 120;
    engine.onClose("ETHUSDT", "15m", T0);
    expect(fired).toEqual(["multi-close-1"]);
  });

  it("emits all multi-brick rangeBars without phantom reversals on bullish marubozu", () => {
    const bricks = rangeBars([{ time: 0, open: 100, high: 130, low: 100, close: 130, volume: 1 }], 10);
    expect(bricks.map((b) => [b.open, b.close, b.up])).toEqual([
      [100, 110, true],
      [110, 120, true],
      [120, 130, true],
    ]);
  });

  it("detects ascending triangles with realistic flat-resistance noise and avoids apex-inverted false confirmation", () => {
    const candle = (i: number, open: number, high: number, low: number, close: number): OHLCV => ({
      time: i * 60_000,
      open,
      high,
      low,
      close,
      volume: 100,
    });
    const path = (waypoints: [number, number][], spread = 0.4): OHLCV[] => {
      const bars: OHLCV[] = [];
      for (let w = 0; w < waypoints.length - 1; w++) {
        const [i0, p0] = waypoints[w];
        const [i1, p1] = waypoints[w + 1];
        for (let i = i0; i < i1; i++) {
          const t = (i - i0) / (i1 - i0);
          const c = p0 + (p1 - p0) * t;
          const n = p0 + (p1 - p0) * ((i + 1 - i0) / (i1 - i0));
          bars.push(candle(i, c, Math.max(c, n) + spread, Math.min(c, n) - spread, n));
        }
      }
      const [li, lp] = waypoints.at(-1)!;
      bars.push(candle(li, lp, lp + spread, lp - spread, lp));
      return bars;
    };
    // Noisy flat highs at 110.0, 110.12, 109.94, 110.08 — previously rejected by R^2 < 0.6.
    // Ends at 110.35 (strictly below upper resistance ~110.45 and above rising support until the apex),
    // then stays flat at 110.35 far past the apex (bar 150) so apex inversion must NOT falsely confirm it.
    const asc = path([
      [0, 90], [10, 110.0], [20, 96], [30, 110.12], [40, 102], [50, 109.94], [58, 106], [66, 110.08], [67, 110.35], [150, 110.35],
    ]);
    const hits = detectChartPatterns(asc, { strength: 4, ids: ["ascending-triangle"] });
    const hit = hits.find((h) => h.id === "ascending-triangle" && h.endIndex <= 72);
    expect(hit).toBeDefined();
    expect(hit!.confirmed).toBe(false);
  });

  it("handles zero-flow MFI as neutral 50 and zero directional movement ADX as 0 instead of NaN", () => {
    const flatBars: OHLCV[] = Array.from({ length: 40 }, (_, i) => ({
      time: i * 60_000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 0,
    }));
    const mfiVals = mfi(flatBars, 14).filter(Number.isFinite);
    expect(mfiVals.length).toBeGreaterThan(0);
    expect(mfiVals.at(-1)).toBe(50);

    // Constant-range bars with zero directional movement (+DM = 0, -DM = 0, TR = 2 > 0)
    // Previously set dx = NaN, causing ADX to stay NaN forever instead of 0.
    const zeroDmBars: OHLCV[] = Array.from({ length: 50 }, (_, i) => ({
      time: i * 60_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 100,
    }));
    const adxOut = adx(zeroDmBars, 14).adx;
    expect(Number.isFinite(adxOut.at(-1)!)).toBe(true);
    expect(adxOut.at(-1)).toBe(0);
  });

  it("never verifies a same-bar exit from a sub-bar that occurred before entry in auditTrades", async () => {
    const hour = 3_600_000;
    const t0 = 1_700_000_000_000 - (1_700_000_000_000 % hour);
    const report = {
      market: { symbol: "BTCUSDT", timeframe: "1h" },
      trades: [
        {
          id: "t1",
          entryId: "L",
          exitId: "X",
          side: "long",
          quantity: 1,
          entryTime: t0,
          exitTime: t0,
          entryBar: 0,
          exitBar: 0,
          entryPrice: 100,
          exitPrice: 110,
          netProfit: 10,
          commission: 0,
          runup: 10,
          drawdown: 0,
          open: false,
          pointValue: 1,
        },
      ],
    } as unknown as StrategyReport;
    const subBars: OHLCV[] = [
      // Exit price 110 touched BEFORE entry price 100
      { time: t0 + 5 * 60_000, open: 108, high: 111, low: 107, close: 109, volume: 1 },
      // Entry price 100 touched at +15m; price never returns to 110 afterwards
      { time: t0 + 15 * 60_000, open: 102, high: 103, low: 99, close: 101, volume: 1 },
      { time: t0 + 30 * 60_000, open: 101, high: 104, low: 100, close: 103, volume: 1 },
    ];
    const summary = await auditTrades(report, async () => subBars);
    expect(summary.results[0].entryTouched).toBe(true);
    expect(summary.results[0].exitTouched).toBe(false);
    expect(summary.results[0].exitTime).toBeNull();
  });

  it("keeps FootprintHistory usable after an invalid manual step error", () => {
    const history = new FootprintHistory("1m");
    const t: Tick = { id: "1", symbol: "BTCUSDT", price: 100, quantity: 1, side: "buy", simulated: false, time: 60_000 };
    history.add([t]);
    expect(() => history.read({ step: 0, ratio: 3 })).toThrow();
    expect(history.failed).toBe(false);
    expect(history.read({ step: 1, ratio: 3 })).toHaveLength(1);
  });

  it("rejects private/loopback/credentialed Web Push endpoints against SSRF", () => {
    const keys = { p256dh: "BNcRd...", auth: "tBHIt..." };
    expect(validSubscription({ endpoint: "https://127.0.0.1:8443/internal", keys })).toBe(false);
    expect(validSubscription({ endpoint: "https://[::1]/internal", keys })).toBe(false);
    expect(validSubscription({ endpoint: "https://10.0.0.5/hook", keys })).toBe(false);
    expect(validSubscription({ endpoint: "https://user:pass@fcm.googleapis.com/fcm/send/abc", keys })).toBe(false);
    expect(validSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys })).toBe(true);
  });

  it("chunks yahooSpark beyond 20 tickers without silently dropping symbols", async () => {
    const tickers = Array.from({ length: 25 }, (_, i) => `SYM${String(i + 1).padStart(2, "0")}`);
    const seenBatches: string[][] = [];
    const fetcher: typeof fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      const syms = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean);
      seenBatches.push(syms);
      const body = Object.fromEntries(
        syms.map((symbol) => [
          symbol,
          { timestamp: [1_700_000_000], close: [100], chartPreviousClose: 99 },
        ]),
      );
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    const quotes = await yahooSpark(tickers, fetcher);
    expect(seenBatches).toHaveLength(2);
    expect(seenBatches[0]).toHaveLength(20);
    expect(seenBatches[1]).toHaveLength(5);
    expect(Object.keys(quotes)).toHaveLength(25);
    expect(quotes.SYM25?.price).toBe(100);
  });

  it("retries persistence in createShallowPersistStorage after a transient QuotaExceededError", () => {
    const backing = new Map<string, string>();
    let failWrites = true;
    const mockStorage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failWrites) throw new DOMException("QuotaExceededError", "QuotaExceededError");
        backing.set(k, v);
      },
      removeItem: (k: string) => backing.delete(k),
      clear: () => backing.clear(),
      key: () => null,
      get length() { return backing.size; },
    } as Storage;

    const debounced = createDebouncedStorage(1000, () => mockStorage);
    const persist = createShallowPersistStorage<{ symbol: string }>(debounced);
    const state = { state: { symbol: "ETHUSDT" }, version: 0 };

    persist.setItem("chart", state);
    debounced.flush();
    expect(backing.get("chart")).toBeUndefined();

    // Free space and re-submit identical state reference -> must retry and succeed
    failWrites = false;
    persist.setItem("chart", state);
    debounced.flush();
    expect(backing.get("chart")).toContain("ETHUSDT");
  });

  it("anchors NoiseMeter streak 3d/5d forward returns at streak end (including T+1) and updates fallback sequence label", () => {
    // Build synthetic daily bars with a clear 3-red-day streak ending at 100, followed by +5% on T+1 (105) then 103.95 flat
    const baseTime = Date.UTC(2024, 0, 2);
    const closes = [
      110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
      120, 121, 122, 123, 124, 125, 126, 127, 128, 129,
      120, 110, 100, // 3 red days ending at 100
      105, // T+1: +5.0%
      103.95, // T+2: +3.95% from streak end
      103.95, // T+3: +3.95% from streak end
      103.95, // T+4
      103.95, // T+5: +3.95% from streak end
      104, 104.5, 105,
    ];
    const bars = closes.map((c, idx) => {
      const time = baseTime + idx * 86_400_000;
      return {
        time,
        session: new Date(time).toISOString().slice(0, 10),
        open: c,
        high: c * 1.01,
        low: c * 0.99,
        close: c,
        volume: 1_000_000,
      };
    });
    const ds = buildNoiseDataset(bars);
    const scenario = evaluateNoiseScenario(ds, {
      gapPct: 0,
      streakDays: 3,
      streakDirection: "red",
      streakBasis: "close",
    });
    expect(scenario.streakExact.avgNextDayPct).toBeCloseTo(5.0, 2);
    expect(scenario.streakExact.fwd3dAvgPct).toBeCloseTo(3.95, 2);
    expect(scenario.streakExact.fwd5dAvgPct).toBeCloseTo(3.95, 2);

    // Trigger sequence fallback (small dataset with extreme move -> seqRows < 5 -> drops move filter)
    const forecast = evaluateNextDayForecast(ds, {
      priorStreakDays: 3,
      priorStreakDirection: "red",
      streakBasis: "close",
      todayMovePct: -15,
      useExtraFactors: false,
    });
    expect(forecast.sequenceCohort.usedFallback).toBe(true);
    expect(forecast.sequenceCohort.label).toContain("nur Serie");
    expect(forecast.sequenceCohort.label).not.toContain("−15");
  });
});
