import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { FootprintHistory } from "../lib/orderflow/footprintHistory";
import { footprintDisplayBar } from "../lib/orderflow/footprintCells";
import type { Tick } from "../types/trading";

// Public raw responses retained by the venue-grid verifier; never reads credentials.
const capture = JSON.parse(await readFile("artifacts/footprint-grid-source.json", "utf8"));
const tapes: Tick[][] = [
  capture.raw.binance.trades.map((r: { a: number; T: number; p: string; q: string; m: boolean; f: number; l: number }) => ({ symbol: "BTCUSDT", id: String(r.a), time: r.T, price: +r.p, quantity: +r.q, side: r.m ? "sell" : "buy", tradeCount: r.l - r.f + 1, simulated: false })),
  capture.raw.kraken.trades.result["BTC/USD"].map((r: [string, string, number, string, unknown, unknown, number]) => ({ symbol: "KRK:BTC/USD", id: String(r[6]), time: Math.floor(+r[2] * 1000), price: +r[0], quantity: +r[1], side: r[3] === "b" ? "buy" : "sell", tradeCount: 1, simulated: false })),
  capture.raw.hyperliquid.trades.map((r: { tid: number; time: number; px: string; sz: string; side: string }) => ({ symbol: "HL:BTC", id: String(r.tid), time: r.time, price: +r.px, quantity: +r.sz, side: r.side === "B" ? "buy" : "sell", tradeCount: 1, simulated: false })),
];
// Positive decimal integer division, independent of the production grid helper.
function decimal(n: number) { const [m, e = "0"] = n.toString().split("e"), p = m.indexOf("."); return { n: BigInt(m.replace(".", "")), e: +e - (p < 0 ? 0 : m.length - p - 1) }; }
function rowIndex(price: number, step: number) { const a = decimal(price), b = decimal(step), e = Math.min(a.e, b.e); return Number(a.n * 10n ** BigInt(a.e - e) / (b.n * 10n ** BigInt(b.e - e))); }
type Row = { buy: number; sell: number; buys: number; sells: number };
const results = [];
let checked = 0, absentChecks = 0, observedZeroChecks = 0, hiddenChecks = 0;
for (let venue = 0; venue < tapes.length; venue++) {
  // Chronological accumulation matches the observation contract; retained
  // Hyperliquid HTTP lists can arrive newest-first.
  const tape = [...tapes[venue]].sort((a, b) => a.time - b.time), history = new FootprintHistory("1m"); history.add(tape);
  let rowsCompared = 0, configurations = 0;
  for (const step of [...new Set<number>(capture.results[venue].configurations.map((c: { step: number }) => c.step))]) {
    const expected = new Map<number, Map<number, Row>>();
    for (const t of tape) {
      const time = Math.floor(t.time / 60000) * 60000, index = rowIndex(t.price, step), rows = expected.get(time) ?? new Map<number, Row>();
      const own = rows.get(index) ?? { buy: 0, sell: 0, buys: 0, sells: 0 };
      if (t.side === "buy") { own.buy += t.quantity; own.buys += t.tradeCount!; } else { own.sell += t.quantity; own.sells += t.tradeCount!; }
      rows.set(index, own); expected.set(time, rows);
    }
    for (const average of [false, true]) for (const ratio of [1, 3, 10]) for (const filter of [0, 1, 2]) {
      const size = (r: Row) => ({ buy: average ? r.buys ? r.buy / r.buys : 0 : r.buy, sell: average ? r.sells ? r.sell / r.sells : 0 : r.sell });
      const totals = [...expected.values()].flatMap(rows => [...rows.values()].map(r => { const s = size(r); return s.buy + s.sell; })).sort((a, b) => a - b);
      const cutoff = totals[Math.floor(totals.length / 2)] ?? 0;
      const options = { averageTradeSize: average, imbalanceRatio: ratio, ...(filter === 1 ? { minVolume: cutoff } : filter === 2 ? { maxBidVolume: cutoff / 2, maxAskVolume: cutoff / 2 } : {}) };
      const visible = (r: Row) => { const s = size(r); return filter === 1 ? s.buy + s.sell >= cutoff : filter === 2 && cutoff > 0 ? s.buy <= cutoff / 2 && s.sell <= cutoff / 2 : true; };
      for (const rawBar of history.read({ step, ratio })) {
        const bar = footprintDisplayBar(rawBar, step, options), rows = expected.get(bar.time)!;
        for (const actual of bar.levels) {
          const index = rowIndex(actual.price, step), own = rows.get(index)!; assert.ok(own);
          const s = size(own);
          const dominant = (side: "buy" | "sell") => {
            const opposite = rows.get(index + (side === "buy" ? -1 : 1));
            if (!opposite) { absentChecks++; return false; }
            if (!visible(own) || !visible(opposite)) { hiddenChecks++; return false; }
            const quantity = s[side], other = size(opposite)[side === "buy" ? "sell" : "buy"];
            if (quantity > 0 && other === 0) observedZeroChecks++;
            return quantity > 0 && quantity >= ratio * other;
          };
          assert.equal(actual.buyImbalance, dominant("buy"), `${tape[0].symbol}:${bar.time}:${actual.price}:buy`);
          assert.equal(actual.sellImbalance, dominant("sell"), `${tape[0].symbol}:${bar.time}:${actual.price}:sell`);
          if (filter) assert.equal(actual.filtered, !visible(own));
          assert.equal(actual.buyVolume, own.buy); assert.equal(actual.sellVolume, own.sell);
          rowsCompared++; checked += 2;
        }
      }
      configurations++;
    }
  }
  results.push({ symbol: tape[0].symbol, observations: tape.length, configurations, rowsCompared });
}
assert.ok(absentChecks > 0 && observedZeroChecks > 0 && hiddenChecks > 0);
const report = { checkedAt: new Date().toISOString(), capturedAt: capture.checkedAt, coverage: "Retained public observations only; independent decimal row membership and raw/mean/filtered diagonal oracle", checked, absentChecks, observedZeroChecks, hiddenChecks, results };
await writeFile("artifacts/footprint-diagonals-source.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
