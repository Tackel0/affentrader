import { expect, it, vi } from "vitest";
import type { NativeIndicatorContext, NativeIndicatorOutput, OHLCV } from "@luxalgo/vela";
import { calculateVwapBands, defaultVwapBands, VWAP_SOURCES } from "@/lib/orderflow/vwapBands";
import { resolveVwapBands, vwapBandsDescriptor, vwapBandsOutput } from "@/lib/orderflow/vwapBandsIndicator";
import { INDICATORS } from "@/lib/indicators/catalog";
import { nativeIndicatorInputs } from "@/lib/indicators/nativeInputs";
import type { IndicatorInstance } from "@/types/trading";
const start=Date.UTC(2026,10,4),minute=60000;
const bar=(time:number,price:number,volume=1):OHLCV=>({time,open:price,high:price,low:price,close:price,volume});
const defaults=defaultVwapBands();
it("matches an independent two-pass weighted population oracle at every prefix",()=>{
  const bars=Array.from({length:90},(_,i)=>({...bar(start+i*minute,100+i%11,i%5),high:105+i%11,low:98+i%11}));
  const out=calculateVwapBands(bars,{...defaults,band2:true,band3:true},"1m");
  for(let i=0;i<bars.length;i++){
    const prefix=bars.slice(0,i+1),weight=prefix.reduce((s,b)=>s+b.volume!,0);
    if(!weight){expect(out.mean[i]).toBeNull();continue;}
    const price=(b:OHLCV)=>(b.high+b.low+b.close)/3,mean=prefix.reduce((s,b)=>s+price(b)*b.volume!,0)/weight;
    const sigma=Math.sqrt(prefix.reduce((s,b)=>s+(price(b)-mean)**2*b.volume!,0)/weight);
    expect(out.mean[i]).toBeCloseTo(mean,10);expect(out.deviation[i]).toBeCloseTo(sigma,10);
    out.bands.forEach(b=>{expect(b.upper[i]).toBeCloseTo(mean+b.index*sigma,10);expect(b.lower[i]).toBeCloseTo(mean-b.index*sigma,10);});
  }
});
it("preserves small band distances on a trillion-unit price base",()=>{
  const result=calculateVwapBands([bar(start,1e12),bar(start+minute,1e12+2)],defaults,"1m");
  expect(result.mean[1]).toBe(1e12+1);expect(result.deviation[1]).toBeCloseTo(1,14);
  expect(result.bands[0].upper[1]).toBe(1e12+2);expect(result.bands[0].lower[1]).toBe(1e12);
});
it.each([
  ["Session","2026-11-04T23:00Z","2026-11-05T00:00Z"],
  ["Week","2026-11-08T23:00Z","2026-11-09T00:00Z"],
  ["Month","2026-11-30T23:00Z","2026-12-01T00:00Z"],
  ["Quarter","2026-12-31T23:00Z","2027-01-01T00:00Z"],
  ["Year","2026-12-31T23:00Z","2027-01-01T00:00Z"],
] as const)("restarts %s at its UTC boundary",(anchor,a,b)=>{
  const time=Date.parse(a),bars=[bar(time,100),bar(time+minute,110),bar(Date.parse(b),200)];
  expect(calculateVwapBands(bars,{...defaults,anchor},"1m").mean).toEqual([100,105,200]);
});
it("honors all native price sources without overflowing finite HLC/OHLC sums",()=>{
  const b={time:start,open:5,high:14,low:2,close:11,volume:1};
  expect(VWAP_SOURCES.map(source=>calculateVwapBands([b],{...defaults,source},"1m").mean[0])).toEqual([11,5,14,2,8,9,8,9.5]);
  const huge=calculateVwapBands([bar(start,1e308)],{...defaults,source:"OHLC4"},"1m");expect(huge.mean[0]).toBe(1e308);
});
it("uses candle volume, preserves zero-volume gaps/carry and supports percentage offsets",()=>{
  const bars=[bar(start,999,0),bar(start+minute,100,1),bar(start+2*minute,104,3),bar(start+3*minute,999,0)];
  const result=calculateVwapBands(bars,{...defaults,bandsMode:"Percentage",band1Mult:2},"1m");
  expect(result.mean).toEqual([null,100,103,103]);expect(result.bands[0].upper[2]).toBe(105.06);expect(result.bands[0].lower[2]).toBe(100.94);
});
it("uses the explicit timeframe for hiding, even with a single daily bar or a weekend gap",()=>{
  const one=[bar(start,100)];expect(calculateVwapBands(one,defaults,"1D").mean).toEqual([null]);
  expect(calculateVwapBands(one,{...defaults,hideDwm:false},"1D").mean).toEqual([100]);
  const sparse=[bar(start,100),bar(start+3*86400000,110)];expect(calculateVwapBands(sparse,defaults,"15m").hidden).toBe(false);
});
it("recalculates only revealed prefixes and accepts corrections and deeper history",()=>{
  const bars=[bar(start,100),bar(start+minute,102),bar(start+2*minute,1000)];
  expect(calculateVwapBands(bars.slice(0,2),defaults,"1m").mean.at(-1)).toBe(101);
  bars[0].volume=3;expect(calculateVwapBands(bars.slice(0,2),defaults,"1m").mean.at(-1)).toBe(100.5);
  expect(calculateVwapBands([bar(start-minute,98),...bars.slice(0,2)],{...defaults,anchor:"Week"},"1m").mean.at(-1)).toBe(100);
});
it("poisons bad contributing periods and resumes at the next anchor without fabricated totals",()=>{
  const bars=[bar(start,100),bar(start+minute,101,-1),bar(start+2*minute,102),bar(start+86400000,105)];
  const result=calculateVwapBands(bars,defaults,"1m");expect(result.mean).toEqual([100,null,null,105]);expect(result.invalid).toBe(1);
  expect(()=>calculateVwapBands([bars[0],bars[0]],defaults,"1m")).toThrow(/ascending/);
});
it("retains Band 2/3 names, identities and fill references when Band 1 is off",()=>{
  const bars=[bar(start,100),bar(start+minute,102)],all=vwapBandsOutput(bars,{...defaults,band2:true,band3:true},"1m");
  const selected=vwapBandsOutput(bars,{...defaults,band1:false,band2:true},"1m");
  const second=selected.series!.find(s=>s.title==="Upper Band #2")!;expect(second.id).toBe(all.series!.find(s=>s.title==="Upper Band #2")!.id);
  expect(selected.fills).toHaveLength(1);expect(selected.fills![0].fromSeriesId).toBe(second.id);
  const first=selected.series!.find(s=>s.title==="Upper Band #1")!;expect(first.display?.pane).toBe(false);
  expect("points" in first&&first.points?.every(p=>p.value===null)).toBe(true);
});
it("keeps native settings/defaults and makes VWAP discoverable as an Orderflow candle study",()=>{
  expect(vwapBandsDescriptor()).toMatchObject({type:"af-vwap",multiInstance:true,waitsForHistory:true});
  expect(vwapBandsDescriptor().defaultInputs!()).toMatchObject({anchor:"Session",source:"HLC3",band1:true,band2:false,band3:false,hideDwm:true});
  expect(resolveVwapBands({band1Mult:0,band2:true,anchor:"Quarter",source:"OHLC4"})).toMatchObject({band1Mult:0,band2:true,anchor:"Quarter",source:"OHLC4"});
  expect(resolveVwapBands({band1Mult:-1,anchor:"bad"})).toEqual(defaults);
  expect(INDICATORS.find(d=>d.id==="vwap")).toMatchObject({category:"Order flow",kind:"native",nativeId:"af-vwap"});
});
it("preserves the VWAP source input across generic primary-chart input preparation",()=>{
  const fresh={id:"a",definitionId:"vwap",source:"close",inputs:{},color:"#123456",lineWidth:2} as IndicatorInstance;
  expect(nativeIndicatorInputs(fresh).source).toBe("HLC3");
  expect(nativeIndicatorInputs({...fresh,inputs:{source:"OHLC4"}}).source).toBe("OHLC4");
  expect(nativeIndicatorInputs({...fresh,inputs:{source:"HLCC4"}}).source).toBe("HLCC4");
  expect(nativeIndicatorInputs({...fresh,definitionId:"ema",source:"hl2"}).source).toBe("HL2");
});
it("re-emits settings and bars through the native lifecycle and clears stale data on failure",()=>{
  let bars=[bar(start,100),bar(start+minute,102)];const outputs:NativeIndicatorOutput[]=[],ctx={symbol:"BTCUSDT",timeframe:"1m",live:false,bars:()=>bars,emit:(out:NativeIndicatorOutput)=>outputs.push(out),setStatus:vi.fn()} as unknown as NativeIndicatorContext;
  const a=vwapBandsDescriptor().create();a.start(ctx,{band2:true});expect(outputs.at(-1)!.fills).toHaveLength(2);
  a.suspend();bars=[bar(start,200)];a.onBars();expect(outputs).toHaveLength(1);a.resume();expect(outputs).toHaveLength(2);
  a.setInputs({band1:false,band3:true});expect(outputs.at(-1)!.fills).toHaveLength(1);
  bars=[bars[0],bars[0]];a.onBars();expect(outputs.at(-1)!.fills).toEqual([]);
  expect(outputs.at(-1)!.series!.every(s=>"points" in s&&s.points?.every(p=>p.value===null))).toBe(true);
  a.stop();const count=outputs.length;a.onBars();expect(outputs).toHaveLength(count);
});
