// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, act, waitFor, within, cleanup } from "@testing-library/react";
import { FundamentalsPanel } from "@/components/FundamentalsPanel";
import { OpportunitiesHub } from "@/components/OpportunitiesHub";
import { OsintMapPanel } from "@/components/OsintMapPanel";
import { NewsPanel } from "@/components/NewsPanel";
import { HeatmapPanel } from "@/components/HeatmapPanel";
import { CalendarPanel } from "@/components/CalendarPanel";
import { useChartStore } from "@/stores/useChartStore";
import { usePaperStore, DEFAULT_TICKET } from "@/stores/usePaperStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import type {
  FundamentalSnapshot,
  OpportunityScanResult,
  TradeOpportunity,
} from "@/lib/screener/opportunities";
import type { QuantTechnicalSnapshot } from "@/lib/quant/signals";
import type { OsintMapPayload } from "@/lib/server/osint";
import type { ChokepointMarineCondition, MaritimeAdvisory } from "@/lib/server/osintTelemetry";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function makeFundamentals(overrides: Partial<FundamentalSnapshot> = {}): FundamentalSnapshot {
  return {
    ticker: "QCOM",
    name: "Qualcomm Incorporated",
    sector: "Semiconductors",
    currency: "USD",
    marketCapBn: 192.4,
    forwardPe: 14.8,
    sectorMedianPe: 23.5,
    historicalMedianPe: 18.2,
    peVsHistoryPct: -18.7,
    evToEbitda: 11.2,
    sectorMedianEvEbitda: 16.4,
    priceToFcf: 15.6,
    fcfYieldPct: 6.4,
    pegRatio: 1.08,
    netDebtToEbitda: -0.35,
    operatingMarginPct: 28.4,
    netMarginPct: 23.1,
    roePct: 39.2,
    epsRevisionPct: 5.4,
    revenueGrowthPct: 14.2,
    analystTarget: 210,
    fairValue: 218,
    analystConsensus: {
      buy: 18,
      hold: 4,
      sell: 1,
      ratingLabel: "Moderate Buy",
      analystCount: 23,
      targetLow: 175,
      targetMean: 210,
      targetHigh: 245,
      recentActions: [
        {
          date: "2026-10-28",
          firm: "Morgan Stanley",
          action: "Reiterated",
          toGrade: "Overweight · $220",
        },
      ],
    },
    insiderBuys90d: 3,
    insiderNetValueUsd: 1_250_000,
    recentInsiderFilings: [
      {
        date: "2026-10-15",
        insider: "Cristiano Amon",
        role: "CEO",
        shares: 8500,
        price: 165,
        valueUsd: 1_402_500,
        form: "Form 4",
      },
    ],
    earningsSurprisePct: 7.2,
    lastEarningsDate: "2026-07-30",
    dataSources: ["SEC EDGAR XBRL", "Yahoo Finance"],
    source: "tradingview+sec+yahoo",
    ...overrides,
  };
}

function makeQuant(): QuantTechnicalSnapshot {
  return {
    rsi14: 58.4,
    adx14: 26.1,
    atr14: 3.42,
    atrPct: 1.98,
    macdHistogram: 0.72,
    bollingerWidthPct: 6.3,
    annualizedVolPct: 29.4,
    priceSlopePerBarPct: 0.34,
    mfi14: 64.2,
    willR14: -22.5,
    sortinoRatio: 1.65,
    maxDrawdownPct: -14.2,
    var95Pct: -2.4,
    candlestickPatterns: ["Bullish Engulfing"],
  };
}

function makeOpportunity(overrides: Partial<TradeOpportunity> = {}): TradeOpportunity {
  const ticker = overrides.ticker ?? "NVDA";
  return {
    id: `opp-${ticker}`,
    symbol: `YF:${ticker}`,
    ticker,
    name: `${ticker} Corp.`,
    market: "us",
    sector: "Technology",
    currency: "USD",
    session: "2026-11-14",
    category: "structural-bottom",
    subType: "wyckoff-spring",
    setupLabel: "Wyckoff Spring Reclaim",
    score: 84,
    scoreBreakdown: { Structure: 30, Volume: 28, Valuation: 26 },
    whySetup: ["High-volume reclaim above 20 EMA", "Positive OBV divergence on retest"],
    levels: {
      lastClose: 138.5,
      entryZone: [135.0, 140.0],
      invalidation: 129.0,
      target1: 158.0,
      target2: 172.0,
      riskReward: 2.35,
    },
    technicals: {
      rsi14: 57.2,
      ema20: 136.4,
      ema50: 131.2,
      vwap20: 135.8,
      ema20DistPct: 1.5,
      ema50DistPct: 5.6,
      vwap20DistPct: 2.0,
      relativeStrengthPct: 11.4,
      benchmarkReturnPct: 2.1,
      rvol20: 1.45,
      volumeDryUpRatio: 0.62,
      upDownVolumeRatio: 1.38,
      obvDivergence: true,
      adDivergence: true,
      bbBandwidthPct: 7.4,
      bbSqueezePercentile: 24,
      vcpContractions: 3,
      priorDrawdownPct: -18.4,
    },
    fundamentals: makeFundamentals({ ticker, name: `${ticker} Corp.` }),
    chart: [
      { session: "2026-11-12", open: 133, high: 137, low: 132, close: 136, volume: 1200000 },
      { session: "2026-11-13", open: 136, high: 139, low: 135, close: 138.5, volume: 1500000 },
    ],
    ...overrides,
  };
}

describe("Analytical Terminal Sub-Panels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    useChartStore.setState({
      symbol: "YF:AAPL",
      timeframe: "1D",
      bottomOpen: false,
      bottomTab: "trading",
    });
    usePaperStore.setState({ ticket: { ...DEFAULT_TICKET } });
    useWatchlistStore.setState({
      activeId: "default",
      lists: [{ id: "default", name: "Core", symbols: ["YF:AAPL", "BTCUSDT"] }],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ==========================================
  // 1. FundamentalsPanel
  // ==========================================
  describe("FundamentalsPanel", () => {
    it("shows loading state then renders valuation, consensus, quant metrics, insider filings, and handles chart navigation", async () => {
      let resolveFetch!: (res: Response) => void;
      const pendingFetch = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        const s = String(url);
        if (s.includes("ticker=QCOM")) return pendingFetch;
        return Promise.resolve(
          jsonResponse({
            ticker: "AAPL",
            lastClose: 229.5,
            fundamentals: makeFundamentals({ ticker: "AAPL", name: "Apple Inc.", sector: "Consumer Hardware" }),
            quant: makeQuant(),
          }),
        );
      });

      const onOpenChart = vi.fn();
      const { container } = render(<FundamentalsPanel initialTicker="QCOM" onOpenChart={onOpenChart} />);

      expect(container.textContent).toContain("Loading fundamentals for QCOM");

      await act(async () => {
        resolveFetch(
          jsonResponse({
            ticker: "QCOM",
            lastClose: 172.4,
            fundamentals: makeFundamentals(),
            quant: makeQuant(),
          }),
        );
      });

      await waitFor(() => {
        expect(container.textContent).toContain("QCOM · Qualcomm Incorporated");
      });
      expect(container.textContent).toContain("14.8×");
      expect(container.textContent).toContain("Moderate Buy");
      expect(container.textContent).toContain("Morgan Stanley");
      expect(container.textContent).toContain("Bullish Engulfing");
      expect(container.textContent).toContain("Cristiano Amon");

      // Submit AAPL to trigger reload
      const input = container.querySelector("input") as HTMLInputElement;
      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: "aapl" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      await waitFor(() => {
        expect(container.textContent).toContain("AAPL · Apple Inc.");
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/terminal-fundamentals?ticker=AAPL"),
        expect.any(Object),
      );

      // Click Open Chart
      const openBtn = within(container).getByRole("button", { name: /Open AAPL Chart/i });
      fireEvent.click(openBtn);
      expect(onOpenChart).toHaveBeenCalledWith("AAPL");
    });

    it("renders preloaded fundamentals synchronously and validates invalid / failing requests cleanly", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({ error: "Ticker not found upstream" }, false, 404),
      );

      const { container } = render(
        <FundamentalsPanel
          initialTicker="MSFT"
          preloaded={{
            ticker: "MSFT",
            lastClose: 422.1,
            fundamentals: makeFundamentals({ ticker: "MSFT", name: "Microsoft Corp." }),
          }}
        />,
      );

      expect(container.textContent).toContain("MSFT · Microsoft Corp.");
      expect(fetchSpy).not.toHaveBeenCalled();

      // Invalid ticker rejects locally without fetch
      const input = container.querySelector("input") as HTMLInputElement;
      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: "BAD TICKER!!!" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });
      expect(within(container).getByRole("alert").textContent).toContain("Enter a valid exchange ticker");
      expect(fetchSpy).not.toHaveBeenCalled();

      // Valid ticker submitted via form that returns HTTP 404 renders API error
      await act(async () => {
        fireEvent.change(input, { target: { value: "ZZZ9" } });
      });
      await act(async () => {
        fireEvent.submit(form);
      });
      await waitFor(() => {
        expect(container.querySelector(".screener-error")?.textContent).toContain("Ticker not found upstream");
      });
    });
  });

  // ==========================================
  // 2. OpportunitiesHub
  // ==========================================
  describe("OpportunitiesHub", () => {
    it("loads opportunities, filters by category/min-score, syncs chart/order ticket on selection, and shows error/empty states", async () => {
      const nvda = makeOpportunity({ ticker: "NVDA", category: "structural-bottom", score: 86 });
      const mu = makeOpportunity({
        id: "opp-MU",
        symbol: "YF:MU",
        ticker: "MU",
        name: "Micron Technology",
        category: "value-garp",
        subType: "value-garp",
        setupLabel: "Value & GARP",
        score: 74,
        levels: {
          lastClose: 102.0,
          entryZone: [98.0, 103.0],
          invalidation: 92.0,
          target1: 124.0,
          target2: 136.0,
          riskReward: 2.75,
        },
      });
      const payload: OpportunityScanResult = {
        market: "us",
        benchmark: "SPY",
        benchmarkSession: "2026-11-14",
        generatedAt: Date.now(),
        evaluated: 20,
        universe: 25,
        page: 0,
        pages: 1,
        dataSources: ["Yahoo", "SEC"],
        opportunities: [nvda, mu],
        unavailable: [],
      };

      let callNum = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        callNum += 1;
        if (callNum === 1) return Promise.resolve(jsonResponse(payload));
        return Promise.resolve(jsonResponse({ error: "Scanner backend throttled" }, false, 503));
      });

      const onSelectOpportunity = vi.fn();
      const { container } = render(<OpportunitiesHub onSelectOpportunity={onSelectOpportunity} />);

      await waitFor(() => {
        expect(container.textContent).toContain("2 von 2 Setups");
      });
      expect(container.textContent).toContain("NVDA");
      expect(container.textContent).toContain("MU");

      // Opening research does not change the chart until the chart action is used.
      const priorSymbol = useChartStore.getState().symbol;
      const muButton = within(container).getByRole("button", { name: /^MU\b/i });
      await act(async () => {
        fireEvent.click(muButton);
      });
      expect(useChartStore.getState().symbol).toBe(priorSymbol);
      fireEvent.click(within(container).getByRole("button", { name: "In Haupt-Chart laden (MU)" }));
      expect(useChartStore.getState().symbol).toBe("YF:MU");
      expect(onSelectOpportunity).toHaveBeenCalledWith(expect.objectContaining({ ticker: "MU" }), mu.fundamentals);

      // Stage bracket order updates paper ticket with 50/50 two-leg exitLevels across target1 and target2
      const bracketBtn = within(container).getByRole("button", { name: /Bracket-Order vorbereiten/i });
      fireEvent.click(bracketBtn);
      const ticket = usePaperStore.getState().ticket;
      expect(ticket.side).toBe("buy");
      expect(ticket.type).toBe("limit");
      expect(ticket.quantity).toBe(0.01);
      expect(ticket.stopLoss).toBeUndefined();
      expect(ticket.takeProfit).toBeUndefined();
      expect(ticket.exitLevels).toEqual([
        { quantity: 0.005, takeProfit: 124, stopLoss: 92 },
        { quantity: 0.005, takeProfit: 136, stopLoss: 92 },
      ]);

      const budget = within(container).getByLabelText("Risikobudget (USD)");
      fireEvent.change(budget, { target: { value: "26" } });
      expect(within(container).getByText("3 Aktien")).toBeTruthy();
      fireEvent.click(bracketBtn);
      expect(usePaperStore.getState().ticket.exitLevels).toEqual([
        { quantity: 1, takeProfit: 124, stopLoss: 92 },
        { quantity: 2, takeProfit: 136, stopLoss: 92 },
      ]);

      // Filter by category value-garp -> keeps only MU
      const catSelect = within(container).getByLabelText("Strategy category") as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(catSelect, { target: { value: "value-garp" } });
      });
      expect(container.textContent).toContain("1 von 2 Setups");
      expect(container.textContent).toContain("MU");

      // Raise min score to 90 -> empty filter message
      const rangeInput = within(container).getByLabelText("Min. Score");
      await act(async () => {
        fireEvent.change(rangeInput, { target: { value: "90" } });
      });
      expect(container.textContent).toContain("Keine Treffer für diese Filter.");

      // Rescan triggers API failure alert
      const rescanBtn = within(container).getByRole("button", { name: /Scan Trade-Möglichkeiten/i });
      await act(async () => {
        fireEvent.click(rescanBtn);
      });
      await waitFor(() => {
        expect(within(container).getByRole("alert").textContent).toContain("Scanner backend throttled");
      });
    });
  });

  // ==========================================
  // 3. OsintMapPanel
  // ==========================================
  describe("OsintMapPanel", () => {
    it("renders live AIS/ADS-B telemetry, filters regions/search/toggles, syncs symbols, and surfaces fetch errors", async () => {
      const osintPayload: OsintMapPayload & {
        marineConditions: ChokepointMarineCondition[];
        advisories: MaritimeAdvisory[];
      } = {
        generatedAt: Date.now(),
        vessels: [
          {
            id: "v1",
            mmsi: 230991100,
            name: "NORDIC TANKER",
            category: "oil-tanker",
            shipType: 80,
            lat: 59.8,
            lon: 24.5,
            sogKnots: 12.4,
            cogDeg: 245,
            destination: "ROTTERDAM",
            updatedAt: Date.now(),
            source: "Digitraffic",
          },
          {
            id: "v2",
            mmsi: 211004422,
            name: "BALTIC CARGO",
            category: "cargo",
            shipType: 70,
            lat: 58.2,
            lon: 20.1,
            sogKnots: 14.1,
            cogDeg: 180,
            destination: "GDANSK",
            updatedAt: Date.now(),
            source: "Digitraffic",
          },
        ],
        flights: [
          {
            id: "f1",
            icao: "4CA123",
            callsign: "RCH401",
            category: "military-tanker",
            aircraftType: "KC-135R",
            lat: 52.3,
            lon: 11.4,
            altitudeFt: 32000,
            speedKnots: 440,
            headingDeg: 95,
            country: "US",
            source: "OpenSky",
          },
        ],
        chokepoints: [
          {
            id: "hormuz",
            name: "Strait of Hormuz",
            region: "Persian Gulf",
            lat: 26.57,
            lon: 56.25,
            shareGlobalOilPct: "~20% global petroleum & LNG",
            flowSummary: "VLCC transit hub connecting Persian Gulf to Arabian Sea.",
            correlatedSymbols: [
              { symbol: "YF:BZ=F", label: "Brent Crude" },
              { symbol: "YF:FRO", label: "Frontline" },
            ],
          },
        ],
        routes: [
          {
            id: "r1",
            name: "Gulf–Europe",
            commodity: "crude",
            coordinates: [
              [56.25, 26.57],
              [32.27, 30.58],
            ],
          },
        ],
        correlatedTickers: [{ symbol: "YF:XOM", label: "Exxon Mobil", sector: "Energy" }],
        feedStatus: {
          ais: { ok: true, count: 2, provider: "Digitraffic" },
          adsb: { ok: true, count: 1, provider: "OpenSky" },
        },
        marineConditions: [
          {
            chokepointId: "hormuz",
            name: "Strait of Hormuz",
            waveHeightM: 1.8,
            swellHeightM: 1.1,
            currentSpeedMs: 0.7,
            severity: "moderate",
          },
        ],
        advisories: [
          {
            id: "adv-1",
            title: "Red Sea transit insurance surcharge steady",
            link: "https://example.com/advisory",
            publishedAt: Date.now(),
            source: "Maritime Bulletin",
          },
        ],
      };

      let callNum = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        callNum += 1;
        if (callNum === 1) return Promise.resolve(jsonResponse(osintPayload));
        return Promise.resolve(jsonResponse({ error: "AIS upstream timeout" }, false, 504));
      });

      const onSelectSymbol = vi.fn();
      const { container } = render(<OsintMapPanel onSelectSymbol={onSelectSymbol} />);

      expect(container.textContent).toContain("SYNCING FEED");

      await waitFor(() => {
        expect(container.textContent).toContain("2 VESSELS · 1 FLIGHTS");
      });
      expect(container.textContent).toContain("Baltic / N. Europe AIS: 2 vessels (Digitraffic)");
      expect(container.textContent).toContain("Strait of Hormuz");
      expect(container.textContent).toContain("1.8 m");
      expect(container.textContent).toContain("Red Sea transit insurance surcharge steady");

      // Search filter matches only NORDIC TANKER (0 flights, 1 vessel)
      const searchInput = within(container).getByLabelText("OSINT filter") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: "ROTTERDAM" } });
      });
      expect(container.textContent).toContain("1 VESSELS · 0 FLIGHTS");

      // Toggle Tanker button hides remaining vessel
      const tankerBtn = within(container).getByRole("button", { name: /Tanker \(1\)/i });
      fireEvent.click(tankerBtn);
      expect(container.textContent).toContain("0 VESSELS · 0 FLIGHTS");

      // Switch region & click correlated symbol chip
      fireEvent.click(within(container).getByRole("button", { name: /Gulf & Red Sea/i }));
      fireEvent.click(within(container).getByRole("button", { name: /Brent Crude \(BZ=F\)/i }));
      expect(onSelectSymbol).toHaveBeenCalledWith("YF:BZ=F");

      // Trigger Sync failure
      await act(async () => {
        fireEvent.click(within(container).getByRole("button", { name: /Sync/i }));
      });
      await waitFor(() => {
        expect(container.querySelector(".screener-error")?.textContent).toContain("AIS upstream timeout");
      });
    });
  });

  // ==========================================
  // 4. NewsPanel
  // ==========================================
  describe("NewsPanel", () => {
    it("loads articles, switches feed scopes/filters, syncs chart symbol from chips, and handles empty/error states", async () => {
      const articles = [
        {
          id: "n1",
          title: "Bitcoin rallies on institutional inflows",
          link: "https://example.com/btc",
          source: "CoinDesk",
          published: Date.now() - 10 * 60_000,
          summary: "Spot demand accelerates into weekly close.",
          symbols: ["BTCUSDT"],
        },
        {
          id: "n2",
          title: "Apple unveils new silicon roadmap",
          link: "https://example.com/aapl",
          source: "Reuters",
          published: Date.now() - 25 * 60_000,
          summary: "Flagship M-series rollout targets enterprise laptops.",
          symbols: ["YF:AAPL"],
        },
      ];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        const s = String(url);
        if (s.includes("scope=crypto")) {
          return Promise.resolve(jsonResponse({ error: "RSS proxy unavailable" }, false, 502));
        }
        return Promise.resolve(jsonResponse({ items: articles, failed: [] }));
      });

      const { container } = render(<NewsPanel />);
      expect(container.textContent).toContain("Loading news feeds");

      await waitFor(() => {
        expect(container.textContent).toContain("2 ITEMS");
      });
      expect(container.textContent).toContain("Bitcoin rallies on institutional inflows");
      expect(container.textContent).toContain("Apple unveils new silicon roadmap");

      // Scope filter: AAPL Only
      fireEvent.click(within(container).getByRole("button", { name: /AAPL Only/i }));
      expect(container.textContent).toContain("1 ITEMS");
      expect(container.textContent).not.toContain("Bitcoin rallies");

      // Search filter -> empty state
      const searchInput = within(container).getByLabelText("Search news") as HTMLInputElement;
      fireEvent.change(searchInput, { target: { value: "nonexistent-topic-xyz" } });
      expect(container.textContent).toContain("No stories match.");

      // Clear search & switch All News, click BTC coin chip -> updates chart store
      fireEvent.change(searchInput, { target: { value: "" } });
      fireEvent.click(within(container).getByRole("button", { name: /All News/i }));
      fireEvent.click(within(container).getByRole("button", { name: "BTC" }));
      expect(useChartStore.getState().symbol).toBe("BTCUSDT");

      // Switch feed kind to Crypto -> fails and shows error banner
      await act(async () => {
        fireEvent.click(within(container).getByRole("button", { name: "Crypto" }));
      });
      await waitFor(() => {
        expect(container.querySelector(".screener-error")?.textContent).toContain("RSS proxy unavailable");
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/feeds?kind=news&scope=crypto"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  // ==========================================
  // 5. HeatmapPanel
  // ==========================================
  describe("HeatmapPanel", () => {
    let origWidth: PropertyDescriptor | undefined;
    let origHeight: PropertyDescriptor | undefined;

    beforeEach(() => {
      origWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
      origHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
      Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 640 });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
    });

    afterEach(() => {
      if (origWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origWidth);
      if (origHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origHeight);
    });

    it("renders Binance treemap excluding stables, switches to US Sectors with GICS filtering, syncs symbol, and renders empty/error states", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        const s = String(url);
        if (s.includes("market=ticker/24hr") || s.includes("resource=ticker/24hr")) {
          return Promise.resolve(
            jsonResponse([
              { symbol: "BTCUSDT", priceChangePercent: "3.45", quoteVolume: "5000000000" },
              { symbol: "ETHUSDT", priceChangePercent: "-1.20", quoteVolume: "2500000000" },
              { symbol: "USDCUSDT", priceChangePercent: "0.01", quoteVolume: "9000000000" },
            ]),
          );
        }
        if (s.includes("market=us")) {
          return Promise.resolve(
            jsonResponse({
              rows: [
                { ticker: "NVDA", symbol: "YF:NVDA", name: "NVIDIA", sector: "Technology", price: 140, changePct: 4.1, marketCapBn: 3200 },
                { ticker: "XOM", symbol: "YF:XOM", name: "Exxon", sector: "Energy", price: 118, changePct: -0.9, marketCapBn: 520 },
              ],
            }),
          );
        }
        if (s.includes("market=lse")) {
          return Promise.resolve(jsonResponse({ rows: [] }));
        }
        return Promise.resolve(jsonResponse({ error: "Xetra heatmap offline" }, false, 500));
      });

      const onSelectSymbol = vi.fn();
      const { container } = render(<HeatmapPanel onSelectSymbol={onSelectSymbol} />);

      await waitFor(() => {
        expect(container.querySelectorAll(".heat-tile").length).toBe(2);
      });
      expect(container.textContent).toContain("BTC");
      expect(container.textContent).toContain("+3.45%");
      expect(container.textContent).not.toContain("USDC");

      // Switch to US Sectors -> populates GICS filter select
      await act(async () => {
        fireEvent.click(within(container).getByRole("button", { name: "US Sectors" }));
      });
      await waitFor(() => {
        expect(within(container).getByLabelText("Filter GICS sector")).toBeTruthy();
      });
      const sectorSelect = within(container).getByLabelText("Filter GICS sector") as HTMLSelectElement;
      fireEvent.change(sectorSelect, { target: { value: "Technology" } });

      const tiles = container.querySelectorAll(".heat-tile");
      expect(tiles.length).toBe(1);
      expect(tiles[0].textContent).toContain("NVDA");
      fireEvent.click(tiles[0]);
      expect(onSelectSymbol).toHaveBeenCalledWith("YF:NVDA");

      // Switch to UK LSE -> empty rows shows "No data."
      await act(async () => {
        fireEvent.click(within(container).getByRole("button", { name: "UK LSE" }));
      });
      await waitFor(() => {
        expect(container.querySelector(".heat-empty")?.textContent).toContain("No data.");
      });

      // Switch to DE Xetra -> API error renders in .heat-empty
      await act(async () => {
        fireEvent.click(within(container).getByRole("button", { name: "DE Xetra" }));
      });
      await waitFor(() => {
        expect(container.querySelector(".heat-empty")?.textContent).toContain("Xetra heatmap offline");
      });
    });

    it("recovers from a timed-out fetch and ignores its late response", async () => {
      vi.useFakeTimers();
      try {
        let resolveLate!: (response: Response) => void;
        const fetch = vi.spyOn(globalThis, "fetch")
          .mockImplementationOnce(() => new Promise(resolve => { resolveLate = resolve; }))
          .mockResolvedValueOnce(jsonResponse([
            null,
            { symbol: "ETHUSDT", priceChangePercent: "-1.2", quoteVolume: "2500000000" },
            { symbol: "XRPUSDT", priceChangePercent: null, quoteVolume: "1000000000" },
          ]))
          .mockResolvedValueOnce(jsonResponse(null, false));
        const { container, unmount } = render(<HeatmapPanel />);
        const refresh = within(container).getByRole("button", { name: "Refresh heatmap" }) as HTMLButtonElement;
        expect(refresh.disabled).toBe(true);

        await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
        expect(container.textContent).toContain("Heatmap request timed out");
        expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
        expect(refresh.disabled).toBe(false);

        await act(async () => { fireEvent.click(refresh); });
        await act(async () => {
          resolveLate(jsonResponse([{ symbol: "BTCUSDT", priceChangePercent: "5", quoteVolume: "5000000000" }]));
        });
        expect([...container.querySelectorAll(".heat-tile strong")].map(tile => tile.textContent)).toEqual(["ETH"]);

        await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
        expect(container.textContent).toContain("Showing the last available data.");
        expect(container.querySelector(".heat-tile strong")?.textContent).toBe("ETH");
        unmount();
        await vi.advanceTimersByTimeAsync(40_000);
        expect(fetch).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ==========================================
  // 6. CalendarPanel
  // ==========================================
  describe("CalendarPanel", () => {
    it("switches tabs across Economic, Earnings, Treasury yields, and FRED & Macro with filtering and error handling", async () => {
      const now = Date.now() + 3 * 60 * 60_000;
      vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        const s = String(url);
        if (s.includes("kind=economic")) {
          return Promise.resolve(
            jsonResponse({
              events: [
                {
                  id: "ev1",
                  title: "US CPI YoY",
                  country: "USD",
                  time: now,
                  impact: "high",
                  forecast: "2.6%",
                  previous: "2.4%",
                  actual: "",
                },
                {
                  id: "ev2",
                  title: "Eurozone Industrial Production",
                  country: "EUR",
                  time: now + 60_000,
                  impact: "low",
                  forecast: "0.3%",
                  previous: "0.1%",
                  actual: "",
                },
              ],
            }),
          );
        }
        if (s.includes("kind=earnings")) {
          return Promise.resolve(
            jsonResponse({
              events: [
                {
                  symbol: "NVDA",
                  name: "NVIDIA Corporation",
                  time: "After close",
                  epsForecast: "$0.74",
                  lastYearEps: "$0.40",
                  marketCap: "$3.4T",
                  fiscalQuarter: "Oct 2026",
                },
              ],
            }),
          );
        }
        if (s.includes("kind=yields")) {
          return Promise.resolve(
            jsonResponse({
              curves: [
                { date: "2026-11-13", values: { "1M": 4.5, "2Y": 4.4, "10Y": 4.15, "30Y": 4.35 } },
                { date: "2026-11-14", values: { "1M": 4.55, "2Y": 4.45, "10Y": 4.15, "30Y": 4.35 } },
              ],
            }),
          );
        }
        if (s.includes("kind=macro")) {
          return Promise.resolve(
            jsonResponse({
              updatedAt: Date.now(),
              fearGreed: { value: 64, classification: "Greed", timestamp: Date.now() },
              fearGreedHistory: [],
              fred: [
                { id: "DFF", label: "Fed Funds", unit: "%", date: "2026-11-12", value: 4.58, prevValue: 4.58, change: 0 },
              ],
              crossAssets: [
                { symbol: "YF:GLD", label: "Gold ETF", price: 248.4, changePct: 1.15 },
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ error: "Dividend calendar unavailable" }, false, 502));
      });

      const { container } = render(<CalendarPanel />);

      expect(container.textContent).toContain("Loading economic calendar");
      await waitFor(() => {
        expect(container.textContent).toContain("US CPI YoY");
      });
      expect(container.textContent).toContain("Eurozone Industrial Production");

      // Filter Economic events by Impact = high
      const impactSelect = within(container).getByLabelText("Impact") as HTMLSelectElement;
      fireEvent.change(impactSelect, { target: { value: "high" } });
      expect(container.textContent).toContain("US CPI YoY");
      expect(container.textContent).not.toContain("Eurozone Industrial Production");

      // Empty filter match when Currency = EUR and Impact = high
      const curSelect = within(container).getByLabelText("Currency") as HTMLSelectElement;
      fireEvent.change(curSelect, { target: { value: "EUR" } });
      expect(container.textContent).toContain("No events match.");

      // Switch to Earnings tab
      await act(async () => {
        fireEvent.click(within(container).getByRole("tab", { name: "Earnings" }));
      });
      await waitFor(() => {
        expect(container.textContent).toContain("NVIDIA Corporation");
      });
      expect(container.textContent).toContain("After close");

      // Switch to Treasury yields tab
      await act(async () => {
        fireEvent.click(within(container).getByRole("tab", { name: "Treasury yields" }));
      });
      await waitFor(() => {
        expect(within(container).getByRole("img", { name: "Treasury yield curve" })).toBeTruthy();
      });
      expect(container.textContent).toContain("-30 bp");
      expect(container.textContent).toContain("Inverted");

      // Switch to FRED & Macro tab and click Chart button
      await act(async () => {
        fireEvent.click(within(container).getByRole("tab", { name: "FRED & Macro" }));
      });
      await waitFor(() => {
        expect(container.textContent).toContain("64/100 (Greed)");
      });
      expect(container.textContent).toContain("4.58 %");
      fireEvent.click(within(container).getByRole("button", { name: "Chart" }));
      expect(useChartStore.getState().symbol).toBe("YF:GLD");

      // Switch to Dividends tab -> shows error state cleanly
      await act(async () => {
        fireEvent.click(within(container).getByRole("tab", { name: "Dividends" }));
      });
      await waitFor(() => {
        expect(container.querySelector(".screener-error")?.textContent).toContain("Dividend calendar unavailable");
      });
    });
  });
});
