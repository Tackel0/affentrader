import type { OHLCV } from "@luxalgo/vela";
import { parseInterval } from "@/lib/market/intervals";
export const VWAP_ANCHORS = ["Session", "Week", "Month", "Quarter", "Year"] as const;
export const VWAP_SOURCES = ["Close", "Open", "High", "Low", "HL2", "HLC3", "OHLC4", "HLCC4"] as const;
export interface VwapBandsPreferences {
  anchor: typeof VWAP_ANCHORS[number]; source: typeof VWAP_SOURCES[number]; bandsMode: "Standard Deviation" | "Percentage";
  band1: boolean; band2: boolean; band3: boolean; band1Mult: number; band2Mult: number; band3Mult: number;
  hideDwm: boolean; bullColor: string; bearColor: string; bandsColor: string; fill: boolean;
}
export const defaultVwapBands = (): VwapBandsPreferences => ({ anchor:"Session",source:"HLC3",bandsMode:"Standard Deviation",band1:true,band2:false,band3:false,band1Mult:1,band2Mult:2,band3Mult:3,hideDwm:true,bullColor:"#089981",bearColor:"#f23645",bandsColor:"#b2b5be",fill:true });
const DAY = 86400000;
function period(anchor: VwapBandsPreferences["anchor"], time: number) {
  const day = Math.floor(time / DAY), date = new Date(time);
  return anchor === "Session" ? day : anchor === "Week" ? Math.floor((day + 3) / 7) : anchor === "Year" ? date.getUTCFullYear()
    : anchor === "Quarter" ? date.getUTCFullYear()*4+Math.floor(date.getUTCMonth()/3) : date.getUTCFullYear()*12+date.getUTCMonth();
}
/** Divided differences preserve small moves on a large base without overflowing
 * a finite HLC/OHLC sum. This remains candle-volume VWAP, never execution VWAP. */
function price(bar: OHLCV, source: VwapBandsPreferences["source"]) {
  const values = source === "Open" ? [bar.open] : source === "High" ? [bar.high] : source === "Low" ? [bar.low] : source === "Close" ? [bar.close]
    : source === "HL2" ? [bar.high,bar.low] : source === "OHLC4" ? [bar.open,bar.high,bar.low,bar.close] : source === "HLCC4" ? [bar.high,bar.low,bar.close,bar.close] : [bar.high,bar.low,bar.close];
  const base = values[0], differences = values.map(value => value-base);
  return differences.every(Number.isFinite) ? base+differences.reduce((sum,value)=>sum+value/values.length,0) : values.reduce((sum,value)=>sum+value/values.length,0);
}
export interface VwapBandsResult { mean: Array<number|null>; deviation: Array<number|null>; bands: Array<{ index: number; upper: Array<number|null>; lower: Array<number|null> }>; hidden: boolean; invalid: number; missingVolume: number }
/** Prefix-only weighted population moments. A bad contributing price poisons
 * its anchor period rather than silently dropping volume from the average. */
export function calculateVwapBands(bars: readonly OHLCV[], style: VwapBandsPreferences, timeframe: string): VwapBandsResult {
  const result: VwapBandsResult = { mean:bars.map(()=>null),deviation:bars.map(()=>null),bands:[1,2,3].filter(i=>style[`band${i}` as "band1"])
    .map(index=>({index,upper:bars.map(()=>null),lower:bars.map(()=>null)})),hidden:style.hideDwm&&(parseInterval(timeframe)?.ms??0)>=DAY,invalid:0,missingVolume:0 };
  if (result.hidden) return result;
  let key = NaN, weight=0, mean=0, deviation=0, poisoned=false, previous=-Infinity;
  bars.forEach((bar,i)=>{
    if (!Number.isSafeInteger(bar.time)||Math.abs(bar.time)>=8.64e15||bar.time<=previous) throw new Error("VWAP requires ascending finite candle times.");
    previous=bar.time;
    const next=period(style.anchor,bar.time);
    if(next!==key){key=next;weight=mean=deviation=0;poisoned=false;}
    const volume=bar.volume;
    if(volume===undefined||volume===null) result.missingVolume++;
    else if(!Number.isFinite(volume)||volume<0){poisoned=true;result.invalid++;}
    else if(volume>0&&!poisoned){
      const value=price(bar,style.source), total=weight+volume;
      if(!Number.isFinite(value)||!Number.isFinite(total)){poisoned=true;result.invalid++;}
      else if(!weight){mean=value;deviation=0;weight=total;}
      else {
        const ratio=volume/total, remaining=weight/total, delta=value-mean, factor=Math.sqrt(ratio)*Math.sqrt(remaining);
        deviation=Math.hypot(Math.sqrt(remaining)*deviation,Number.isFinite(delta)?factor*delta:factor*value-factor*mean);
        mean=Number.isFinite(delta)?mean+ratio*delta:remaining*mean+ratio*value;weight=total;
      }
    }
    if(poisoned||!weight)return;
    const offset=style.bandsMode==="Percentage"?Math.abs(mean)/100:deviation;
    if(!Number.isFinite(mean)||!Number.isFinite(offset)){poisoned=true;result.invalid++;return;}
    const limits=result.bands.map(b=>{const spread=offset*style[`band${b.index}Mult` as "band1Mult"];return{upper:mean+spread,lower:mean-spread};});
    if(limits.some(b=>!Number.isFinite(b.upper)||!Number.isFinite(b.lower))){poisoned=true;result.invalid++;return;}
    result.mean[i]=mean;result.deviation[i]=deviation;
    result.bands.forEach((band,b)=>{band.upper[i]=limits[b].upper;band.lower[i]=limits[b].lower;});
  });
  return result;
}
