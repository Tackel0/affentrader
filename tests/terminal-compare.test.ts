import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/terminal-compare/route";
import { yahooChart } from "@/lib/server/yahoo";
import type { YahooChart, YahooMeta } from "@/lib/market/yahoo";

vi.mock("@/lib/server/yahoo", () => ({ yahooChart: vi.fn() }));

function history(symbol: string, currency: string, closes: (number | null)[]): YahooChart {
  const bars = closes.flatMap((close, index) => close === null ? [] : [{
    time: Date.UTC(2025, 0, 6 + index, 16),
    open: close, high: close, low: close, close, volume: 100,
  }]);
  const price = bars.at(-1)!.close;
  const meta: YahooMeta = {
    symbol, name: symbol, currency, exchange: "Test", timezone: "Europe/London", type: "stock",
    price, previousClose: price, dayHigh: price, dayLow: price, volume: 100, time: bars.at(-1)!.time, gmtOffset: 0,
  };
  return { meta, bars, adjClose: bars.map(bar => bar.close), events: { dividends: [], splits: [] } };
}

describe("terminal comparison retest", () => {
  beforeEach(() => {
    const histories = new Map([
      ["ABC", history("ABC", "GBP", [100, 110, 120, 130])],
      ["XYZ", history("XYZ", "USD", [200, 220, 198, 242])],
      ["PENCE.L", history("PENCE.L", "GBp", [100, 110, 120, 130])],
      ["GBX.L", history("GBX.L", "GBX", [100, 110, 120, 130])],
      ["GAP", history("GAP", "USD", [200, null, 198, 242, 245])],
      ["GBPUSD=X", history("GBPUSD=X", "USD", [1.2, null, 1.3, null])],
    ]);
    vi.mocked(yahooChart).mockImplementation(async ({ ticker }) => {
      const data = histories.get(ticker);
      if (!data) throw new Error(`Unexpected ticker ${ticker}`);
      return data;
    });
  });

  it.each(["PENCE.L", "GBX.L"])("normalizes %s prices to pounds before FX conversion", async (ticker) => {
    const local = await GET(new Request(`http://localhost/api/terminal-compare?a=XYZ&b=${ticker}`));
    expect(local.status).toBe(200);
    const localResult = await local.json();
    expect(localResult.currencies).toEqual(["USD", "GBP"]);
    expect(localResult.series[0].b).toBeCloseTo(1);

    const converted = await GET(new Request(`http://localhost/api/terminal-compare?a=${ticker}&b=XYZ&basis=USD`));
    expect(converted.status).toBe(200);
    const result = await converted.json();
    expect(result.series[0].a).toBeCloseTo(1.2);
    expect(result.rows[0].a).toBeCloseTo(30);
  });

  it("uses the exact matched retest close and reports compounded relative performance", async () => {
    const response = await GET(new Request("http://localhost/api/terminal-compare?a=ABC&b=XYZ&retest=2025-01-07"));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.retestRow).toMatchObject({ start: "2025-01-07", sessions: 2 });
    expect(result.retestRow.a).toBeCloseTo(100 * (130 / 110 - 1));
    expect(result.retestRow.b).toBeCloseTo(10);
    expect(result.retestRow.relative).toBeCloseTo(100 * (130 / 121 - 1));
    expect(result.retestRow.maxDrawdownA).toBe(0);
    expect(result.retestRow.maxDrawdownB).toBeCloseTo(-10);
    expect(result.rows[0].maxDrawdownB).toBe(0);
  });

  it("omits the retest return when conversion lacks its exact date and reports the skipped closes", async () => {
    const response = await GET(new Request("http://localhost/api/terminal-compare?a=ABC&b=XYZ&basis=USD&retest=2025-01-07"));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      asOf: "2025-01-08", latestSessions: ["2025-01-09", "2025-01-09"], missingFxSessions: 2, retestRow: null,
    });
    expect(result.series.map((bar: { session: string }) => bar.session)).toEqual(["2025-01-06", "2025-01-08"]);
    expect(result.rows[0].a).toBeCloseTo(30);
    expect(result.rows[0].localA).toBeCloseTo(20);
  });
  it("reports dates unique to each instrument, including dates after the last common close", async () => {
    const response = await GET(new Request("http://localhost/api/terminal-compare?a=ABC&b=GAP"));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ asOf: "2025-01-09", unmatchedInstrumentDates: [1, 1], missingFxSessions: 0 });
    expect(result.series.map((bar: { session: string }) => bar.session)).toEqual(["2025-01-06", "2025-01-08", "2025-01-09"]);
  });
});
