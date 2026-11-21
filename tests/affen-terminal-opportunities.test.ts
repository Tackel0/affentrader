import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTerminalCommand } from "@/lib/terminal/commands";
import {
  computeAccumulationDistribution,
  computeObv,
  detectHighConvictionOpportunities,
  detectStructuralBottomOpportunity,
  detectValueGarpOpportunity,
  evaluateTickerOpportunities,
  mergeOpportunityGroups,
  opportunityEntryState,
  opportunityPlan,
  opportunityShareSize,
  opportunitiesToCsv,
  type FundamentalSnapshot,
} from "@/lib/screener/opportunities";
import type { DailyStockBar } from "@/lib/screener/stockBase";
import { clearOpportunityScanCache, scanTradeOpportunities } from "@/lib/server/opportunities";
import { fetchSecEdgarForm4Summary, fetchTradingViewScannerBatch, resolveFundamentalSnapshot } from "@/lib/server/fundamentals";
import { parseMeta } from "@/lib/market/yahoo";
import { GET as getOpportunities, POST as postOpportunities } from "@/app/api/terminal-opportunities/route";
import { GET as getFundamentals } from "@/app/api/terminal-fundamentals/route";

const day = 86_400_000;

function makeBars(closes: number[], volumes?: number[], spreads?: number[]): DailyStockBar[] {
  return closes.map((close, i) => {
    const time = Date.UTC(2026, 0, 1, 15) + i * day;
    const spread = spreads?.[i] ?? 1.2;
    const volume = volumes?.[i] ?? 1000;
    return {
      time,
      session: new Date(time).toISOString().slice(0, 10),
      open: close - 0.15,
      high: close + spread,
      low: close - spread,
      close,
      volume,
    };
  });
}

// Structural bottom fixture: 60 steady bars around 120, sharp selloff to 94 (idx 71), rally to 101 (idx 75),
// dry-up higher low retest at 95.5 (idx 79), reclaim above EMA20/VWAP to 102.5 (idx 85)
const structuralPrices = [
  ...Array.from({ length: 62 }, (_, i) => 120 + (i % 3) * 0.5),
  117, 114, 110, 108, 106, 103, 100, 98, 95, 94, // first low at idx 71
  96, 98, 100, 101, // automatic rally
  99.5, 98, 97, 95.5, // higher-low retest at idx 79
  97.5, 98.5, 99.5, 100.8, 102.2, 103.0,
];
const structuralVolumes = structuralPrices.map((_, i) => {
  if (i >= 68 && i <= 72) return 2200; // heavy climax volume
  if (i >= 78 && i <= 80) return 900; // volume dry-up on retest
  if (i >= 81) return 1800; // expanding buy volume on impulse
  return 1200;
});
const structuralBars = makeBars(structuralPrices, structuralVolumes);
const benchmarkBars = structuralBars.map((b, i) => ({
  ...b,
  close: 100 - i * 0.04, // slightly weak benchmark so RS stands out
  open: 100 - i * 0.04,
  high: 101 - i * 0.04,
  low: 99 - i * 0.04,
}));

describe("AffenTerminal command bar parser", () => {
  it("parses core workspace navigation commands and <GO> suffixes", () => {
    expect(parseTerminalCommand("OPPS")).toEqual({ kind: "view", view: "opps" });
    expect(parseTerminalCommand("OPPS <GO>")).toEqual({ kind: "view", view: "opps" });
    expect(parseTerminalCommand("SCAN")).toEqual({ kind: "view", view: "scan" });
    expect(parseTerminalCommand("VALUE", "QCOM")).toEqual({ kind: "view", view: "fa", ticker: "QCOM" });
    expect(parseTerminalCommand("FA", "ADBE")).toEqual({ kind: "view", view: "fa", ticker: "ADBE" });
    expect(parseTerminalCommand("FLOW")).toEqual({ kind: "flow" });
    expect(parseTerminalCommand("CHART", "MSFT")).toEqual({ kind: "chart", ticker: "MSFT" });
    expect(parseTerminalCommand("MACRO")).toEqual({ kind: "view", view: "macro" });
    expect(parseTerminalCommand("NEWS")).toEqual({ kind: "view", view: "news" });
    expect(parseTerminalCommand("MARKETS")).toEqual({ kind: "view", view: "markets" });
    expect(parseTerminalCommand("COMPARE")).toEqual({ kind: "view", view: "compare" });
    expect(parseTerminalCommand("HEATMAP")).toEqual({ kind: "view", view: "heatmap" });
    expect(parseTerminalCommand("HELP")).toEqual({ kind: "view", view: "help" });
  });

  it("parses ticker-specific Bloomberg commands (<TICKER> <GO>, GP, FA, VALUE, FLOW, CAPM)", () => {
    expect(parseTerminalCommand("AAPL <GO>")).toEqual({ kind: "chart", ticker: "AAPL" });
    expect(parseTerminalCommand("NVDA GP")).toEqual({ kind: "chart", ticker: "NVDA" });
    expect(parseTerminalCommand("QCOM FA")).toEqual({ kind: "view", view: "fa", ticker: "QCOM" });
    expect(parseTerminalCommand("SAP.DE VALUE")).toEqual({ kind: "view", view: "fa", ticker: "SAP.DE" });
    expect(parseTerminalCommand("FA UNH")).toEqual({ kind: "view", view: "fa", ticker: "UNH" });
    expect(parseTerminalCommand("AAPL CAPM")).toEqual({ kind: "capm", ticker: "AAPL" });
    expect(parseTerminalCommand("TSLA FLOW")).toEqual({ kind: "flow", ticker: "TSLA" });
  });

  it("rejects empty or invalid multi-token commands cleanly", () => {
    expect(parseTerminalCommand("   ")).toEqual({ kind: "unknown", raw: "   " });
    expect(parseTerminalCommand("INVALID COMMAND EXTRA")).toEqual({ kind: "unknown", raw: "INVALID COMMAND EXTRA" });
    expect(parseTerminalCommand("$$$ FA")).toEqual({ kind: "unknown", raw: "$$$ FA" });
  });
});

describe("Multi-Strategy Trade-Möglichkeiten Engine", () => {
  it("sizes whole shares against the actual limit and refuses invalid setup levels", () => {
    const levels = { lastClose: 0.425, entryZone: [0.4220, 0.4224] as [number, number],
      invalidation: 0.4, target1: 0.55, target2: 0.6, riskReward: 4 };
    const plan = opportunityPlan(levels)!;
    expect(plan.entry).toBe(0.4222);
    expect(opportunityEntryState(levels)).toBe("above");
    expect(opportunityEntryState({ ...levels, lastClose: 0.4224 })).toBe("zone");
    expect(opportunityEntryState({ ...levels, lastClose: 0.55 })).toBe("target");
    expect(opportunityEntryState({ ...levels, lastClose: 0.4 })).toBe("invalid");
    expect(opportunityPlan({ ...levels, invalidation: 0.43 })).toBeNull();
    expect(opportunityShareSize(plan, 1)?.quantity).toBe(45);
    expect(opportunityShareSize(plan, 0.01)).toBeNull();
    expect(opportunityShareSize(plan, Infinity)).toBeNull();
  });

  it("keeps scan totals and rejects pages from a revised benchmark", () => {
    const first = { market: "us", benchmark: "S&P 500", benchmarkSession: "2026-11-20", benchmarkRevision: "a",
      generatedAt: 1000, page: 0, pages: 2, universe: 24, totalUniverse: 31, evaluated: 23, excluded: 1,
      dataSources: ["Yahoo"], opportunities: [], unavailable: [] };
    const next = { ...first, generatedAt: 2000, page: 1, universe: 7, evaluated: 6, excluded: 0,
      dataSources: ["Yahoo", "SEC"], unavailable: [{ symbol: "YF:AAPL", reason: "Missing day." }] };
    expect(mergeOpportunityGroups(first, next)).toMatchObject({ page: 1, evaluated: 29, universe: 31,
      generatedAt: 1000, dataSources: ["Yahoo", "SEC"], excluded: 1, unavailable: next.unavailable });
    expect(() => mergeOpportunityGroups(first, { ...next, benchmarkRevision: "b" })).toThrow(/Marktdaten/);
    expect(() => mergeOpportunityGroups(first, { ...next, page: 0 })).toThrow(/Marktdaten/);
  });

  const meta = {
    symbol: "YF:QCOM",
    ticker: "QCOM",
    name: "QUALCOMM Incorporated",
    market: "us",
    sector: "Semiconductors",
    currency: "USD",
  };

  it("computes OBV and Accumulation/Distribution (A/D) series accurately", () => {
    const obv = computeObv(structuralBars);
    const ad = computeAccumulationDistribution(structuralBars);
    expect(obv).toHaveLength(structuralBars.length);
    expect(ad).toHaveLength(structuralBars.length);
    expect(Number.isFinite(obv.at(-1))).toBe(true);
    expect(Number.isFinite(ad.at(-1))).toBe(true);
  });

  it("Category A: detects structural bottom (HL/BoS/Wyckoff) with volume dry-up and relative strength", () => {
    const opp = detectStructuralBottomOpportunity(structuralBars, benchmarkBars, meta);
    expect(opp).not.toBeNull();
    expect(opp!.category).toBe("structural-bottom");
    expect(["bos-hl-reclaim", "wyckoff-spring", "double-bottom"]).toContain(opp!.subType);
    expect(opp!.score).toBeGreaterThanOrEqual(55);
    expect(opp!.score).toBeLessThanOrEqual(100);
    expect(opp!.levels.invalidation).toBeLessThan(opp!.levels.entryZone[0]);
    expect(opp!.levels.target1).toBeGreaterThan(opp!.levels.entryZone[1]);
    expect(opp!.levels.target2).toBeGreaterThan(opp!.levels.target1);
    expect(opp!.levels.riskReward).toBeGreaterThan(1);
    expect(opp!.technicals.volumeDryUpRatio).toBeLessThan(0.95);
    expect(opp!.technicals.relativeStrengthPct).toBeGreaterThan(0);
    expect(opp!.whySetup.length).toBeGreaterThanOrEqual(3);
  });

  it("Category A: rejects a cheap RSI < 30 falling knife without structural base or reclaim", () => {
    const fallingCloses = Array.from({ length: 85 }, (_, i) => 200 - i * 1.4);
    const fallingBars = makeBars(fallingCloses);
    const opp = detectStructuralBottomOpportunity(fallingBars, benchmarkBars, meta);
    expect(opp).toBeNull();
  });

  it("distinguishes a local swing break from resistance that still holds", () => {
    const bars = structuralBars.map((bar, index) => index === 74 ? { ...bar, high: 104 } : bar);
    const setup = detectStructuralBottomOpportunity(bars, benchmarkBars, meta);
    expect(setup?.whySetup).toContain("Schlusskurs unter dem Zwischenhoch (104.00 USD) und über dem lokalen Swing-Hoch (102.20 USD).");
  });

  it("does not pair two lows across a lower intermediate candle inside the invalidation buffer", () => {
    const baseline = detectStructuralBottomOpportunity(structuralBars, benchmarkBars, meta);
    expect(baseline?.structure).toMatchObject({ firstLow: { session: structuralBars[71].session }, retest: { session: structuralBars[79].session } });
    const bars = structuralBars.map((bar, index) => index === 76 ? { ...bar, low: structuralBars[71].low - .1 } : bar);
    const result = detectStructuralBottomOpportunity(bars, benchmarkBars, meta);
    expect(result?.structure).not.toMatchObject({ firstLow: { session: bars[71].session }, retest: { session: bars[79].session } });
  });

  it("Category B: detects undervalued quality Value & GARP stocks and rejects overleveraged value traps", () => {
    const qualityFundamentals: FundamentalSnapshot = {
      ticker: "QCOM",
      name: "QUALCOMM Incorporated",
      sector: "Semiconductors",
      currency: "USD",
      marketCapBn: 188,
      forwardPe: 14.8,
      sectorMedianPe: 30.0,
      evToEbitda: 11.6,
      sectorMedianEvEbitda: 21.5,
      priceToFcf: 16.4,
      fcfYieldPct: 6.1,
      pegRatio: 0.98,
      netDebtToEbitda: 0.35,
      operatingMarginPct: 27.4,
      netMarginPct: 23.8,
      roePct: 38.2,
      epsRevisionPct: 3.1,
      revenueGrowthPct: 11.4,
      analystTarget: 135,
      fairValue: 140,
      insiderBuys90d: 2,
      insiderNetValueUsd: 640_000,
      recentInsiderFilings: [],
      earningsSurprisePct: 6.9,
      lastEarningsDate: "2026-02-04",
      source: "curated-baseline",
    };

    const valueOpp = detectValueGarpOpportunity(structuralBars, benchmarkBars, meta, qualityFundamentals);
    expect(valueOpp).not.toBeNull();
    expect(valueOpp!.category).toBe("value-garp");
    expect(valueOpp!.subType).toBe("value-garp");
    expect(valueOpp!.score).toBeGreaterThanOrEqual(65);
    expect(valueOpp!.whySetup.some(line => line.includes("Forward-KGV"))).toBe(true);

    // Reject if Net Debt / EBITDA is excessive (> 2.6)
    const leveredTrap: FundamentalSnapshot = { ...qualityFundamentals, netDebtToEbitda: 4.2 };
    expect(detectValueGarpOpportunity(structuralBars, benchmarkBars, meta, leveredTrap)).toBeNull();
  });

  it("Category C: detects VCP Squeeze, Insider Cluster, and Post-Earnings-Drift (PEAD)", () => {
    // 1. VCP & Bollinger Squeeze series: progressively tighter waves near 40d high with low volume
    const vcpCloses = [
      ...Array.from({ length: 46 }, (_, i) => 95 + Math.sin(i / 2) * 6),
      ...Array.from({ length: 15 }, (_, i) => 102 + Math.sin(i / 2) * 3),
      ...Array.from({ length: 15 }, (_, i) => 104 + Math.sin(i / 2) * 1.2),
      ...Array.from({ length: 10 }, (_, i) => 105 + (i % 2) * 0.25),
    ];
    const vcpVolumes = vcpCloses.map((_, i) => (i >= 76 ? 550 : 1200));
    const vcpSpreads = vcpCloses.map((_, i) => (i < 46 ? 2.5 : i < 61 ? 1.4 : i < 76 ? 0.8 : 0.35));
    const vcpBars = makeBars(vcpCloses, vcpVolumes, vcpSpreads);

    const vcpOpps = detectHighConvictionOpportunities(vcpBars, benchmarkBars, meta, null);
    expect(vcpOpps.some(o => o.subType === "vcp-squeeze")).toBe(true);

    // 2. Insider Cluster + Earnings Gap & Drift
    const peadCloses = [
      ...Array.from({ length: 75 }, () => 100),
      106.5, // Earnings gap +6.5% at idx 75
      106.0, 105.8, 106.2, 106.4, 106.8, // Orderly flag holding above gap support & anchored VWAP
    ];
    const peadVolumes = peadCloses.map((_, i) => (i === 75 ? 3800 : i > 75 ? 1100 : 1000));
    const peadBars = makeBars(peadCloses, peadVolumes, peadCloses.map(() => 0.8));
    peadBars[75].open = 104.5; // +4.5% gap open, +6.5% close
    const peadBench = peadBars.map(b => ({ ...b, close: 100, open: 100, high: 101, low: 99 }));

    const insiderFundamentals = resolveFundamentalSnapshot("ADBE", 106.8, "USD", "Adobe Inc.");
    const catCOpps = detectHighConvictionOpportunities(peadBars, peadBench, meta, insiderFundamentals);
    expect(catCOpps.some(o => o.subType === "insider-cluster")).toBe(true);
    expect(catCOpps.some(o => o.subType === "earnings-drift")).toBe(true);
  });

  it("exports opportunities to CSV and escapes formula-injection strings", () => {
    const opps = evaluateTickerOpportunities(
      structuralBars,
      benchmarkBars,
      { ...meta, name: "=CMD|' /C calc'!A0" },
      resolveFundamentalSnapshot("QCOM", 103, "USD", "=CMD|' /C calc'!A0"),
    );
    expect(opps.length).toBeGreaterThan(0);
    for (const { levels } of opps) {
      const midpoint = (levels.entryZone[0] + levels.entryZone[1]) / 2;
      expect(levels.riskReward).toBeGreaterThan(0);
      expect(levels.riskReward).toBeCloseTo((levels.target1 - midpoint) / (midpoint - levels.invalidation), 12);
    }
    const csv = opportunitiesToCsv(opps);
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(opps.length + 1);
    expect(lines[0]).toContain("symbol,ticker,name,market,sector,category,subtype");
    expect(lines[1]).toContain("'=CMD");
    expect(lines[0]).toContain("first_low_session,first_low_price,retest_session,retest_low_price,neckline,local_swing_high");
    const structure = opps.find(row => row.category === "structural-bottom")!.structure!;
    expect(csv).toContain(`,${structure.firstLow.session},${structure.firstLow.price},${structure.retest.session},${structure.retest.price},${structure.neckline},${structure.localSwingHigh},`);
  });

  it("rejects zero-volume holiday placeholder bars, stale sessions, and unadjusted stock splits", () => {
    // 1. Zero-volume placeholder bar in recent history
    const zeroVolBars = structuralBars.map((b, i) => (i === structuralBars.length - 4 ? { ...b, volume: 0 } : b));
    expect(detectStructuralBottomOpportunity(zeroVolBars, benchmarkBars, meta)).toBeNull();
    expect(detectHighConvictionOpportunities(zeroVolBars, benchmarkBars, meta)).toEqual([]);

    // 2. Stale stock session not matching benchmark's latest completed session
    const staleStockBars = structuralBars.slice(0, -1);
    expect(detectStructuralBottomOpportunity(staleStockBars, benchmarkBars, meta)).toBeNull();

    // 3. Unadjusted 10-for-1 forward split (single-day -90% drop from 1000 to 100)
    const forwardSplitBars = structuralBars.map((b, i) =>
      i < 65 ? { ...b, open: b.open * 10, high: b.high * 10, low: b.low * 10, close: b.close * 10 } : b,
    );
    expect(detectStructuralBottomOpportunity(forwardSplitBars, benchmarkBars, meta)).toBeNull();

    // 4. Unadjusted 1-for-10 reverse split (single-day +900% jump) must not trigger PEAD earnings-drift
    const reverseSplitCloses = [
      ...Array.from({ length: 75 }, () => 10),
      100, // 1:10 reverse split jump
      100.5, 100.2, 100.8, 101.0, 101.2,
    ];
    const reverseSplitVolumes = reverseSplitCloses.map((_, i) => (i === 75 ? 4000 : 1000));
    const reverseSplitBars = makeBars(reverseSplitCloses, reverseSplitVolumes, reverseSplitCloses.map(() => 0.4));
    const reverseBench = reverseSplitBars.map(b => ({ ...b, close: 100, open: 100, high: 101, low: 99 }));
    expect(detectHighConvictionOpportunities(reverseSplitBars, reverseBench, meta)).toEqual([]);
  });
});

describe("Public Screener & Fundamental Server Integrations", () => {
  afterEach(() => {
    clearOpportunityScanCache();
  });

  it("parses TradingView Public Scanner and SEC EDGAR Form 4 responses and merges them cleanly", async () => {
    const mockFetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("scanner.tradingview.com")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                s: "NASDAQ:QCOM",
                d: ["QCOM", "QUALCOMM Inc", "Electronic Technology", "USD", 170, 190e9, 15.1, 0.95, 11.2, 16.0, 0.3, 28.1, 24.0, 37.5, 12.1, 218],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("data.sec.gov/submissions")) {
        return new Response(
          JSON.stringify({
            filings: {
              recent: {
                form: ["4", "10-Q", "4"],
                filingDate: ["2026-02-10", "2026-02-01", "2026-01-25"],
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    const tvMap = await fetchTradingViewScannerBatch("us", ["QCOM"], mockFetch);
    expect(tvMap.get("QCOM")?.forwardPe).toBe(15.1);

    const sec = await fetchSecEdgarForm4Summary("QCOM", mockFetch, Date.UTC(2026, 2, 1));
    expect(sec?.count).toBe(2);

    const snapshot = resolveFundamentalSnapshot("QCOM", 170, "USD", "QUALCOMM", tvMap.get("QCOM"), sec);
    expect(snapshot.source).toBe("tradingview+sec+yahoo");
    expect(snapshot.forwardPe).toBe(15.1);
    expect(snapshot.insiderBuys90d).toBeGreaterThanOrEqual(2);
  });

  it("normalizes UK LSE minor-unit (GBp / GBX) vs major-unit (GBP) price targets and preserves live targets", () => {
    // Yahoo quotes BP.L in pence (450 GBp) while TradingView returns target in GBP (5.40 GBP = 540 GBp)
    const bpSnapshot = resolveFundamentalSnapshot(
      "BP.L",
      450,
      "GBp",
      "BP p.l.c.",
      {
        ticker: "BP.L",
        name: "BP p.l.c.",
        sector: "Energy",
        currency: "GBP",
        forwardPe: 8.2,
        evToEbitda: 4.4,
        fcfYieldPct: 10.5,
        netDebtToEbitda: 0.8,
        operatingMarginPct: 14.0,
        analystTarget: 5.4,
      },
      null,
    );
    expect(bpSnapshot.currency).toBe("GBp");
    expect(bpSnapshot.analystTarget).toBe(540);

    // Baseline SHEL.L quoted in GBP (26.50 GBP) converts its 3250 GBp baseline target to 32.50 GBP
    const shelGbp = resolveFundamentalSnapshot("SHEL.L", 26.5, "GBP", "Shell plc");
    expect(shelGbp.currency).toBe("GBP");
    expect(shelGbp.analystTarget).toBe(32.5);
    expect(shelGbp.fairValue).toBe(33.2);

    // Live TradingView target below 0.7 * latestClose must NOT be overwritten by 1.18 * latestClose
    const overvaluedQcom = resolveFundamentalSnapshot(
      "QCOM",
      200,
      "USD",
      "QUALCOMM",
      { forwardPe: 28, analystTarget: 120, currency: "USD" },
      null,
    );
    expect(overvaluedQcom.analystTarget).toBe(120);
  });

  it("aborts the active watchlist fetch and skips queued symbols", async () => {
    const controller = new AbortController();
    const loaded: string[] = [];
    let quoteAborted = false;
    const now = structuralBars.at(-1)!.time + day;
    const scan = scanTradeOpportunities("xetra", 0, now, async ({ ticker }, fetcher = fetch) => {
      loaded.push(ticker);
      if (ticker !== "^GDAXI") {
        await fetcher("https://example.test/quotes");
        throw new Error("The quote request should have been aborted");
      }
      return {
        meta: parseMeta({ symbol: ticker, currency: "EUR", exchangeTimezoneName: "Europe/Berlin", instrumentType: "INDEX" }),
        bars: benchmarkBars, adjClose: benchmarkBars.map(bar => bar.close), events: { dividends: [], splits: [] },
      };
    }, ["SAP.DE", "BAS.DE", "SIE.DE", "BAYN.DE", "BMW.DE", "VOW3.DE"], async (input, init) => {
      if (String(input) !== "https://example.test/quotes") return new Response("{}", { status: 404 });
      controller.abort();
      quoteAborted = init?.signal?.aborted === true;
      init?.signal?.throwIfAborted();
      throw new Error("Active request did not receive the abort signal");
    }, controller.signal);
    await expect(scan).rejects.toMatchObject({ name: "AbortError" });
    expect(quoteAborted).toBe(true);
    expect(loaded).toEqual(["^GDAXI", "SAP.DE"]);
  });

  it("scans trade opportunities across a watchlist batch and validates API route inputs", async () => {
    const now = structuralBars.at(-1)!.time + day;
    const scan = await scanTradeOpportunities(
      "us",
      0,
      now,
      async ({ ticker }) => {
        const bars = ticker === "^GSPC" ? benchmarkBars : ticker === "STALE" ? structuralBars.slice(0, -1)
          : ticker === "GAP" ? structuralBars.filter((_, index) => index !== structuralBars.length - 4) : structuralBars;
        return {
          meta: parseMeta({
            symbol: ticker,
            currency: "USD",
            exchangeTimezoneName: "America/New_York",
            instrumentType: ticker === "^GSPC" ? "INDEX" : ticker === "SPY" ? "ETF" : "EQUITY",
          }),
          bars,
          adjClose: bars.map(b => b.close),
          events: { dividends: [], splits: [] },
        };
      },
      ["QCOM", "STALE", "SPY", "GAP"],
      vi.fn(async () => new Response("{}", { status: 404 })) as unknown as typeof fetch,
    );

    expect(scan.evaluated).toBe(1);
    expect(scan.excluded).toBe(1);
    expect(scan.unavailable).toEqual([
      { symbol: "YF:GAP", reason: `Stock candle missing for benchmark session ${structuralBars.at(-4)!.session}.` },
      { symbol: "YF:STALE", reason: "Latest completed session differs from benchmark." },
    ]);
    expect(scan.opportunities.length).toBeGreaterThanOrEqual(1);
    expect(scan.opportunities[0].ticker).toBe("QCOM");
    const [header, record] = opportunitiesToCsv(scan.opportunities, scan).split("\r\n");
    expect(header).toContain("benchmark,benchmark_session,scan_group,scan_groups,group_evaluated,group_symbols,group_unavailable,group_excluded");
    expect(record.endsWith(`,S&P 500,${scan.benchmarkSession},1,1,1,4,2,1`)).toBe(true);

    // Verify API validation for invalid market & invalid ticker
    const badMarketRes = await getOpportunities(new Request("http://localhost/api/terminal-opportunities?market=mars"));
    expect(badMarketRes.status).toBe(400);

    const badPostRes = await postOpportunities(
      new Request("http://localhost/api/terminal-opportunities", {
        method: "POST",
        body: JSON.stringify({ market: "us", tickers: [] }),
      }),
    );
    expect(badPostRes.status).toBe(400);

    const badFaRes = await getFundamentals(new Request("http://localhost/api/terminal-fundamentals?ticker=$$$"));
    expect(badFaRes.status).toBe(400);
  });
});
