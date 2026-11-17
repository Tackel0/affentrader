import { afterEach, expect, it, vi } from "vitest";
import type { Tick } from "@/types/trading";
import { TpoExecutionSource } from "@/lib/orderflow/tpoExecutionSource";
import { buildTpoSessions } from "@/lib/orderflow/tpoModel";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";
const start = Date.UTC(2026,10,4), symbol = "BTCUSDT", m = 60000;
const bars = [0,30].map(t => ({time:start+t*m,open:100,high:101,low:100,close:100,volume:9999}));
const style = {...defaultTpo(),rowSize:1,colorBy:"Volume" as const};
const input = {symbol,timeframe:"30m",epoch:"1",replay:false,sessions:buildTpoSessions(bars,style,"30m",symbol),bars,style};
const tick = (id:string, time = start+1000): Tick => ({id,symbol,time,price:100,quantity:1,side:"buy",tradeCount:1,simulated:false});
function fixture() {
  let revision = 0, live:Tick[] = [tick("a")], archived:Tick[] = [tick("r")], hasReplay = true;
  const listeners = new Set<(t:Tick)=>void>(), archives = new Set<()=>void>(), repaint = vi.fn(), trades = vi.fn(()=>live);
  const source = new TpoExecutionSource({ trades, revision:()=>revision,
    replay:()=>hasReplay ? {trades:archived} : undefined,
    ticks:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
    subscribe:(_,fn)=>{archives.add(fn);return()=>{archives.delete(fn);};} },repaint);
  return {source,repaint,trades,listeners,emit:(t:Tick)=>{for(const f of [...listeners])f(t);},live:(t:Tick[])=>{live=t;}, replay:(t:Tick[])=>{archived=t;},noReplay:()=>{hasReplay=false;},change:()=>{revision++;for(const f of [...archives])f();},count:()=>listeners.size+archives.size};
}
afterEach(()=>vi.useRealTimers());
it("retains subscribed live executions beyond tape replacement and batches source-only repaints", async()=>{
  vi.useFakeTimers(); const f=fixture();
  try {
    f.source.read(input); f.emit(tick("b")); f.emit(tick("c")); f.live([]);
    await vi.advanceTimersByTimeAsync(50); expect(f.repaint).toHaveBeenCalledTimes(1);
    expect(f.source.read(input)?.sessions.get(start)?.rows[0]?.buy).toBe(3);
    expect(f.trades).toHaveBeenCalledTimes(1);
  } finally {f.source.reset();}
});
it("never subscribes to live executions during Replay and refilters a backward seek",()=>{
  const f=fixture(); f.replay([tick("r"),tick("future",start+30*m)]);
  try {
    const replay={...input,replay:true,through:start+60*m};
    expect(f.source.read(replay)?.sessions.get(start)?.rows[0]?.buy).toBe(2); expect(f.listeners.size).toBe(0);
    f.emit(tick("live")); expect(f.source.read({...replay,through:start+30*m})?.sessions.get(start)?.rows[0]?.buy).toBe(1);
    f.noReplay(); expect(f.source.read({...replay,through:start+5*m})?.message).toMatch(/no revealed archived/);
  } finally {f.source.reset();}
});
it("discards old observations on archive replacement, feed changes and symbol changes",()=>{
  const f=fixture();
  try {
    f.source.read(input); f.live([tick("b")]); f.change();
    expect(f.source.read(input)?.sessions.get(start)?.rows[0]?.buy).toBe(1);
    f.live([]); expect(f.source.read({...input,epoch:"2"})?.sessions.size).toBe(0);
    expect(f.source.read({...input,symbol:"ETHUSDT"})?.sessions.size).toBe(0);
  } finally {f.source.reset();}
});
it("detaches pending repaint and all source subscriptions when hidden or set to Time",async()=>{
  vi.useFakeTimers(); const f=fixture();
  f.source.read(input); f.emit(tick("b")); f.source.reset();
  await vi.advanceTimersByTimeAsync(60); expect(f.repaint).not.toHaveBeenCalled(); expect(f.count()).toBe(0);
  f.source.read(input); expect(f.source.read({...input,style:{...style,colorBy:"Time"}})).toBeUndefined(); expect(f.count()).toBe(0);
});
it("keeps independent overlay/native sources and their retained totals separate",()=>{
  const a=fixture(),b=fixture();
  try { a.source.read(input); b.source.read(input); a.emit(tick("extra"));
    expect(a.source.read(input)?.sessions.get(start)?.rows[0]?.buy).toBe(2);
    expect(b.source.read(input)?.sessions.get(start)?.rows[0]?.buy).toBe(1);
  }finally{a.source.reset();b.source.reset();}
});
