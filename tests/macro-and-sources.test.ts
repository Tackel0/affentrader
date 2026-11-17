import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMacroPulseCache,
  fetchGlobalMacroPulse,
  fetchTrueHistoricalMedianPe,
  parseFearGreedPayload,
  parseFredCsv,
  parseNasdaqAnalystRatings,
} from "@/lib/server/macroAndSentimentSources";

describe("Macro, sentiment, Nasdaq analyst & true historical XBRL P/E sources", () => {
  beforeEach(() => {
    clearMacroPulseCache();
  });

  it("parses FRED CSV time series while skipping missing '.' observations", () => {
    const csv = [
      "DATE,T10Y2Y",
      "2026-03-01,0.22",
      "2026-03-02,.",
      "2026-03-03,0.34",
    ].join("\n");

    const point = parseFredCsv(csv, "T10Y2Y", "US 10Y-2Y Spread", "%");
    expect(point).toEqual({
      id: "T10Y2Y",
      label: "US 10Y-2Y Spread",
      unit: "%",
      date: "2026-03-03",
      value: 0.34,
      prevValue: 0.22,
      change: 0.12,
    });
    expect(parseFredCsv("DATE,VIXCLS\n2026-03-01,.", "VIXCLS", "VIX", "pts")).toBeNull();
  });

  it("parses Alternative.me Crypto Fear & Greed JSON entries", () => {
    const entries = parseFearGreedPayload({
      data: [
        { value: "28", value_classification: "Fear", timestamp: "1770000000" },
        { value: "42", value_classification: "Neutral", timestamp: "1769913600" },
        { value: "invalid", value_classification: "Fear" },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      value: 28,
      classification: "Fear",
      timestamp: 1770000000 * 1000,
    });
    expect(parseFearGreedPayload(null)).toEqual([]);
  });

  it("parses Nasdaq public analyst ratings and consensus price targets", () => {
    const summary = parseNasdaqAnalystRatings(
      "nvda",
      {
        data: {
          consensusRecommendation: "Strong Buy",
          ratingsSummary: { strongBuy: "22", buy: 12, hold: 4, sell: 1, strongSell: 0 },
        },
      },
      {
        data: {
          meanTargetPrice: "$175.50",
          highTargetPrice: "$220.00",
          lowTargetPrice: "$130.00",
        },
      },
    );

    expect(summary).toEqual({
      ticker: "NVDA",
      consensus: {
        ratingLabel: "Strong Buy",
        buy: 34,
        hold: 4,
        sell: 1,
        analystCount: 39,
        targetLow: 130,
        targetMean: 175.5,
        targetHigh: 220,
      },
      targetMean: 175.5,
      targetHigh: 220,
      targetLow: 130,
    });

    const matrixSummary = parseNasdaqAnalystRatings("msft", {
      data: {
        brokerRecommendations: {
          rows: [
            { recommendation: "Strong Buy", current: 10 },
            { recommendation: "Buy", current: 8 },
            { recommendation: "Hold", current: 2 },
            { recommendation: "Sell", current: 0 },
          ],
        },
      },
    });
    expect(matrixSummary?.consensus?.ratingLabel).toBe("Strong Buy");
    expect(matrixSummary?.consensus?.analystCount).toBe(20);
  });

  it("computes genuine multi-year historical P/E median from SEC XBRL 10-K EPS and Yahoo monthly closes", async () => {
    const mockFetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("data.sec.gov/api/xbrl/companyfacts")) {
        return new Response(
          JSON.stringify({
            facts: {
              "us-gaap": {
                EarningsPerShareDiluted: {
                  units: {
                    "USD/shares": [
                      { form: "10-K", end: "2022-12-31", val: 5.0 },
                      { form: "10-K", end: "2023-12-31", val: 6.0 },
                      { form: "10-K", end: "2024-12-31", val: 8.0 },
                    ],
                  },
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("query1.finance.yahoo.com")) {
        const ts2022 = Math.floor(Date.parse("2022-12-31T00:00:00Z") / 1000);
        const ts2023 = Math.floor(Date.parse("2023-12-31T00:00:00Z") / 1000);
        const ts2024 = Math.floor(Date.parse("2024-12-31T00:00:00Z") / 1000);
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: { symbol: "TEST", regularMarketPrice: 120 },
                  timestamp: [ts2022, ts2023, ts2024],
                  indicators: {
                    quote: [
                      {
                        open: [100, 145, 195],
                        high: [105, 155, 205],
                        low: [95, 140, 190],
                        close: [100, 150, 200], // P/Es = 20.0, 25.0, 25.0 -> median = 25.0
                        volume: [1e6, 1e6, 1e6],
                      },
                    ],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    };

    const res = await fetchTrueHistoricalMedianPe("TEST", "0000320193", 120, 20, mockFetcher);
    expect(res).toEqual({
      historicalMedianPe: 25.0,
      peVsHistoryPct: -20.0,
    });
  });

  it("returns null from fetchTrueHistoricalMedianPe when Yahoo historical closes fail or are >45 days out of range (no currentPrice fallback)", async () => {
    const xbrlBody = JSON.stringify({
      facts: {
        "us-gaap": {
          EarningsPerShareDiluted: {
            units: {
              "USD/shares": [
                { form: "10-K", end: "2022-12-31", val: 5.0 },
                { form: "10-K", end: "2023-12-31", val: 6.0 },
                { form: "10-K", end: "2024-12-31", val: 8.0 },
              ],
            },
          },
        },
      },
    });

    const missingHistoryFetcher: typeof fetch = async (input) => {
      if (String(input).includes("data.sec.gov/api/xbrl/companyfacts")) {
        return new Response(xbrlBody, { status: 200 });
      }
      return new Response("", { status: 500 });
    };
    const resMissing = await fetchTrueHistoricalMedianPe("TESTNOPRICE", "0000320193", 250, 20, missingHistoryFetcher);
    expect(resMissing).toBeNull();

    const staleHistoryFetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("data.sec.gov/api/xbrl/companyfacts")) {
        return new Response(xbrlBody, { status: 200 });
      }
      if (url.includes("query1.finance.yahoo.com")) {
        const tsStale = Math.floor(Date.parse("2026-01-15T00:00:00Z") / 1000);
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: { symbol: "TESTSTALE", regularMarketPrice: 250 },
                  timestamp: [tsStale],
                  indicators: { quote: [{ open: [240], high: [255], low: [235], close: [250], volume: [1e6] }] },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    };
    const resStale = await fetchTrueHistoricalMedianPe("TESTSTALE", "0000320193", 250, 20, staleHistoryFetcher);
    expect(resStale).toBeNull();
  });

  it("aggregates GlobalMacroPulse across FRED CSVs, Fear & Greed, and cross-asset quotes", async () => {
    const mockFetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("fredgraph.csv?id=FEDFUNDS")) {
        return new Response("DATE,FEDFUNDS\n2026-02-01,4.33\n2026-03-01,4.25\n", { status: 200 });
      }
      if (url.includes("fredgraph.csv")) {
        return new Response("DATE,VAL\n2026-03-01,18.5\n", { status: 200 });
      }
      if (url.includes("alternative.me/fng")) {
        return new Response(
          JSON.stringify({ data: [{ value: "64", value_classification: "Greed", timestamp: "1770000000" }] }),
          { status: 200 },
        );
      }
      if (url.includes("query1.finance.yahoo.com")) {
        const nowSec = Math.floor(Date.now() / 1000);
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: { symbol: "^GSPC", regularMarketPrice: 5900, previousClose: 5850 },
                  timestamp: [nowSec - 86_400, nowSec],
                  indicators: {
                    quote: [{ open: [5840, 5860], high: [5870, 5910], low: [5820, 5855], close: [5850, 5900], volume: [1e8, 1e8] }],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    };

    const pulse = await fetchGlobalMacroPulse(mockFetcher);
    expect(pulse.fred.length).toBe(5);
    expect(pulse.fred.find((f) => f.id === "FEDFUNDS")?.value).toBe(4.25);
    expect(pulse.fearGreed?.value).toBe(64);
    expect(pulse.crossAssets.length).toBeGreaterThanOrEqual(5);
  });

  it("parses live Nasdaq consensusOverview + meanRatingType schema", () => {
    const parsed = parseNasdaqAnalystRatings(
      "AAPL",
      {
        data: {
          meanRatingType: "Hold",
          ratingsSummary: "Based on 30 analysts offering 12-month price targets",
          brokerRecommendations: null,
        },
      },
      {
        data: {
          consensusOverview: {
            lowPriceTarget: 261,
            highPriceTarget: 425,
            priceTarget: 345.57,
            buy: 16,
            hold: 8,
            sell: 6,
          },
        },
      },
    );

    expect(parsed).toEqual({
      ticker: "AAPL",
      targetMean: 345.57,
      targetHigh: 425,
      targetLow: 261,
      consensus: {
        ratingLabel: "Hold",
        buy: 16,
        hold: 8,
        sell: 6,
        analystCount: 30,
        targetMean: 345.57,
        targetHigh: 425,
        targetLow: 261,
      },
    });
  });

  it("rejects quarterly 10-K sub-periods and pre-split EPS filings in fetchTrueHistoricalMedianPe", async () => {
    const mockFetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json")) {
        return new Response(
          JSON.stringify({
            facts: {
              "us-gaap": {
                EarningsPerShareDiluted: {
                  units: {
                    "USD/shares": [
                      // Pre-split 2022 10-K (filed 2022-03-18) vs split-restated 2022 EPS in 2024 10-K (filed 2025-02-26)
                      { form: "10-K", fp: "FY", start: "2021-02-01", end: "2022-01-30", filed: "2022-03-18", val: 3.85 },
                      { form: "10-K", fp: "FY", start: "2022-01-31", end: "2023-01-29", filed: "2023-02-24", val: 1.74 },
                      { form: "10-K", fp: "FY", start: "2023-01-30", end: "2024-01-28", filed: "2025-02-26", val: 1.19 },
                      { form: "10-K", fp: "FY", start: "2024-01-29", end: "2025-01-26", filed: "2025-02-26", val: 2.94 },
                      { form: "10-K", fp: "FY", start: "2025-01-27", end: "2026-01-25", filed: "2026-02-25", val: 4.9 },
                      // Restated post-split 2023 comparative inside 2025 filing
                      { form: "10-K", fp: "FY", start: "2022-01-31", end: "2023-01-29", filed: "2025-02-26", val: 0.17 },
                      // Quarterly (<300d) rows inside 10-K tagged fp: "FY" that must be ignored
                      { form: "10-K", fp: "FY", frame: "CY2025Q4", start: "2025-10-27", end: "2026-01-25", filed: "2026-02-25", val: 1.62 },
                      { form: "10-K", fp: "FY", start: "2024-10-28", end: "2025-01-26", filed: "2025-02-26", val: 0.89 },
                    ],
                  },
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("query1.finance.yahoo.com")) {
        const points = [
          { ts: Date.parse("2022-01-30T00:00:00Z") / 1000, close: 24.5 },
          { ts: Date.parse("2023-01-29T00:00:00Z") / 1000, close: 19.5 },
          { ts: Date.parse("2024-01-28T00:00:00Z") / 1000, close: 61.5 },
          { ts: Date.parse("2025-01-26T00:00:00Z") / 1000, close: 120.0 },
          { ts: Date.parse("2026-01-25T00:00:00Z") / 1000, close: 185.0 },
        ];
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: { regularMarketPrice: 185 },
                  timestamp: points.map((p) => p.ts),
                  indicators: {
                    quote: [
                      {
                        open: points.map((p) => p.close),
                        high: points.map((p) => p.close),
                        low: points.map((p) => p.close),
                        close: points.map((p) => p.close),
                        volume: points.map(() => 1e6),
                      },
                    ],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    };

    const res = await fetchTrueHistoricalMedianPe("NVDA", "0001045810", 185, 35, mockFetcher);
    // Split-consistent years (2023: 19.5/0.17=114.7, 2024: 61.5/1.19=51.7, 2025: 120/2.94=40.8, 2026: 185/4.9=37.8) => median ~46.3 (NOT ~10 or >140)
    expect(res).not.toBeNull();
    expect(res!.historicalMedianPe!).toBeGreaterThan(40);
    expect(res!.historicalMedianPe!).toBeLessThan(60);
  });
});
