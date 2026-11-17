import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { loadKrakenClosedBars } from "../lib/market/kraken";
import { buildTpoSessions } from "../lib/orderflow/tpoModel";
import { defaultTpo } from "../lib/orderflow/tpoSettings";
import { scopedTpoOperations } from "../lib/orderflow/tpoOperations";
import type { TpoRow } from "../lib/orderflow/tpoMath";

// Retained public response: reproducible checks use exactly the source payload
// from the previous independently verified real-market capture, not fixtures.
const capture = JSON.parse(await readFile("artifacts/tpo-split-live.json", "utf8")), raw = capture.raw;
const rows = (Object.values(raw.result).find(Array.isArray) as unknown[][]).slice(0, -1);
const bars = await loadKrakenClosedBars("BTC/USD", "1h", async () => Response.json(raw));
assert.equal(bars.length, rows.length);
const day = 86400000, hour = 3600000, symbol = "KRK:BTC/USD", report = [];
for (const sessionMinutes of [60, 1440]) {
  const style = { ...defaultTpo(), rowSize: 100, blockMinutes: "240" as const, sessionMinutes };
  const daily = [...new Set(rows.map(row => Math.floor(Number(row[0]) * 1000 / day) * day))].sort((a, b) => a - b);
  const members = daily.slice(2, 6), ops = scopedTpoOperations(style, "1h", symbol);
  ops.links = members.slice(1).map((start, i) => [members[i], start]);
  const sessions = buildTpoSessions(bars, { ...style, sessionOperations: ops }, "1h", symbol);
  const composite = sessions.find(session => session.start === members[0]); assert.ok(composite);
  assert.deepEqual(composite.members?.map(w => w.start), members);
  const priceBlocks = new Map<number, Set<number>>(), count = Math.ceil(sessionMinutes / 240);
  let loaded = 0;
  for (const row of rows) {
    const time = Number(row[0]) * 1000, opening = Math.floor(time / day) * day, member = members.indexOf(opening);
    if (member < 0 || time >= opening + sessionMinutes * 60000) continue;
    loaded++;
    const period = member * count + Math.floor((time - opening) / (4 * hour));
    for (let p = Math.floor(Number(row[3]) / 100); p <= Math.floor(Number(row[2]) / 100); p++) {
      const set = priceBlocks.get(p) ?? new Set<number>(); set.add(period); priceBlocks.set(p, set);
    }
  }
  assert.equal(composite.coverage.loadedBars, loaded);
  assert.equal(composite.completion.expectedBars, members.length * sessionMinutes / 60);
  assert.equal(composite.completion.status, "complete");
  const low = Math.min(...priceBlocks.keys()), high = Math.max(...priceBlocks.keys());
  assert.equal(composite.rows.length, high - low + 1);
  const counts = [];
  for (let p = low; p <= high; p++) {
    const expected = [...(priceBlocks.get(p) ?? [])].sort((a, b) => a - b);
    const actual: TpoRow = composite.rows[p - low];
    assert.equal(actual.price, p * 100); assert.deepEqual(actual.periodIndices, expected); counts.push(expected.length);
  }
  const total = counts.reduce((sum, n) => sum + n, 0), max = Math.max(...counts), midpoint = (counts.length - 1) / 2;
  const candidates = counts.flatMap((n, i) => n === max ? [i] : []).sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint));
  assert.equal(composite.valueArea.poc, candidates[0]); assert.equal(composite.valueArea.total, total);
  report.push({ sessionMinutes, members: members.map(t => new Date(t).toISOString()), loaded, rows: counts.length, opportunities: total,
    poc: composite.rows[composite.valueArea.poc].price, verified: true });
}
await writeFile("artifacts/tpo-operations-live.json", JSON.stringify({ checkedAt: new Date().toISOString(), capturedAt: capture.checkedAt,
  source: "Retained public Kraken BTC/USD hourly response", closedBars: rows.length, report }, null, 2));
console.log(JSON.stringify(report));
