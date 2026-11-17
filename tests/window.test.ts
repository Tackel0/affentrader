import { afterEach, describe, expect, it } from "vitest";
import { parseLinkMessage } from "@/lib/windowLink";
import { isPopout, popoutId, scopedName } from "@/lib/windowScope";

describe("window scope isolation", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true, writable: true });
    }
  });

  function mockLocation(pathname: string, search = "") {
    Object.defineProperty(globalThis, "window", {
      value: { location: { pathname, search } },
      configurable: true,
      writable: true,
    });
  }

  it("keeps main workspace unscoped on / and honors explicit ?window= popout params", () => {
    mockLocation("/");
    expect(popoutId()).toBeNull();
    expect(isPopout()).toBe(false);
    expect(scopedName("affentrader-chart-v1")).toBe("affentrader-chart-v1");

    mockLocation("/", "?window=pop123ab");
    expect(popoutId()).toBe("pop123ab");
    expect(isPopout()).toBe(true);
    expect(scopedName("affentrader-chart-v1")).toBe("affentrader-chart-v1@pop123ab");
  });

  it("always isolates /terminal into a non-main scope even without ?window=", () => {
    mockLocation("/terminal");
    expect(popoutId()).toBe("affen-terminal");
    expect(isPopout()).toBe(true);
    expect(scopedName("affentrader-chart-v1")).toBe("affentrader-chart-v1@affen-terminal");

    mockLocation("/terminal/research", "?window=term99");
    expect(popoutId()).toBe("term99");
    expect(scopedName("affentrader-chart-v1")).toBe("affentrader-chart-v1@term99");

    mockLocation("/terminal/");
    expect(popoutId()).toBe("affen-terminal");

    mockLocation("/terminal-other");
    expect(popoutId()).toBeNull();
  });
});

describe("window link messages", () => {
  const base = { from: "ab12cd", group: "red" };
  it("accepts a valid state message and normalizes the interval", () => {
    expect(parseLinkMessage({ ...base, type: "state", symbol: "ETHUSDT", timeframe: "15m" })).toMatchObject({
      type: "state",
      symbol: "ETHUSDT",
      timeframe: "15m",
    });
    expect(parseLinkMessage({ ...base, type: "state", symbol: "YF:AAPL", timeframe: "1D" })).not.toBeNull();
  });
  it("rejects malformed, unlinked or hostile input", () => {
    expect(parseLinkMessage(null)).toBeNull();
    expect(parseLinkMessage("state")).toBeNull();
    expect(parseLinkMessage({ ...base, group: "off", type: "state", symbol: "BTCUSDT", timeframe: "1h" })).toBeNull();
    expect(parseLinkMessage({ ...base, group: "purple", type: "state", symbol: "BTCUSDT", timeframe: "1h" })).toBeNull();
    expect(parseLinkMessage({ ...base, type: "state", symbol: "<script>", timeframe: "1h" })).toBeNull();
    expect(parseLinkMessage({ ...base, type: "state", symbol: "BTCUSDT", timeframe: "banana" })).toBeNull();
    expect(parseLinkMessage({ ...base, from: "x".repeat(40), type: "state", symbol: "BTCUSDT", timeframe: "1h" })).toBeNull();
    expect(parseLinkMessage({ ...base, type: "unknown" })).toBeNull();
  });
  it("validates crosshair points", () => {
    expect(parseLinkMessage({ ...base, type: "crosshair", point: null })).toMatchObject({ point: null });
    expect(parseLinkMessage({ ...base, type: "crosshair", point: { time: 1700000000, price: 42.5, symbol: "BTCUSDT" } })).toMatchObject({
      point: { time: 1700000000, price: 42.5, symbol: "BTCUSDT" },
    });
    expect(parseLinkMessage({ ...base, type: "crosshair", point: { time: 1, price: null } })).not.toBeNull();
    expect(parseLinkMessage({ ...base, type: "crosshair", point: { time: "1", price: 2 } })).toBeNull();
    expect(parseLinkMessage({ ...base, type: "crosshair", point: { time: 1, price: Infinity } })).toBeNull();
    expect(parseLinkMessage({ ...base, type: "crosshair", point: { time: NaN, price: 1 } })).toBeNull();
    const dropped = parseLinkMessage({ ...base, type: "crosshair", point: { time: 1, price: 2, symbol: "bad symbol" } });
    expect(dropped && dropped.type === "crosshair" && dropped.point?.symbol).toBeUndefined();
  });

  it("validates workspace link messages and rejects invalid tabs, indicators, or empty actions", () => {
    const valid = parseLinkMessage({
      ...base,
      type: "workspace",
      symbol: "IEX:AAPL",
      timeframe: "15m",
      chartType: "footprint",
      bottomOpen: true,
      bottomTab: "orderflow",
      addIndicators: ["volume-nodes", "orderflow-signals", "delta-divergence"],
      toast: { title: "Orderflow", message: "Proxy aktiv", tone: "success" },
    });
    expect(valid).toMatchObject({
      type: "workspace",
      symbol: "IEX:AAPL",
      timeframe: "15m",
      chartType: "footprint",
      bottomOpen: true,
      bottomTab: "orderflow",
      addIndicators: ["volume-nodes", "orderflow-signals", "delta-divergence"],
      toast: { title: "Orderflow", message: "Proxy aktiv", tone: "success" },
    });

    expect(parseLinkMessage({ ...base, type: "workspace" })).toBeNull();
    expect(parseLinkMessage({ ...base, type: "workspace", bottomTab: "nonexistent" })).toBeNull();
    expect(parseLinkMessage({ ...base, type: "workspace", chartType: "invalid-type" })).toBeNull();
    expect(parseLinkMessage({ ...base, type: "workspace", addIndicators: ["does-not-exist"] })).toBeNull();
    expect(parseLinkMessage({ ...base, type: "workspace", addIndicators: Array(12).fill("vpvr") })).toBeNull();
  });
});
