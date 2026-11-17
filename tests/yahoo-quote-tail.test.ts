import { expect, it } from "vitest";
import { parseChart } from "@/lib/market/yahoo";
import { buildTpoSessions } from "@/lib/orderflow/tpoModel";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";

const start = Date.UTC(2026, 10, 4, 15, 30) / 1000;
function response(tail = start + 366, patch: Record<string, unknown> = {}) {
  return { chart: { result: [{ meta: { regularMarketTime: tail, regularMarketPrice: 103, dataGranularity: "15m", ...patch },
    timestamp: [start - 900, start, tail], indicators: { quote: [{
      open: [100, 101, 103], high: [102, 104, 103], low: [99, 100, 103], close: [101, 102, 103], volume: [20, 30, 0],
    }], adjclose: [{ adjclose: [101, 102, 103] }] } }] } };
}
it("keeps the quote in metadata and excludes only its synthetic intraday candle point", () => {
  const result = parseChart(response());
  expect(result.bars.map(b => b.time)).toEqual([(start - 900) * 1000, start * 1000]);
  expect(result.meta).toMatchObject({ time: (start + 366) * 1000, price: 103 });
  expect(result.adjClose).toEqual([101, 102]);
  expect(buildTpoSessions(result.bars, defaultTpo(), "15m", "YF:AAPL")).toHaveLength(1);
});
it("preserves flat zero-volume candles at the next actual interval boundary", () => {
  expect(parseChart(response(start + 900)).bars).toHaveLength(3);
});
it.each(["volume", "range"])("retains a final partial candle with an actual %s", mode => {
  const raw = response(), quote = raw.chart.result[0].indicators.quote[0];
  if (mode === "volume") quote.volume[2] = 2;
  else quote.high[2] = 104;
  expect(parseChart(raw).bars).toHaveLength(3);
});
it.each([{ dataGranularity: "1d" }, { dataGranularity: "" }, { regularMarketTime: start }])("does not infer quote-only provenance when metadata disagrees: %j", patch => {
  expect(parseChart(response(start + 366, patch)).bars).toHaveLength(3);
});
it("preserves hourly session-offset timestamps instead of globally rounding to UTC buckets", () => {
  const raw = response(start + 3600, { dataGranularity: "60m" });
  raw.chart.result[0].timestamp = [start - 3600, start, start + 3600];
  expect(parseChart(raw).bars.map(b => b.time)).toEqual(raw.chart.result[0].timestamp.map(t => t * 1000));
});
