// @vitest-environment jsdom
import { Profiler } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { ChartCanvas } from "@/components/ChartCanvas";
import { useVelaChart } from "@/hooks/useVelaChart";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { OHLCV } from "@/types/trading";

vi.mock("@/hooks/useVelaChart", () => ({ useVelaChart: vi.fn() }));
vi.mock("@/hooks/useOverlays", () => ({ useOverlays: () => {} }));
vi.mock("@/components/OrderModification", () => ({ WorkingOrderControls: () => null }));
vi.mock("@/components/ChartOrderEditor", () => ({ ChartOrderEditor: () => null }));
vi.mock("@/components/PositionActions", () => ({ ChartPositionBar: () => null }));
vi.mock("@/components/ChartTrading", () => ({ ChartTrading: () => null }));
vi.mock("@/components/Indicators", () => ({ IndicatorChips: () => null }));
vi.mock("@/components/ChartCoverage", () => ({ ChartCoverage: () => null }));
vi.mock("@/components/DerivedChartIssue", () => ({ DerivedChartIssue: () => null }));

const initialChart = useChartStore.getState();
const initialWorkspace = useWorkspaceStore.getState();
const bar = (time: number, close: number): OHLCV => ({ time, open: close, high: close, low: close, close, volume: 1 });

afterEach(() => {
  cleanup();
  useChartStore.setState(initialChart);
  useWorkspaceStore.setState(initialWorkspace);
  vi.resetAllMocks();
});

it("updates the OHLC strip for ticks and hover without rerendering the chart shell", () => {
  const market = { symbol: "BTCUSDT", timeframe: "1m" } as const;
  const chart = { market } as NonNullable<ReturnType<typeof useVelaChart>["chart"]>;
  const readout = createStore<{ hovered: OHLCV | null; replayBar: OHLCV | null }>()(() => ({ hovered: null, replayBar: null }));
  vi.mocked(useVelaChart).mockReturnValue({ chart, loading: false, readout });
  const previous = bar(60_000, 100), historical = bar(120_000, 110);
  useChartStore.setState({ ...market, chartError: null, candles: [previous, historical, bar(180_000, 120)] });

  const commits = vi.fn();
  const { container } = render(<Profiler id="chart" onRender={commits}><ChartCanvas /></Profiler>);
  const close = () => container.querySelector(".ohlc-close")?.textContent;
  const change = () => container.querySelector(".bar-change")?.textContent;
  const shellRenders = vi.mocked(useVelaChart).mock.calls.length;
  expect(close()).toBe("C120.00");

  act(() => useChartStore.setState({ candles: [previous, historical, bar(180_000, 125)] }));
  expect(close()).toBe("C125.00");
  act(() => readout.setState({ hovered: historical }));
  expect(close()).toBe("C110.00");
  expect(change()).toBe("+10.00 (+10.00%)");
  const hoveredCommits = commits.mock.calls.length;
  act(() => useChartStore.setState({ candles: [previous, historical, bar(180_000, 127)] }));
  act(() => readout.setState({ hovered: { ...historical } }));
  expect(commits).toHaveBeenCalledTimes(hoveredCommits);

  act(() => useChartStore.setState({ candles: [bar(60_000, 105), historical, bar(180_000, 127)] }));
  expect(change()).toBe("+5.00 (+4.76%)");
  act(() => readout.setState({ hovered: null }));
  expect(close()).toBe("C127.00");
  expect(vi.mocked(useVelaChart)).toHaveBeenCalledTimes(shellRenders);

  act(() => useChartStore.setState({ timeframe: "5m" }));
  expect(close()).toBeUndefined();
});

it("hides future bar changes when rewinding Replay and ignores future candle updates", () => {
  const market = { symbol: "BTCUSDT", timeframe: "1m" } as const;
  const chart = { market } as NonNullable<ReturnType<typeof useVelaChart>["chart"]>;
  const previous = bar(60_000, 100), revealed = bar(120_000, 110);
  const readout = createStore<{ hovered: OHLCV | null; replayBar: OHLCV | null }>()(() => ({ hovered: null, replayBar: revealed }));
  vi.mocked(useVelaChart).mockReturnValue({ chart, loading: false, readout });
  useChartStore.setState({ ...market, chartError: null, candles: [previous, revealed, bar(180_000, 140)] });
  useWorkspaceStore.setState({ replay: { ...initialWorkspace.replay, active: true, cursorTime: revealed.time } });

  const commits = vi.fn();
  const { container } = render(<Profiler id="replay" onRender={commits}><ChartCanvas /></Profiler>);
  expect(container.querySelector(".ohlc-close")?.textContent).toBe("C110.00");
  expect(container.querySelector(".bar-change")?.textContent).toBe("+10.00 (+10.00%)");

  const initialCommits = commits.mock.calls.length;
  act(() => useChartStore.setState({ candles: [previous, revealed, bar(180_000, 145)] }));
  expect(commits).toHaveBeenCalledTimes(initialCommits);
  act(() => useWorkspaceStore.setState(state => ({ replay: { ...state.replay, cursorTime: previous.time } })));
  expect(container.querySelector(".bar-change")).toBeNull();
});
