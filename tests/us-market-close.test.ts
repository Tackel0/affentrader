import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeSinceUsClose,
  formatUsCloseAnchor,
  lastUsMarketCloseMs,
  usMarketPhase,
} from "@/lib/market/usMarketClose";
import { clearUsCloseCache, fetchUsClosePrices } from "@/lib/server/usMarketClose";
import { clearStockHeatmapCache, fetchStockSectorHeatmap } from "@/lib/server/stockHeatmap";
import { GET as getUsCloseRoute } from "@/app/api/us-close/route";
import { columnValue, sortEntries } from "@/lib/watchlist";
import type { Quote } from "@/types/trading";

describe("US market close calculations (America/New_York, DST & weekends)", () => {
  it("resolves 16:00 EST (21:00 UTC) and 16:00 EDT (20:00 UTC) accurately across weekdays and weekends", () => {
    // Winter (EST, UTC-5): Wed Jan 14 2026 15:00 ET (20:00 UTC) -> Tue Jan 13 2026 16:00 ET (21:00 UTC)
    expect(lastUsMarketCloseMs(Date.UTC(2026, 0, 14, 20, 0))).toBe(Date.UTC(2026, 0, 13, 21, 0));
    // Winter (EST, UTC-5): Wed Jan 14 2026 16:30 ET (21:30 UTC) -> Wed Jan 14 2026 16:00 ET (21:00 UTC)
    expect(lastUsMarketCloseMs(Date.UTC(2026, 0, 14, 21, 30))).toBe(Date.UTC(2026, 0, 14, 21, 0));
    // Summer (EDT, UTC-4): Wed Jul 15 2026 17:00 ET (21:00 UTC) -> Wed Jul 15 2026 16:00 ET (20:00 UTC)
    expect(lastUsMarketCloseMs(Date.UTC(2026, 6, 15, 21, 0))).toBe(Date.UTC(2026, 6, 15, 20, 0));
    // Monday morning before 16:00 ET (Mon Jan 19 2026 10:00 ET = 15:00 UTC) -> Fri Jan 16 2026 16:00 ET (21:00 UTC)
    expect(lastUsMarketCloseMs(Date.UTC(2026, 0, 19, 15, 0))).toBe(Date.UTC(2026, 0, 16, 21, 0));
    // Sunday Nov 1 2026 (DST fallback day!) -> Fri Oct 30 2026 16:00 EDT (20:00 UTC)
    const dstSunday = Date.UTC(2026, 10, 1, 14, 0);
    expect(lastUsMarketCloseMs(dstSunday)).toBe(Date.UTC(2026, 9, 30, 20, 0));
    expect(formatUsCloseAnchor(Date.UTC(2026, 9, 30, 20, 0))).toBe("US-Close Fr 16:00 ET");
  });

  it("classifies US market phases and computes percentage moves safely", () => {
    // Tue Jan 13 2026 (EST, UTC-5)
    expect(usMarketPhase(Date.UTC(2026, 0, 13, 12, 0))).toBe("premarket"); // 07:00 ET
    expect(usMarketPhase(Date.UTC(2026, 0, 13, 15, 30))).toBe("regular"); // 10:30 ET
    expect(usMarketPhase(Date.UTC(2026, 0, 13, 22, 0))).toBe("postmarket"); // 17:00 ET
    expect(usMarketPhase(Date.UTC(2026, 0, 17, 16, 0))).toBe("closed"); // Saturday

    expect(changeSinceUsClose(105, 100)).toEqual({ change: 5, changePercent: 5 });
    expect(changeSinceUsClose(95, 100)).toEqual({ change: -5, changePercent: -5 });
    expect(changeSinceUsClose(100, 0)).toBeNull();
    expect(changeSinceUsClose(NaN, 100)).toBeNull();
  });

  it("sorts watchlist rows by usClosePercent with missing anchors last", () => {
    const q = (symbol: string, price: number): Quote => ({
      symbol,
      price,
      previous: price,
      change: 0,
      changePercent: 0,
      high: price,
      low: price,
      volume: 1,
      history: [price],
      time: 1,
      simulated: false,
    });
    const quotes = { A: q("A", 110), B: q("B", 90), C: q("C", 200) };
    const usClose = { A: 100, B: 100 }; // A: +10%, B: -10%, C: missing
    expect(columnValue("usClosePercent", quotes.A, usClose.A)).toBeCloseTo(10, 6);
    expect(sortEntries(["B", "C", "A"], quotes, { column: "usClosePercent", direction: "desc" }, {}, usClose)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
});

describe("US market close server resolver, /api/us-close route & stock heatmap", () => {
  beforeEach(() => {
    clearUsCloseCache();
    clearStockHeatmapCache();
  });

  it("fetches and caches US-Close reference prices for Binance and Hyperliquid", async () => {
    const now = Date.UTC(2026, 0, 14, 23, 0); // Wed 18:00 ET -> close is Wed 21:00 UTC
    const closeMs = Date.UTC(2026, 0, 14, 21, 0);
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/v3/klines")) {
        return new Response(JSON.stringify([[closeMs - 3_600_000, "90000", "91000", "89500", "90500.5", "10"]]), { status: 200 });
      }
      if (url.includes("api.hyperliquid.xyz")) {
        return new Response(
          JSON.stringify([{ t: closeMs - 3_600_000, o: "140", h: "145", l: "139", c: "144.25", v: "100" }]),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    const first = await fetchUsClosePrices(["BTCUSDT", "HL:xyz:NVDA"], fetcher, now);
    expect(first.closeMs).toBe(closeMs);
    expect(first.prices).toEqual({ BTCUSDT: 90500.5, "HL:xyz:NVDA": 144.25 });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Subsequent call for the same US Close hits cache with zero network requests
    const second = await fetchUsClosePrices(["BTCUSDT", "HL:xyz:NVDA"], fetcher, now + 60_000);
    expect(second.prices).toEqual({ BTCUSDT: 90500.5, "HL:xyz:NVDA": 144.25 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("validates /api/us-close query parameters strictly", async () => {
    const empty = await getUsCloseRoute(new Request("http://localhost/api/us-close"));
    expect(empty.status).toBe(400);
    const bad = await getUsCloseRoute(new Request("http://localhost/api/us-close?symbols=!!!BAD!!!"));
    expect(bad.status).toBe(400);
  });

  it("computes changeSinceUsClosePct from postmarket/premarket columns in fetchStockSectorHeatmap", async () => {
    // Postmarket (Wed Jan 14 2026 17:30 ET = 22:30 UTC): uses postmarket_change
    const postNow = Date.UTC(2026, 0, 14, 22, 30);
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              s: "NASDAQ:NVDA",
              // name, desc, close, change, volume, mcap, sector, Value.Traded, pre_chg, post_chg, pre_close, post_close
              d: ["NVDA", "NVIDIA Corp", 140, 2.5, 10_000_000, 3_400_000_000_000, "Electronic Technology", 1e9, null, 1.85, null, 142.59],
            },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const postRes = await fetchStockSectorHeatmap("us", fetcher, postNow);
    expect(postRes.rows[0].changePct).toBe(2.5);
    expect(postRes.rows[0].changeSinceUsClosePct).toBe(1.85);
    expect(postRes.usCloseMs).toBe(Date.UTC(2026, 0, 14, 21, 0));

    // Regular hours (Wed Jan 14 2026 11:00 ET = 16:00 UTC): uses regular session change vs prior US close
    clearStockHeatmapCache();
    const regNow = Date.UTC(2026, 0, 14, 16, 0);
    const regRes = await fetchStockSectorHeatmap("us", fetcher, regNow);
    expect(regRes.rows[0].changeSinceUsClosePct).toBe(2.5);
  });
});
