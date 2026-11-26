// @vitest-environment jsdom
import { Profiler } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PortfolioPanel } from "@/components/PortfolioPanel";
import { useChartStore } from "@/stores/useChartStore";
import { usePortfolioStore } from "@/stores/usePortfolioStore";
import type { Quote } from "@/types/trading";

const { renderBadge } = vi.hoisted(() => ({ renderBadge: vi.fn() }));
vi.mock("@/components/ui", () => ({ AssetBadge: () => { renderBadge(); return null; } }));
const initialChart = useChartStore.getState();
const initialPortfolio = usePortfolioStore.getState();

afterEach(() => {
  cleanup();
  useChartStore.setState(initialChart);
  usePortfolioStore.setState(initialPortfolio);
  vi.clearAllMocks();
});

function quote(symbol: string, price: number, changePercent = 0, time = 1): Quote {
  return {
    symbol, price, previous: price, change: 0, changePercent, high: price,
    low: price, volume: 0, history: [price], time, simulated: false,
  };
}

it("revalues only when a held market changes and uses the latest draft price on submit", () => {
  usePortfolioStore.setState({
    activeId: "test",
    portfolios: [{ id: "test", name: "Test", lots: [
      { id: "held", symbol: "ETHUSDT", side: "buy", quantity: 2, price: 100, time: 1, fee: 0 },
    ] }],
  });
  useChartStore.setState({ quotes: { ETHUSDT: quote("ETHUSDT", 110), BTCUSDT: quote("BTCUSDT", 500) } });
  const commits = vi.fn();
  const { container, getByLabelText, getByRole } = render(<Profiler id="portfolio" onRender={commits}><PortfolioPanel /></Profiler>);
  const update = (symbol: string, price: number, changePercent?: number, time?: number) => {
    act(() => useChartStore.setState(state => ({ quotes: { ...state.quotes, [symbol]: quote(symbol, price, changePercent, time) } })));
  };
  const value = () => container.querySelector(".metrics-grid .metric strong")?.textContent;
  expect(value()).toBe("220.00 USDT");
  const priceInput = getByLabelText("Price");
  expect(priceInput.getAttribute("placeholder")).toBe("Price (500.00)");
  commits.mockClear();
  renderBadge.mockClear();

  update("SOLUSDT", 40);
  update("ETHUSDT", 110, 0, 2);
  expect(commits).not.toHaveBeenCalled();
  update("BTCUSDT", 505);
  expect(priceInput.getAttribute("placeholder")).toBe("Price (505.00)");
  expect(renderBadge).not.toHaveBeenCalled();
  update("ETHUSDT", 110, 2);
  expect(container.querySelector(".portfolio-grid tbody td:nth-child(7)")?.textContent).toBe("+2.00%");
  update("ETHUSDT", 120, 2);
  expect(value()).toBe("240.00 USDT");

  fireEvent.change(getByLabelText("Quantity"), { target: { value: "1" } });
  fireEvent.click(getByRole("button", { name: /^Add$/ }));
  expect(usePortfolioStore.getState().portfolios[0].lots.at(-1)).toMatchObject({ symbol: "BTCUSDT", price: 505, quantity: 1 });
  expect(value()).toBe("745.00 USDT");
});
