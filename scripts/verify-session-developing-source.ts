import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { loadKrakenRecentTrades } from "../lib/market/kraken";
import { buildSessionVolumeProfiles } from "../lib/orderflow/volumeProfileModel";
import { defaultVolumeProfile } from "../lib/orderflow/volumeProfileSettings";
const capture = JSON.parse(await readFile("artifacts/session-profile-hours-live.json", "utf8"));
const trades = await loadKrakenRecentTrades("BTC/USD", 1000, async () => Response.json(capture.raw));
const tuples = (capture.raw.result["BTC/USD"] as unknown[][]).map(row => ({ id: Number(row[6]), time: Math.floor(Number(row[2]) * 1000),
  bin: Math.floor(Number(row[0]) / 10), quantity: Number(row[1]) })).sort((a, b) => a.time - b.time);
let checked = 0;
for (const [timeframe, duration] of [["1s", 1000], ["1m", 60000]] as const) for (const percent of [70, 100]) {
  const style = { ...defaultVolumeProfile(), rowSize: 10, valueAreaPercent: percent, showDevelopingPoc: true, showDevelopingValueArea: true };
  const model = buildSessionVolumeProfiles(trades, style, "KRK:BTC/USD", undefined, timeframe);
  for (const session of model.sessions) {
    const seen = new Set<number>(), source = tuples.filter(t => t.time >= session.start && t.time < session.end && !seen.has(t.id) && !!seen.add(t.id));
    const first = Math.min(...source.map(t => t.bin)), last = Math.max(...source.map(t => t.bin)), midpoint = (first + last) / 2;
    for (const point of session.developing!) {
      const prefix = source.filter(t => t.time < point.time + duration), totals = new Map<number, number>();
      for (const t of prefix) totals.set(t.bin, (totals.get(t.bin) ?? 0) + t.quantity);
      const maximum = Math.max(...totals.values());
      const poc = [...totals].filter(([, qty]) => qty === maximum).map(([bin]) => bin)
        .sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint) || a - b)[0];
      const total = [...totals.values()].reduce((a, b) => a + b, 0), target = total * percent / 100;
      let low = poc, high = poc, amount = totals.get(poc)!;
      while (amount < target && (low > first || high < last)) {
        const lower = low > first ? totals.get(low - 1) ?? 0 : -1, upper = high < last ? totals.get(high + 1) ?? 0 : -1;
        const up = upper > lower || upper === lower && high + 1 - poc <= poc - (low - 1);
        const addition = up ? upper : lower;
        if (amount + addition > target + Number.EPSILON * total * 8) break;
        if (up) high++; else low--; amount += addition;
      }
      assert.equal(point.poc, poc * 10 + 5); assert.equal(point.val, low * 10); assert.equal(point.vah, (high + 1) * 10);
      assert.equal(point.executions, prefix.length); assert.ok(Math.abs(point.volume - total) < 1e-9); checked++;
    }
  }
}
const performanceTrades = Array.from({ length: 100000 }, (_, i) => ({ ...trades[0], id: String(i), time: Date.UTC(2026, 10, 4) + i * 800,
  price: 80000 + i % 24, quantity: i % 5 + 1 }));
const before = performance.now();
const capacity = buildSessionVolumeProfiles(performanceTrades, { ...defaultVolumeProfile(), rowSize: 1, showDevelopingPoc: true }, "KRK:BTC/USD", undefined, "1s");
const elapsedMs = Math.round(performance.now() - before);
assert.equal(capacity.retained, 100000); assert.equal(capacity.sessions[0].developing!.at(-1)!.executions, 100000);
const report = { checkedAt: new Date().toISOString(), sourceCapture: capture.capturedAt, executions: trades.length, checkedPrefixPoints: checked,
  capacity: { executions: capacity.retained, points: capacity.sessions[0].developing!.length, rows: capacity.sessions[0].rows.length, elapsedMs },
  scope: "Independent raw-tuple POC/VA/prefix oracle on a retained public Kraken capture; capacity timing uses synthetic executions. No fresh live capture or gap-free history claim." };
await writeFile("artifacts/session-profile-developing-source.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
