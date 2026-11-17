import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { NativeIndicatorContext } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { sessionProfileDescriptor } from "@/lib/orderflow/volumeProfileIndicator";
import { SessionProfileJobs, packSessionTrades, type SessionProfileRequest, type SessionProfileResponse, type SessionProfileExecutor } from "@/lib/orderflow/sessionProfileJobs";
import { buildSessionVolumeProfiles } from "@/lib/orderflow/volumeProfileModel";
import { defaultVolumeProfile, type VolumeProfilePreferences } from "@/lib/orderflow/volumeProfileSettings";
import type { VolumeProfileChannel } from "@/lib/orderflow/volumeProfileRenderer";

const style = { ...defaultVolumeProfile(), rowSize: 1 };
const trade = (i: number, simulated = true): Tick => ({ id: `t${i}`, symbol: "HL:BTC", time: Date.UTC(2026, 9, 29) + i * 100,
  price: 100 + i % 20, quantity: i % 3 + 1, side: i % 2 ? "buy" : "sell", simulated });
const source = Array.from({ length: 10001 }, (_, i) => trade(i));
function fixture() {
  const requests: Array<{ trades: readonly Tick[]; style: VolumeProfilePreferences; complete: (response: SessionProfileResponse) => void }> = [];
  const jobs: SessionProfileExecutor = { submit(_owner, trades, options, _symbol, complete) { requests.push({ trades, style: options, complete }); }, cancel: vi.fn() };
  let tape: readonly Tick[] = source, receive: ((tick?: Tick) => void) | undefined, channel: VolumeProfileChannel | null = null;
  const instance = sessionProfileDescriptor(() => tape, (_symbol, callback) => { receive = callback; return () => { receive = undefined; }; }, jobs).create();
  const context = { symbol: "HL:BTC", live: true, emit() {}, pushData(value: VolumeProfileChannel | null) { channel = value; }, setStatus() {} } as unknown as NativeIndicatorContext;
  instance.start(context, style);
  return { requests, instance, context, payload: () => channel?.current, tape: (value: readonly Tick[]) => { tape = value; }, tick: (value: Tick) => receive?.(value),
    finish(index: number, error?: string) { const request = requests[index]; request.complete(error ? { id: index, error } : { id: index, model: buildSessionVolumeProfiles(request.trades, request.style, "HL:BTC") }); } };
}
describe("background session profile calculation", () => {
  it("runs the shipped worker with exact batch math at 100,000 executions and preserves DST/precision errors", () => {
    const replies: SessionProfileResponse[] = [];
    const scope: { onmessage?: (event: { data: SessionProfileRequest }) => void; postMessage: (response: SessionProfileResponse) => void } = { postMessage: response => replies.push(response) };
    runInNewContext(readFileSync("public/workers/session-profile.js", "utf8"), { self: scope, setTimeout, clearTimeout });
    const trades = Array.from({ length: 100000 }, (_, i) => trade(i));
    const send = (id: number, settings: VolumeProfilePreferences, input = trades) => scope.onmessage!({ data: { id, values: packSessionTrades(input), simulated: true, style: settings, symbol: "HL:BTC" } });
    send(1, style); expect(replies[0].model).toEqual(buildSessionVolumeProfiles(trades, style, "HL:BTC"));
    const dst = { ...style, sessionZone: "America/New_York", sessionStartMinutes: 570, sessionMinutes: 390 };
    const dated = source.map((value, i) => ({ ...value, time: Date.UTC(2026, 10, 1, 14) + i * 10000 }));
    send(2, dst, dated); expect(replies[1].model).toEqual(buildSessionVolumeProfiles(dated, dst, "HL:BTC"));
    send(3, { ...style, rowSize: .000001 }); expect(replies[2].error).toContain("2,000 rows"); expect(replies[2].model).toBeUndefined();
  });
  it("keeps completed observations visible while newer ticks queue, without starving publication", () => {
    vi.useFakeTimers(); try {
      const f = fixture(); expect(f.payload()?.message).toContain("Calculating"); expect(f.requests).toHaveLength(1);
      f.tick(trade(10001)); f.tape([trade(10001)]); vi.advanceTimersByTime(40); expect(f.requests).toHaveLength(1);
      f.finish(0); expect(f.payload()?.model?.retained).toBe(10001); expect(f.payload()?.pending).toBe(true); expect(f.requests).toHaveLength(2);
      f.finish(1); expect(f.payload()?.model?.retained).toBe(10002); expect(f.payload()?.pending).toBe(false); f.instance.stop();
    } finally { vi.useRealTimers(); }
  });
  it("fences changed math while accepting fresh display styles without redoing work", () => {
    const f = fixture(); f.instance.setInputs({ ...style, buyColor: "#123456" }); expect(f.requests).toHaveLength(1);
    f.finish(0); expect(f.payload()?.style.buyColor).toBe("#123456");
    f.instance.setInputs({ ...style, rowSize: 2 }); expect(f.payload()?.model).toBeUndefined(); expect(f.requests).toHaveLength(2);
    f.finish(0); expect(f.payload()?.model).toBeUndefined(); f.finish(1); expect(f.payload()?.model?.sessions[0].step).toBe(2); f.instance.stop();
  });
  it.each(["hide", "stop", "restart", "Replay", "source", "empty"])("rejects late worker results after %s", transition => {
    const f = fixture();
    if (transition === "hide") f.instance.suspend();
    if (transition === "stop") f.instance.stop();
    if (transition === "restart") f.instance.start({ ...f.context, symbol: "HL:ETH" }, style);
    if (transition === "Replay") { (f.context as { live: boolean }).live = false; f.instance.setInputs({ ...style, rowSize: 2 }); }
    if (transition === "source") { f.tape([trade(20000, false)]); f.instance.onBars(); }
    if (transition === "empty") { f.tape([]); f.instance.onBars(); }
    const before = f.payload(); f.finish(0); expect(f.payload()).toBe(before);
    if (transition === "source") expect(f.payload()?.model?.source).toBe("exchange");
    if (transition === "empty") expect(f.payload()?.model?.retained).toBe(0);
    f.instance.stop();
  });
  it("latches worker errors without retry loops and retries on hide/show", () => {
    const f = fixture(); f.finish(0, "worker failed"); expect(f.payload()?.message).toContain("worker failed");
    f.tape(source.slice()); f.instance.onBars(); expect(f.requests).toHaveLength(1); f.instance.suspend(); f.instance.resume();
    expect(f.requests).toHaveLength(2); f.finish(1); expect(f.payload()?.model?.retained).toBe(10001); f.instance.stop();
  });
  it("cannot publish an old subtotal after execution capacity fails while work is pending", () => {
    vi.useFakeTimers(); try {
      const f = fixture();
      for (let i = 10001; i <= 100000; i++) f.tick(trade(i));
      f.tape([trade(100000)]); vi.advanceTimersByTime(300);
      expect(f.payload()?.message).toContain("100,000 executions"); expect(f.payload()?.model).toBeUndefined();
      f.finish(0); expect(f.payload()?.message).toContain("100,000 executions"); expect(f.payload()?.model).toBeUndefined(); f.instance.stop();
    } finally { vi.useRealTimers(); }
  });
  it("serializes jobs, coalesces queued owners, transfers buffers and cancels callbacks", () => {
    const posted: SessionProfileRequest[] = [], transfers: Transferable[][] = [], finished: SessionProfileResponse[] = [];
    const worker = { postMessage(request: SessionProfileRequest, transfer: Transferable[]) { posted.push(request); transfers.push(transfer); }, terminate: vi.fn(), onmessage: null as ((event: { data: SessionProfileResponse }) => void) | null };
    const jobs = new SessionProfileJobs(() => worker as unknown as Worker);
    jobs.submit(1, source, style, "HL:BTC", response => finished.push(response));
    jobs.submit(2, source, style, "HL:BTC", response => finished.push(response)); jobs.submit(2, source.slice(1), style, "HL:BTC", response => finished.push(response));
    expect(posted).toHaveLength(1); expect(transfers[0]).toEqual([posted[0].values.buffer]); expect(finished[0].error).toContain("superseded");
    jobs.cancel(1); worker.onmessage!({ data: { id: posted[0].id, error: "old" } }); expect(finished).toHaveLength(1); expect(posted[1].values.length).toBe(40000);
    worker.onmessage!({ data: { id: posted[1].id, error: "done" } }); expect(finished.at(-1)?.error).toBe("done");
  });
  it("reports worker timeout and can start a replacement without accepting the old worker's events", () => {
    vi.useFakeTimers(); try {
      const workers = Array.from({ length: 2 }, () => ({ postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as ((event: { data: SessionProfileResponse }) => void) | null }));
      let index = 0; const replies: SessionProfileResponse[] = [], jobs = new SessionProfileJobs(() => workers[index++] as unknown as Worker);
      jobs.submit(1, source, style, "HL:BTC", response => replies.push(response)); vi.advanceTimersByTime(30000);
      expect(workers[0].terminate).toHaveBeenCalledOnce(); expect(replies[0].error).toContain("30 seconds");
      jobs.submit(1, source, style, "HL:BTC", response => replies.push(response)); const request = workers[1].postMessage.mock.calls[0][0] as SessionProfileRequest;
      workers[0].onmessage!({ data: { id: request.id, error: "stale" } }); expect(replies).toHaveLength(1);
      workers[1].onmessage!({ data: { id: request.id, error: "new" } }); expect(replies[1].error).toBe("new");
    } finally { vi.useRealTimers(); }
  });
});
