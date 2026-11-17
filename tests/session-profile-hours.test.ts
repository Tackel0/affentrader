import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { NativeIndicatorContext } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { clearMarketSessions, registerMarketSessions, type MarketSessionCalendar } from "@/lib/market/sessionWindows";
import { defaultVolumeProfile, resolveVolumeProfile, volumeProfileInputs, volumeProfileInputVisible } from "@/lib/orderflow/volumeProfileSettings";
import { buildSessionVolumeProfiles } from "@/lib/orderflow/volumeProfileModel";
import { profileTradingCalendar, profileSessionSource } from "@/lib/orderflow/profileTradingHours";
import { sessionProfileDescriptor } from "@/lib/orderflow/volumeProfileIndicator";
import { packSessionTrades, SessionProfileJobs, type SessionProfileExecutor, type SessionProfileResponse, type SessionProfileRequest } from "@/lib/orderflow/sessionProfileJobs";
import { rollingProfileInputs } from "@/lib/orderflow/rollingProfile";
import type { VolumeProfileChannel } from "@/lib/orderflow/volumeProfileRenderer";
const day=86400000,m=60000,base=Date.UTC(2026,10,4),symbol="HL:BTC";
const tick=(id:string,time:number,quantity=1):Tick=>({id,time,quantity,symbol,price:100,side:"buy",simulated:false});
const style={...defaultVolumeProfile(),rowSize:1};
afterEach(()=>{clearMarketSessions();vi.useRealTimers();});
it.each([
  ["Pre-market",540,810],["Market",810,1200],["Post-market",1200,1440],
  ["London",480,990],["New York",780,1320],["Asian",0,540],
] as const)("filters %s by exact inclusive start/exclusive end",(tradingHours,start,end)=>{
  const trades=[tick("a",base+start*m-1),tick("b",base+start*m,2),tick("c",base+end*m-1,3),tick("d",base+end*m,4)];
  const model=buildSessionVolumeProfiles(trades,{...style,tradingHours},symbol);
  expect(model.sessions).toHaveLength(1);expect(model.sessions[0]).toMatchObject({start:base+start*m,end:base+end*m,tradeCount:2});
  expect(model.sessions[0].valueArea.total).toBe(5);
});
it("supports custom overnight UTC windows and rejects impossible HHMM without rolling minutes",()=>{
  const prefs={...style,tradingHours:"Custom" as const,customStart:2200,customEnd:200};
  const model=buildSessionVolumeProfiles([tick("a",base+23*60*m,2),tick("b",base+day+60*m,3),tick("c",base+day+2*60*m,99)],prefs,symbol);
  expect(model.sessions).toHaveLength(1);expect(model.sessions[0]).toMatchObject({start:base+22*60*m,end:base+day+2*60*m});expect(model.sessions[0].valueArea.total).toBe(5);
  expect(()=>buildSessionVolumeProfiles([],resolveVolumeProfile({...prefs,customStart:1260}),symbol)).toThrow(/HHMM/);
});
it("uses provided RTH/ETH windows and keeps each chart's inherited session mode separate",()=>{
  const regular=[[base+14.5*60*m,base+21*60*m]] as const,extended=[[base+9*60*m,base+day]] as const;
  registerMarketSessions(symbol,{regular:[...regular],extended:[...extended]},"extended");
  const source=profileSessionSource(symbol,"regular")!,eth=profileSessionSource(symbol,"extended")!;
  const trades=[tick("pre",base+10*60*m,2),tick("regular",base+15*60*m,3),tick("post",base+22*60*m,5)];
  const run=(tradingHours:typeof style.tradingHours,calendar:MarketSessionCalendar)=>buildSessionVolumeProfiles(trades,{...style,tradingHours},symbol,profileTradingCalendar({...style,tradingHours},symbol,calendar));
  expect(run("Full day",source).sessions[0].valueArea.total).toBe(3);
  expect(run("Full day",eth).sessions[0].valueArea.total).toBe(10);
  expect(run("Regular hours (RTH)",eth).sessions[0].valueArea.total).toBe(3);
  expect(run("Extended hours (ETH)",source).sessions[0].valueArea.total).toBe(10);
});
it("ignores daily windows for UTC Week/Month and preserves legacy settings/default overrides",()=>{
  for(const sessionPeriod of ["Week","Month"] as const){
    const prefs={...style,sessionPeriod,tradingHours:"Custom" as const,customStart:1260,customEnd:1260};
    expect(buildSessionVolumeProfiles([tick("a",base),tick("b",base+day)],prefs,symbol).sessions[0].valueArea.total).toBe(2);
  }
  expect(resolveVolumeProfile({rows:40,widthPercent:25})).toMatchObject({rows:40,widthPercent:25,tradingHours:"Full day"});
  expect(defaultVolumeProfile()).toMatchObject({rows:24,widthPercent:30});
  expect(volumeProfileInputs().find(i=>i.key==="tradingHours")?.options).toHaveLength(10);
  expect(volumeProfileInputVisible("customStart",{tradingHours:"Custom"})).toBe(true);
  expect(volumeProfileInputVisible("customStart",{tradingHours:"London"})).toBe(false);
  expect(volumeProfileInputVisible("tradingHours",{sessionPeriod:"Week"})).toBe(false);
  expect(rollingProfileInputs().some(i=>["tradingHours","customStart","customEnd"].includes(i.key))).toBe(false);
});
it("runs named and changed source-calendar snapshots through the shipped worker without global registry",()=>{
  const replies:SessionProfileResponse[]=[],scope:{onmessage?:(event:{data:SessionProfileRequest})=>void;postMessage:(r:SessionProfileResponse)=>void}={postMessage:r=>replies.push(r)};
  runInNewContext(readFileSync("public/workers/session-profile.js","utf8"),{self:scope,console});
  const trades=[tick("a",base+8*60*m,2),tick("b",base+10*60*m,3),tick("c",base+15*60*m,5)];
  const calendar:MarketSessionCalendar={regular:[[base+9*60*m,base+11*60*m]],extended:[[base,base+day]],mode:"regular",revision:1};
  for(const request of [
    {style:{...style,tradingHours:"London" as const}},
    {style:{...style,tradingHours:"Regular hours (RTH)" as const},calendar},
    {style:{...style,tradingHours:"Regular hours (RTH)" as const},calendar:{...calendar,regular:[[base+14*60*m,base+16*60*m] as const],revision:2}},
  ]){
    scope.onmessage!({data:{id:replies.length+1,values:packSessionTrades(trades),simulated:false,symbol,...request}});
    expect(replies.at(-1)?.error).toBeUndefined();
    expect(JSON.parse(JSON.stringify(replies.at(-1)!.model))).toEqual(buildSessionVolumeProfiles(trades,request.style,symbol,profileTradingCalendar(request.style,symbol,request.calendar)));
  }
  expect(replies.map(r=>r.model!.sessions[0].valueArea.total)).toEqual([10,3,5]);
});
it("recalculates a quiet profile when source windows change without reseeding its tape",()=>{
  const trades=[tick("a",base+10*60*m,2),tick("b",base+15*60*m,3)];let channel:VolumeProfileChannel|undefined;
  registerMarketSessions(symbol,{regular:[[base+9*60*m,base+11*60*m]],extended:[[base,base+day]]},"regular");
  const native=sessionProfileDescriptor(()=>trades).create();
  native.start({id:"calendar",symbol,timeframe:"1m",live:true,session:"regular",emit(){},pushData(v:VolumeProfileChannel){channel=v;},setStatus(){}} as unknown as NativeIndicatorContext,{tradingHours:"Regular hours (RTH)"});
  expect(channel!.current!.model!.sessions[0].valueArea.total).toBe(2);
  registerMarketSessions(symbol,{regular:[[base+14*60*m,base+16*60*m]],extended:[[base,base+day]]},"regular");native.onBars();
  expect(channel!.current!.model!.sessions[0].valueArea.total).toBe(3);native.stop();
});
it("fences a pending worker result against a newly replaced venue calendar",()=>{
  const trades=Array.from({length:10001},(_,i)=>tick(String(i),base+10*60*m));
  const jobs:Array<{complete:(r:SessionProfileResponse)=>void;calendar?:MarketSessionCalendar}>=[];
  const executor:SessionProfileExecutor={submit(_o,_t,_s,_symbol,complete,calendar){jobs.push({complete,calendar});},cancel(){}};
  registerMarketSessions(symbol,{regular:[[base+9*60*m,base+11*60*m]],extended:[[base,base+day]]},"regular");
  let channel:VolumeProfileChannel|undefined;const native=sessionProfileDescriptor(()=>trades,undefined,executor).create();
  native.start({id:"pending",symbol,timeframe:"1m",live:true,emit(){},pushData(v:VolumeProfileChannel){channel=v;},setStatus(){}} as unknown as NativeIndicatorContext,{tradingHours:"Regular hours (RTH)"});
  const old=jobs[0].calendar!;
  registerMarketSessions(symbol,{regular:[[base+14*60*m,base+16*60*m]],extended:[[base,base+day]]},"regular");
  jobs[0].complete({id:1,model:buildSessionVolumeProfiles(trades,style,symbol,profileTradingCalendar(style,symbol,old))});
  expect(channel!.current!.model).toBeUndefined();expect(jobs).toHaveLength(2);expect(jobs[1].calendar!.revision).not.toBe(old.revision);native.stop();
});
it("snapshots calendar windows while work waits in the shared queue",()=>{
  const worker={postMessage:vi.fn(),terminate(){},onmessage:undefined as ((event:{data:SessionProfileResponse})=>void)|undefined};
  const jobs=new SessionProfileJobs(()=>worker as unknown as Worker),trades=[tick("a",base)];
  const calendar:MarketSessionCalendar={regular:[[base,base+60*m]],extended:[],mode:"regular",revision:1};
  jobs.submit(1,trades,style,symbol,()=>{});jobs.submit(2,trades,style,symbol,()=>{},calendar);
  calendar.regular[0]=[base+day,base+day+60*m];
  const first=worker.postMessage.mock.calls[0][0] as SessionProfileRequest;worker.onmessage!({data:{id:first.id}});
  const second=worker.postMessage.mock.calls[1][0] as SessionProfileRequest;expect(second.calendar!.regular[0][0]).toBe(base);
  worker.onmessage!({data:{id:second.id}});
});
