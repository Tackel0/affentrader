import type {ChartType,RangeShortcut,Timeframe} from "@/types/trading";
import {intervalMs,isTickInterval} from "@/lib/market/intervals";
import {MAX_HISTORY_BARS} from "@/lib/market/klines";
const DAY=86_400_000;
export const RANGE_SHORTCUTS:readonly RangeShortcut[]=["1D","5D","1M","3M","6M","YTD","1Y","5Y","ALL"];
export const RANGE_INTERVALS:Record<RangeShortcut,Timeframe>={"1D":"1m","5D":"5m","1M":"30m","3M":"1h","6M":"2h",YTD:"1D","1Y":"1D","5Y":"1W",ALL:"1M"};
const MONTHS:Partial<Record<RangeShortcut,number>>={"1M":1,"3M":3,"6M":6,"1Y":12,"5Y":60};
/** UTC calendar subtraction, retaining time and clamping month-end. */
export function monthsBefore(time:number,months:number):number {
  const date=new Date(time),month=date.getUTCMonth()-months,day=date.getUTCDate(),end=new Date(time);
  end.setUTCMonth(month+1,0);date.setUTCMonth(month,Math.min(day,end.getUTCDate()));return date.getTime();
}
export function rangeTimeframe(range:RangeShortcut,chartType?:ChartType):Timeframe {
  const timeframe=RANGE_INTERVALS[range];return chartType==="tpo"&&intervalMs(timeframe)>900000?"15m":timeframe;
}
export function rangePlan(range:RangeShortcut,now=Date.now(),chartType?:ChartType) {
  const timeframe=rangeTimeframe(range,chartType),date=new Date(now);
  const from=range==="ALL"?undefined:range==="YTD"?Date.UTC(date.getUTCFullYear(),0,1):MONTHS[range]?monthsBefore(now,MONTHS[range]!):now-(range==="5D"?5:1)*DAY;
  return {timeframe,from,to:now,count:from===undefined?MAX_HISTORY_BARS:Math.min(MAX_HISTORY_BARS,Math.max(600,Math.ceil((now-from)/intervalMs(timeframe))+10))};
}
export function navigationDepth(time:number,timeframe:Timeframe,now=Date.now()):number {
  if(!Number.isFinite(time)||Math.abs(time)>8_640_000_000_000_000||time>now)throw new Error("Choose a valid date that is not in the future.");
  if(isTickInterval(timeframe))throw new Error("Choose a time-based interval before navigating to a date.");
  const count=Math.max(600,Math.ceil((now-time)/intervalMs(timeframe))+100);
  if(count>MAX_HISTORY_BARS)throw new Error("This date exceeds the 20,000-bar window at this interval. Choose a larger interval and try again.");
  return count;
}
export function dateWindow(time:number,to:number|undefined,timeframe:Timeframe,now=Date.now()):{from:number;to:number} {
  if(isTickInterval(timeframe))throw new Error("Choose a time-based interval before navigating to a date.");
  if(!Number.isFinite(time)||Math.abs(time)>8_640_000_000_000_000||time>now||to!==undefined&&(!Number.isFinite(to)||to<=time||to>now))throw new Error("Choose valid dates with the end after the start and no later than now.");
  const step=intervalMs(timeframe);
  return to===undefined?{from:Math.max(-8_640_000_000_000_000,time-60*step),to:Math.min(now,time+30*step)}:{from:time,to};
}
export function recentWindow(bars:readonly {time:number}[],count=150,cursor?:number):{from:number;to:number}|undefined {
  const index=cursor===undefined?bars.length-1:bars.findLastIndex(bar=>bar.time<=cursor);
  if(index<0)return;
  const from=bars[Math.max(0,index-Math.max(2,Math.floor(count))+1)].time,to=bars[index].time;
  return{from,to:Math.max(from+1,to)};
}
