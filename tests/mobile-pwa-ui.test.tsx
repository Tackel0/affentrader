// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const mockVelaState = vi.hoisted(() => ({
  drawings: [
    { id: "d1", type: "trendline", visible: true, locked: false, zIndex: 2 },
  ],
}));

vi.mock("@/hooks/useVelaChart", () => ({
  getPrimaryChart: () => ({
    drawings: {
      all: () => mockVelaState.drawings,
      select: vi.fn(),
      updateMany: vi.fn(),
      openSettings: vi.fn(),
      bringToFront: vi.fn(),
      sendToBack: vi.fn(),
      duplicate: vi.fn(),
      removeMany: vi.fn(),
      toJSON: () => [],
    },
  }),
}));

vi.mock("@luxalgo/vela", () => ({
  drawingTypes: () => [{ type: "trendline", label: "Trend Line" }],
}));

import { OpportunitiesHub } from "@/components/OpportunitiesHub";
import { TradingPanel } from "@/components/TradingPanel";
import { ResearchTerminal } from "@/components/ResearchTerminal";
import { AffenTerminalWindow } from "@/components/AffenTerminalWindow";
import { NewsPanel } from "@/components/NewsPanel";
import { Modal } from "@/components/ui";
import { useDismiss } from "@/components/WorkspaceMenus";
import { ObjectTree } from "@/components/ObjectTree";
import { Watchlist } from "@/components/Watchlist";
import { ChartToolbarOverflow } from "@/components/ChartToolbarOverflow";
import { PriceLevelMenu } from "@/components/PriceLevelMenu";
import { priceLevelAction } from "@/components/priceLevelAction";
import { COMPACT_WORKSPACE_QUERY } from "@/lib/chart/bottomPanelResize";
import { validateExitLevels } from "@/lib/trading/exitLevels";
import { useChartStore } from "@/stores/useChartStore";
import { DEFAULT_TICKET, usePaperStore } from "@/stores/usePaperStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { createAccount, placeOrder } from "@/lib/trading/broker";
import type { OpportunityScanResult } from "@/lib/screener/opportunities";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function createMatchMediaController(initialMap: Record<string, boolean>) {
  const listeners = new Map<string, Set<(e: MediaQueryListEvent) => void>>();
  const state = new Map<string, boolean>(Object.entries(initialMap));

  const mockMatchMedia = vi.fn((query: string): MediaQueryList => ({
    get matches() {
      return state.get(query) ?? false;
    },
    media: query,
    onchange: null,
    addListener: (cb) => {
      if (!cb) return;
      const set = listeners.get(query) ?? new Set();
      set.add(cb);
      listeners.set(query, set);
    },
    removeListener: (cb) => {
      if (cb) listeners.get(query)?.delete(cb);
    },
    addEventListener: (_event: string, cb: EventListenerOrEventListenerObject) => {
      if (typeof cb === "function") {
        const set = listeners.get(query) ?? new Set();
        set.add(cb as (e: MediaQueryListEvent) => void);
        listeners.set(query, set);
      }
    },
    removeEventListener: (_event: string, cb: EventListenerOrEventListenerObject) => {
      if (typeof cb === "function") {
        listeners.get(query)?.delete(cb as (e: MediaQueryListEvent) => void);
      }
    },
    dispatchEvent: () => true,
  }));

  return {
    mockMatchMedia,
    setMatches(query: string, value: boolean) {
      state.set(query, value);
      const evt = { matches: value, media: query } as MediaQueryListEvent;
      for (const cb of listeners.get(query) ?? []) cb(evt);
    },
  };
}

describe("Mobile PWA & Touch UI regressions", () => {
  const originalFetch = global.fetch;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    useChartStore.setState({
      symbol: "BTCUSDT",
      timeframe: "1D",
      drawingTrees: {},
      selectedDrawings: [],
      drawingsVersion: 0,
      quotes: {},
      searchOpen: false,
      compareOpen: false,
      alertDraft: null,
    });
    usePaperStore.setState({
      mode: "live",
      live: createAccount({ cash: 100_000, feeRate: 0, slippageBps: 0 }),
      prices: { BTCUSDT: 50_000, "YF:NVDA": 140 },
      liveSources: { BTCUSDT: "market" },
      ticket: { ...DEFAULT_TICKET, quantity: 0.01, exitLevels: undefined },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  it("falls back to top-level TP/SL in OpportunitiesHub when target2 <= target1", async () => {
    const payload: OpportunityScanResult = {
      market: "us",
      benchmark: "SPY",
      benchmarkSession: "2026-11-14",
      generatedAt: Date.now(),
      evaluated: 10,
      universe: 10,
      page: 0,
      pages: 1,
      dataSources: ["Yahoo"],
      opportunities: [
        {
          id: "opp-single-tp",
          symbol: "YF:AAPL",
          ticker: "AAPL",
          name: "Apple Inc.",
          market: "us",
          sector: "Technology",
          currency: "USD",
          session: "2026-11-14",
          category: "structural-bottom",
          subType: "bos-hl-reclaim",
          setupLabel: "BOS Reclaim",
          score: 82,
          scoreBreakdown: { Structure: 30, Volume: 26, Valuation: 26 },
          whySetup: ["Reclaim"],
          levels: {
            lastClose: 220,
            entryZone: [215, 221],
            invalidation: 205,
            target1: 245,
            target2: 245,
            riskReward: 2.0,
          },
          technicals: {
            rsi14: 55,
            ema20: 218,
            ema50: 214,
            vwap20: 216,
            ema20DistPct: 0.9,
            ema50DistPct: 2.8,
            vwap20DistPct: 1.8,
            relativeStrengthPct: 3.4,
            benchmarkReturnPct: 1.2,
            rvol20: 1.4,
            volumeDryUpRatio: 0.72,
            upDownVolumeRatio: 1.3,
            obvDivergence: true,
            adDivergence: false,
            bbBandwidthPct: 6.1,
            bbSqueezePercentile: 30,
            vcpContractions: 2,
            priorDrawdownPct: -14.2,
          },
          fundamentals: null,
          chart: [
            { session: "2026-11-13", open: 214, high: 218, low: 213, close: 217, volume: 900_000 },
            { session: "2026-11-14", open: 215, high: 222, low: 214, close: 220, volume: 1_000_000 },
          ],
        },
      ],
      unavailable: [],
    };
    global.fetch = vi.fn(async () => jsonResponse(payload)) as typeof fetch;

    const { container } = render(<OpportunitiesHub />);
    await waitFor(() => expect(container.textContent).toContain("AAPL"));

    fireEvent.click(within(container).getByRole("button", { name: /Bracket-Order vorbereiten/i }));
    const ticket = usePaperStore.getState().ticket;
    expect(ticket.exitLevels).toBeUndefined();
    expect(ticket.takeProfit).toBe(245);
    expect(ticket.stopLoss).toBe(205);
  });

  it("proportionally rescales staged multi-leg exitLevels in TradingPanel on manual qty input & quick-size buttons", () => {
    usePaperStore.getState().setTicket({
      side: "buy",
      type: "limit",
      quantity: 1,
      price: 50_000,
      exitLevels: [
        { quantity: 0.5, takeProfit: 55_000, stopLoss: 45_000 },
        { quantity: 0.5, takeProfit: 60_000, stopLoss: 45_000 },
      ],
      stopLoss: undefined,
      takeProfit: undefined,
    });

    const { container } = render(<TradingPanel />);
    const qtyInput = within(container).getByLabelText(/Quantity \(BTC\)/i) as HTMLInputElement;
    fireEvent.change(qtyInput, { target: { value: "0.4" } });

    let ticket = usePaperStore.getState().ticket;
    expect(ticket.quantity).toBe(0.4);
    expect(ticket.exitLevels).toEqual([
      { quantity: 0.2, takeProfit: 55_000, stopLoss: 45_000 },
      { quantity: 0.2, takeProfit: 60_000, stopLoss: 45_000 },
    ]);
    expect(validateExitLevels(ticket.exitLevels, ticket.quantity)).toBeNull();

    // Quick-size button 25% of $100,000 power @ $50,000/BTC -> 0.5 BTC
    const btn25 = within(container).getByRole("button", { name: "25%" });
    fireEvent.click(btn25);

    ticket = usePaperStore.getState().ticket;
    expect(ticket.quantity).toBe(0.5);
    expect(validateExitLevels(ticket.exitLevels, ticket.quantity)).toBeNull();
    expect(ticket.exitLevels?.reduce((sum, l) => sum + l.quantity, 0)).toBeCloseTo(0.5, 8);
  });

  it("starts compact ResearchTerminal with a single pane and loads additional panes on demand", async () => {
    const mm = createMatchMediaController({ [COMPACT_WORKSPACE_QUERY]: true });
    window.matchMedia = mm.mockMatchMedia;
    global.fetch = vi.fn(async (url) => jsonResponse(url === "/api/osint-map" ? {
      vessels: [], flights: [], routes: [], chokepoints: [],
      feedStatus: { ais: { ok: true }, adsb: { ok: true } },
    } : {})) as typeof fetch;

    const { container } = render(<ResearchTerminal externalWindow initialView="help" />);
    const root = container.querySelector(".research-terminal")!;
    expect(root.className).toContain("is-single-pane");
    expect(container.querySelector(".terminal-secondary-pane")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();

    // Manual override stays intact
    fireEvent.click(container.querySelector('.segmented button[title*="2-Pane"]') as HTMLButtonElement);
    expect(root.className).not.toContain("is-single-pane");
    expect(container.querySelector(".terminal-secondary-pane")).not.toBeNull();

    // Touch autocomplete option triggers via pure click without desktop mousedown double execution
    const input = container.querySelector("#terminal-command") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "OSINT" } });
    const listbox = within(container).getByRole("listbox", { name: /Command suggestions/i });
    const osintOpt = within(listbox).getByRole("option", { name: /Marine AIS Vessels/i });

    fireEvent.click(osintOpt);
    expect(await within(container).findByRole("textbox", { name: "OSINT filter" })).toBeTruthy();
    expect(container.querySelector(".terminal-autocomplete")).toBeNull();

    // Simulated desktop mouseDown followed immediately by click within 300ms executes once
    const setSpy = vi.spyOn(useChartStore.getState(), "set");
    fireEvent.change(input, { target: { value: "AAPL" } });
    const aaplOpt = within(within(container).getByRole("listbox", { name: /Command suggestions/i })).getByRole(
      "option",
      { name: /Open daily chart for AAPL/i },
    );
    fireEvent.mouseDown(aaplOpt);
    fireEvent.click(aaplOpt);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith({ symbol: "YF:AAPL", timeframe: "1D" });
  });

  it("triggers priceLevelAction on 450ms touch long-press across re-renders, suppresses trailing click, and cancels on drag or early lift", () => {
    vi.useFakeTimers();
    const clicks: string[] = [];
    const draws: string[] = [];

    function Harness({ version }: { version: number }) {
      const versionRef = React.useRef(version);
      versionRef.current = version;
      const actions = priceLevelAction(() => draws.push(`draw-${versionRef.current}`));
      return (
        <button type="button" onClick={() => clicks.push(`click-${versionRef.current}`)} {...actions}>
          Level
        </button>
      );
    }

    const { getByRole, rerender } = render(<Harness version={1} />);
    const btn = getByRole("button", { name: "Level" });

    // Start touch press, re-render mid-hold (like live ticks), then complete 450ms
    fireEvent.pointerDown(btn, { pointerType: "touch", pointerId: 7, clientX: 50, clientY: 50 });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    rerender(<Harness version={2} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(draws).toEqual(["draw-2"]);

    // Long hold >= 1600ms still suppresses synthetic click upon lift
    fireEvent.pointerDown(btn, { pointerType: "touch", pointerId: 10, clientX: 50, clientY: 50 });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(draws).toEqual(["draw-2", "draw-2"]);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    fireEvent.pointerUp(btn, { pointerType: "touch", pointerId: 10 });
    fireEvent.click(btn);
    expect(clicks).toEqual([]);

    // Moving > 10px cancels long-press before 450ms
    fireEvent.pointerDown(btn, { pointerType: "touch", pointerId: 8, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(btn, { pointerType: "touch", pointerId: 8, clientX: 65, clientY: 50 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(draws).toEqual(["draw-2", "draw-2"]);

    // Early lift (<450ms) does not trigger draw and allows normal tap click
    fireEvent.pointerDown(btn, { pointerType: "touch", pointerId: 9, clientX: 20, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.pointerUp(btn, { pointerType: "touch", pointerId: 9 });
    fireEvent.click(btn);
    expect(draws).toEqual(["draw-2", "draw-2"]);
    expect(clicks).toEqual(["click-2"]);
  });

  it("recovers exitLevels ratio after empty quantity input and keeps 100% quick-size within fee-adjusted buying power", () => {
    usePaperStore.setState({
      live: createAccount({ cash: 100_000, feeRate: 0.001, slippageBps: 0 }),
      prices: { BTCUSDT: 50_000 },
      ticket: {
        ...DEFAULT_TICKET,
        side: "buy",
        type: "limit",
        quantity: 1,
        price: 50_000,
        exitLevels: [
          { quantity: 0.5, takeProfit: 55_000, stopLoss: 45_000 },
          { quantity: 0.5, takeProfit: 60_000, stopLoss: 45_000 },
        ],
        stopLoss: undefined,
        takeProfit: undefined,
      },
    });

    const { container } = render(<TradingPanel />);
    const qtyInput = within(container).getByLabelText(/Quantity \(BTC\)/i) as HTMLInputElement;

    // Clearing field temporarily sets qty=0 without erasing lastPositiveQtyRef or exitLevels, then "0.5" scales 1 -> 0.5
    fireEvent.change(qtyInput, { target: { value: "" } });
    expect(usePaperStore.getState().ticket.quantity).toBe(0);
    expect(usePaperStore.getState().ticket.exitLevels).toHaveLength(2);

    fireEvent.change(qtyInput, { target: { value: "0.5" } });
    expect(usePaperStore.getState().ticket.exitLevels).toEqual([
      { quantity: 0.25, takeProfit: 55_000, stopLoss: 45_000 },
      { quantity: 0.25, takeProfit: 60_000, stopLoss: 45_000 },
    ]);

    // Clicking 100% accounts for 0.1% fee rate (100_000 / (50_000 * 1.001) = 1.9980...)
    fireEvent.click(within(container).getByRole("button", { name: "100%" }));
    const nextQty = usePaperStore.getState().ticket.quantity;
    expect(nextQty).toBeLessThanOrEqual(100_000 / (50_000 * 1.001));
    expect(nextQty).toBeCloseTo(1.998, 3);
    expect(validateExitLevels(usePaperStore.getState().ticket.exitLevels, nextQty)).toBeNull();
  });

  it("blocks paper drafts with an inverted invalidation in OpportunitiesHub", async () => {
    const payload: OpportunityScanResult = {
      market: "us",
      benchmark: "SPY",
      benchmarkSession: "2026-11-14",
      generatedAt: Date.now(),
      evaluated: 10,
      universe: 10,
      page: 0,
      pages: 1,
      dataSources: ["Yahoo"],
      opportunities: [
        {
          id: "opp-subdollar",
          symbol: "YF:PENN",
          ticker: "PENN",
          name: "Subdollar Example",
          market: "us",
          sector: "Technology",
          currency: "USD",
          session: "2026-11-14",
          category: "structural-bottom",
          subType: "bos-hl-reclaim",
          setupLabel: "BOS Reclaim",
          score: 84,
          scoreBreakdown: { Structure: 30, Volume: 27, Valuation: 27 },
          whySetup: ["Sub-dollar precision test"],
          levels: {
            lastClose: 0.425,
            entryZone: [0.4123, 0.4321],
            invalidation: 0.5, // intentionally inverted (> entryMid) to ensure guard omits invalid SL
            target1: 0.55,
            target2: 0.65,
            riskReward: 2.1,
          },
          technicals: {
            rsi14: 52,
            ema20: 0.42,
            ema50: 0.4,
            vwap20: 0.415,
            ema20DistPct: 1.2,
            ema50DistPct: 6.2,
            vwap20DistPct: 2.4,
            relativeStrengthPct: 4.1,
            benchmarkReturnPct: 1.0,
            rvol20: 1.3,
            volumeDryUpRatio: 0.7,
            upDownVolumeRatio: 1.25,
            obvDivergence: true,
            adDivergence: false,
            bbBandwidthPct: 5.5,
            bbSqueezePercentile: 25,
            vcpContractions: 2,
            priorDrawdownPct: -20,
          },
          fundamentals: null,
          chart: [{ session: "2026-11-14", open: 0.41, high: 0.43, low: 0.405, close: 0.425, volume: 100_000 }],
        },
      ],
      unavailable: [],
    };
    global.fetch = vi.fn(async () => jsonResponse(payload)) as typeof fetch;

    const { container } = render(<OpportunitiesHub />);
    await waitFor(() => expect(container.textContent).toContain("PENN"));
    const bracket = within(container).getByRole<HTMLButtonElement>("button", { name: /Bracket-Order vorbereiten/i });
    expect(bracket.disabled).toBe(true);
  });

  it("renders AffenTerminalWindow, OpportunitiesHub, and NewsPanel gracefully when macro crossAssets, scan arrays, or news symbols are missing", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("kind=macro")) {
        return jsonResponse({ updatedAt: Date.now(), fred: [], fearGreed: { value: 62, classification: "Greed", timestamp: 1 } });
      }
      if (url.includes("kind=news")) {
        return jsonResponse({
          items: [{ id: "n-partial", title: "Breaking wire", link: "https://example.com/wire", source: "Wire", publishedAt: new Date(Date.now() - 120_000).toISOString() }],
          failed: [],
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const win = render(<AffenTerminalWindow initialView="help" />);
    await waitFor(() => expect(win.container.textContent).toContain("62"));
    fireEvent.click(within(win.container).getByRole("button", { name: "Trade-Möglichkeiten" }));
    await waitFor(() => expect(win.container.textContent).toContain("0 von 0 Setups"));
    fireEvent.click(within(win.container).getByRole("button", { name: "Module" }));
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-module-view="help"]')!);
    fireEvent.click(within(win.container).getByRole("button", { name: "Trade-Möglichkeiten" }));
    expect(win.container.textContent).toContain("0 von 0 Setups");
    expect(vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url).includes("/api/terminal-opportunities"))).toHaveLength(1);

    const news = render(<NewsPanel />);
    await waitFor(() => expect(news.container.textContent).toContain("Breaking wire"));
  });

  it("restores the desktop terminal layout after leaving the compact viewport and isolates Escape to the topmost modal", () => {
    const mm = createMatchMediaController({ [COMPACT_WORKSPACE_QUERY]: false });
    window.matchMedia = mm.mockMatchMedia;
    global.fetch = vi.fn(async () => jsonResponse({})) as typeof fetch;

    const { container } = render(<ResearchTerminal externalWindow initialView="help" />);
    const root = container.querySelector(".research-terminal")!;
    expect(root.className).not.toContain("is-single-pane");
    expect(container.querySelector(".terminal-tertiary-pane")).not.toBeNull();

    act(() => mm.setMatches(COMPACT_WORKSPACE_QUERY, true));
    expect(root.className).toContain("is-single-pane");
    expect(container.querySelector(".terminal-secondary-pane")).toBeNull();

    act(() => mm.setMatches(COMPACT_WORKSPACE_QUERY, false));
    expect(root.className).not.toContain("is-single-pane");
    expect(container.querySelector(".terminal-tertiary-pane")).not.toBeNull();

    // Topmost Modal captures Escape without dismissing an underlying useDismiss menu
    function PopoverWithModal() {
      const [menuOpen, setMenuOpen] = useState(true);
      const [modalOpen, setModalOpen] = useState(true);
      const ref = useDismiss(menuOpen, () => setMenuOpen(false));
      return (
        <div ref={ref}>
          {menuOpen ? <div data-testid="underlying-menu">Menu</div> : null}
          {modalOpen ? (
            <Modal title="Nested dialog" onClose={() => setModalOpen(false)}>
              <input aria-label="Dialog field" />
            </Modal>
          ) : null}
        </div>
      );
    }

    const nested = render(<PopoverWithModal />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(nested.queryByRole("dialog")).toBeNull();
    expect(nested.queryByTestId("underlying-menu")).not.toBeNull();
  });

  it("exposes explicit touch-friendly rename buttons in ObjectTree for drawings and groups", () => {
    const { container } = render(<ObjectTree />);
    const renameBtn = within(container).getByRole("button", { name: "Rename drawing" });
    fireEvent.click(renameBtn);
    const input = within(container).getByRole("textbox", { name: "Rename drawing" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Macro Supply Line" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useChartStore.getState().drawingTrees.BTCUSDT?.names.d1).toBe("Macro Supply Line");

    // Create a group and rename it via the explicit Rename group button
    fireEvent.click(within(container).getByRole("button", { name: "New group" }));
    const renameGroupBtn = within(container).getByRole("button", { name: "Rename group" });
    fireEvent.click(renameGroupBtn);
    const groupInput = within(container).getByRole("textbox", { name: "Rename group" }) as HTMLInputElement;
    fireEvent.change(groupInput, { target: { value: "Key Levels" } });
    fireEvent.keyDown(groupInput, { key: "Enter" });
    expect(useChartStore.getState().drawingTrees.BTCUSDT?.groups[0]?.name).toBe("Key Levels");
  });

  it("adapts Watchlist row height between 30px desktop and 40px touch/mobile media queries and exposes ChartToolbarOverflow actions", () => {
    const mm = createMatchMediaController({ "(max-width: 768px), (pointer: coarse)": false });
    window.matchMedia = mm.mockMatchMedia;
    useWatchlistStore.setState({
      activeId: "default",
      lists: [{ id: "default", name: "Main", symbols: ["BTCUSDT", "ETHUSDT"] }],
    });

    const { container } = render(<Watchlist />);
    const row = container.querySelector(".watchlist-row.dynamic") as HTMLElement;
    expect(row.style.height).toBe("30px");

    act(() => {
      mm.setMatches("(max-width: 768px), (pointer: coarse)", true);
    });
    expect((container.querySelector(".watchlist-row.dynamic") as HTMLElement).style.height).toBe("40px");

    // ChartToolbarOverflow exposes Compare symbol, Create alert, and Bar Replay in mobile overflow
    const overflow = render(<ChartToolbarOverflow toggleSidebar={vi.fn()} />);
    fireEvent.click(within(overflow.container).getByRole("button", { name: "More chart controls" }));
    expect(within(overflow.container).getByRole("button", { name: "Compare symbol" })).toBeTruthy();
    expect(within(overflow.container).getByRole("button", { name: "Create alert" })).toBeTruthy();
    expect(within(overflow.container).getByRole("button", { name: /Bar Replay|Stop replay/i })).toBeTruthy();
  });

  it("sizes 100% limit orders against limit price instead of spot so broker.ts never rejects buying power, and clamps PriceLevelMenu above mobile bottom edge", () => {
    const account = createAccount({ cash: 100_000, feeRate: 0.001, slippageBps: 0 });
    usePaperStore.setState({
      live: account,
      prices: { BTCUSDT: 50_000 },
      ticket: {
        ...DEFAULT_TICKET,
        side: "buy",
        type: "limit",
        quantity: 1,
        price: 60_000,
        exitLevels: undefined,
      },
    });

    const { container } = render(<TradingPanel />);
    fireEvent.click(within(container).getByRole("button", { name: "100%" }));
    const sizedQty = usePaperStore.getState().ticket.quantity;
    expect(sizedQty).toBeLessThanOrEqual(100_000 / (60_000 * 1.001));
    const placed = placeOrder(
      account,
      { symbol: "BTCUSDT", side: "buy", type: "limit", quantity: sizedQty, price: 60_000 },
      { BTCUSDT: 50_000 },
      Date.now(),
    );
    expect(placed.order.status).not.toBe("rejected");

    // PriceLevelMenu with 3 mobile buttons clamps safely above window.innerHeight - 142
    Object.defineProperty(window, "innerWidth", { value: 360, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const menuHarness = render(
      <PriceLevelMenu price={91_250} draw={vi.fn()} drawArea={vi.fn()}>
        {(actions) => (
          <button
            type="button"
            {...actions}
            ref={(el) => {
              if (el) {
                el.getBoundingClientRect = () =>
                  ({ left: 320, top: 755, bottom: 785, right: 356, width: 36, height: 30, x: 320, y: 755, toJSON: () => ({}) }) as DOMRect;
              }
            }}
          >
            Trigger level
          </button>
        )}
      </PriceLevelMenu>,
    );
    fireEvent.contextMenu(within(menuHarness.container).getByRole("button", { name: "Trigger level" }));
    const group = document.body.querySelector('[role="group"][aria-label*="91250"]') as HTMLElement;
    expect(group).toBeTruthy();
    expect(parseFloat(group.style.top)).toBeLessThanOrEqual(800 - 142);
    expect(parseFloat(group.style.left)).toBeLessThanOrEqual(360 - 168);
  });

  it("exposes Konto erstellen directly in MainMenu alongside Konto and Konto anmelden", async () => {
    const { MainMenu } = await import("@/components/WorkspaceMenus");
    const { container } = render(<MainMenu onExport={vi.fn()} onImport={vi.fn()} />);
    fireEvent.click(within(container).getByRole("button", { name: "Main menu" }));
    expect(within(container).getByRole("button", { name: "Konto" })).toBeTruthy();
    expect(within(container).getByRole("button", { name: "Konto erstellen" })).toBeTruthy();
    expect(within(container).getByRole("button", { name: "Konto anmelden" })).toBeTruthy();
  });

  it("renders tablet Watchlist with edit toggle and full-height flex rows (no 396px inline cap)", async () => {
    const { Watchlist } = await import("@/components/Watchlist");
    const { container } = render(<Watchlist tablet />);
    const editBtn = within(container).getByRole("button", { name: "Watchlist bearbeiten" });
    expect(editBtn.getAttribute("aria-pressed")).toBe("false");
    const rows = container.querySelector(".watchlist-rows.virtual") as HTMLElement | null;
    expect(rows).toBeTruthy();
    expect(rows?.style.height).toBe("");
    fireEvent.click(editBtn);
    expect(within(container).getByRole("button", { name: "Bearbeitung beenden" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("handles MarketService.resumeFromBackground safely without side effects when stopped", async () => {
    const { marketService } = await import("@/lib/market/service");
    marketService.stop();
    expect(marketService.resumeFromBackground()).toBe(false);
  });

  it("renders ultra-minimal 5-control PhoneChartActions bar with unified phone hub and MainMenuSheet", async () => {
    const { PhoneChartActions } = await import("@/components/WorkspaceToolbar");
    const openAlerts = vi.fn();
    const openPanel = vi.fn();
    const toggleWatchlist = vi.fn();
    const { container } = render(
      <PhoneChartActions
        drawingOpen={false}
        toggleDrawing={vi.fn()}
        toggleSidebar={vi.fn()}
        tradingOpen={false}
        toggleTrading={vi.fn()}
        watchlistOpen={false}
        toggleWatchlist={toggleWatchlist}
        openAlerts={openAlerts}
        openObjects={vi.fn()}
        openPanel={openPanel}
        alertCount={2}
        onExport={vi.fn()}
        onImport={vi.fn()}
        phoneStatus={{ label: "Live", description: "Binance · Live", connected: true }}
      />,
    );
    const bar = container.querySelector(".phone-chart-actions") as HTMLElement;
    const directControls = bar.querySelectorAll(":scope > button, :scope > .toolbar-popover-host > button, :scope > .toolbar-mobile-overflow > button");
    expect(directControls.length).toBe(5);

    fireEvent.click(within(bar).getByRole("button", { name: "Watchlists" }));
    expect(toggleWatchlist).toHaveBeenCalledTimes(1);

    fireEvent.click(within(bar).getByRole("button", { name: "More chart controls" }));
    expect(within(bar).getByRole("button", { name: "Indicators" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Alerts" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Schwebende Objektleiste" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "More workspace panels" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Terminal" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: /Chart type:/i })).toBeTruthy();

    fireEvent.click(within(bar).getByRole("button", { name: "Main menu" }));
    expect(within(document.body).getByRole("button", { name: "Konto erstellen" })).toBeTruthy();
  });

  it("skips JSON serialization in usePaperStore during live observePrice and observeBook ticks", async () => {
    const { isPaperPersistenceBuffering } = await import("@/lib/trading/paperPersistence");
    expect(isPaperPersistenceBuffering()).toBe(false);
    const stringifySpy = vi.spyOn(JSON, "stringify");
    usePaperStore.getState().observePrice("BTCUSDT", 91_500, false);
    usePaperStore.getState().observeBook({
      symbol: "BTCUSDT",
      bids: [{ price: 91_499, quantity: 1.5 }],
      asks: [{ price: 91_501, quantity: 1.2 }],
      time: Date.now(),
      simulated: false,
    });
    expect(stringifySpy).not.toHaveBeenCalled();
  });
});
