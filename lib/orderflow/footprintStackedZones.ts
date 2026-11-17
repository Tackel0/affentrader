import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import { nextBucket } from "@/lib/market/intervals";
import { footprintStacks } from "./footprintAnalysis";
import { firstObservedRangeTouches, type PriceTouchBar } from "./referenceTouches";
import { footprintBarGeometry, type FootprintPlacement, type ResolvedFootprintPreferences } from "./footprint";
export interface FootprintStackedZone { time:number; side:"buy"|"sell"; lower:number; upper:number; rows:number; from:number; touched:number|null }
export function createFootprintStackedZoneCache(){
  let key="",previous:FootprintStackedZone[]=[];
  return {read(footprints:readonly FootprintBar[],input:readonly PriceTouchBar[],timeframe:string,step:number,minimumRows:number,through?:number):FootprintStackedZone[]{
    const bars=through===undefined?input:input.filter(bar=>nextBucket(timeframe,bar.time)<=through),times=new Set(bars.map(bar=>bar.time));
    const refs=footprints.filter(bar=>times.has(bar.time)).flatMap(bar=>footprintStacks(bar,step,minimumRows).map(stack=>({time:bar.time,side:stack.side,lower:stack.from,upper:stack.to,rows:stack.rows,from:nextBucket(timeframe,bar.time),touched:null as number|null})));
    const next=JSON.stringify([timeframe,step,minimumRows,through,refs,bars.map(bar=>[bar.time,bar.low,bar.high])]);if(next===key)return previous;
    const touches=firstObservedRangeTouches(bars,refs.map(ref=>({from:ref.from,low:ref.lower,high:ref.upper})));
    previous=refs.map((ref,index)=>({...ref,touched:touches[index]}));key=next;return previous;
  }};
}
/** Filled whole-band projection; origin bars are outlined by their ordinary
 * cell imbalance controls. Stacks have independent alpha-capable fill colors. */
export function paintFootprintStackedZones(ctx:CanvasRenderingContext2D,args:RendererLayerArgs,zones:readonly FootprintStackedZone[],style:ResolvedFootprintPreferences,placement?:FootprintPlacement){
  if(!style.stackedVisible)return;
  ctx.save();ctx.globalAlpha=placement?.opacity??1;
  for(const zone of zones){
    const {width,center,half}=footprintBarGeometry(args,zone.time,placement);if(!(width>0)||(placement?.opacity??1)<=.01)continue;
    const left=Math.max(0,center+half),right=zone.touched===null?args.coords.width:Math.min(args.coords.width,args.coords.timeToX(zone.touched));
    if(right<=left)continue;
    const a=args.coords.priceToY(zone.lower,args.scale,args.bounds),b=args.coords.priceToY(zone.upper,args.scale,args.bounds),top=Math.min(a,b),height=Math.abs(a-b);
    if(!(height>0)||top+height<args.bounds.top||top>args.bounds.top+args.bounds.height)continue;
    ctx.fillStyle=zone.side==="buy"?style.stackedBuyColor:style.stackedSellColor;ctx.fillRect(left,top,right-left,height);
  }
  ctx.restore();
}
