import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadYahooBars, type ChartPayload } from "@/lib/market/yahooClient";
import { parseMeta } from "@/lib/market/yahoo";
const now = Date.UTC(2026, 10, 4), day = 86400000;
const payload: ChartPayload = { meta: parseMeta({ symbol: "AAPL" }), rows: [], adj: [], events: { dividends: [], splits: [] } };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());
it("does not overfetch before an explicit Replay source window", async () => {
  const chartLoader = vi.fn(async () => payload), start = now - 25 * day, end = now - 6 * day;
  await loadYahooBars({ ticker: "AAPL", timeframe: "15m", count: 20000, start, end, extended: true, adjustDividends: false, chartLoader });
  expect(chartLoader).toHaveBeenCalledWith("AAPL", "15m", start, end, true);
});
it("anchors provider retention to now rather than to a historical requested end", async () => {
  const chartLoader = vi.fn(async () => payload), end = now - 6 * day;
  await loadYahooBars({ ticker: "AAPL", timeframe: "15m", count: 20000, end, extended: true, adjustDividends: false, chartLoader });
  expect(chartLoader).toHaveBeenCalledWith("AAPL", "15m", now - 59 * day, end, true);
});
it("rejects a wholly expired history window without making an impossible provider request", async () => {
  const chartLoader = vi.fn(async () => payload);
  await expect(loadYahooBars({ ticker: "AAPL", timeframe: "15m", count: 600, end: now - 61 * day, extended: true, adjustDividends: false, chartLoader })).rejects.toThrow(/retention/);
  expect(chartLoader).not.toHaveBeenCalled();
});
