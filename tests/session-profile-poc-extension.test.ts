import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { createProfilePocExtensionCache } from "@/lib/orderflow/profilePocExtensions";
import { firstObservedPriceTouches, firstObservedRangeTouches } from "@/lib/orderflow/referenceTouches";
import { buildSessionVolumeProfiles } from "@/lib/orderflow/volumeProfileModel";
import { defaultVolumeProfile, resolveVolumeProfile, volumeProfileInputVisible } from "@/lib/orderflow/volumeProfileSettings";
import { paintVolumeProfiles } from "@/lib/orderflow/volumeProfileRenderer";
import { publishSessionProfileSurface, readSessionProfileSurfaces, clearSessionProfileSurface } from "@/lib/orderflow/sessionProfileReadout";
import { rollingProfileInputs } from "@/lib/orderflow/rollingProfile";
const day=86400000,start=Date.UTC(2026,10,4),m=60000;
const style={...defaultVolumeProfile(),rowSize:1,extendPoc:true,showLabels:false,showHistogram:false,showValueArea:false};
const model=buildSessionVolumeProfiles([{id:"a",symbol:"BTCUSDT",time:start,price:100,quantity:1,side:"buy",simulated:false}],style,"BTCUSDT");
const bar=(time:number,low:number,high=low)=>({time,low,high,open:low,close:high,volume:1});
it("waits for a revealed candle at/after session end and excludes earlier touches",()=>{
  const cache=createProfilePocExtensionCache();
  expect(cache.read([bar(start,100,101),bar(start+day-m,100,101)],model.sessions).size).toBe(0);
  const result=cache.read([bar(start,100,101),bar(start+day,102,103),bar(start+day+m,100,101)],model.sessions).get(start)!;
  expect(result).toEqual({from:start+day,price:100.5,touched:start+day+m});
});
it("treats inclusive row-center touches as contact but never bridges a price gap",()=>{
  const refs=[{from:start+day,price:100.5}];
  expect(firstObservedPriceTouches([bar(start+day,100.6,101),bar(start+day+m,99,100.4)],refs)).toEqual([null]);
  expect(firstObservedPriceTouches([bar(start+day,100.5,101)],refs)).toEqual([start+day]);
  expect(firstObservedPriceTouches([bar(start+day,100,100.5)],refs)).toEqual([start+day]);
});
it("ignores invalid candle observations and point or range queries", () => {
  const invalidBars = [
    bar(start, Number.NaN, 110),
    bar(Number.NaN, 90, 110),
    bar(start + m, 90, Number.POSITIVE_INFINITY),
    bar(start + 2 * m, 110, 90),
  ];
  const later = bar(start + 3 * m, 95, 105);
  const refs = [
    { from: start, price: 100 },
    { from: start, price: Number.NaN },
    { from: Number.NaN, price: 100 },
    { from: start, price: Number.POSITIVE_INFINITY },
    { from: later.time + 1, price: 100 },
    { from: start, price: 105 },
  ];
  const ranges = refs.map(({ from, price }) => ({ from, low: price, high: price }));
  const expected = [later.time, null, null, null, null, later.time];
  expect(firstObservedPriceTouches([...invalidBars, later], refs)).toEqual(expected);
  expect(firstObservedRangeTouches([...invalidBars, later], ranges)).toEqual(expected);
  expect(firstObservedPriceTouches(invalidBars, refs)).toEqual(refs.map(() => null));
  expect(firstObservedRangeTouches(invalidBars, ranges)).toEqual(refs.map(() => null));
});
it("recomputes touch times after in-place repairs, historical backfill and backward Replay seeks",()=>{
  const cache=createProfilePocExtensionCache(),bars=[bar(start+day,102,103),bar(start+day+m,100,101)];
  const first=cache.read(bars,model.sessions);expect(first.get(start)?.touched).toBe(start+day+m);
  expect(cache.read(bars,model.sessions)).toBe(first);
  bars[0].low=100.5;expect(cache.read(bars,model.sessions).get(start)?.touched).toBe(start+day);
  expect(cache.read([bar(start+day,102,103)],model.sessions).get(start)?.touched).toBeNull();
  expect(cache.read([],model.sessions).size).toBe(0);
});
it.each(["Week","Month"] as const)("uses the actual %s end instead of assuming a day",sessionPeriod=>{
  const own=buildSessionVolumeProfiles([{id:"a",symbol:"BTCUSDT",time:start,price:100,quantity:1,side:"buy",simulated:false}],{...style,sessionPeriod},"BTCUSDT");
  const end=own.sessions[0].end;
  expect(createProfilePocExtensionCache().read([bar(end-1,100,101)],own.sessions).size).toBe(0);
  expect(createProfilePocExtensionCache().read([bar(end,100,101)],own.sessions).get(own.sessions[0].start)?.touched).toBe(end);
});
function draw(bars:ReturnType<typeof bar>[],kind?:"rolling",project=(time:number)=>(time-start)/day*100-150,preferences=style){
  const lines:number[][]=[],path:number[]=[];
  const ctx={save(){},restore(){},beginPath(){path.length=0;},moveTo(...p:number[]){path.push(...p);},lineTo(...p:number[]){path.push(...p);},stroke(){lines.push([...path]);}} as unknown as CanvasRenderingContext2D;
  const args={bars,bounds:{top:0,height:300},scale:{},theme:{},coords:{width:500,timeToX:project,priceToY:(p:number)=>p}} as unknown as RendererLayerArgs;
  const extensions=paintVolumeProfiles(ctx,args,{style:preferences,model,kind},()=>true);
  return {lines,extensions};
}
it("paints an old off-screen session's extension from the plot edge to its first later touch",()=>{
  const result=draw([bar(start+2*day,102),bar(start+3*day,100,101)]);
  expect(result.lines).toEqual([[0,101.5,150,101.5]]);
});
it("extends an untested POC to the plot edge and respects parent/rolling switches",()=>{
  const bars=[bar(start+2*day,102)];
  expect(draw(bars).lines).toEqual([[0,101.5,500,101.5]]);
  expect(draw(bars,"rolling").extensions.size).toBe(0);
  expect(draw(bars,undefined,undefined,{...style,showPoc:false}).extensions.size).toBe(0);
  expect(draw(bars,undefined,undefined,{...style,extendPoc:false}).extensions.size).toBe(0);
  expect(volumeProfileInputVisible("extendPoc",{showPoc:false})).toBe(false);
  expect(rollingProfileInputs().some(i=>i.key==="extendPoc")).toBe(false);
  expect(resolveVolumeProfile({}).extendPoc).toBe(false);
});
it("matches a brute-force oracle for unsorted-price queries and many shared POCs",()=>{
  const bars=Array.from({length:350},(_,i)=>bar(start+i*m,95+i%13,99+i%13));
  const refs=Array.from({length:220},(_,i)=>({from:start+i*m,price:96+i%11}));
  expect(firstObservedPriceTouches(bars,refs)).toEqual(refs.map(ref=>bars.find(b=>b.time>=ref.from&&b.low<=ref.price&&b.high>=ref.price)?.time??null));
});
it("exposes observed touch provenance in the readout without claiming gap-free history",()=>{
  const key="poc-ext",token=Symbol(),context={id:"svp",symbol:"BTCUSDT",timeframe:"1m",epoch:0,live:true};
  const pocExtensions=createProfilePocExtensionCache().read([bar(start+day,102)],model.sessions);
  publishSessionProfileSurface(key,token,{context,payload:{style,model,pocExtensions}});
  try{const rows=readSessionProfileSurfaces(key,{symbol:"BTCUSDT",timeframe:"1m",epoch:0,replay:false},start,["svp"])[0].rows;
    expect(rows).toContainEqual({label:"First observed POC touch",value:"None in revealed candles; gaps unknown"});
    expect(rows.find(r=>r.label==="POC touch basis")?.value).toContain("candle opening time");
  }finally{clearSessionProfileSurface(key,token);}
});
