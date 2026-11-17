import {describe,expect,it} from "vitest";
import {RANGE_SHORTCUTS,rangePlan,monthsBefore,navigationDepth,dateWindow,recentWindow} from "@/lib/chart/ranges";
import type {RangeShortcut} from "@/types/trading";
const now=Date.UTC(2026,9,26,12),day=86_400_000;
describe("chart date navigation",()=>{
  it.each<[RangeShortcut,string]>([["1D","1m"],["5D","5m"],["1M","30m"],["3M","1h"],["6M","2h"],["YTD","1D"],["1Y","1D"],["5Y","1W"],["ALL","1M"]])("loads the observed reference interval for %s",(range,timeframe)=>{
    const plan=rangePlan(range,now);expect(plan.timeframe).toBe(timeframe);expect(plan.to).toBe(now);expect(plan.count).toBeGreaterThanOrEqual(600);expect(plan.count).toBeLessThanOrEqual(20000);expect(RANGE_SHORTCUTS).toContain(range);
  });
  it("uses UTC calendar months and clamps leap/month ends",()=>{
    expect(monthsBefore(Date.UTC(2024,2,31,12),1)).toBe(Date.UTC(2024,1,29,12));expect(monthsBefore(Date.UTC(2025,2,31,12),1)).toBe(Date.UTC(2025,1,28,12));expect(monthsBefore(Date.UTC(2024,1,29),12)).toBe(Date.UTC(2023,1,28));
    expect(rangePlan("3M",now).from).toBe(Date.UTC(2026,6,26,12));expect(rangePlan("YTD",now).from).toBe(Date.UTC(2026,0,1));expect(rangePlan("1Y",now).from).toBe(Date.UTC(2025,9,26,12));
  });
  it("requests enough minute history for the real 1D/5D mappings and bounds All",()=>{
    expect(rangePlan("1D",now).count).toBe(1450);expect(rangePlan("5D",now).count).toBe(1450);expect(rangePlan("ALL",now)).toEqual({timeframe:"1M",from:undefined,to:now,count:20000});
  });
  it("retains actual intraday TPO brackets and bounds long requested periods",()=>{
    expect(rangePlan("1D",now,"tpo").timeframe).toBe("1m");expect(rangePlan("3M",now,"tpo").timeframe).toBe("15m");expect(rangePlan("1Y",now,"tpo").count).toBe(20000);expect(rangePlan("ALL",now,"tpo").timeframe).toBe("15m");
  });
  it("retains interval and distinguishes a point window from an exact custom range",()=>{
    expect(dateWindow(now-day,undefined,"5m",now)).toEqual({from:now-day-60*300000,to:now-day+30*300000});expect(dateWindow(now-day,now,"5m",now)).toEqual({from:now-day,to:now});expect(navigationDepth(now-day,"1m",now)).toBe(1540);
  });
  it("rejects missing/reversed/future dates and unsupported tick-clock navigation",()=>{
    for(const [from,to] of [[NaN,undefined],[now+1,undefined],[now,now-1],[now-1,now+1]] as [number,number|undefined][])expect(()=>dateWindow(from,to,"5m",now)).toThrow();
    expect(()=>navigationDepth(now-20000*60000,"1m",now)).toThrow(/20,000/);expect(()=>navigationDepth(now-day,"100T",now)).toThrow(/time-based/);expect(()=>dateWindow(now-day,undefined,"100T",now)).toThrow(/time-based/);
  });
  it("resets a view over its own bars and excludes unrevealed Replay dates",()=>{
    const bars=Array.from({length:300},(_,i)=>({time:now+i*300000}));expect(recentWindow(bars,10)).toEqual({from:bars[290].time,to:bars[299].time});expect(recentWindow(bars,10,bars[99].time)).toEqual({from:bars[90].time,to:bars[99].time});expect(recentWindow(bars,10,now-1)).toBeUndefined();expect(recentWindow([],10)).toBeUndefined();expect(recentWindow([{time:now}],10)).toEqual({from:now,to:now+1});
  });
});
