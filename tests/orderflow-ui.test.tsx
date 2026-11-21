// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { Profiler } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OrderFlowPanel } from "@/components/OrderFlowPanel";
import { FootprintInspector } from "@/components/FootprintInspector";
import { DomPanel } from "@/components/DomPanel";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import * as readout from "@/hooks/useChartReadout";
import * as domTradesHook from "@/hooks/useDomTrades";
import * as domGridHook from "@/hooks/useDomPriceGrid";
import { replayDepth, REPLAY_DEPTH_RETENTION_MS } from "@/lib/orderflow/replayDepth";
import { DomTrades } from "@/lib/orderflow/domTrades";
import * as timeSales from "@/lib/orderflow/timeSales";
import { clearFootprintSurface, publishFootprintSurface } from "@/lib/orderflow/footprintReadout";
import type { FootprintInspectionTarget } from "@/lib/orderflow/footprintInspection";
import { rangeProfileSourceStamp } from "@/lib/orderflow/executionRangeSource";
import { footprints } from "@/lib/orderflow/math";
import type { OrderBook, Tick } from "@/types/trading";

const { renderTradeRow, renderBook } = vi.hoisted(() => ({ renderTradeRow: vi.fn(), renderBook: vi.fn() }));
vi.mock("@/components/PriceLevelMenu", () => ({
  PriceLevelMenu: ({ price }: { price: number }) => { renderTradeRow(price); return <span>{price}</span>; },
}));
vi.mock("@/components/BookView", () => ({
  BookView: ({ book }: { book: OrderBook }) => { renderBook(book); return <div>Observed bid {book.bids[0]?.price}</div>; },
}));

const initialReplay = useWorkspaceStore.getState().replay;
const initialDomPreferences = useWorkspaceStore.getState().domPreferences;
function depth(time: number, bid = 99): OrderBook {
  return { symbol: "HL:BTC", time, simulated: false, bids: [{ price: bid, quantity: 2 }], asks: [{ price: bid + 2, quantity: 3 }] };
}

function sampleTicks(count = 4, qtyScale = 1): Tick[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `t-${idx}-${qtyScale}`,
    symbol: "HL:BTC",
    time: 60_000 + idx * 1_000,
    price: 100 + idx,
    quantity: (idx === 0 ? 10 : 50 + idx * 10) * qtyScale,
    side: idx === 0 ? "sell" : "buy",
    simulated: false,
  }));
}

describe("OrderFlowPanel & FootprintInspector UI regression", () => {
  const token = Symbol("orderflow-ui-test");

  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.getState().setReplay(initialReplay);
    useChartStore.setState({
      symbol: "HL:BTC",
      timeframe: "1m",
      chartType: "footprint",
      feedEpoch: 1,
      feedMode: "auto",
      dataSources: { "HL:BTC:1m": "exchange" },
      marketEpochs: { "HL:BTC": 1 },
      candles: [{ time: 60_000, open: 102, high: 105, low: 99, close: 100.5, volume: 200 }],
      trades: sampleTicks(4),
      indicators: [],
      orderBook: null,
    });
  });

  afterEach(() => {
    clearFootprintSurface("primary", token);
    cleanup();
    useWorkspaceStore.getState().setReplay(initialReplay);
    useWorkspaceStore.setState({ domPreferences: initialDomPreferences });
    renderTradeRow.mockClear();
    renderBook.mockClear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders FootprintInspector rows, diagonal ratios, validation, and live autoFollow without idle 120ms loops", async () => {
    vi.useFakeTimers();
    const stamp = rangeProfileSourceStamp("HL:BTC", "1m");
    const bars = footprints(sampleTicks(4, 1), "1m", 1, 3, { ignoreZeroOpposite: false });
    publishFootprintSurface("primary", token, {
      symbol: "HL:BTC",
      timeframe: "1m",
      epoch: 1,
      sourceStamp: stamp,
      bars,
      simulated: false,
      dropped: 0,
      analysis: { step: 1, ratio: 3, minimumVolume: 0, ignoreZeroOpposite: false, minimumStackRows: 3 },
    });

    const target: FootprintInspectionTarget = {
      cell: "primary",
      symbol: "HL:BTC",
      timeframe: "1m",
      epoch: 1,
      time: 60_000,
      replay: false,
      sourceStamp: stamp,
    };

    render(<FootprintInspector target={target} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect footprint rows…" }));

    const dialog = screen.getByRole("dialog", { name: "Footprint row inspection" });
    expect(within(dialog).getByText(/Collected volume 220/i)).toBeTruthy();
    expect(within(dialog).getByLabelText("Captured footprint price rows")).toBeTruthy();
    expect(within(dialog).getAllByText(/↑ ∞/).length).toBeGreaterThanOrEqual(1);

    // Enable Auto-follow live: fires initial 120ms capture ONCE, then stops re-capturing while surface is idle
    const autoFollowCheckbox = within(dialog).getByLabelText("Auto-follow live") as HTMLInputElement;
    fireEvent.click(autoFollowCheckbox);
    expect(autoFollowCheckbox.checked).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(within(dialog).getByText(/Collected volume 220/i)).toBeTruthy();

    // Advance 3 seconds while idle — timer queue must NOT perpetually refresh timestamp/volume
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    setTimeoutSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    // Real surface mutation DOES trigger one 120ms debounced recapture
    const updatedBars = footprints(sampleTicks(4, 2), "1m", 1, 3, { ignoreZeroOpposite: false });
    await act(async () => {
      publishFootprintSurface("primary", token, {
        symbol: "HL:BTC",
        timeframe: "1m",
        epoch: 1,
        sourceStamp: stamp,
        bars: updatedBars,
        simulated: false,
        dropped: 0,
        analysis: { step: 1, ratio: 3, minimumVolume: 0, ignoreZeroOpposite: false, minimumStackRows: 3 },
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(within(dialog).getByText(/Collected volume 440/i)).toBeTruthy();

    // Invalid minimum volume validation guard
    const minInput = within(dialog).getByLabelText("Minimum footprint row volume");
    fireEvent.change(minInput, { target: { value: "-5" } });
    expect(within(dialog).getByRole("alert").textContent).toContain("nonnegative");
  });

  it("renders OrderFlowPanel tape, pause controls, and Footprint toggle actions cleanly", () => {
    render(<OrderFlowPanel />);
    expect(screen.getByText(/Time & sales · HL:BTC/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause tape" })).toBeTruthy();
    expect(screen.queryByLabelText("Trade side filter")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tape settings" }));
    const settings = screen.getByRole("dialog", { name: "Tape filters & display" });
    fireEvent.change(within(settings).getByLabelText("Trade side filter"), { target: { value: "buy" } });
    expect(within(settings).getByRole("button", { name: "Export filtered trades CSV" })).toBeTruthy();
    fireEvent.click(within(settings).getByRole("button", { name: "Close dialog" }));
    expect(within(screen.getByRole("table", { name: "Filtered time and sales" })).getAllByRole("row")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Tape details" }));
    const details = screen.getByRole("dialog", { name: "Tape details" });
    expect(within(details).getByLabelText("Totals across all matching executions")).toBeTruthy();
    fireEvent.click(within(details).getByRole("button", { name: "Close dialog" }));

    // Toggle Footprint chartType off -> candles
    fireEvent.click(screen.getByText("Chart tools"));
    fireEvent.click(screen.getByRole("button", { name: "Footprint" }));
    expect(useChartStore.getState().chartType).toBe("candles");

    // Toggle TPO profile on -> tpo
    fireEvent.click(screen.getByRole("button", { name: "TPO profile" }));
    expect(useChartStore.getState().chartType).toBe("tpo");
  });

  it("samples the newest retained tape once per refresh window", async () => {
    vi.useFakeTimers();
    render(<OrderFlowPanel />);
    const tape = within(screen.getByRole("table", { name: "Filtered time and sales" }));
    expect(tape.getAllByRole("row")).toHaveLength(5);

    for (let count = 5; count <= 9; count++) {
      await act(async () => {
        useChartStore.getState().set({ trades: sampleTicks(count) });
        await vi.advanceTimersByTimeAsync(16);
      });
      expect(tape.getAllByRole("row")).toHaveLength(5);
    }

    await act(async () => vi.advanceTimersByTimeAsync(40));
    expect(tape.getAllByRole("row")).toHaveLength(10);
  });

  it("refreshes depth and elapsed time without rendering Time and Sales rows again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(64_000);
    useChartStore.setState({ orderBook: depth(64_000) });
    render(<OrderFlowPanel />);
    expect(screen.getByText("Observed bid 99")).toBeTruthy();
    expect(renderTradeRow).toHaveBeenCalled();
    renderTradeRow.mockClear();

    act(() => useChartStore.setState({ orderBook: depth(64_000, 100) }));
    expect(screen.getByText("Observed bid 100")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(5500));
    expect(screen.getByText(/Order book is stale/)).toBeTruthy();
    expect(screen.getByText(/6s ago/)).toBeTruthy();
    expect(renderTradeRow).not.toHaveBeenCalled();
  });

  it("renders only added Time and Sales rows when a live refresh retains the existing trades", async () => {
    vi.useFakeTimers();
    const retained = sampleTicks().map(trade => Object.freeze(trade));
    useChartStore.setState({ trades: retained });
    render(<OrderFlowPanel />);
    expect(renderTradeRow.mock.calls.map(([price]) => price)).toEqual([103, 102, 101, 100]);
    renderTradeRow.mockClear();

    const added = Object.freeze({ ...retained[0], id: "added", time: 65_000, price: 200 });
    act(() => useChartStore.setState({ trades: [added, ...retained] }));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(renderTradeRow.mock.calls.map(([price]) => price)).toEqual([200]);
    const tape = screen.getByRole("table", { name: "Filtered time and sales" });
    expect(within(tape).getAllByRole("row")).toHaveLength(6);
  });

  it("suspends hidden phone views and resumes with fresh data or a paused snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(70_000);
    useChartStore.setState({ orderBook: depth(70_000) });
    let width = 230;
    let resize = () => {};
    const bounds = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("flow-switch") ? new DOMRect(0, 0, width, 36) : bounds.call(this);
    });
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    const filter = vi.spyOn(timeSales, "filterTimeSales");
    render(<OrderFlowPanel />);
    const switcher = within(screen.getByRole("group", { name: "Order flow views" }));

    renderBook.mockClear();
    for (let bid = 100; bid < 105; bid++) {
      act(() => useChartStore.setState({ orderBook: depth(Date.now(), bid) }));
      await act(async () => vi.advanceTimersByTimeAsync(500));
    }
    expect(renderBook).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Pause tape" }));
    fireEvent.click(switcher.getByRole("button", { name: "Order book" }));
    expect(screen.getByText("Observed bid 104")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Filtered time and sales" })).toBeNull();
    filter.mockClear();
    for (let count = 5; count <= 9; count++) {
      act(() => useChartStore.setState({ trades: sampleTicks(count) }));
      await act(async () => vi.advanceTimersByTimeAsync(110));
    }
    expect(filter).not.toHaveBeenCalled();
    fireEvent.click(switcher.getByRole("button", { name: "Time & sales" }));
    const tape = within(screen.getByRole("table", { name: "Filtered time and sales" }));
    expect(tape.getAllByRole("row")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Resume tape" }));
    expect(tape.getAllByRole("row")).toHaveLength(10);

    width = 0;
    act(resize);
    expect(screen.getByText("Observed bid 104")).toBeTruthy();
    expect(tape.getAllByRole("row")).toHaveLength(10);
  });

  it("keeps collecting DOM executions without projecting hidden columns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(64_000);
    useChartStore.setState({ orderBook: depth(64_000) });
    useWorkspaceStore.getState().setDomPreferences({ view: "book" });
    const model = new DomTrades("HL:BTC", 63_000);
    vi.spyOn(domTradesHook, "useDomTrades").mockReturnValue(model);
    vi.spyOn(domGridHook, "useDomPriceGrid").mockReturnValue({ pending: false, error: "" });
    const rows = vi.spyOn(model, "rows");

    render(<DomPanel />);
    const ladder = within(screen.getByRole("table", { name: "Depth of market" }));
    expect(ladder.getAllByRole("columnheader")).toHaveLength(3);
    expect(model.add({ ...sampleTicks()[0], time: Date.now(), price: 100 }, Date.now())).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(rows).not.toHaveBeenCalled();

    act(() => useWorkspaceStore.getState().setDomPreferences({ view: "configured" }));
    expect(ladder.getByRole("columnheader", { name: "Sold" })).toBeTruthy();
    expect(rows.mock.results.at(-1)?.value.get(100)?.sold).toBe(10);
    expect(model.observations).toBe(1);

    act(() => useWorkspaceStore.getState().setDomPreferences({ view: "book" }));
    rows.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(rows).not.toHaveBeenCalled();
  });

  it("keeps Replay idle across live books and updates recorded depth on restore and expiry", async () => {
    vi.useFakeTimers();
    const through = Date.UTC(2026, 10, 16, 11);
    vi.setSystemTime(through + 1000);
    const snapshot = { symbol: "HL:BTC", timeframe: "1m", marketEpoch: 1, status: "ready", replay: true, replayThrough: through };
    vi.spyOn(readout, "useChartReadout").mockReturnValue(snapshot as ReturnType<typeof readout.useChartReadout>);
    useWorkspaceStore.getState().setReplay({ active: true, playing: false });
    const commits = vi.fn();
    render(<Profiler id="orderflow" onRender={commits}><OrderFlowPanel /></Profiler>);
    expect(screen.getByText(/No retained depth snapshot/)).toBeTruthy();
    commits.mockClear();

    act(() => useChartStore.setState({ orderBook: depth(through + 1000) }));
    await act(async () => vi.advanceTimersByTimeAsync(3500));
    expect(commits).not.toHaveBeenCalled();

    act(() => replayDepth.restore(depth(through - 1000), through - 500));
    expect(screen.getByText("Observed bid 99")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(REPLAY_DEPTH_RETENTION_MS));
    expect(screen.getByText(/No retained depth snapshot/)).toBeTruthy();
    expect(screen.queryByText("Observed bid 99")).toBeNull();
  });
});
