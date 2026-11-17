import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { loadKrakenClosedBars } from "../lib/market/kraken";
import { buildTpoSessions } from "../lib/orderflow/tpoModel";
import { defaultTpo } from "../lib/orderflow/tpoSettings";
import { scopedTpoOperations } from "../lib/orderflow/tpoOperations";
const capture = JSON.parse(await readFile("artifacts/tpo-split-live.json", "utf8")), raw = capture.raw;
const rows = (Object.values(raw.result).find(Array.isArray) as unknown[][]).slice(0, -1);
const bars = await loadKrakenClosedBars("BTC/USD", "1h", async () => Response.json(raw));
assert.equal(bars.length, rows.length);
const day = 86400000, symbol = "KRK:BTC/USD", report = [];
for (const period of ["Day", "Week", "Month"] as const) for (const merge of [false, true]) {
  const windows = new Map<number, unknown[][]>();
  for (const row of rows) {
    const date = new Date(Number(row[0]) * 1000), midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const start = period === "Day" ? midnight : period === "Week" ? midnight - (date.getUTCDay() + 6) % 7 * day : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const values = windows.get(start) ?? []; values.push(row); windows.set(start, values);
  }
  const style = { ...defaultTpo(), rowSize: 100, blockMinutes: "240" as const, sessionPeriod: period };
  if (merge) {
    const starts = [...windows.keys()], ops = scopedTpoOperations(style, "1h", symbol);
    ops.links = [[starts[0], starts[1]]]; style.sessionOperations = ops;
    windows.set(starts[0], [...windows.get(starts[0])!, ...windows.get(starts[1])!]); windows.delete(starts[1]);
  }
  const sessions = buildTpoSessions(bars, style, "1h", symbol), checks = [];
  assert.equal(sessions.length, windows.size);
  for (const session of sessions) {
    const source = windows.get(session.start)!; assert.ok(source);
    const opening = Number(source[0][0]) * 1000 === session.start ? Number(source[0][1]) : null;
    const closing = Number(source.at(-1)![4]);
    // Kraken BTC/USD fields carry at most five decimal places. Integer quote
    // units give an independent midpoint without importing the app's decimals.
    const units = (v: unknown) => { assert.match(String(v), /^\d+(?:\.\d{1,5})?$/); return Math.round(Number(v) * 100000); };
    const low = Math.min(...source.map(row => units(row[3]))), high = Math.max(...source.map(row => units(row[2])));
    assert.equal(session.markers?.open.price, opening); assert.equal(session.markers?.close.price, closing);
    assert.equal(session.markers?.low, low / 100000); assert.equal(session.markers?.high, high / 100000);
    assert.equal(session.markers?.midpoint, (low + high) / 200000);
    checks.push({ start: new Date(session.start).toISOString(), open: opening, close: closing, midpoint: session.markers.midpoint });
  }
  report.push({ period, mergeFirstTwo: merge, verified: true, sessions: checks });
}
await writeFile("artifacts/tpo-markers-live.json", JSON.stringify({ checkedAt: new Date().toISOString(), capturedAt: capture.checkedAt,
  source: "Retained public Kraken BTC/USD hourly response", closedBars: rows.length, report }, null, 2));
console.log(JSON.stringify({ combinations: report.length, sessionChecks: report.reduce((sum, r) => sum + r.sessions.length, 0), verified: true }));
