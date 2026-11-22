import { afterEach, describe, expect, it, vi } from "vitest";
import { assetIconUrl, resolveAssetIconKey } from "@/lib/assetIcon";
import { clearAssetIconCache, resolveAssetIcon, sanitizeAndNormalizeSvg } from "@/lib/server/assetIcon";
import { GET } from "@/app/api/asset-icon/route";

describe("Asset icon resolution & security", () => {
  afterEach(() => {
    clearAssetIconCache();
  });

  it("canonicalizes symbols across Binance, Hyperliquid, Bybit, Kraken, Yahoo, and Alpaca into shared cache keys", () => {
    expect(resolveAssetIconKey("BTCUSDT").key).toBe("crypto:BTC");
    expect(resolveAssetIconKey("HL:BTC").key).toBe("crypto:BTC");
    expect(resolveAssetIconKey("BYBIT:linear:BTCUSDT").key).toBe("crypto:BTC");
    expect(resolveAssetIconKey("KRAKEN:XBTUSD").key).toBe("crypto:BTC");
    expect(assetIconUrl("BTCUSDT")).toBe(assetIconUrl("HL:BTC"));

    expect(resolveAssetIconKey("YF:NVDA").key).toBe("equity:NVDA");
    expect(resolveAssetIconKey("IEX:NVDA").key).toBe("equity:NVDA");
    expect(resolveAssetIconKey("HL:xyz:NVDA").key).toBe("equity:NVDA");
    expect(resolveAssetIconKey("BYBIT:linear:NVDAUSDT").key).toBe("equity:NVDA");
    expect(resolveAssetIconKey("YF:BRK-B").key).toBe("equity:BRK.B");
    expect(resolveAssetIconKey("YF:SAP.DE")).toMatchObject({ key: "equity:SAP.DE", code: "SAP", suffix: ".DE" });

    expect(resolveAssetIconKey("YF:GC=F").key).toBe("commodity:GOLD");
    expect(resolveAssetIconKey("HL:xyz:GOLD").key).toBe("commodity:GOLD");
    expect(resolveAssetIconKey("PAXGUSDT").key).toBe("commodity:GOLD");
    expect(resolveAssetIconKey("YF:CL=F").key).toBe("commodity:OIL");
    expect(resolveAssetIconKey("YF:^GSPC").key).toBe("index:SPX");
    expect(resolveAssetIconKey("HL:xyz:SP500").key).toBe("index:SPX");
    expect(resolveAssetIconKey("YF:EURUSD=X").key).toBe("forex:EURUSD");
  });

  it("injects viewBox into TradingView SVGs and blocks unsafe active SVG content", () => {
    const tvSvg = `<!-- by TradingView --><svg width="56" height="56" xmlns="http://www.w3.org/2000/svg"><rect width="56" height="56" fill="#000"/></svg>`;
    const normalized = sanitizeAndNormalizeSvg(tvSvg);
    expect(normalized).toContain('viewBox="0 0 56 56"');
    expect(normalized).not.toContain("<!--");

    expect(sanitizeAndNormalizeSvg('<svg><script>alert(1)</script></svg>')).toBeNull();
    expect(sanitizeAndNormalizeSvg('<svg onload="alert(1)"></svg>')).toBeNull();
    expect(sanitizeAndNormalizeSvg('<svg><a href="javascript:alert(1)"></a></svg>')).toBeNull();
    expect(sanitizeAndNormalizeSvg('<svg><foreignObject><div>x</div></foreignObject></svg>')).toBeNull();
    expect(sanitizeAndNormalizeSvg('<svg><image href="https://evil.example/x.png"/></svg>')).toBeNull();
  });

  it("fetches, normalizes, and caches real SVG logos and serves built-in vector art & monogram fallbacks", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("nvidia--big.svg")) {
        return new Response('<svg width="56" height="56"><rect width="56" height="56" fill="#76b900"/></svg>', {
          status: 200,
          headers: { "Content-Type": "image/svg+xml" },
        });
      }
      if (url.includes("XTVCUNKNOWN")) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    const nvda1 = await resolveAssetIcon("equity:NVDA", fetcher);
    expect(nvda1?.authentic).toBe(true);
    expect(nvda1?.body.toString("utf8")).toContain('viewBox="0 0 56 56"');
    const nvda2 = await resolveAssetIcon("YF:NVDA", fetcher);
    expect(nvda2?.authentic).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const fx = await resolveAssetIcon("forex:EURUSD", fetcher);
    expect(fx?.authentic).toBe(true);
    expect(fx?.body.toString("utf8")).toContain("EUR");
    expect(fx?.body.toString("utf8")).toContain("USD");

    const corn = await resolveAssetIcon("commodity:CORN", fetcher);
    expect(corn?.authentic).toBe(true);
    expect(corn?.contentType).toContain("image/svg+xml");

    const fallback = await resolveAssetIcon("crypto:UNKNOWNTOKEN", fetcher);
    expect(fallback?.authentic).toBe(false);
    expect(fallback?.body.toString("utf8")).toContain("<svg");

    expect(await resolveAssetIcon("../../../etc/passwd", fetcher)).toBeNull();
  });

  it("serves /api/asset-icon with sandbox CSP and rejects invalid inputs with 400", async () => {
    const bad = await GET(new Request("https://affentrader.local/api/asset-icon?k=bad%20input!"));
    expect(bad.status).toBe(400);

    const ok = await GET(new Request("https://affentrader.local/api/asset-icon?k=forex:EURUSD"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("image/svg+xml");
    expect(ok.headers.get("content-security-policy")).toContain("sandbox");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("cache-control")).toContain("max-age=604800");
  });
});
