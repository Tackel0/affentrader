import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import type { Tick } from "../types/trading";
import { aggregateTradeCount } from "../lib/market/tradeCounts";
import { loadKrakenRecentTrades } from "../lib/market/kraken";
import { parseTrade } from "../lib/market/hyperliquid";
import { FootprintHistory } from "../lib/orderflow/footprintHistory";
import { footprintDisplayBar, footprintSizes } from "../lib/orderflow/footprintCells";
const capture = JSON.parse(await readFile("artifacts/bubble-price-grid-live.json", "utf8"));
type Observation = { time: number; price: number; quantity: number; buy: boolean; count: number };
const binance = capture.raw.binanceTrades as { a: number; T: number; p: string; q: string; m: boolean; f: number; l: number }[];
const krakenRaw = capture.raw.krakenTrades.result["BTC/USD"] as unknown[][];
const hl = capture.raw.hlTrades as { coin: string; px: string; sz: string; time: number; side: string; tid: number }[];
const sources: { symbol: string; ticks: Tick[]; raw: Observation[] }[] = [
  { symbol: "BTCUSDT", ticks: binance.map(r => ({ id: String(r.a), symbol: "BTCUSDT", time: r.T, price: Number(r.p), quantity: Number(r.q), side: r.m ? "sell" : "buy", simulated: false, tradeCount: aggregateTradeCount(r.f, r.l) })),
    raw: binance.map(r => ({ time: r.T, price: Number(r.p), quantity: Number(r.q), buy: !r.m, count: r.l - r.f + 1 })) },
  { symbol: "KRK:BTC/USD", ticks: await loadKrakenRecentTrades("BTC/USD", 1000, async () => Response.json(capture.raw.krakenTrades)),
    raw: krakenRaw.map(r => ({ time: Math.floor(Number(r[2]) * 1000), price: Number(r[0]), quantity: Number(r[1]), buy: r[3] === "b", count: 1 })) },
  { symbol: "HL:BTC", ticks: hl.map(r => parseTrade(r)!), raw: hl.map(r => ({ time: r.time, price: Number(r.px), quantity: Number(r.sz), buy: r.side === "B", count: 1 })) },
];
const results = [];
for (const source of sources) {
  const history = new FootprintHistory("1m"); history.add(source.ticks);
  const expected = new Map<number, Map<number, { buy: number; sell: number; buys: number; sells: number }>>();
  for (const r of source.raw) {
    assert.ok(Number.isSafeInteger(r.count) && r.count > 0);
    const time = Math.floor(r.time / 60000) * 60000, price = Math.floor(r.price / 10) * 10;
    const rows = expected.get(time) ?? new Map(), row = rows.get(price) ?? { buy: 0, sell: 0, buys: 0, sells: 0 };
    row[r.buy ? "buy" : "sell"] += r.quantity; row[r.buy ? "buys" : "sells"] += r.count;
    rows.set(price, row); expected.set(time, rows);
  }
  let compared = 0;
  for (const bar of history.read({ step: 10, ratio: 3 })) {
    const rows = expected.get(bar.time)!, plotted = footprintDisplayBar(bar, 10, { averageTradeSize: true, imbalanceRatio: 3 });
    let maximum = -1, poc = NaN;
    for (const [price, row] of [...rows].sort((a, b) => a[0] - b[0])) {
      const observed = bar.levels.find(r => r.price === price)!;
      assert.equal(observed.buyCount ?? 0, row.buys); assert.equal(observed.sellCount ?? 0, row.sells);
      const buy = row.buys ? row.buy / row.buys : 0, sell = row.sells ? row.sell / row.sells : 0;
      const sizes = footprintSizes(observed, true);
      assert.ok(Math.abs(sizes.buy! - buy) < 1e-9); assert.ok(Math.abs(sizes.sell! - sell) < 1e-9);
      if (buy + sell > maximum) { maximum = buy + sell; poc = price; }
      const above = rows.get(price + 10), below = rows.get(price - 10), displayed = plotted.levels.find(r => r.price === price)!;
      const oppositeSell = below && below.sells ? below.sell / below.sells : 0, oppositeBuy = above && above.buys ? above.buy / above.buys : 0;
      assert.equal(displayed.buyImbalance, !!below && buy > 0 && buy >= 3 * oppositeSell);
      assert.equal(displayed.sellImbalance, !!above && sell > 0 && sell >= 3 * oppositeBuy); compared++;
    }
    assert.equal(plotted.poc, poc); assert.equal(plotted.volume, bar.volume); assert.equal(plotted.delta, bar.delta);
  }
  results.push({ symbol: source.symbol, observations: source.ticks.length, underlyingPrints: source.raw.reduce((sum, row) => sum + row.count, 0), comparedRows: compared });
}
const report = { checkedAt: new Date().toISOString(), sourceCapture: capture.checkedAt, results,
  scope: "Independent raw-tuple counts, per-side means, mean-size POC and diagonal oracle on a retained public three-venue capture. Binance count uses inclusive f/l trade IDs, not aggregate message count. No fresh capture or complete historical count coverage claim." };
await writeFile("artifacts/footprint-cells-source.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
