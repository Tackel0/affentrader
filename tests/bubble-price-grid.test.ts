import { afterEach, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { createPriceGridLoader, fetchPriceGridMetadata, priceGridTick, type PriceGridMetadata } from "@/lib/market/priceGridMetadata";
import { parseAssets } from "@/lib/market/hyperliquid";
import { bubbleStep, defaultBubbles, resolveBubbles } from "@/lib/orderflow/volumeBubbles";
import { bubblesDescriptor, type BubblesChannel } from "@/lib/orderflow/volumeBubblesIndicator";
const metadata = (symbol = "KRK:BTC/USD", tickSize = .1): PriceGridMetadata => ({ symbol, tickSize, source: "Fixture venue tick", checkedAt: Date.now() });
const spot = (symbol = "BTCUSDT", tickSize: unknown = "0.01000000") => ({ symbols: [{ symbol, filters: [{ filterType: "PRICE_FILTER", tickSize }] }] });
const view = { bars: [{ time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 }], bounds: { height: 360 }, scale: { min: 95, max: 105 } } as unknown as RendererLayerArgs;
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

it("reads Binance PRICE_FILTER and Kraken AssetPairs rather than quote precision", async () => {
  const binance = vi.fn<typeof fetch>(async () => Response.json({ ...spot(), quotePrecision: 8 }));
  expect(await fetchPriceGridMetadata("BTCUSDT", binance)).toMatchObject({ symbol: "BTCUSDT", tickSize: .01 });
  expect(String(binance.mock.calls[0][0])).toBe("https://data-api.binance.vision/api/v3/exchangeInfo?symbol=BTCUSDT");
  const kraken = vi.fn<typeof fetch>(async () => Response.json({ error: [], result: { "BTC/USD": { tick_size: ".1", lot_decimals: 8 } } }));
  expect(await fetchPriceGridMetadata("KRK:BTC/USD", kraken)).toMatchObject({ tickSize: .1, source: "Kraken AssetPairs tick_size" });
});

it.each([0, "0", null, "NaN", "-0.1", {}, "0.1junk"])("rejects disabled or malformed Binance tick %j", async tick => {
  await expect(fetchPriceGridMetadata("BTCUSDT", async () => Response.json(spot("BTCUSDT", tick)))).rejects.toThrow(/PRICE_FILTER/);
});

it("rejects a different symbol, missing filters, duplicate symbols and HTTP errors", async () => {
  for (const body of [spot("ETHUSDT"), { symbols: [{ symbol: "BTCUSDT", quotePrecision: 8 }] }, { symbols: [...spot().symbols, ...spot().symbols] }])
    await expect(fetchPriceGridMetadata("BTCUSDT", async () => Response.json(body))).rejects.toThrow(/PRICE_FILTER/);
  await expect(fetchPriceGridMetadata("BTCUSDT", async () => new Response("", { status: 429 }))).rejects.toThrow(/429/);
  const fetcher = vi.fn<typeof fetch>();
  await expect(fetchPriceGridMetadata("YF:AAPL", fetcher)).rejects.toThrow(/no verified/);
  await expect(fetchPriceGridMetadata("BTC/../../secret", fetcher)).rejects.toThrow(/Invalid/);
  expect(fetcher).not.toHaveBeenCalled();
});

it("uses verified Hyperliquid precision at the chart price, including integer prices and builder markets", async () => {
  const assets = parseAssets({ universe: [{ name: "xyz:TSLA", szDecimals: 3 }] }, [{ markPx: "1234.5" }], "xyz");
  const grid = await fetchPriceGridMetadata("HL:xyz:TSLA", async () => Response.json({ assets }));
  expect(grid).toMatchObject({ sizeDecimals: 3, symbol: "HL:xyz:TSLA" });
  expect(priceGridTick(grid, 1234.5)).toBe(.1); expect(priceGridTick(grid, .01234)).toBe(.001);
  expect(priceGridTick(grid, 123456)).toBe(1);
  expect(() => priceGridTick(grid)).toThrow(/chart price/);
  const missing = parseAssets({ universe: [{ name: "BTC" }] }, [{ markPx: "80000" }], "");
  expect(missing[0].pricePrecisionKnown).toBe(false);
  await expect(fetchPriceGridMetadata("HL:BTC", async () => Response.json({ assets: missing }))).rejects.toThrow(/unavailable/);
});

it("coalesces requests, expires venue metadata and backs off failures", async () => {
  vi.useFakeTimers(); const fetcher = vi.fn<typeof fetch>(async () => Response.json(spot())), load = createPriceGridLoader(fetcher);
  const first = load("BTCUSDT"), same = load("BTCUSDT"); expect(first).toBe(same); await first;
  await load("BTCUSDT"); expect(fetcher).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(300001); await load("BTCUSDT"); expect(fetcher).toHaveBeenCalledTimes(2);
  const broken = vi.fn<typeof fetch>(async () => new Response("", { status: 503 })), retry = createPriceGridLoader(broken);
  await expect(retry("BTCUSDT")).rejects.toThrow(/503/); await expect(retry("BTCUSDT")).rejects.toThrow(/503/);
  expect(broken).toHaveBeenCalledTimes(1); vi.advanceTimersByTime(30001);
  await expect(retry("BTCUSDT")).rejects.toThrow(/503/); expect(broken).toHaveBeenCalledTimes(2);
});

it("multiplies verified market ticks canonically and keeps explicit legacy overrides", () => {
  const manual = { ...defaultBubbles(), rows: "Manual" as const, ticksPerRow: 3 };
  expect(bubbleStep(view, manual, .1)).toBe(.3);
  expect(bubbleStep(view, { ...manual, tickSize: .01 }, .1)).toBe(.03);
  expect(resolveBubbles({ tickSize: .01 }).tickSize).toBe(.01); expect(defaultBubbles().tickSize).toBe(0);
  expect(bubbleStep(view, { ...defaultBubbles(), ticksPerRow: 8 }, .3) / .3).toBeCloseTo(2);
  expect(() => bubbleStep(view, manual)).toThrow(/precision/);
});

function fixture(load: (symbol: string) => Promise<PriceGridMetadata>, live = true) {
  const input: Tick[] = [{ id: "a", symbol: "KRK:BTC/USD", time: 1000, price: 100, quantity: 1, side: "buy", simulated: false }];
  let channel: BubblesChannel | undefined, receive: ((tick: Tick) => void) | undefined;
  const context = { id: "bubble-grid", symbol: "KRK:BTC/USD", timeframe: "1m", live, bars: () => view.bars,
    emit() {}, setStatus() {}, pushData(value: BubblesChannel) { channel = value; } } as unknown as NativeIndicatorContext;
  const native = bubblesDescriptor(() => input, (_symbol, changed) => { receive = changed; return () => {}; },
    { replay: () => ({ trades: input, through: 60000, label: "REPLAY fixture" }) }, load).create();
  native.start(context, {}); return { native, context, input, channel: () => channel!, receive: (tick: Tick) => receive!(tick) };
}

it("retains collected executions while metadata loads, fails and is retried", async () => {
  vi.useFakeTimers(); let reject!: (error: Error) => void;
  const load = vi.fn(() => new Promise<PriceGridMetadata>((_r, fail) => { reject = fail; })), f = fixture(load);
  await flush(); const history = f.channel().history;
  f.receive({ ...f.input[0], id: "during", time: 2000, quantity: 4 });
  reject(new Error("metadata offline")); await flush();
  expect(f.channel().history).toBe(history); expect(history!.coverage.trades).toBe(2);
  expect(f.channel().message).toContain("metadata offline"); expect(f.channel().priceTick).toBeUndefined();
  load.mockImplementation(async () => metadata()); vi.advanceTimersByTime(30001); f.native.onBars(); await flush();
  expect(f.channel().priceTick).toBe(.1); expect(f.channel().history).toBe(history);
  f.native.setInputs({ rows: "Manual", tickSize: .01 }); expect(f.channel().priceTick).toBe(.01);
  expect(f.channel().priceTickSource).toBe("Explicit price tick override"); f.native.stop();
});

it.each(["stop", "suspend", "replace"])("rejects an obsolete metadata response after %s", async action => {
  let resolve!: (value: PriceGridMetadata) => void;
  const f = fixture(() => new Promise(done => { resolve = done; })); await flush();
  if (action === "stop") f.native.stop();
  if (action === "suspend") f.native.suspend();
  if (action === "replace") f.native.start({ ...f.context, symbol: "BTCUSDT" }, { tickSize: .01 });
  resolve(metadata()); await flush();
  if (action === "replace") { expect(f.channel().priceTick).toBe(.01); expect(f.channel().identity!.symbol).toBe("BTCUSDT"); }
  else expect(f.channel()).toBeNull(); f.native.stop();
});

it("reuses the retained Replay prefix and discloses current-rule metadata", async () => {
  const f = fixture(async () => metadata(), false); await flush();
  expect(f.channel().history!.coverage.trades).toBe(1); expect(f.channel().priceTick).toBe(.1);
  expect(f.channel().message).toContain("REPLAY"); expect(f.channel().message).toContain("historical rule changes are not reconstructed"); f.native.stop();
});
