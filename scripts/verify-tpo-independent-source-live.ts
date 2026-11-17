import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { yahooChart } from "../lib/server/yahoo";
import { loadYahooBars, type YahooLoadRequest } from "../lib/market/yahooClient";
import { TpoCandlePool, TpoCandleSource, type TpoSourceRequest } from "../lib/orderflow/tpoCandleSource";
import { defaultTpo } from "../lib/orderflow/tpoSettings";
import { createTpoCache } from "../lib/orderflow/tpoModel";
import { registerMarketSessions, marketSessions } from "../lib/market/sessionWindows";
import { TpoVolumeLadderCache } from "../lib/orderflow/tpoVolumeLadder";
import type { OHLCV } from "@luxalgo/vela";
const captures: unknown[] = [];
const loader = (request: YahooLoadRequest) => loadYahooBars({ ...request, chartLoader: async (ticker, interval, period1, period2, extended) => {
  const value = await yahooChart({ ticker, interval, period1: period1 / 1000, period2: period2 / 1000, extended });
  captures.push({ extended, value });
  return { meta: value.meta, rows: value.bars.map(b => [b.time, b.open, b.high, b.low, b.close, b.volume]), adj: value.adjClose, events: value.events };
} });
const base = await loader({ ticker: "AAPL", timeframe: "15m", count: 600, extended: false, adjustDividends: false });
assert.ok(base.meta?.sessions); registerMarketSessions("YF:AAPL", base.meta.sessions, "regular");
const original = JSON.stringify(base.bars), calendar = marketSessions("YF:AAPL"), pool = new TpoCandlePool(loader), checks = [];
for (const tradingHours of ["Regular hours (RTH)", "Extended hours (ETH)", "Pre-market"] as const) {
  let wake!: () => void;
  const ready = new Promise<void>(resolve => { wake = resolve; }), owner = new TpoCandleSource(() => wake(), pool);
  const request: TpoSourceRequest = { symbol: "YF:AAPL", timeframe: "15m", bars: base.bars, style: { ...defaultTpo(), tradingHours, ladderVisible: true }, epoch: "isolated-public-probe", replay: false, adjustDividends: false };
  assert.equal(owner.read(request).status, "loading");
  let timer: ReturnType<typeof setTimeout>;
  try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Source probe timed out")), 45000); })]); }
  finally { clearTimeout(timer!); }
  const read = owner.read(request); assert.equal(read.status, "ready"); if (read.status !== "ready") throw new Error("No source data");
  const sessions = createTpoCache().read(read.value.bars, request.style, "15m", request.symbol, read.value.calendar);
  const ladders = new TpoVolumeLadderCache().read(read.value.bars, sessions, request.style);
  let observations = 0, zeroVolumeProfiles = 0;
  for (const session of sessions) {
    const source: readonly OHLCV[] = read.value.bars.filter(b => b.time >= session.start && b.time < session.end);
    const volume = source.reduce((n, b) => n + (b.volume ?? 0), 0);
    assert.equal(session.coverage.loadedBars, source.length);
    const ladder = ladders.get(session.start)!;
    if (volume === 0) { assert.equal(ladder.profile, null); zeroVolumeProfiles++; }
    else { assert.ok(ladder.profile, `${session.date}: ${ladder.status}: ${ladder.message}`); assert.ok(Math.abs(ladder.profile.total - volume) < Math.max(1e-9, volume * 1e-10)); }
    if (tradingHours === "Regular hours (RTH)") assert.ok(read.value.calendar!.regular.some(w => w[0] === session.start && w[1] === session.end));
    if (tradingHours === "Extended hours (ETH)") assert.ok(read.value.calendar!.extended.some(w => w[0] === session.start && w[1] === session.end));
    if (tradingHours === "Pre-market") { assert.equal(new Date(session.start).getUTCHours(), 9); assert.equal(new Date(session.end).getUTCHours(), 13); assert.equal(new Date(session.end).getUTCMinutes(), 30); }
    observations += source.length;
  }
  assert.equal(JSON.stringify(base.bars), original); assert.equal(marketSessions("YF:AAPL"), calendar);
  checks.push({ tradingHours, hostCandles: base.bars.length, independentCandles: read.value.bars.length, sessionCandles: observations, profiles: sessions.length, zeroVolumeProfiles, hostUnchanged: true, verified: true });
  owner.reset();
}
{
  const cursor = base.bars.at(-50)!.time, prefix = base.bars.filter(b => b.time <= cursor), through = cursor + 900000;
  let wake!: () => void;
  const ready = new Promise<void>(resolve => { wake = resolve; }), owner = new TpoCandleSource(() => wake(), pool);
  const request: TpoSourceRequest = { symbol: "YF:AAPL", timeframe: "15m", bars: prefix, style: { ...defaultTpo(), tradingHours: "Extended hours (ETH)" }, epoch: "isolated-public-replay", replay: true, through, adjustDividends: false };
  owner.read(request); let timer: ReturnType<typeof setTimeout>;
  try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Replay source probe timed out")), 45000); })]); }
  finally { clearTimeout(timer!); }
  const read = owner.read(request); assert.equal(read.status, "ready"); if (read.status !== "ready") throw new Error("No Replay source data");
  assert.ok(read.value.bars.every(b => b.time + 900000 <= through));
  const sessions = createTpoCache().read(read.value.bars, request.style, "15m", request.symbol, read.value.calendar);
  assert.ok(sessions.every(s => s.coverage.lastBar <= cursor));
  checks.push({ tradingHours: "Extended hours (ETH)", hostCandles: prefix.length, independentCandles: read.value.bars.length, sessionCandles: read.value.bars.length,
    profiles: sessions.length, zeroVolumeProfiles: 0, hostUnchanged: true, verified: true, replayThrough: new Date(through).toISOString() });
  owner.reset();
}
await writeFile("artifacts/tpo-source-live.json", JSON.stringify({ capturedAt: new Date().toISOString(), checks, captures }, null, 2));
console.log(JSON.stringify(checks));
