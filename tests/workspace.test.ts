import { describe, it, expect } from "vitest";
import { parseWorkspace } from "@/lib/workspace";
import { DEFAULT_STRATEGY_SETTINGS } from "@/lib/strategy/settings";
const workspace = () => ({
  version: 1,
  chart: {
    state: {
      symbol: "BTCUSDT",
      timeframe: "15m",
      chartType: "candles",
      feedMode: "auto",
      indicators: [],
      drawings: {},
      pineLibraries: {},
    },
  },
  watchlists: {
    state: {
      lists: [{ id: "a", name: "Crypto", symbols: ["BTCUSDT"] }],
      activeId: "a",
    },
  },
  alerts: { state: { alerts: [], logs: [] } },
});
describe("workspace import validation", () => {
  it("round trips strategy source and rejects injected strategy state", () => {
    const data = {
      ...workspace(),
      strategy: {
        state: {
          document: {
            name: "Strategy",
            source: '//@version=6\nstrategy("Strategy")',
            inputs: {},
            settings: { ...DEFAULT_STRATEGY_SETTINGS },
          },
        },
      },
    };
    expect(parseWorkspace(JSON.stringify(data)).strategy).toEqual(
      data.strategy,
    );
    Object.assign(data.strategy.state, { set: "injected" });
    expect(() => parseWorkspace(JSON.stringify(data))).toThrow(
      "Invalid strategy workspace",
    );
  });
  it("rejects injected state methods and malformed log entries", () => {
    const data = workspace();
    Object.assign(data.chart.state, { set: "overridden" });
    expect(() => parseWorkspace(JSON.stringify(data))).toThrow(
      "Unexpected workspace",
    );
    const bad = workspace() as unknown as {
      alerts: { state: { logs: unknown[] } };
    };
    bad.alerts.state.logs = [{ name: { invalid: true } }];
    expect(() => parseWorkspace(JSON.stringify(bad))).toThrow(
      "Invalid alert log",
    );
  });
  it("round trips a complete workspace", () => {
    const data = workspace();
    expect(parseWorkspace(JSON.stringify(data))).toEqual(data);
  });
  it("preserves an unfinished Pine draft and validates its fields", () => {
    const data = workspace();
    Object.assign(data.chart.state, {
      bottomTab: "strategy",
      pineDraft: { name: "Draft", source: "", activeId: null },
    });
    expect(parseWorkspace(JSON.stringify(data))).toEqual(data);
    Object.assign(data.chart.state, {
      pineDraft: { name: "Draft", source: 123, activeId: null },
    });
    expect(() => parseWorkspace(JSON.stringify(data))).toThrow(
      "Invalid Pine editor draft",
    );
  });
  it.each(["invalid-json", "{}", '{"version":2}'])(
    "rejects invalid format %s",
    (source) => expect(() => parseWorkspace(source)).toThrow(),
  );
  it("rejects missing active watchlist", () => {
    const data = workspace();
    data.watchlists.state.activeId = "missing";
    expect(() => parseWorkspace(JSON.stringify(data))).toThrow(
      "Active watchlist",
    );
  });
  it("rejects invalid markets and intervals", () => {
    const data = workspace();
    data.chart.state.timeframe = "invalid";
    expect(() => parseWorkspace(JSON.stringify(data))).toThrow("Invalid chart");
  });
  it("rejects incomplete indicator objects", () => {
    const data = workspace() as unknown as {
      chart: { state: { indicators: unknown[] } };
    };
    data.chart.state.indicators = [{ id: "bad" }];
    expect(() => parseWorkspace(JSON.stringify(data))).toThrow(
      "Invalid indicator",
    );
  });
});
