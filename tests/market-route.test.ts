import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/market/route";
afterEach(() => vi.unstubAllGlobals());
describe("exchange metadata route", () => {
  it("returns a compact cached search catalog and avoids caching the huge raw response", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        symbols: [
          {
            symbol: "BTCUSDT",
            baseAsset: "BTC",
            quoteAsset: "USDT",
            status: "TRADING",
            permissionSets: [["large"]],
            filters: [{ filterType: "PRICE_FILTER", tickSize: "0.01" }],
          },
          {
            symbol: "ETHBTC",
            baseAsset: "ETH",
            quoteAsset: "BTC",
            status: "TRADING",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetch);
    const result = await GET(
      new NextRequest("http://localhost/api/market?resource=exchangeInfo"),
    );
    expect(await result.json()).toEqual({
      symbols: [
        {
          symbol: "BTCUSDT",
          baseAsset: "BTC",
          quoteAsset: "USDT",
          status: "TRADING",
        },
      ],
    });
    expect(fetch.mock.calls[0][0]).toContain("showPermissionSets=false");
    expect(fetch.mock.calls[0][1].cache).toBe("no-store");
    await GET(
      new NextRequest("http://localhost/api/market?resource=exchangeInfo"),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves actual per-symbol filters required for strategy tick slippage and quantity sizing", async () => {
    const data = {
      symbols: [
        {
          symbol: "BTCUSDT",
          filters: [
            { filterType: "PRICE_FILTER", tickSize: "0.01" },
            { filterType: "LOT_SIZE", stepSize: "0.00001" },
          ],
        },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => data });
    vi.stubGlobal("fetch", fetch);
    expect(
      await (
        await GET(
          new NextRequest(
            "http://localhost/api/market?resource=exchangeInfo&symbol=BTCUSDT",
          ),
        )
      ).json(),
    ).toEqual(data);
    expect(fetch.mock.calls[0][1].next.revalidate).toBe(3600);
  });
});
