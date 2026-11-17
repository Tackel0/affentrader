import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { loadKrakenClosedBars } from "../lib/market/kraken";
import { buildTpoSessions } from "../lib/orderflow/tpoModel";
import { defaultTpo } from "../lib/orderflow/tpoSettings";

const response = await fetch("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=15", { signal: AbortSignal.timeout(15000) });
assert.ok(response.ok);
const raw = await response.json(); assert.deepEqual(raw.error, []);
const rawRows = Object.values(raw.result).find(Array.isArray) as unknown[][];
assert.ok(rawRows.length > 2);
const rows = rawRows.slice(0, -1), bars = await loadKrakenClosedBars("BTC/USD", "15m", async () => Response.json(raw));
assert.equal(rows.length, bars.length);
const day = 86400000, minute = 60000, duration = 15 * minute;
const revealedUntil = Math.max(...rows.map(row => Number(row[0]) * 1000));
const report = [];
for (const period of ["Day", "Week", "Month"] as const) for (const minutes of [45, 60, 90]) {
  // Independent oracle: raw venue timestamps/highs/lows and ordinary UTC Date
  // arithmetic. No app calendar, IB, extension or price-grid helpers.
  const windows = new Map<number, number>();
  for (const row of rows) {
    const date = new Date(Number(row[0]) * 1000), midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const start = period === "Day" ? midnight : period === "Week" ? midnight - (date.getUTCDay() + 6) % 7 * day
      : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    windows.set(start, period === "Day" ? start + day : period === "Week" ? start + 7 * day : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  }
  let baseline: unknown;
  for (const blockMinutes of ["30", "60", "240"] as const) {
    const sessions = buildTpoSessions(bars, { ...defaultTpo(), rowSize: 100, sessionPeriod: period, ibMinutes: minutes, blockMinutes }, "15m", "KRK:BTC/USD");
    assert.equal(sessions.length, windows.size);
    for (const session of sessions) {
      const end = Math.min(windows.get(session.start)!, session.start + minutes * minute);
      const selected = rows.filter(row => Number(row[0]) * 1000 >= session.start && Number(row[0]) * 1000 + duration <= end);
      const expectedBars = (end - session.start) / duration;
      const missing = Math.max(0, Math.min(expectedBars, Math.max(0, Math.floor((revealedUntil - session.start) / duration) + 1)) - selected.length);
      const high = selected.length ? Math.max(...selected.map(row => Number(row[2]))) : null;
      const low = selected.length ? Math.min(...selected.map(row => Number(row[3]))) : null;
      const status = !selected.length ? "unavailable" : missing ? "incomplete" : revealedUntil < end ? "developing" : "complete";
      assert.equal(session.initialBalance.end, end); assert.equal(session.initialBalance.high, high); assert.equal(session.initialBalance.low, low);
      assert.equal(session.initialBalance.loadedBars, selected.length); assert.equal(session.initialBalance.expectedBars, expectedBars);
      assert.equal(session.initialBalance.missingSlots, missing); assert.equal(session.initialBalance.status, status);
    }
    const values = sessions.map(session => ({ sessionStartUtc: new Date(session.start).toISOString(), ...session.initialBalance }));
    if (baseline) assert.deepEqual(values, baseline); else baseline = values;
    report.push({ period, minutes, blockMinutes, verified: true, checks: values });
  }
}
await writeFile("artifacts/tpo-ib-minutes-live.json", JSON.stringify({ checkedAt: new Date().toISOString(), provider: "Kraken public closed BTC/USD 15m",
  closedBars: rows.length, excludedFormingRows: 1, report, raw }, null, 2));
console.log(JSON.stringify({ closedBars: rows.length, combinations: report.length, sessionChecks: report.reduce((sum, item) => sum + item.checks.length, 0), verified: true }));
