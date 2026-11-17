// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Watchlist } from "@/components/Watchlist";
import { useQuoteRanges } from "@/hooks/useQuoteRanges";
import { useChartStore } from "@/stores/useChartStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import type { Quote } from "@/types/trading";

vi.mock("@/hooks/useQuoteRanges", () => ({ useQuoteRanges: vi.fn() }));
vi.mock("@/components/TechnicalsCard", () => ({ TechnicalsCard: () => null }));

function quote(symbol: string, price: number): Quote {
  return {
    symbol, price, previous: price, change: 0, changePercent: 0,
    high: price, low: price, volume: 0, history: [price], time: 1, simulated: false,
  };
}

const initialChart = useChartStore.getState();
const initialWatchlist = useWatchlistStore.getState();

afterEach(() => {
  cleanup();
  useChartStore.setState(initialChart);
  useWatchlistStore.setState(initialWatchlist);
  vi.clearAllMocks();
});

it("updates quote cells independently and renders the list again when the sorted order changes", () => {
  useWatchlistStore.setState({
    activeId: "test",
    lists: [{ id: "test", name: "Test list", symbols: ["BTCUSDT", "ETHUSDT"] }],
    columns: ["last"],
    sort: { column: "last", direction: "desc" },
  });
  useChartStore.setState({
    symbol: "BTCUSDT",
    quotes: { BTCUSDT: quote("BTCUSDT", 200), ETHUSDT: quote("ETHUSDT", 100) },
  });
  const { container } = render(<Watchlist />);
  const rows = () => [...container.querySelectorAll(".watchlist-row")].map((row) => row.querySelector(".watch-cell")?.textContent);
  const update = (symbol: string, price: number) => {
    act(() => useChartStore.setState((s) => ({ quotes: { ...s.quotes, [symbol]: quote(symbol, price) } })));
  };
  const renders = () => vi.mocked(useQuoteRanges).mock.calls.length;
  const initialRenders = renders();

  expect(rows()).toEqual(["200.00", "100.00"]);
  update("SOLUSDT", 500);
  update("ETHUSDT", 110);
  update("BTCUSDT", 210);
  expect(rows()).toEqual(["210.00", "110.00"]);
  expect(container.querySelector(".detail-price")?.textContent).toContain("210.00");
  expect(renders()).toBe(initialRenders);

  update("ETHUSDT", 250);
  expect(rows()).toEqual(["250.00", "210.00"]);
  expect(renders()).toBeGreaterThan(initialRenders);
});
