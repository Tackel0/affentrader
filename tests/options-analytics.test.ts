import { describe, expect, it, vi } from "vitest";
import {
  blackScholesGreeks,
  computeMaxPain,
  computeOptionsAnalytics,
  optionsWallOverlays,
  resolveOptionsTarget,
  type RawOptionContract,
} from "@/lib/market/optionsAnalytics";
import {
  clearOptionsChainCache,
  optionsChainRequest,
  parseDeribitInstrument,
} from "@/lib/server/optionsChain";
import { parseTerminalCommand } from "@/lib/terminal/commands";

const NOW = Date.UTC(2026, 10, 28, 15, 0, 0);
const EXP = "2026-12-04";

function makeChain(): RawOptionContract[] {
  return [
    // Heavy Put Wall at 95, Heavy Call Wall at 105, balanced ATM at 100
    { contractSymbol: "SPY261204P00090000", optionType: "put", strike: 90, expiration: EXP, openInterest: 4000, volume: 600, impliedVolatility: 0.34, bid: 0.25, ask: 0.3, lastPrice: 0.28 },
    { contractSymbol: "SPY261204P00095000", optionType: "put", strike: 95, expiration: EXP, openInterest: 28000, volume: 5200, impliedVolatility: 0.29, bid: 0.85, ask: 0.95, lastPrice: 0.9 },
    { contractSymbol: "SPY261204P00100000", optionType: "put", strike: 100, expiration: EXP, openInterest: 9500, volume: 3100, impliedVolatility: 0.24, bid: 2.3, ask: 2.4, lastPrice: 2.35 },
    { contractSymbol: "SPY261204P00105000", optionType: "put", strike: 105, expiration: EXP, openInterest: 2100, volume: 400, impliedVolatility: 0.21, bid: 5.8, ask: 6.0, lastPrice: 5.9 },
    { contractSymbol: "SPY261204C00095000", optionType: "call", strike: 95, expiration: EXP, openInterest: 1800, volume: 300, impliedVolatility: 0.27, bid: 5.7, ask: 5.9, lastPrice: 5.8 },
    { contractSymbol: "SPY261204C00100000", optionType: "call", strike: 100, expiration: EXP, openInterest: 10000, volume: 4200, impliedVolatility: 0.23, bid: 2.4, ask: 2.5, lastPrice: 2.45 },
    { contractSymbol: "SPY261204C00105000", optionType: "call", strike: 105, expiration: EXP, openInterest: 32000, volume: 6800, impliedVolatility: 0.20, bid: 0.75, ask: 0.85, lastPrice: 0.8 },
    { contractSymbol: "SPY261204C00110000", optionType: "call", strike: 110, expiration: EXP, openInterest: 5000, volume: 12000, impliedVolatility: 0.22, bid: 0.22, ask: 0.26, lastPrice: 0.24 },
  ];
}

describe("zero-API-key options analytics engine", () => {
  it("resolves US equities, ETFs, indices, and crypto pairs while rejecting unsupported symbols", () => {
    expect(resolveOptionsTarget("YF:SPY")).toEqual({ assetClass: "equity", ticker: "SPY", display: "SPY" });
    expect(resolveOptionsTarget("IEX:NVDA")).toEqual({ assetClass: "equity", ticker: "NVDA", display: "NVDA" });
    expect(resolveOptionsTarget("YF:^GSPC")).toEqual({ assetClass: "equity", ticker: "^SPX", display: "SPX" });
    expect(resolveOptionsTarget("BTCUSDT")).toEqual({ assetClass: "crypto", ticker: "BTC", display: "BTC" });
    expect(resolveOptionsTarget("BINANCE:ETHUSDT")).toEqual({ assetClass: "crypto", ticker: "ETH", display: "ETH" });
    expect(resolveOptionsTarget("SOL-USD")).toEqual({ assetClass: "crypto", ticker: "SOL", display: "SOL" });
    expect(resolveOptionsTarget("YF:VOD.L")).toBeNull();
    expect(resolveOptionsTarget("EURUSD")).toBeNull();
  });

  it("computes accurate Black-Scholes Greeks with call-put delta parity and positive gamma", () => {
    const call = blackScholesGreeks({ spot: 100, strike: 100, timeYears: 30 / 365, iv: 0.25, rate: 0.045, type: "call" });
    const put = blackScholesGreeks({ spot: 100, strike: 100, timeYears: 30 / 365, iv: 0.25, rate: 0.045, type: "put" });
    expect(call.delta).toBeGreaterThan(0.5);
    expect(call.delta).toBeLessThan(0.56);
    expect(call.delta - put.delta).toBeCloseTo(1, 5);
    expect(call.gamma).toBeCloseTo(put.gamma, 6);
    expect(call.gamma).toBeGreaterThan(0.04);
    expect(call.vega).toBeGreaterThan(0.08);
    expect(call.theta).toBeLessThan(0);
  });

  it("identifies Put Wall, Call Wall, Max Pain, Gamma Flip, Expected Move, 25D Skew, Unusual Activity, and Chart Overlays", () => {
    const analytics = computeOptionsAnalytics({
      ticker: "SPY",
      display: "SPY",
      assetClass: "equity",
      source: "Yahoo Finance (Kein API-Key)",
      spot: 100,
      multiplier: 100,
      contracts: makeChain(),
      selectedExpiration: EXP,
      includedExpirations: [EXP],
      availableExpirations: [EXP],
      asOf: NOW,
    });

    expect(analytics.callWall?.strike).toBe(105);
    expect(analytics.callWall?.openInterest).toBe(32000);
    expect(analytics.putWall?.strike).toBe(95);
    expect(analytics.putWall?.openInterest).toBe(28000);
    expect(analytics.callVolumeWall?.strike).toBe(110);
    expect(analytics.maxPain).toBe(100);
    expect(analytics.gammaFlip).not.toBeNull();
    expect(analytics.gammaFlip!).toBeGreaterThan(95);
    expect(analytics.gammaFlip!).toBeLessThan(105);

    // Expected move from ATM straddle: 0.85 * (2.45 + 2.35) = 4.08
    expect(analytics.expectedMoveUsd).toBeCloseTo(4.08, 2);
    expect(analytics.expectedHigh).toBeCloseTo(104.08, 2);
    expect(analytics.expectedLow).toBeCloseTo(95.92, 2);

    // Put skew > 0 because OTM 95 put IV (29%) > OTM 105 call IV (20%)
    expect(analytics.skew25).not.toBeNull();
    expect(analytics.skew25!).toBeGreaterThan(0.05);

    // Unusual activity catches 110C with 12,000 vol vs 5,000 OI (2.4x)
    expect(analytics.unusual.some((u) => u.contractSymbol === "SPY261204C00110000" && u.volOiRatio >= 2.3)).toBe(true);

    // Chart overlays include Call Wall, Put Wall, Gamma Flip, Max Pain, and EM ±1σ
    const overlays = optionsWallOverlays(analytics);
    expect(overlays.map((o) => o.id)).toEqual([
      "opt-call-wall",
      "opt-put-wall",
      "opt-gamma-flip",
      "opt-max-pain",
      "opt-em-high",
      "opt-em-low",
    ]);
  });

  it("computes exact Max Pain strike on simple strike distributions", () => {
    const mp = computeMaxPain([
      { strike: 90, callOi: 100, putOi: 5000 },
      { strike: 100, callOi: 1000, putOi: 1000 },
      { strike: 110, callOi: 5000, putOi: 100 },
    ]);
    expect(mp).toBe(100);
  });

  it("parses Deribit instrument names and computes live crypto walls without any API key", async () => {
    expect(parseDeribitInstrument("BTC-26MAR27-90000-C")).toEqual({
      currency: "BTC",
      expiration: "2027-03-26",
      strike: 90000,
      optionType: "call",
    });
    expect(parseDeribitInstrument("INVALID")).toBeNull();

    clearOptionsChainCache();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        result: [
          { instrument_name: "BTC-4DEC26-85000-P", open_interest: 1200, volume: 350, mark_iv: 58, bid_price: 0.012, ask_price: 0.014, mark_price: 0.013, underlying_price: 90000 },
          { instrument_name: "BTC-4DEC26-90000-P", open_interest: 400, volume: 180, mark_iv: 54, bid_price: 0.032, ask_price: 0.035, mark_price: 0.033, underlying_price: 90000 },
          { instrument_name: "BTC-4DEC26-90000-C", open_interest: 450, volume: 220, mark_iv: 53, bid_price: 0.033, ask_price: 0.036, mark_price: 0.034, underlying_price: 90000 },
          { instrument_name: "BTC-4DEC26-95000-C", open_interest: 1500, volume: 600, mark_iv: 51, bid_price: 0.011, ask_price: 0.013, mark_price: 0.012, underlying_price: 90000 },
        ],
      }),
    });

    const data = await optionsChainRequest("BTCUSDT", "near", undefined, mockFetch as unknown as typeof fetch, NOW);
    expect(data.assetClass).toBe("crypto");
    expect(data.source).toContain("Deribit");
    expect(data.callWall?.strike).toBe(95000);
    expect(data.putWall?.strike).toBe(85000);
    expect(data.maxPain).toBe(90000);
    expect(data.expectedMoveUsd).toBeGreaterThan(1000);
  });

  it("supports OPTIONS, WALLS, GEX, and MAXPAIN terminal command aliases", () => {
    expect(parseTerminalCommand("WALLS")).toMatchObject({ view: "optionsflow" });
    expect(parseTerminalCommand("GEX")).toMatchObject({ view: "optionsflow" });
    expect(parseTerminalCommand("SPY WALLS")).toMatchObject({ view: "optionsflow", ticker: "SPY" });
    expect(parseTerminalCommand("NVDA GEX")).toMatchObject({ view: "optionsflow", ticker: "NVDA" });
    expect(parseTerminalCommand("AAPL MAXPAIN")).toMatchObject({ view: "optionsflow", ticker: "AAPL" });
  });
});
