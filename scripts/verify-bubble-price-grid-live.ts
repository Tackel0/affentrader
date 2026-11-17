import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import type { Tick } from "../types/trading";
import { fetchPriceGridMetadata, priceGridTick } from "../lib/market/priceGridMetadata";
import { parseAssets, parseTrade } from "../lib/market/hyperliquid";
import { loadKrakenRecentTrades } from "../lib/market/kraken";
import { FootprintHistory } from "../lib/orderflow/footprintHistory";
import { bubbleStep, defaultBubbles, volumeBubbles } from "../lib/orderflow/volumeBubbles";
import type { RendererLayerArgs } from "@luxalgo/vela";
async function json(url: string, body?: unknown) {
  const response = await fetch(url, { ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, `${url}: ${response.status}`); return response.json();
}
const [binanceMeta, binanceTrades, krakenMeta, krakenTrades, hlMeta, hlTrades] = await Promise.all([
  json("https://data-api.binance.vision/api/v3/exchangeInfo?symbol=BTCUSDT"),
  json("https://data-api.binance.vision/api/v3/aggTrades?symbol=BTCUSDT&limit=1000"),
  json("https://api.kraken.com/0/public/AssetPairs?pair=BTCUSD&assetVersion=1"),
  json("https://api.kraken.com/0/public/Trades?pair=BTCUSD&assetVersion=1&count=1000"),
  json("https://api.hyperliquid.xyz/info", { type: "metaAndAssetCtxs" }),
  json("https://api.hyperliquid.xyz/info", { type: "recentTrades", coin: "BTC" }),
]);
const assets = parseAssets(hlMeta[0], hlMeta[1], "");
const kraken = await loadKrakenRecentTrades("BTC/USD", 1000, async () => Response.json(krakenTrades));
const inputs = [
  { symbol: "BTCUSDT", metadata: binanceMeta, ticks: binanceTrades.map((r: { a: number; T: number; p: string; q: string; m: boolean }) => ({ id: String(r.a), time: r.T, price: Number(r.p), quantity: Number(r.q), side: r.m ? "sell" : "buy", symbol: "BTCUSDT", simulated: false })) as Tick[],
    raw: binanceTrades.map((r: { a: number; T: number; p: string; q: string; m: boolean }) => ({ id: String(r.a), time: r.T, price: Number(r.p), quantity: Number(r.q), buy: !r.m })),
    expectedTick: Number(binanceMeta.symbols[0].filters.find((f: { filterType: string }) => f.filterType === "PRICE_FILTER").tickSize) },
  { symbol: "KRK:BTC/USD", metadata: krakenMeta, ticks: kraken,
    raw: krakenTrades.result["BTC/USD"].map((r: unknown[]) => ({ id: `KRK:BTC/USD:${r[6]}`, time: Math.floor(Number(r[2]) * 1000), price: Number(r[0]), quantity: Number(r[1]), buy: r[3] === "b" })),
    expectedTick: Number(krakenMeta.result["BTC/USD"].tick_size) },
  { symbol: "HL:BTC", metadata: { assets }, ticks: hlTrades.map(parseTrade).filter(Boolean) as Tick[],
    raw: hlTrades.map((r: { tid: number; time: number; px: string; sz: string; side: string }) => ({ id: `BTC-${r.tid || r.time}`, time: r.time, price: Number(r.px), quantity: Number(r.sz), buy: r.side === "B" })), expectedTick: undefined },
];
const results = [];
for (const input of inputs) {
  assert.ok(input.ticks.length > 0); const price = input.ticks.at(-1)!.price;
  const metadata = await fetchPriceGridMetadata(input.symbol, async () => Response.json(input.metadata));
  const tick = priceGridTick(metadata, price);
  if (input.symbol === "HL:BTC") {
    const rawSize = hlMeta[0].universe.find((a: { name: string }) => a.name === "BTC").szDecimals;
    const allowedDecimals = Math.max(0, Math.min(6 - rawSize, 5 - (Math.floor(Math.log10(price)) + 1)));
    assert.equal(tick, 10 ** -allowedDecimals);
  } else assert.equal(tick, input.expectedTick);
  const settings = { ...defaultBubbles(), rows: "Manual" as const, hideBelow: 0, ticksPerRow: 8, maxVisible: 500 };
  const step = bubbleStep({} as RendererLayerArgs, settings, tick), history = new FootprintHistory("1m"); history.add(input.ticks);
  const from = Math.floor(Math.min(...input.ticks.map(t => t.time)) / 60000) * 60000;
  const to = Math.floor(Math.max(...input.ticks.map(t => t.time)) / 60000) * 60000;
  const actual = volumeBubbles(history.read({ step, ratio: 3 }), from, to, settings);
  // Independent integer-decimal row arithmetic for these BTC quotes, without
  // calling production price-grid, bucket or footprint assignment functions.
  const units = 100000000, stepUnits = BigInt(Math.round(step * units));
  const expected = new Map<string, { time: number; lower: number; buy: number; sell: number }>(), seen = new Set<string>();
  for (const raw of input.raw) {
    if (seen.has(raw.id)) continue; seen.add(raw.id);
    const time = Math.floor(raw.time / 60000) * 60000, row = BigInt(Math.round(raw.price * units)) / stepUnits;
    const lower = Number(row * stepUnits) / units, key = `${time}:${lower}`;
    const value = expected.get(key) ?? { time, lower, buy: 0, sell: 0 }; value[raw.buy ? "buy" : "sell"] += raw.quantity; expected.set(key, value);
  }
  const sorted = [...expected.values()].sort((a, b) => b.buy + b.sell - a.buy - a.sell || a.time - b.time || a.lower - b.lower).slice(0, 500);
  assert.equal(actual.length, sorted.length);
  actual.forEach((a, index) => {
    const e = sorted[index]; assert.equal(a.time, e.time); assert.equal(a.lower, e.lower);
    assert.ok(Math.abs(a.buy - e.buy) < 1e-9); assert.ok(Math.abs(a.sell - e.sell) < 1e-9);
  });
  results.push({ symbol: input.symbol, tick, step, executions: history.coverage.trades, comparedBubbles: actual.length, metadataSource: metadata.source });
}
const report = { checkedAt: new Date().toISOString(), results,
  scope: "Fresh public metadata and retained recent trade snapshots, independent integer row/buy-sell oracle. Binance observations may aggregate prints. HL metadata is adapted from the public raw response into the app route shape; actual route wiring is checked separately. Not a historical tick-rule or gap-free source claim.",
  raw: { binanceMeta, binanceTrades, krakenMeta, krakenTrades, hlMeta, hlTrades } };
await writeFile("artifacts/bubble-price-grid-live.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify({ checkedAt: report.checkedAt, results }));
