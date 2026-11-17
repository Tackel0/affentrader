import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { loadKrakenRecentTrades } from "../lib/market/kraken";
import { selectTailWindows, resolveTails } from "../lib/orderflow/volumeTails";
const capture = JSON.parse(await readFile("artifacts/session-profile-hours-live.json", "utf8"));
const trades = await loadKrakenRecentTrades("BTC/USD", 1000, async () => Response.json(capture.raw));
const raw = capture.raw.result["BTC/USD"] as unknown[][];
const day = 86400000, minute = 60000, date = Math.floor(trades[0].time / day) * day;
const bars = [date - day, date, date + day].map(time => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 }));
// The bars here define source eligibility only; their prices and volume are not market data.
const options = [
  { tradingHours: "Full day", from: 0, to: 1440 },
  { tradingHours: "Regular hours (RTH)", from: 0, to: 1440 },
  { tradingHours: "Extended hours (ETH)", from: 0, to: 1440 },
  { tradingHours: "Pre-market", from: 540, to: 810 },
  { tradingHours: "Market", from: 810, to: 1200 },
  { tradingHours: "Post-market", from: 1200, to: 1440 },
  { tradingHours: "London", from: 480, to: 990 },
  { tradingHours: "New York", from: 780, to: 1320 },
  { tradingHours: "Asian", from: 0, to: 540 },
  { tradingHours: "Custom", customStart: 1750, customEnd: 1751, from: 1070, to: 1071 },
  { tradingHours: "Custom", customStart: 2200, customEnd: 1800, from: 1320, to: 1080 },
];
const results = [];
for (const option of options) {
  const selected = selectTailWindows(trades, bars, "1D", "session", resolveTails(option), "KRK:BTC/USD", { from: 0, to: 2 });
  const expected = raw.filter(row => {
    const time = Math.floor(Number(row[2]) * 1000), minuteOfDay = (time % day) / minute;
    return option.from < option.to ? minuteOfDay >= option.from && minuteOfDay < option.to : minuteOfDay >= option.from || minuteOfDay < option.to;
  });
  const expectedIds = [...new Set(expected.map(row => `KRK:BTC/USD:${row[6]}`))].sort();
  assert.deepEqual(selected.flatMap(w => w.trades.map(t => t.id)).sort(), expectedIds);
  const quantity = expected.reduce((sum, row) => sum + Number(row[1]), 0);
  assert.ok(Math.abs(selected.flatMap(w => w.trades).reduce((sum, t) => sum + t.quantity, 0) - quantity) < 1e-9);
  results.push({ tradingHours: option.tradingHours, ...(option.customStart === undefined ? {} : { customStart: option.customStart, customEnd: option.customEnd }),
    executions: expectedIds.length, quantity, windows: selected.map(w => ({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() })) });
}
assert.equal(results.find(r => r.tradingHours === "Full day")!.executions, 1000);
const narrow = results.find(r => r.customStart === 1750)!;
assert.ok(narrow.executions > 0 && narrow.executions < 1000);
const report = { checkedAt: new Date().toISOString(), sourceCapture: capture.capturedAt, results,
  scope: "Retained public Kraken raw-tuple membership/quantity oracle. Synthetic daily bar timestamps define source eligibility; RTH/ETH exercise the continuous-venue fallback, not an equity session feed." };
await writeFile("artifacts/session-tails-hours-source.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ sourceCapture: report.sourceCapture, comparisons: results.length, retainedExecutions: trades.length, results: results.map(({ windows, ...rest }) => rest) }));
