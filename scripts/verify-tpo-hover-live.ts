import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { loadKrakenClosedBars } from "../lib/market/kraken";
import { buildTpoSessions } from "../lib/orderflow/tpoModel";
import { defaultTpo } from "../lib/orderflow/tpoSettings";
import { scopedTpoOperations } from "../lib/orderflow/tpoOperations";
import { tpoCellAtPoint } from "../lib/orderflow/tpoHover";
const capture = JSON.parse(await readFile("artifacts/tpo-split-live.json", "utf8")), raw = capture.raw;
const rows = (Object.values(raw.result).find(Array.isArray) as unknown[][]).slice(0, -1);
const bars = await loadKrakenClosedBars("BTC/USD", "1h", async () => Response.json(raw));
const hour = 3600000, day = 24 * hour, first = Number(rows[0][0]) * 1000, symbol = "KRK:BTC/USD", report = [];
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
for (const period of ["Day", "Week", "Month"] as const) for (const merge of [false, true]) {
  // Independent raw venue/calendar/grid oracle, without app layout or letter helpers.
  const grouped = new Map<number, { end: number; values: unknown[][] }>();
  for (const row of rows) {
    const time = Number(row[0]) * 1000, date = new Date(time), midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const start = period === "Day" ? midnight : period === "Week" ? midnight - (date.getUTCDay() + 6) % 7 * day : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const end = period === "Day" ? start + day : period === "Week" ? start + 7 * day : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const group = grouped.get(start) ?? { end, values: [] }; group.values.push(row); grouped.set(start, group);
  }
  const starts = [...grouped.keys()], style = { ...defaultTpo(), rowSize: 100, blockMinutes: "240" as const, sessionPeriod: period, splitPeriods: true };
  if (merge) { const ops = scopedTpoOperations(style, "1h", symbol); ops.links = [[starts[0], starts[1]]]; style.sessionOperations = ops; }
  const expected = new Map<string, { lower: number; start: number; end: number; letter: string }>();
  for (let g = 0; g < starts.length; g++) {
    const opening = starts[g], group = grouped.get(opening)!, offset = merge && g === 1 ? Math.ceil((grouped.get(starts[0])!.end - starts[0]) / (4 * hour)) : 0;
    for (const row of group.values) {
      const index = Math.floor((Number(row[0]) * 1000 - opening) / (4 * hour)), start = opening + index * 4 * hour, end = Math.min(group.end, start + 4 * hour);
      const n = index + offset, letter = alphabet[n % 62] + (n >= 62 ? String(Math.floor(n / 62) + 1) : "");
      for (let p = Math.floor(Number(row[3]) / 100); p <= Math.floor(Number(row[2]) / 100); p++) expected.set(`${start}:${p}`, { start, end, lower: p * 100, letter });
    }
  }
  const args = { bars, priceStyle: "tpo", bounds: { top: 0, height: 20000 }, scale: {}, coords: { width: 10000,
    timeToX: (t: number) => 24 + (t - first) / hour * 12, pxPerBar: () => 12, priceToY: (p: number) => p / 10 } } as unknown as RendererLayerArgs;
  const sessions = buildTpoSessions(bars, style, "1h", symbol); let checked = 0;
  for (const cell of expected.values()) {
    const x = 24 + (cell.start - first) / hour * 12 - 6 + 47.4 / 2, y = cell.lower / 10 + 9.4 / 2;
    if (x < 0 || x > 10000) continue;
    const actual = tpoCellAtPoint(args, sessions, style, x, y); assert.ok(actual);
    assert.equal(actual.lower, cell.lower); assert.equal(actual.upper, cell.lower + 100);
    assert.equal(actual.start, cell.start); assert.equal(actual.end, cell.end); assert.equal(actual.letter, cell.letter); checked++;
  }
  report.push({ period, mergeFirstTwo: merge, cellsChecked: checked, verified: true });
}
await writeFile("artifacts/tpo-hover-live.json", JSON.stringify({ checkedAt: new Date().toISOString(), capturedAt: capture.checkedAt,
  source: "Retained public Kraken BTC/USD hourly response", closedBars: rows.length, report }, null, 2));
console.log(JSON.stringify(report));
