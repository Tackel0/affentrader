import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { loadKrakenClosedBars, loadKrakenRecentTrades } from "../lib/market/kraken";
import { FootprintHistory } from "../lib/orderflow/footprintHistory";
import { createUnfinishedAuctionCache } from "../lib/orderflow/unfinishedAuctions";
const capture = JSON.parse(await readFile("artifacts/bubble-price-grid-live.json", "utf8"));
const trades = await loadKrakenRecentTrades("BTC/USD", 1000, async () => Response.json(capture.raw.krakenTrades));
const retained = process.argv.includes("--retained");
const response = retained ? null : await fetch("https://api.kraken.com/0/public/OHLC?pair=BTCUSD&interval=1", { signal: AbortSignal.timeout(15000) });
if (response) assert.ok(response.ok);
const raw = retained ? JSON.parse(await readFile("artifacts/unfinished-auctions-source.json", "utf8")).raw : await response!.json();
const candles = await loadKrakenClosedBars("BTC/USD", "1m", async () => Response.json(raw));
const history = new FootprintHistory("1m"); history.add(trades);
const actual = createUnfinishedAuctionCache().read(history.read({ step: 10, ratio: 3 }), candles, "1m", 10, 0);
// Independent raw tuples: minute grouping, integer $10 buckets, only outer rows.
const groups = new Map<number, Map<number, { buy: number; sell: number }>>(), seen = new Set<number>();
for (const row of capture.raw.krakenTrades.result["BTC/USD"] as unknown[][]) {
  const id = Number(row[6]); if (seen.has(id)) continue; seen.add(id);
  const time = Math.floor(Number(row[2]) / 60) * 60000, price = Math.floor(Number(row[0]) / 10) * 10;
  const group = groups.get(time) ?? new Map(), value = group.get(price) ?? { buy: 0, sell: 0 };
  value[row[3] === "b" ? "buy" : "sell"] += Number(row[1]); group.set(price, value); groups.set(time, group);
}
const rawCandles = (Object.values(raw.result).find(Array.isArray) as unknown[][]).slice(0, -1);
const expected = [...groups].flatMap(([time, rows]) => {
  const prices = [...rows.keys()].sort((a, b) => a - b);
  return ([ ["low", prices[0]], ["high", prices.at(-1)!] ] as const).flatMap(([side, lower]) => {
    const value = rows.get(lower)!;
    // Independent reference compact-zero contract: subunit values use two decimals.
    const qualifies = (n: number) => n > 0 && (n >= 1 || Number(n.toFixed(2)) !== 0);
    if (!(qualifies(value.buy) && qualifies(value.sell))) return [];
    const price = side === "high" ? lower + 10 : lower;
    const revisit = rawCandles.find(r => Number(r[0]) * 1000 > time && Number(r[3]) <= price && Number(r[2]) >= price);
    return [{ time, side, price, lower, upper: lower + 10, ...value, from: time + 60000, touched: revisit ? Number(revisit[0]) * 1000 : null }];
  });
}).sort((a, b) => a.time - b.time || a.side.localeCompare(b.side));
assert.ok(expected.length > 0);
assert.deepEqual([...actual].sort((a, b) => a.time - b.time || a.side.localeCompare(b.side)), expected);
const report = { checkedAt: new Date().toISOString(), sourceCapture: capture.checkedAt, executions: trades.length, matchedAuctions: actual.length,
  observedRevisits: actual.filter(a => a.touched !== null).length, rows: actual,
  scope: `Retained public Kraken execution snapshot plus ${retained ? "retained independently fetched" : "freshly fetched"} closed minute candles. Independent raw-tuple outer-row/compact-zero threshold/edge/revisit oracle; partial source extrema only, not complete venue auctions.`, raw };
await writeFile(`artifacts/unfinished-auctions-source${retained ? "-retained-reference" : ""}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ checkedAt: report.checkedAt, sourceCapture: report.sourceCapture, executions: report.executions, matchedAuctions: report.matchedAuctions, observedRevisits: report.observedRevisits }));
