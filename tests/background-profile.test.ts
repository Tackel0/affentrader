import { describe, it, expect } from "vitest";
import { BackgroundProfile } from "@/lib/orderflow/backgroundProfile";
import { ProfileJobs, type ProfileResponse, type ProfileRequest } from "@/lib/orderflow/profileJobs";
import { FixedProfileCache } from "@/lib/orderflow/fixedProfileModel";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { Tick } from "@/types/trading";
import { ExecutionRangeProfileCache } from "@/lib/orderflow/executionRangeProfile";
const bars = Array.from({ length: 240 }, (_, time) => ({ time, open: 10, close: 12, low: 9, high: 13 + time / 100, volume: 100 }));
const options = { rows: 24, valueAreaPct: 70, developing: true };
const expected = () => new FixedProfileCache().read(bars, options);
function fixture() {
  const requests: Array<{ complete: (response: ProfileResponse) => void; bars: typeof bars }> = [];
  const profile = new BackgroundProfile({ submit: (_owner, source, _options, complete) => { requests.push({ complete, bars: source as typeof bars }); } });
  let state: { bars: typeof bars; options: typeof options; context: string } | null = { bars: bars.map(bar => ({ ...bar })), options, context: "BTC:1m:replay140" };
  let paints = 0;
  const read = () => profile.read(state!.bars, state!.options, state!.context, () => state, () => { paints++; });
  return { requests, read, set: (value: typeof state) => { state = value; }, state: () => state!, paints: () => paints };
}
describe("background developing profile snapshots", () => {
  it("shows pending instead of old geometry, commits once and reuses unchanged results", () => {
    const f = fixture(); expect(f.read().notice).toContain("Calculating"); expect(f.read().result).toBeNull(); expect(f.requests).toHaveLength(1);
    const result = expected(); f.requests[0].complete({ id: 1, result }); expect(f.read().result).toBe(result); expect(f.paints()).toBe(1);
    f.set({ ...f.state(), bars: bars.slice(0, 210) }); expect(f.read().result).toBeNull(); expect(f.requests).toHaveLength(2);
  });
  it.each(["symbol", "interval", "replay", "anchor"])("rejects an idle %s switch before repaint", field => {
    const f = fixture(); f.read(); f.set({ ...f.state(), context: field }); f.requests[0].complete({ id: 1, result: expected() }); expect(f.paints()).toBe(0);
    expect(f.read().notice).toContain("Calculating");
  });
  it("rejects repaired candles, changed inputs and detached charts", () => {
    for (const change of ["bar", "settings", "detached"]) {
      const f = fixture(); f.read();
      if (change === "bar") f.state().bars[5].volume++;
      else if (change === "settings") f.set({ ...f.state(), options: { ...options, rows: 32 } });
      else f.set(null);
      f.requests[0].complete({ id: 1, result: expected() }); expect(f.paints()).toBe(0);
      expect(f.requests[0].bars[5].volume).toBe(100);
    }
  });
  it("keeps worker failures visible without a render retry loop", () => {
    const f = fixture(); f.read(); f.requests[0].complete({ id: 1, error: "worker failed" });
    expect(f.read()).toEqual({ result: null, notice: "worker failed" }); expect(f.requests).toHaveLength(1);
  });
  it("executes the actual bundled worker with exact synchronous math and old-bar repair", () => {
    const responses: ProfileResponse[] = [];
    const scope: { onmessage?: (event: { data: ProfileRequest }) => void; postMessage: (value: ProfileResponse) => void } = { postMessage: value => responses.push(value) };
    runInNewContext(readFileSync("public/workers/fixed-profile.js", "utf8"), { self: scope });
    scope.onmessage!({ data: { id: 1, owner: 1, bars, options } }); expect(responses[0].result).toEqual(expected());
    const repaired = bars.map(bar => ({ ...bar })); repaired[7].volume = 300;
    scope.onmessage!({ data: { id: 2, owner: 1, bars: repaired, options } });
    expect(responses[1].result).toEqual(new FixedProfileCache().read(repaired, options));
  });
  it("serializes CPU work and coalesces queued snapshots per owner", () => {
    const posted: ProfileRequest[] = [], finished: ProfileResponse[] = [];
    const worker = { postMessage: (request: ProfileRequest) => posted.push(request), terminate() {}, onmessage: null as ((event: { data: ProfileResponse }) => void) | null };
    const jobs = new ProfileJobs(() => worker as unknown as Worker);
    jobs.submit(1, bars, options, value => finished.push(value)); jobs.submit(2, bars, options, value => finished.push(value)); jobs.submit(2, bars.slice(1), options, value => finished.push(value));
    expect(posted).toHaveLength(1); expect(finished[0].error).toContain("superseded");
    worker.onmessage!({ data: { id: posted[0].id, result: null } });
    expect(posted).toHaveLength(2); expect(posted[1].bars).toHaveLength(239);
  });
  it("runs the actual worker with classified quantities, causal developing levels and source-mode changes", () => {
    const responses: ProfileResponse[] = [], scope: { onmessage?: (event: { data: ProfileRequest }) => void; postMessage: (value: ProfileResponse) => void } = { postMessage: value => responses.push(value) };
    runInNewContext(readFileSync("public/workers/fixed-profile.js", "utf8"), { self: scope });
    const source = Array.from({ length: 300 }, (_, i) => ({ ...bars[0], time: i * 60000 }));
    const trades: Tick[] = Array.from({ length: 15000 }, (_, i) => ({ id: String(i), symbol: "HL:BTC", time: Math.floor(i / 50) * 60000 + i % 50, price: 100 + i % 100 / 100, quantity: .01, side: i % 2 ? "buy" : "sell", simulated: false }));
    const expected = new ExecutionRangeProfileCache().read(source, options, trades, "1m");
    scope.onmessage!({ data: { id: 1, owner: 1, bars: source, options, execution: { trades, timeframe: "1m" } } }); expect(responses[0].result).toEqual(expected); expect(responses[0].result?.total).toBe(150);
    scope.onmessage!({ data: { id: 2, owner: 1, bars, options } }); expect(responses[1].result).toEqual(new FixedProfileCache().read(bars, options));
    scope.onmessage!({ data: { id: 3, owner: 1, bars: source.slice(0, 1), options, execution: { trades, timeframe: "1m" } } }); expect(responses[2].result?.total).toBe(.5);
  });
  it("freezes shared execution snapshots and rejects changed live quantities before commit", () => {
    const calls: Array<{ request?: Parameters<ProfileJobs["submit"]>[4]; complete: (response: ProfileResponse) => void }> = [];
    const profile = new BackgroundProfile({ submit: (_owner, _bars, _options, complete, request) => { calls.push({ request, complete }); } });
    const source = [{ ...bars[0], time: 0 }], trades: Tick[] = [{ id: "one", symbol: "HL:BTC", time: 1, price: 100, quantity: 2, side: "buy", simulated: false }];
    const current = { bars: source, options, context: "HL:BTC:1m", execution: { trades, timeframe: "1m" } }; let paints = 0;
    profile.read(source, options, current.context, () => current, () => { paints++; }, current.execution);
    trades[0].quantity = 9; expect(calls[0].request?.trades[0].quantity).toBe(2); expect(Object.isFrozen(calls[0].request?.trades[0])).toBe(true);
    calls[0].complete({ id: 1, result: null }); expect(paints).toBe(0);
    profile.read(source, options, current.context, () => current, () => { paints++; }, current.execution); expect(calls).toHaveLength(2);
  });
  it("bounds queued classified snapshots while preserving one active request", () => {
    const posted: ProfileRequest[] = [], finished: ProfileResponse[] = [], worker = { postMessage: (request: ProfileRequest) => posted.push(request), terminate() {}, onmessage: null };
    const jobs = new ProfileJobs(() => worker as unknown as Worker);
    const trades = Array.from({ length: 100000 }, (_, i) => ({ id: String(i), symbol: "HL:BTC", time: i, price: 100, quantity: 1, side: "buy" as const, simulated: false }));
    for (let owner = 1; owner <= 4; owner++) jobs.submit(owner, bars, options, response => finished.push(response), { trades, timeframe: "1m" });
    expect(posted).toHaveLength(1); expect(finished).toHaveLength(1); expect(finished[0].error).toContain("Too many queued");
  });
});
