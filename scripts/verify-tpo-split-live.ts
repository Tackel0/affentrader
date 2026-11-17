import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { loadKrakenClosedBars } from "../lib/market/kraken";
import { buildTpoSessions } from "../lib/orderflow/tpoModel";
import { paintTpoSessions } from "../lib/orderflow/tpoRenderer";
import { defaultTpo } from "../lib/orderflow/tpoSettings";

const response = await fetch("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60", { signal: AbortSignal.timeout(15000) });
assert.ok(response.ok); const raw = await response.json(); assert.deepEqual(raw.error, []);
const rows = (Object.values(raw.result).find(Array.isArray) as unknown[][]).slice(0, -1);
const bars = await loadKrakenClosedBars("BTC/USD", "1h", async () => Response.json(raw));
assert.equal(rows.length, bars.length);
const hour = 3600000, day = 24 * hour, first = Number(rows[0][0]) * 1000, report = [];
const xOf = (time: number) => 24 + (time - first) / hour * 12;
for (const period of ["Day", "Week", "Month"] as const) {
  // Raw OHLC oracle builds a set of price-row / four-hour-window pairs with
  // ordinary UTC Date arithmetic, independently of the app's TPO helpers.
  const expectedCells = new Map<string, { start: number; price: number }>();
  for (const row of rows) {
    const time = Number(row[0]) * 1000, date = new Date(time);
    const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const opening = period === "Day" ? midnight : period === "Week" ? midnight - (date.getUTCDay() + 6) % 7 * day : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const start = opening + Math.floor((time - opening) / (4 * hour)) * 4 * hour;
    for (let price = Math.floor(Number(row[3]) / 100) * 100; price <= Math.floor(Number(row[2]) / 100) * 100; price += 100)
      expectedCells.set(`${start}:${price}`, { start, price });
  }
  const rects: number[][] = [], expected = [...expectedCells.values()].filter(cell => xOf(cell.start + 4 * hour) - 6 >= 0 && xOf(cell.start) - 6 <= 10000)
    .map(cell => [xOf(cell.start) - 6, cell.price / 10, 47.4, 9.4]);
  const ctx = { save() {}, restore() {}, beginPath() {}, rect: (...args: number[]) => rects.push(args), fill() {} } as unknown as CanvasRenderingContext2D;
  const style = { ...defaultTpo(), sessionPeriod: period, blockMinutes: "240" as const, rowSize: 100, splitPeriods: true,
    candlesVisible: false, lettersVisible: false, pocVisible: false, valueAreaVisible: false, boundariesVisible: false, ibVisible: false };
  const args = { bars, scale: {}, bounds: { top: 0, height: 20000 }, theme: { textColor: "#fff" },
    coords: { width: 10000, timeToX: xOf, pxPerBar: () => 12, priceToY: (price: number) => price / 10 } } as unknown as RendererLayerArgs;
  const sessions = buildTpoSessions(bars, style, "1h", "KRK:BTC/USD");
  paintTpoSessions(ctx, args, sessions, style);
  const sorted = (values: number[][]) => values.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepEqual(sorted(rects), sorted(expected));
  report.push({ period, verified: true, sessions: sessions.length, renderedCells: rects.length, firstCell: rects[0], lastCell: rects.at(-1) });
}
await writeFile("artifacts/tpo-split-live.json", JSON.stringify({ checkedAt: new Date().toISOString(), provider: "Kraken public closed BTC/USD 1h",
  closedBars: rows.length, excludedFormingRows: 1, report, raw }, null, 2));
console.log(JSON.stringify({ closedBars: rows.length, report }));
