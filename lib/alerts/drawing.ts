import type { DrawingAlertCondition, DrawingAlertGeometry, DrawingAlertOperator, DrawingAlertTarget, NativeAlertDrawing, AlertDrawingType, DrawingObservation } from "@/types/drawingAlerts";
import type { AlertRule } from "@/types/alerts";
import type { OHLCV } from "@/types/trading";
import type { MarketView } from "./rules";
import { intervalMs, nextBucket } from "@/lib/market/intervals";
import { MAX_HISTORY_BARS } from "@/lib/market/klines";
import { formatPrice } from "@/lib/symbols";
import { fibonacciPrice, isFibonacciType } from "@/lib/drawings/fibonacciMath";
import { anchoredVwap, ANCHORED_VWAP_VERSION } from "@/lib/orderflow/anchoredVwap";

export const DRAWING_LABELS: Record<AlertDrawingType, string> = { trendline:"Trend line",ray:"Ray",extendedline:"Extended line",infoline:"Info line",trendangle:"Trend angle",hline:"Horizontal line",hray:"Horizontal ray",crossline:"Cross line",fibretracement:"Fib retracement",fibextension:"Fib extension",fibextensiontrend:"Trend-based Fib extension",parallelchannel:"Parallel channel",disjointchannel:"Disjoint channel",flattopbottom:"Flat top/bottom",box:"Rectangle",anchoredvwap:"Anchored VWAP",regressionchannel:"Regression channel" };
export const DRAWING_OPERATORS: Record<DrawingAlertOperator,string> = { crossing:"Crossing",crossing_up:"Crossing up",crossing_down:"Crossing down",above:"Greater than",below:"Less than",entering:"Entering",exiting:"Exiting",inside:"Inside",outside:"Outside" };
export const isFibDrawing = (type: string) => ["fibretracement","fibextension","fibextensiontrend"].includes(type);
export const isChannelDrawing = (type: string) => ["parallelchannel","disjointchannel","flattopbottom","box","regressionchannel"].includes(type);
export const supportsDrawingAlert = (type: string): type is AlertDrawingType => Object.hasOwn(DRAWING_LABELS,type);
const object = (value: unknown): value is Record<string,unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function drawingGeometry(drawing: NativeAlertDrawing, logarithmic = false, chartCellId?:string): DrawingAlertGeometry | undefined {
  if (!supportsDrawingAlert(drawing.type) || drawing.paneId && drawing.paneId !== "price") return;
  const props=drawing.props??{},levels=Array.isArray(props.levels)?props.levels.filter(object).map(level=>({ratio:Number(level.ratio),enabled:level.enabled!==false,...(typeof level.label==="string"?{label:level.label}: {})})):[];
  const geometry:DrawingAlertGeometry={id:drawing.id,type:drawing.type,anchors:drawing.anchors.map(anchor=>({...anchor})),extendLeft:drawing.type==="extendedline"||Boolean(drawing.style?.extendLeft),extendRight:["ray","hray","extendedline"].includes(drawing.type)||Boolean(drawing.style?.extendRight),logarithmic,...(isFibDrawing(drawing.type)?{logLevels:props.logLevels===true}:{}),...(chartCellId?{chartCellId}:{}),reverse:Boolean(props.reverse),levels,multiplier:typeof props.multiplier==="number"?props.multiplier:1};
  return validateDrawingGeometry(geometry)?undefined:geometry;
}
export function validateDrawingGeometry(value: unknown): string | null {
  if(!object(value))return "Invalid drawing geometry.";
  const g=value as unknown as DrawingAlertGeometry;
  if(typeof g.id!=="string"||!g.id||g.id.length>120||!supportsDrawingAlert(g.type))return "Unsupported alert drawing.";
  const required=["hline","hray","crossline","anchoredvwap"].includes(g.type)?1:["parallelchannel","flattopbottom","fibextensiontrend"].includes(g.type)?3:g.type==="disjointchannel"?4:2;
  if(!Array.isArray(g.anchors)||g.anchors.length!==required||g.anchors.some(p=>!object(p)||!Number.isFinite(p.time)||p.time<0||!Number.isFinite(p.price)||p.price<=0))return "The drawing needs complete, valid price/time anchors.";
  if(["extendLeft","extendRight","logarithmic","reverse"].some(key=>typeof value[key]!=="boolean"))return "Invalid drawing projection.";
  if(g.logLevels!==undefined&&typeof g.logLevels!=="boolean"||g.chartCellId!==undefined&&(typeof g.chartCellId!=="string"||!g.chartCellId||g.chartCellId.length>100))return "Invalid drawing construction context.";
  if(!Array.isArray(g.levels)||g.levels.length>100||g.levels.some(l=>!object(l)||!Number.isFinite(l.ratio)||Math.abs(l.ratio)>10000||typeof l.enabled!=="boolean"||l.label!==undefined&&(typeof l.label!=="string"||l.label.length>200))||new Set(g.levels.map(l=>l.ratio)).size!==g.levels.length)return "Invalid Fibonacci levels.";
  if(!Number.isFinite(g.multiplier)||g.multiplier<=0||g.multiplier>100)return "Invalid VWAP band multiplier.";
  if(!isFibDrawing(g.type)&&!["hline","hray","crossline","box","anchoredvwap"].includes(g.type)&&g.anchors[0].time===g.anchors[1].time)return "The drawing needs two different anchor times.";
  if(g.type==="disjointchannel"&&g.anchors[2].time===g.anchors[3].time)return "The channel needs two different times on each boundary.";
  return null;
}
export function validateDrawingCondition(value: unknown): string | null {
  if(!object(value))return "Invalid drawing condition.";
  const c=value as unknown as DrawingAlertCondition,problem=validateDrawingGeometry(c.geometry);if(problem)return problem;
  if(!object(c.target)||!["level","all_levels","zone"].includes(c.target.type)||!Object.hasOwn(DRAWING_OPERATORS,c.operator))return "Invalid drawing alert target or operator.";
  const zone=["entering","exiting","inside","outside"].includes(c.operator);
  if(zone!==(c.target.type==="zone"))return "Channel operators need a zone; line operators need a level.";
  const available=(ratio:unknown)=>typeof ratio==="number"&&c.geometry.levels.some(l=>l.enabled&&l.ratio===ratio);
  if(isFibDrawing(c.geometry.type)){
    if(!c.geometry.levels.some(l=>l.enabled))return "Enable at least one Fibonacci level in Drawing settings.";
    if(c.target.type==="level"&&!available(c.target.ratio))return "The selected Fibonacci level is disabled or missing.";
    if(c.target.type==="zone"&&(!Array.isArray(c.target.ratios)||c.target.ratios.length!==2||!c.target.ratios.every(available)||c.target.ratios[0]===c.target.ratios[1]))return "Choose two distinct enabled Fibonacci levels.";
    const ratios=c.target.type==="all_levels"?c.geometry.levels.filter(l=>l.enabled).map(l=>l.ratio):c.target.type==="zone"?c.target.ratios!:[c.target.ratio!];
    if(ratios.some(ratio=>!Number.isFinite(fibLevelPrice(c.geometry,ratio))))return "A selected Fibonacci level is outside the supported numeric price range.";
  }else if(c.target.type==="all_levels"||c.target.type==="level"&&c.target.ratio!==undefined||c.target.type==="zone"&&c.target.ratios!==undefined)return "Ratios belong to Fibonacci drawings.";
  if(isChannelDrawing(c.geometry.type)&&!zone)return "This drawing requires a channel operator.";
  if(!isChannelDrawing(c.geometry.type)&&!isFibDrawing(c.geometry.type)&&c.geometry.type!=="anchoredvwap"&&zone)return "This line has no price channel.";
  if(c.target.type==="level"&&c.target.series!==undefined&&(!["mid","upper","lower"].includes(c.target.series)||c.geometry.type!=="anchoredvwap"))return "Invalid anchored VWAP plot.";
  return null;
}
export function defaultDrawingTarget(g:DrawingAlertGeometry):{target:DrawingAlertTarget;operator:DrawingAlertOperator}{
  if(isChannelDrawing(g.type))return {target:{type:"zone"},operator:"entering"};
  const ratio=g.levels.find(l=>l.enabled&&l.ratio===0.618)?.ratio??g.levels.find(l=>l.enabled)?.ratio;
  return {target:{type:"level",...(isFibDrawing(g.type)?{ratio}:g.type==="anchoredvwap"?{series:"mid" as const}:{})},operator:"crossing"};
}
export const drawingCondition=(rule:AlertRule):DrawingAlertCondition|undefined=>rule.condition.op==="leaf"&&rule.condition.leaf.type==="drawing"?rule.condition.leaf:undefined;
export const drawingObservationKey=(c:DrawingAlertCondition)=>JSON.stringify([drawingFingerprint(c.geometry),c.target,c.operator,...(c.geometry.type==="anchoredvwap"?[ANCHORED_VWAP_VERSION]:[])]);
export const drawingPrice=(price:number)=>formatPrice(price);
export function drawingTargetLabel(c:DrawingAlertCondition):string{
  const level=(ratio:number)=>{const text=c.geometry.levels.find(l=>l.ratio===ratio)?.label;return `${ratio}${text?` (${text})`:""} @ ${drawingPrice(fibLevelPrice(c.geometry,ratio))}`;};
  return c.target.type==="all_levels"?"any enabled level":c.target.type==="zone"?c.target.ratios?`${level(c.target.ratios[0])}–${level(c.target.ratios[1])}`:"channel":c.target.ratio!==undefined?`level ${level(c.target.ratio)}`:c.target.series??"line";
}
export const describeDrawing=(c:DrawingAlertCondition)=>`${DRAWING_LABELS[c.geometry.type]}${c.geometry.logLevels&&c.geometry.logarithmic?" (log)":""} · ${DRAWING_OPERATORS[c.operator]} ${drawingTargetLabel(c)}`;
export function drawingHistory(c:DrawingAlertCondition,timeframe:string,now=Date.now()):number{
  if(isFibDrawing(c.geometry.type)||["hline","hray","crossline","box"].includes(c.geometry.type))return 2;
  const first=Math.min(...c.geometry.anchors.map(a=>a.time));
  return Math.min(MAX_HISTORY_BARS,Math.max(300,Math.ceil((now-first)/Math.max(1,intervalMs(timeframe)))+3));
}
/** Native drawings are placed on the candle grid, including real gaps in an exchange session. */
function coordinate(bars:readonly OHLCV[],time:number,timeframe:string):number{
  if(!bars.length||time<bars[0].time)return NaN;
  let low=0,high=bars.length;
  while(low<high){const mid=(low+high)>>>1;if(bars[mid].time<=time)low=mid+1;else high=mid;}
  const index=low-1,a=bars[index],b=bars[index+1];
  if(b)return index+(time-a.time)/(b.time-a.time);
  return index+(time-a.time)/Math.max(1,nextBucket(timeframe,a.time)-a.time);
}
function segment(g:DrawingAlertGeometry,a:{time:number;price:number},b:{time:number;price:number},at:number,bars:readonly OHLCV[],timeframe:string):number{
  const x=coordinate(bars,at,timeframe),x1=coordinate(bars,a.time,timeframe),x2=coordinate(bars,b.time,timeframe);
  if(![x,x1,x2].every(Number.isFinite)||x1===x2)return NaN;
  if(x<Math.min(x1,x2)&&!g.extendLeft||x>Math.max(x1,x2)&&!g.extendRight)return NaN;
  const weight=(x-x1)/(x2-x1);
  return g.logarithmic?Math.exp(Math.log(a.price)+(Math.log(b.price)-Math.log(a.price))*weight):a.price+(b.price-a.price)*weight;
}
export function fibLevelPrice(g:DrawingAlertGeometry,ratio:number):number{
  return isFibonacciType(g.type)?fibonacciPrice(g.type,g.anchors,ratio,g.reverse,Boolean(g.logarithmic&&g.logLevels)):NaN;
}
/** Vertical slices of the actual four-sided native fill, including a disjoint channel's end caps. */
function channelSlice(g:DrawingAlertGeometry,bars:readonly OHLCV[],timeframe:string,at:number):{ranges:[number,number][];active:boolean}|undefined{
  const [a,b,c,d]=g.anchors,offset=g.type==="parallelchannel"?c.price-(a.price+b.price)/2:0;
  const lowerA=g.type==="disjointchannel"?c:{...a,price:g.type==="flattopbottom"?c.price:a.price+offset};
  const lowerB=g.type==="disjointchannel"?d:{...b,price:g.type==="flattopbottom"?c.price:b.price+offset};
  const points=[a,b,lowerB,lowerA].map(p=>({x:coordinate(bars,p.time,timeframe),y:g.logarithmic?Math.log(p.price):p.price})),x=coordinate(bars,at,timeframe);
  if(!Number.isFinite(x)||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return;
  const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x));
  const inverse=(y:number)=>g.logarithmic?Math.exp(y):y;
  if(x<left||x>right){
    const line=(p:typeof points[number],q:typeof points[number])=>p.y+(q.y-p.y)*(x-p.x)/(q.x-p.x);
    const bounds=[inverse(line(points[0],points[1])),inverse(line(points[3],points[2]))].sort((a,b)=>a-b);if(!bounds.every(Number.isFinite))return;
    return {ranges:[[bounds[0],bounds[1]]],active:x<left?g.extendLeft:g.extendRight};
  }
  const ys:number[]=[];
  points.forEach((p,i)=>{const q=points[(i+1)%points.length];if(p.x===q.x){if(x===p.x)ys.push(p.y,q.y);}else if(x>=Math.min(p.x,q.x)&&x<=Math.max(p.x,q.x))ys.push(p.y+(q.y-p.y)*(x-p.x)/(q.x-p.x));});
  const values=[...new Set(ys)].sort((a,b)=>a-b),ranges:[number,number][]=[];
  for(let i=0;i<values.length;i+=2)ranges.push([inverse(values[i]),inverse(values[i+1]??values[i])]);
  return ranges.length?{ranges,active:true}:undefined;
}
/** Resolved numeric levels/bounds, or undefined when the actual anchor history is unavailable. */
export function drawingValues(c:DrawingAlertCondition,bars:readonly OHLCV[],timeframe:string,at:number):{levels:number[];low?:number;high?:number;active?:boolean;ranges?:[number,number][]}|undefined{
  const g=c.geometry,[a,b,d,e]=g.anchors;
  let values:number[]=[];
  if(isFibDrawing(g.type)){
    const ratios=c.target.type==="all_levels"?g.levels.filter(l=>l.enabled).map(l=>l.ratio):c.target.type==="zone"?c.target.ratios!:[c.target.ratio!];
    values=ratios.map(r=>fibLevelPrice(g,r));
  }else if(["hline","hray","crossline"].includes(g.type)){if(g.type==="hray"&&at<a.time)return;values=[a.price];}
  else if(g.type==="box"){
    values=[a.price,b.price];
  }else if(g.type==="anchoredvwap"){
    try {
      const sample=anchoredVwap(bars,a.time,g.multiplier,at).samples.at(-1); if(!sample)return;
      values=c.target.type==="zone"?[sample.lower,sample.upper]:[c.target.type==="level"&&c.target.series==="upper"?sample.upper:c.target.type==="level"&&c.target.series==="lower"?sample.lower:sample.mid];
    } catch { return; }
  }else if(g.type==="regressionchannel"){
    if(!bars.length||bars[0].time>Math.min(a.time,b.time))return;
    const rows=bars.filter(bar=>bar.time>=Math.min(a.time,b.time)&&bar.time<=Math.max(a.time,b.time)&&bar.time<=at);if(rows.length<2)return;
    const n=rows.length;let sx=0,sy=0,sxy=0,sxx=0;rows.forEach((bar,i)=>{sx+=i;sy+=bar.close;sxy+=i*bar.close;sxx+=i*i;});const slope=(n*sxy-sx*sy)/(n*sxx-sx*sx),start=(sy-slope*sx)/n,end=start+slope*(n-1),dev=2*Math.sqrt(rows.reduce((sum,bar,i)=>sum+(bar.close-start-slope*i)**2,0)/n);
    values=[segment(g,{time:rows[0].time,price:start-dev},{time:rows[n-1].time,price:end-dev},at,bars,timeframe),segment(g,{time:rows[0].time,price:start+dev},{time:rows[n-1].time,price:end+dev},at,bars,timeframe)];
  }else if(["parallelchannel","disjointchannel","flattopbottom"].includes(g.type)){
    const slice=channelSlice(g,bars,timeframe,at);if(!slice)return;
    const levels=slice.ranges.flat();return {levels,low:Math.min(...levels),high:Math.max(...levels),...slice};
  }else{
    values=[segment(g,a,b,at,bars,timeframe)];
  }
  if(!values.length||!values.every(Number.isFinite))return;
  return {levels:values,...(g.type==="box"?{active:at>=Math.min(a.time,b.time)&&at<=Math.max(a.time,b.time)}:{}),...(c.target.type==="zone"?{low:Math.min(...values),high:Math.max(...values)}:{})};
}
/** An observation's price and channel geometry use the same candle, with no later close. */
export function evaluateDrawing(c:DrawingAlertCondition,view:MarketView):{met:boolean;incomplete:boolean;event:boolean;detail:string;sample?:DrawingObservation}{
  const timeframe=view.timeframe??"1m",at=view.at??view.quote?.time??view.bars.at(-1)?.time??NaN,beforeAt=view.previousAt??view.bars.at(-2)?.time??at;
  const barAt=(time:number)=>view.bars.findLast(bar=>bar.time<=time)?.time;
  const isStatic=isFibDrawing(c.geometry.type)||["hline","hray","crossline","box"].includes(c.geometry.type);
  const currentTime=isStatic?at:barAt(at),previousTime=isStatic?beforeAt:barAt(beforeAt);
  const current=currentTime===undefined?undefined:drawingValues(c,view.bars,timeframe,currentTime),fingerprint=drawingObservationKey(c),previous=view.previousDrawing?.fingerprint===fingerprint?view.previousDrawing:previousTime===undefined?undefined:drawingValues(c,view.bars.filter(bar=>bar.time<=beforeAt),timeframe,previousTime);
  const price=view.quote?.price??view.bars.at(-1)?.close??NaN,prior=view.previousDrawing?.fingerprint===fingerprint?view.previousDrawing.price:view.previousQuote?.price??view.quote?.previous??view.bars.at(-2)?.close??NaN;
  const transition=["crossing","crossing_up","crossing_down","entering","exiting"].includes(c.operator);
  if(!current||!Number.isFinite(price))return {met:false,incomplete:true,event:false,detail:"Drawing geometry or complete anchor history is unavailable."};
  let met=false;const hits:number[]=[];
  if(c.target.type==="zone"){
    const contains=(value:number,shape:NonNullable<typeof current>)=>shape.active!==false&&(shape.ranges??[[shape.low!,shape.high!]]).some(([low,high])=>value>=low&&value<=high);
    const inside=contains(price,current),wasInside=previous&&Number.isFinite(prior)?contains(prior,previous):undefined;
    met=c.operator==="inside"?inside:c.operator==="outside"?!inside:c.operator==="entering"?wasInside===false&&inside:wasInside===true&&!inside;
  }else {current.levels.forEach((value,index)=>{const before=previous?.levels[index],matched=c.operator==="above"?price>value:c.operator==="below"?price<value:before===undefined||!Number.isFinite(prior)?false:c.operator==="crossing_up"?prior<before&&price>=value:c.operator==="crossing_down"?prior>before&&price<=value:prior<before&&price>=value||prior>before&&price<=value;if(matched)hits.push(index);});met=hits.length>0;}
  const labels=c.target.type==="all_levels"?hits.map(index=>{const level=gEnabled(c.geometry)[index];return `${level.ratio}${level.label?` (${level.label})`:""}`;}).join(", "):"";
  return {met,incomplete:false,event:met&&transition,detail:`${describeDrawing(c)}${labels?`: ${labels}`:""}`,sample:{...current,at,price,fingerprint}};
}
const gEnabled=(g:DrawingAlertGeometry)=>g.levels.filter(l=>l.enabled);
export function drawingFingerprint(g:DrawingAlertGeometry|undefined):string{
  if(!g)return "missing";const input=JSON.stringify([g.id,g.type,g.anchors.map(p=>[p.time,p.price]),g.extendLeft,g.extendRight,g.logarithmic,Boolean(g.logLevels),g.chartCellId??null,g.reverse,g.levels.map(l=>[l.ratio,l.enabled,l.label??null]),g.multiplier]);let hash=2166136261;
  for(let i=0;i<input.length;i++){hash^=input.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return `${input.length}:${hash>>>0}`;
}
export function drawingArchive(value:unknown):NativeAlertDrawing[]|undefined{
  try{const parsed=typeof value==="string"?JSON.parse(value):value;return object(parsed)&&Array.isArray(parsed.drawings)?parsed.drawings as NativeAlertDrawing[]:undefined;}catch{return;}
}
export function drawingSync(rule:AlertRule,geometry:DrawingAlertGeometry|undefined,now=Date.now()):Partial<AlertRule>|undefined{
  const condition=drawingCondition(rule);if(!condition)return;
  const issue=geometry&&(geometry.id!==condition.geometry.id||geometry.type!==condition.geometry.type)?"The linked drawing identity or tool changed. Restore the original drawing before restarting.":geometry?validateDrawingCondition({...condition,geometry}):"The linked drawing was removed. Restore it before restarting this alert.";
  if(!issue&&geometry&&drawingFingerprint(condition.geometry)===drawingFingerprint(geometry)&&!rule.drawingIssue)return;
  const revision=drawingFingerprint(geometry);
  if(issue===rule.drawingIssue&&revision===rule.drawingRevision)return;
  return {condition:{op:"leaf",leaf:{...condition,geometry:!issue&&geometry?geometry:condition.geometry}},drawingRevision:revision,drawingIssue:issue??undefined,...(issue?{status:"stopped" as const,stop:{reason:"drawing_unavailable" as const,time:now,detail:issue}}:{})};
}
export const drawingSourceRevision=(rule:AlertRule)=>rule.drawingRevision??drawingFingerprint(drawingCondition(rule)?.geometry);
