import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "../types/trading";
import { defaultFootprint, footprintStep } from "../lib/orderflow/footprint";
import { fetchPriceGridMetadata, priceGridTick } from "../lib/market/priceGridMetadata";
import { parseAssets, parseTrade } from "../lib/market/hyperliquid";
import { loadKrakenRecentTrades } from "../lib/market/kraken";
import { FootprintHistory } from "../lib/orderflow/footprintHistory";
async function json(url: string, body?: unknown) {
  const response = await fetch(url, { ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, `Public venue returned ${response.status}`); return response.json();
}
const [bm, bt, km, kt, hm, ht] = await Promise.all([
  json("https://data-api.binance.vision/api/v3/exchangeInfo?symbol=BTCUSDT"), json("https://data-api.binance.vision/api/v3/aggTrades?symbol=BTCUSDT&limit=1000"),
  json("https://api.kraken.com/0/public/AssetPairs?pair=BTCUSD&assetVersion=1"), json("https://api.kraken.com/0/public/Trades?pair=BTCUSD&assetVersion=1&count=1000"),
  json("https://api.hyperliquid.xyz/info", { type: "metaAndAssetCtxs" }), json("https://api.hyperliquid.xyz/info", { type: "recentTrades", coin: "BTC" }),
]);
const assets = parseAssets(hm[0], hm[1], "");
const venues = [
  { symbol: "BTCUSDT", metadata: bm, ticks: bt.map((r: { a: number; T: number; p: string; q: string; m: boolean; f: number; l: number }): Tick => ({ id: String(r.a), time: r.T, price: Number(r.p), quantity: Number(r.q), side: r.m ? "sell" : "buy", tradeCount: r.l - r.f + 1, symbol: "BTCUSDT", simulated: false })), expected: Number(bm.symbols[0].filters.find((f: { filterType: string }) => f.filterType === "PRICE_FILTER").tickSize) },
  { symbol: "KRK:BTC/USD", metadata: km, ticks: await loadKrakenRecentTrades("BTC/USD", 1000, async () => Response.json(kt)), expected: Number(km.result["BTC/USD"].tick_size) },
  { symbol: "HL:BTC", metadata: { assets }, ticks: ht.map(parseTrade).filter(Boolean) as Tick[], expected: undefined },
];
// Independent positive-decimal quotient; no production price-grid or bucket helper.
const decimal = (value: number) => { const [mantissa, exp = "0"] = value.toString().split("e"), dot = mantissa.indexOf("."); return { n: BigInt(mantissa.replace(".", "")), e: Number(exp) - (dot < 0 ? 0 : mantissa.length - dot - 1) }; };
function lower(price: number, step: number) {
  const p = decimal(price), s = decimal(step), e = Math.min(p.e, s.e), pn = p.n * 10n ** BigInt(p.e - e), sn = s.n * 10n ** BigInt(s.e - e);
  return Number(`${pn / sn * sn}e${e}`);
}
const results = [];
for (const venue of venues) {
  const ticks = venue.ticks as Tick[]; assert.ok(ticks.length > 0);
  const price = ticks.at(-1)!.price, metadata = await fetchPriceGridMetadata(venue.symbol, async () => Response.json(venue.metadata));
  const tick = priceGridTick(metadata, price);
  const expectedTick = venue.expected ?? 10 ** -Math.max(0, Math.min(6 - hm[0].universe.find((a: { name: string }) => a.name === "BTC").szDecimals, 5 - (Math.floor(Math.log10(price)) + 1)));
  assert.equal(tick, expectedTick);
  const history = new FootprintHistory("1m"); history.add(ticks);
  let rowsCompared = 0; const configurations = [];
  for (const manual of [1, 2, 4, 7, 16, 64, 0, -1, -2]) {
    const logarithmic = manual === -1, inverted = manual === -2, min = price * .99, max = price * 1.01;
    const y = (p: number) => (inverted ? 1 : -1) * (logarithmic ? Math.log(p / min) / Math.log(max / min) : (p - min) / (max - min)) * 600;
    const view = { scale: { min, max }, bounds: { top: 0, height: 600 }, coords: { priceToY: y } } as unknown as RendererLayerArgs;
    const style = { ...defaultFootprint(), rowMode: manual > 0 ? "manual" as const : "auto" as const, rowTicks: manual > 0 ? manual : 4 };
    const midpoint = (min + max) / 2, pixels = Math.abs(y(midpoint + tick) - y(midpoint));
    const multiple = manual > 0 ? manual : pixels > 0 ? 2 ** Math.max(0, Math.min(12, Math.ceil(Math.log2(16 / pixels)))) : 1;
    const expectedStep = Number((tick * multiple).toFixed(8)), step = footprintStep(view, style, price, tick); assert.equal(step, expectedStep);
    const expected = new Map<string, { buy: number; sell: number; buys: number; sells: number }>();
    for (const trade of ticks) {
      const key = `${Math.floor(trade.time / 60000) * 60000}:${lower(trade.price, step)}`, row = expected.get(key) ?? { buy: 0, sell: 0, buys: 0, sells: 0 };
      if (trade.side === "buy") { row.buy += trade.quantity; row.buys += trade.tradeCount!; } else { row.sell += trade.quantity; row.sells += trade.tradeCount!; }
      expected.set(key, row);
    }
    for (const bar of history.read({ step, ratio: 3 })) for (const row of bar.levels) {
      const key = `${bar.time}:${row.price}`, own = expected.get(key); assert.ok(own, `Unexpected populated row ${key}`);
      assert.ok(Math.abs(row.buyVolume - own.buy) <= 1e-9 * Math.max(1, own.buy)); assert.ok(Math.abs(row.sellVolume - own.sell) <= 1e-9 * Math.max(1, own.sell));
      assert.equal(row.buyVolume === 0 ? row.buyCount ?? 0 : row.buyCount, own.buys);
      assert.equal(row.sellVolume === 0 ? row.sellCount ?? 0 : row.sellCount, own.sells); expected.delete(key); rowsCompared++;
    }
    assert.equal(expected.size, 0); configurations.push({ mode: style.rowMode, ticks: manual > 0 ? manual : multiple, logarithmic, inverted, step });
  }
  results.push({ symbol: venue.symbol, observedTrades: ticks.length, price, metadata, tick, rowsCompared, configurations });
}
const report = { checkedAt: new Date().toISOString(), coverage: "Recent observed public executions only; no complete-history or historical-rule reconstruction claim", results, raw: { binance: { metadata: bm, trades: bt }, kraken: { metadata: km, trades: kt }, hyperliquid: { metadata: hm, trades: ht } } };
await writeFile("artifacts/footprint-grid-source.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ checkedAt: report.checkedAt, results: results.map(({ symbol, tick, observedTrades, rowsCompared, configurations }) => ({ symbol, tick, observedTrades, rowsCompared, configurations: configurations.length })) }));
