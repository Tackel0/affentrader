// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useMarketData", () => ({ useMarketData: () => {} }));
vi.mock("@/hooks/useSync", () => ({ useSync: () => {} }));
vi.mock("@/hooks/useWindowLink", () => ({ useWindowLink: () => {} }));
vi.mock("@/components/ChartGrid", () => ({ ChartGrid: () => <div data-testid="chart-grid" /> }));
vi.mock("@/components/Watchlist", () => ({ Watchlist: () => <div data-testid="watchlist" /> }));
vi.mock("@/components/BottomPanel", () => ({ BottomPanel: () => <div data-testid="bottom-panel" /> }));
vi.mock("@/components/ObjectSidebar", () => ({ ObjectSidebar: () => <div data-testid="object-sidebar" /> }));
vi.mock("@/components/ChartTools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ChartTools")>();
  return {
    ...actual,
    CompareDialog: () => null,
    DerivedDialog: () => null,
    useChartToolHotkeys: () => {},
  };
});

import { FundamentalsPanel } from "@/components/FundamentalsPanel";
import { OsintMapPanel } from "@/components/OsintMapPanel";
import { ResearchTerminal } from "@/components/ResearchTerminal";
import { AffenTerminalWindow } from "@/components/AffenTerminalWindow";
import TradingWorkspace from "@/components/TradingWorkspace";
import { hotStorage } from "@/lib/debouncedStorage";
import { useChartStore } from "@/stores/useChartStore";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("App quality & UI regression tests", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("reloads FundamentalsPanel when initialTicker changes after an earlier snapshot already loaded", async () => {
    const requestedTickers: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = /ticker=([A-Z0-9.-]+)/.exec(url);
      if (match) requestedTickers.push(match[1]);
      if (url.includes("ticker=MSFT")) {
        return jsonResponse({
          ticker: "MSFT",
          lastClose: 425,
          fundamentals: {
            ticker: "MSFT",
            name: "Microsoft Corporation",
            sector: "Technology",
            currency: "USD",
            marketCapBn: 3100,
            forwardPe: 32,
            sectorMedianPe: 28,
            historicalMedianPe: 30,
            peVsHistoryPct: 6.7,
            evToEbitda: 22,
            sectorMedianEvEbitda: 19,
            priceToFcf: 34,
            fcfYieldPct: 2.9,
            pegRatio: 2.1,
            netDebtToEbitda: -0.4,
            operatingMarginPct: 44,
            netMarginPct: 36,
            roePct: 38,
            epsRevisionPct: 3.1,
            revenueGrowthPct: 16,
            analystTarget: 490,
            fairValue: 480,
            analystConsensus: { buy: 30, hold: 3, sell: 0, ratingLabel: "Strong Buy", analystCount: 33 },
            insiderBuys90d: 0,
            insiderNetValueUsd: 0,
            recentInsiderFilings: [],
            earningsSurprisePct: 5.0,
            lastEarningsDate: "2026-10-29",
            dataSources: ["SEC EDGAR XBRL", "Yahoo Finance"],
            source: "tradingview+sec+yahoo",
          },
          quant: null,
        });
      }
      return jsonResponse({
        ticker: "AAPL",
        lastClose: 225,
        fundamentals: {
          ticker: "AAPL",
          name: "Apple Inc.",
          sector: "Technology",
          currency: "USD",
          marketCapBn: 3400,
          forwardPe: 30,
          sectorMedianPe: 28,
          historicalMedianPe: 27,
          peVsHistoryPct: 11.1,
          evToEbitda: 24,
          sectorMedianEvEbitda: 19,
          priceToFcf: 31,
          fcfYieldPct: 3.2,
          pegRatio: 2.4,
          netDebtToEbitda: 0.1,
          operatingMarginPct: 31,
          netMarginPct: 26,
          roePct: 140,
          epsRevisionPct: 2.2,
          revenueGrowthPct: 8,
          analystTarget: 250,
          fairValue: 240,
          analystConsensus: { buy: 25, hold: 8, sell: 1, ratingLabel: "Buy", analystCount: 34 },
          insiderBuys90d: 0,
          insiderNetValueUsd: 0,
          recentInsiderFilings: [],
          earningsSurprisePct: 4.1,
          lastEarningsDate: "2026-10-31",
          dataSources: ["SEC EDGAR XBRL", "Yahoo Finance"],
          source: "tradingview+sec+yahoo",
        },
        quant: null,
      });
    }) as typeof fetch;

    const { rerender, container } = render(<FundamentalsPanel initialTicker="AAPL" />);
    await waitFor(() => {
      expect(container.textContent).toContain("Apple Inc.");
    });

    // Changing initialTicker while an AAPL snapshot is displayed MUST load MSFT instead of staying stale
    rerender(<FundamentalsPanel initialTicker="MSFT" />);
    await waitFor(() => {
      expect(container.textContent).toContain("Microsoft Corporation");
    });
    expect(requestedTickers).toEqual(["AAPL", "MSFT"]);
  });

  it("aborts in-flight OsintMapPanel requests on unmount and surfaces non-JSON HTTP failures safely", async () => {
    let seenSignal: AbortSignal | undefined;
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return {
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      } as unknown as Response;
    }) as typeof fetch;

    const { container, unmount } = render(<OsintMapPanel onSelectSymbol={() => {}} />);
    await waitFor(() => {
      expect(container.textContent).toContain("OSINT map unavailable");
    });
    expect(seenSignal).toBeDefined();
    expect(seenSignal!.aborted).toBe(false);

    unmount();
    expect(seenSignal!.aborted).toBe(true);
  });

  it("ignores modified Ctrl+/ and Meta+/ combinations in TradingWorkspace keyboard listener", async () => {
    useChartStore.setState({ searchOpen: false, symbol: "HL:BTC", timeframe: "1m" });
    const { container } = render(<TradingWorkspace />);
    await waitFor(() => {
      expect(container.querySelector("[data-testid='chart-grid']")).toBeTruthy();
    });

    fireEvent.keyDown(document.body, { key: "/", ctrlKey: true });
    expect(useChartStore.getState().searchOpen).toBe(false);

    fireEvent.keyDown(document.body, { key: "/", metaKey: true });
    expect(useChartStore.getState().searchOpen).toBe(false);

    fireEvent.keyDown(document.body, { key: "/" });
    expect(useChartStore.getState().searchOpen).toBe(true);
  });

  it("flattens embedded ResearchTerminal into single-pane mode without re-rendering on 1Hz AffenUtcClock ticks", async () => {
    vi.useFakeTimers();
    let terminalRenderCount = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/terminal-opportunities")) {
        terminalRenderCount++;
        return jsonResponse({
          market: "us",
          benchmark: "SPY",
          benchmarkSession: "2026-11-13",
          evaluated: 0,
          universe: 0,
          dataSources: [],
          opportunities: [],
          unavailable: [],
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const { container } = render(<ResearchTerminal externalWindow={false} initialView="help" />);
    const root = container.querySelector(".research-terminal");
    expect(root?.className).toContain("is-embedded");
    expect(root?.className).toContain("is-single-pane");
    expect(container.querySelector(".terminal-secondary-pane")).toBeNull();

    // Switching to 2-Pane removes is-single-pane and opens P2
    const twoPaneBtn = container.querySelector('.segmented button[title*="2-Pane"]') as HTMLButtonElement;
    fireEvent.click(twoPaneBtn);
    expect(root?.className).not.toContain("is-single-pane");
    expect(container.querySelector(".terminal-secondary-pane")).not.toBeNull();
    cleanup();
    terminalRenderCount = 0;

    try {
      // AffenTerminalWindow isolates 1Hz clock updates into .affen-clock without refetching or remounting shell
      const { container: winContainer } = render(<AffenTerminalWindow initialView="help" />);
      const initialClock = winContainer.querySelector(".affen-clock")?.textContent;
      expect(initialClock).toContain("UTC");
      vi.advanceTimersByTime(3_000);
      expect(terminalRenderCount).toBeLessThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("avoids JSON.stringify on real useChartStore quote and trade updates while persisting symbol changes", () => {
    localStorage.clear();
    hotStorage.discard();
    useChartStore.getState().set({ symbol: "BTCUSDT", timeframe: "15m" });
    hotStorage.flush();

    const stringifySpy = vi.spyOn(JSON, "stringify");
    try {
      stringifySpy.mockClear();

      for (let i = 0; i < 20; i++) {
        useChartStore.getState().set({
          quotes: { BTCUSDT: { symbol: "BTCUSDT", price: 90000 + i, previous: 90000, change: i, changePercent: 0, high: 90100, low: 89900, volume: 100, history: [], time: Date.now(), simulated: false } },
          trades: [{ id: `t-${i}`, symbol: "BTCUSDT", time: Date.now(), price: 90000 + i, quantity: 1, side: "buy", simulated: false }],
        });
      }
      expect(stringifySpy).toHaveBeenCalledTimes(0);

      useChartStore.getState().set({ timeframe: "4h" });
      hotStorage.flush();
      expect(stringifySpy).toHaveBeenCalled();
    } finally {
      stringifySpy.mockRestore();
    }
  });
});
