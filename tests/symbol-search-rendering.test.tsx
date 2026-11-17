// @vitest-environment jsdom
import React, { Profiler, type ReactNode } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SymbolSearch } from "@/components/SymbolSearch";
import { SYMBOLS } from "@/lib/symbols";
import { useChartStore } from "@/stores/useChartStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import type { Quote } from "@/types/trading";

const { renderBadge, loadCatalog } = vi.hoisted(() => ({ renderBadge: vi.fn(), loadCatalog: vi.fn() }));
vi.mock("@/hooks/useSymbolCatalog", () => ({ loadSymbolCatalog: loadCatalog }));
vi.mock("@/components/ui", () => ({
  Modal: ({ children, title }: { children: ReactNode; title: string }) => <section aria-label={title}>{children}</section>,
  AssetBadge: ({ symbol }: { symbol: string }) => {
    renderBadge(symbol);
    return null;
  },
}));

const initialChart = useChartStore.getState();
const initialWatchlist = useWatchlistStore.getState();
const kraken = "KRK:BTC/USD";

afterEach(() => {
  cleanup();
  useChartStore.setState(initialChart);
  useWatchlistStore.setState(initialWatchlist);
  vi.clearAllMocks();
});

function quote(symbol: string, price: number, time = 1): Quote {
  return {
    symbol, price, previous: price, change: 0, changePercent: 0,
    high: price, low: price, volume: 0, history: [price], time, simulated: false,
  };
}

it("isolates live price updates from the closed dialog and from labels in open results", async () => {
  loadCatalog.mockResolvedValue(SYMBOLS);
  useChartStore.setState({ searchOpen: false, searchTarget: "chart", quotes: {} });
  const commits = vi.fn();
  const { container } = render(<Profiler id="search" onRender={commits}><SymbolSearch /></Profiler>);
  const updateQuote = (symbol: string, price: number, time?: number) => {
    act(() => useChartStore.setState(state => ({ quotes: { ...state.quotes, [symbol]: quote(symbol, price, time) } })));
  };
  const krakenRow = () => [...container.querySelectorAll(".symbol-result")]
    .find(row => row.textContent?.includes("BTC / USD") && row.textContent.includes("Kraken"));

  updateQuote(kraken, 500);
  expect(commits).toHaveBeenCalledOnce();
  expect(loadCatalog).not.toHaveBeenCalled();
  await act(async () => useChartStore.setState({ searchOpen: true }));
  expect(krakenRow()?.querySelector(".mono")?.textContent).toBe("500.00");
  expect(renderBadge).toHaveBeenCalled();
  commits.mockClear();
  renderBadge.mockClear();

  updateQuote("HL:BTC", 999);
  updateQuote(kraken, 500, 2);
  expect(commits).not.toHaveBeenCalled();
  updateQuote(kraken, 501, 3);
  expect(krakenRow()?.querySelector(".mono")?.textContent).toBe("501.00");
  expect(commits).toHaveBeenCalledOnce();
  expect(renderBadge).not.toHaveBeenCalled();

  fireEvent.click(krakenRow()!);
  expect(useChartStore.getState()).toMatchObject({ symbol: kraken, searchOpen: false });
  commits.mockClear();
  updateQuote(kraken, 502);
  expect(commits).not.toHaveBeenCalled();
});

it("updates watchlist membership without closing the search", async () => {
  loadCatalog.mockResolvedValue(SYMBOLS);
  useWatchlistStore.setState({ activeId: "active", lists: [{ id: "active", name: "Active", symbols: [] }] });
  useChartStore.setState({ searchOpen: true, searchTarget: "watchlist" });
  const { container } = render(<SymbolSearch />);
  await act(async () => {});
  const row = [...container.querySelectorAll(".symbol-result")]
    .find(item => item.textContent?.includes("BTC / USD") && item.textContent.includes("Kraken"))!;
  expect(row.querySelector(".lucide-plus")).not.toBeNull();
  fireEvent.click(row);
  expect(useWatchlistStore.getState().lists[0].symbols).toEqual([kraken]);
  expect(row.querySelector(".lucide-check")).not.toBeNull();
  expect(useChartStore.getState().searchOpen).toBe(true);
});
