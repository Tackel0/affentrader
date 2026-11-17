import { expect, it } from "vitest";
import type { Tick } from "@/types/trading";
import { TpoMetricCollection } from "@/lib/orderflow/tpoMetrics";
import { buildTpoSessions } from "@/lib/orderflow/tpoModel";
import { defaultTpo, resolveTpo, validTpo } from "@/lib/orderflow/tpoSettings";
import { tpoMetricInk } from "@/lib/orderflow/tpoTimeColors";
import { tpoHoverLines, type TpoCellHit } from "@/lib/orderflow/tpoHover";
import { resolveTpoOverlay, tpoOverlayDescriptor } from "@/lib/orderflow/tpoOverlay";
const start = Date.UTC(2026, 10, 4), m = 60000, symbol = "KRK:BTC/USD";
const bars = [0, 30].map(i => ({ time: start + i * m, open: 100, high: 103, low: 100, close: 102, volume: 999999 }));
const style = { ...defaultTpo(), rowSize: 1, sessionMinutes: 60, colorBy: "Volume" as const };
const sessions = buildTpoSessions(bars, style, "30m", symbol);
const tick = (id: string, price = 100, quantity = 1, time = start + 1000, side: "buy" | "sell" = "buy"): Tick => ({ id, symbol, price, quantity, time, side, tradeCount: 1, simulated: false });
function collect(trades: Tick[]) { const c = new TpoMetricCollection(symbol); c.add(trades); return c; }
it("colors by session row totals but keeps block hover totals separate", () => {
  const c = collect([tick("a",100,2), tick("b",100,3,start+30*m+1000,"sell"), tick("c",101,10)]);
  const metrics = c.read(sessions,style,bars,"30m").sessions.get(start)!;
  expect(metrics.rows[0]).toEqual({ buy: 2, sell: 3, count: 2, executions: 2 });
  expect(metrics.cells[0].get(0)?.buy).toBe(2); expect(metrics.cells[0].get(1)?.sell).toBe(3);
  expect(metrics.maximum).toEqual({volume:10,trades:2,delta:10});
  expect(tpoMetricInk(style,metrics,metrics.rows[0],true)).toEqual({color:"#3d6fd4",alpha:1});
  expect(metrics.rows[2]).toBeUndefined(); expect(tpoMetricInk(style,metrics,metrics.rows[2],true)).toBeUndefined();
});
it("uses supplied underlying print counts and falls back when any contributing count is unknown", () => {
  const a = tick("a"); a.tradeCount = 17;
  const b = tick("b",101); delete b.tradeCount;
  const c = collect([a,b]), metrics = c.read(sessions,style,bars,"30m").sessions.get(start)!;
  expect(metrics.rows[0]?.count).toBe(17); expect(metrics.rows[1]?.count).toBeUndefined(); expect(metrics.countsKnown).toBe(false);
  expect(tpoMetricInk({...style,colorBy:"Trades count"},metrics,metrics.rows[0],true)).toBeUndefined();
  c.add([{...b,tradeCount:4}]); expect(c.read(sessions,style,bars,"30m").sessions.get(start)!.countsKnown).toBe(true);
});
it("uses the reference delta side colors and four normalized alpha strengths", () => {
  const c = collect([tick("a",100,1,start+1000,"sell"),tick("b",101,4),tick("c",102,2)]);
  const metrics = c.read(sessions,style,bars,"30m").sessions.get(start)!;
  expect(tpoMetricInk({...style,colorBy:"Delta",deltaTheme:"neon"},metrics,metrics.rows[0],true)).toEqual({color:"#ff1744",alpha:.55});
  expect(tpoMetricInk({...style,colorBy:"Delta",deltaTheme:"arctic"},metrics,metrics.rows[1],true)).toEqual({color:"#2962ff",alpha:.95});
  expect(tpoMetricInk({...style,colorBy:"Delta",deltaTheme:"custom",deltaUpColor:"#abcdef"},metrics,metrics.rows[2],false)).toEqual({color:"#abcdef",alpha:.75*.45});
});
it("excludes missing candle windows, absent price cells and executions at/after a Replay boundary", () => {
  const c = collect([tick("a"),tick("b",100,90,start+15*m),tick("c",105,90),tick("d",100,90,start+30*m)]);
  const own = [bars[0]], model = buildTpoSessions(own,style,"5m",symbol);
  const read = c.read(model,style,own,"5m",start+30*m).sessions.get(start)!;
  expect(read.rows[0]?.buy).toBe(1); expect(read.maximum.volume).toBe(1);
});
it("deduplicates archive/live overlap and fails closed on conflicting IDs", () => {
  const a = tick("a"), c = collect([a,a]); c.add([a]);
  expect(c.read(sessions,style,bars,"30m").sessions.get(start)!.rows[0]?.buy).toBe(1);
  c.add([{...a,quantity:99}]); const failed = c.read(sessions,style,bars,"30m");
  expect(failed.sessions.size).toBe(0); expect(failed.message).toMatch(/conflicting/);
});
it("never derives aggressor metrics from simulated/other-market ticks or candle volume", () => {
  const c = collect([{...tick("a"),simulated:true},{...tick("b"),symbol:"ETHUSDT"}]);
  expect(c.read(sessions,style,bars,"30m").sessions.size).toBe(0);
});
it("recomputes a stable Replay prefix on backward seek and cell-grid edits", () => {
  const c = collect([tick("a",100,2),tick("b",101,3,start+30*m+1000)]);
  expect(c.read(sessions,style,bars,"30m",start+60*m).sessions.get(start)!.maximum.volume).toBe(3);
  expect(c.read(sessions,style,bars,"30m",start+30*m).sessions.get(start)!.maximum.volume).toBe(2);
  const coarse = {...style,rowSize:2}, model = buildTpoSessions(bars,coarse,"30m",symbol);
  expect(c.read(model,coarse,bars,"30m").sessions.get(start)!.rows[0]?.buy).toBe(5);
});
it("rejects retained capacity overflow instead of silently shaving quantities", () => {
  const c = new TpoMetricCollection(symbol,1); c.add([tick("a"),tick("b")]);
  expect(c.read(sessions,style,bars,"30m").sessions.size).toBe(0);
  expect(c.read(sessions,style,bars,"30m").message).toMatch(/retained executions/);
});
it("reports observed block metrics with explicit missing and unknown cases", () => {
  const hit = {letter:"A",lower:100,upper:101,start,end:start+30*m,sessionStatus:"developing"} as TpoCellHit;
  const value = {buy:2,sell:3,count:7,executions:2};
  expect(tpoHoverLines(hit,{mode:"Volume",value})).toContain("Observed block volume: 5");
  expect(tpoHoverLines(hit,{mode:"Delta",value})).toContain("Observed block delta: -1");
  expect(tpoHoverLines(hit,{mode:"Trades count",value:{...value,count:undefined}})).toContain("Observed block trades: unknown");
  expect(tpoHoverLines(hit,{mode:"Volume"})).toContain("No observed block executions · Time fallback");
});
it("persists all metric modes/themes on both surfaces and accepts pre-metric settings", () => {
  const legacy = {...defaultTpo()}; delete legacy.colorBy; delete legacy.deltaTheme; delete legacy.deltaUpColor; delete legacy.deltaDownColor;
  expect(validTpo(legacy)).toBe(true);
  const preferences = {...style,colorBy:"Delta" as const,deltaTheme:"orchid" as const};
  expect(validTpo(preferences)).toBe(true); expect(resolveTpoOverlay(preferences)).toMatchObject({colorBy:"Delta",deltaTheme:"orchid"});
  expect(resolveTpo({colorBy:"fake",deltaTheme:"fake"})).toEqual(defaultTpo());
  expect(validTpo({...style,colorBy:"fake"})).toBe(false);
  expect(tpoOverlayDescriptor().defaultInputs!()).toMatchObject({colorBy:"Time",deltaTheme:"classic"});
});
