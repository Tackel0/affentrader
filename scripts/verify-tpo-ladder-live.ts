import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { loadKrakenClosedBars } from "../lib/market/kraken";
import { buildTpoSessions } from "../lib/orderflow/tpoModel";
import { defaultTpo } from "../lib/orderflow/tpoSettings";
import { TpoVolumeLadderCache } from "../lib/orderflow/tpoVolumeLadder";
const capture = JSON.parse(await readFile("artifacts/tpo-overlay-live.json", "utf8")), raw = capture.raw;
const rows = (Object.values(raw.result).find(Array.isArray) as unknown[][]).slice(0, -1);
const bars = await loadKrakenClosedBars("BTC/USD", "1h", async () => Response.json(raw));
const day = 86400000, report = [];
for (const period of ["Day", "Week", "Month"] as const) for (const n of [12, 24]) {
  const groups = new Map<number, unknown[][]>();
  for (const row of rows) {
    const date = new Date(Number(row[0]) * 1000), midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const start = period === "Day" ? midnight : period === "Week" ? midnight - (date.getUTCDay() + 6) % 7 * day : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const group = groups.get(start) ?? []; group.push(row); groups.set(start, group);
  }
  const style = { ...defaultTpo(), sessionPeriod: period, blockMinutes: "240" as const, rowSize: 100, ladderVisible: true, ladderRows: n, ladderValueAreaPercent: 80 };
  const sessions = buildTpoSessions(bars, style, "1h"), ladders = new TpoVolumeLadderCache().read(bars, sessions, style); let checked = 0;
  for (const session of sessions) {
    const source = groups.get(session.start)!.filter(row => Number(row[6]) > 0), ladder = ladders.get(session.start)!; assert.ok(ladder.profile);
    // Independent O(bars * rows) overlap oracle in integer quote units. No app
    // bin allocator, decimal grid or volume-value-area implementation is used.
    const unit = (value: unknown) => Math.round(Number(value) * 100000);
    const low = Math.min(...source.map(row => unit(row[3]))), high = Math.max(...source.map(row => unit(row[2]))), span = high - low;
    const expected = Array(n).fill(0) as number[];
    for (const row of source) {
      const a = unit(row[3]), b = unit(row[2]), volume = Number(row[6]);
      if (a === b) { expected[Math.min(n - 1, Math.floor((a - low) * n / span))] += volume; continue; }
      for (let i = 0; i < n; i++) {
        const overlap = Math.max(0, Math.min(b * n, low * n + span * (i + 1)) - Math.max(a * n, low * n + span * i));
        expected[i] += volume * overlap / ((b - a) * n);
      }
    }
    const profile = ladder.profile.profile, total = source.reduce((sum, row) => sum + Number(row[6]), 0), tolerance = Math.max(1e-9, total * 1e-10);
    assert.equal(profile.rows.length, n); assert.ok(Math.abs(ladder.profile.total - total) <= tolerance);
    profile.rows.forEach((r, i) => { assert.ok(Math.abs(r.up + r.down - expected[i]) <= tolerance); assert.ok(Math.abs(profile.edges[i] - (low * n + span * i) / (n * 100000)) < 1e-8); });
    const max = Math.max(...expected), candidates = expected.flatMap((v, i) => v === max ? [i] : []), center = (n - 1) / 2;
    candidates.sort((a, b) => Math.abs(a - center) - Math.abs(b - center)); const poc = candidates[0]; assert.equal(profile.poc, poc);
    let lo = poc, hi = poc, amount = expected[poc];
    while (amount < total * .8 && (lo > 0 || hi < n - 1)) {
      const below = lo > 0 ? expected[lo - 1] : -1, above = hi < n - 1 ? expected[hi + 1] : -1;
      const up = above > below || above === below && hi + 1 - poc <= poc - (lo - 1), next = up ? above : below;
      if (amount + next > total * .8 + Number.EPSILON * total * 8) break;
      amount += next; if (up) hi++; else lo--;
    }
    assert.equal(profile.vaFrom, lo); assert.equal(profile.vaTo, hi); checked++;
  }
  report.push({ period, rows: n, profilesChecked: checked, verified: true });
}
await writeFile("artifacts/tpo-ladder-live.json", JSON.stringify({ checkedAt: new Date().toISOString(), capturedAt: capture.checkedAt,
  source: "Retained public Kraken BTC/USD hourly response", closedBars: rows.length, report }, null, 2));
console.log(JSON.stringify(report));
