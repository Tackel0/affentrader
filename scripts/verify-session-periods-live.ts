import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { loadKrakenClosedBars } from "../lib/market/kraken";
import { buildTpoSessions } from "../lib/orderflow/tpoModel";
import { defaultTpo } from "../lib/orderflow/tpoSettings";

const response = await fetch("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60", { signal: AbortSignal.timeout(15000) });
assert.ok(response.ok); const raw = await response.json(); assert.deepEqual(raw.error, []);
const rows = Object.values(raw.result).find(Array.isArray) as unknown[][]; assert.ok(rows?.length > 2);
const bars = await loadKrakenClosedBars("BTC/USD", "1h", async () => Response.json(raw));
assert.equal(bars.length, rows.length - 1);
const DAY = 86400000, HOUR = 3600000, step = 100, report = [];
for (const period of ["Week", "Month"] as const) {
  const expected = new Map<number, { end: number; times: Set<number>; prices: Map<number, Set<number>> }>();
  // Oracle uses raw venue fields, ordinary UTC Date arithmetic and integer row
  // indices; it does not import the app's session/interval/grid/TPO helpers.
  for (const row of rows.slice(0, -1)) {
    const time = Number(row[0]) * 1000, date = new Date(time), midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const start = period === "Week" ? midnight - (date.getUTCDay() + 6) % 7 * DAY : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const end = period === "Week" ? start + 7 * DAY : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const group = expected.get(start) ?? { end, times: new Set<number>(), prices: new Map<number, Set<number>>() };
    group.times.add(time); const block = Math.floor((time - start) / (4 * HOUR));
    for (let index = Math.floor(Number(row[3]) / step); index <= Math.floor(Number(row[2]) / step); index++) {
      const blocks = group.prices.get(index) ?? new Set<number>(); blocks.add(block); group.prices.set(index, blocks);
    }
    expected.set(start, group);
  }
  const sessions = buildTpoSessions(bars, { ...defaultTpo(), sessionPeriod: period, blockMinutes: "240", rowSize: step }, "1h", "KRK:BTC/USD");
  assert.equal(sessions.length, expected.size); const checks = [];
  for (const session of sessions) {
    const e = expected.get(session.start); assert.ok(e); assert.equal(session.end, e.end); assert.equal(session.coverage.loadedBars, e.times.size);
    const low = Math.min(...e.prices.keys()), high = Math.max(...e.prices.keys());
    assert.equal(session.rows.length, high - low + 1);
    session.rows.forEach((r, i) => { assert.equal(r.price, (low + i) * step); assert.deepEqual(r.periodIndices, [...(e.prices.get(low + i) ?? [])].sort((a, b) => a - b)); });
    const counts = session.rows.map(r => e.prices.get(r.price / step)?.size ?? 0), total = counts.reduce((n, v) => n + v, 0), max = Math.max(...counts);
    const candidates = counts.flatMap((v, i) => v === max ? [i] : []); candidates.sort((a, b) => Math.abs(a - (counts.length - 1) / 2) - Math.abs(b - (counts.length - 1) / 2));
    assert.equal(session.valueArea.poc, candidates[0]); assert.equal(session.valueArea.total, total);
    assert.equal(session.completion.expectedBars, (e.end - session.start) / HOUR);
    checks.push({ start: new Date(session.start).toISOString(), end: new Date(session.end).toISOString(), loadedBars: e.times.size,
      rows: session.rows.length, opportunities: total, poc: session.rows[session.valueArea.poc].price, completion: session.completion.status });
  }
  report.push({ period, verified: true, checks });
}
await writeFile("artifacts/session-periods-live.json", JSON.stringify({ checkedAt: new Date().toISOString(), provider: "Kraken public closed BTC/USD 1h",
  closedBars: bars.length, discardedFormingRows: 1, report, raw }, null, 2));
console.log(JSON.stringify({ closedBars: bars.length, report }));
