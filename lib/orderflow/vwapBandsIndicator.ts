import { stableSeriesId, type InputSchema, type InputValue, type NativeIndicatorContext, type NativeIndicatorDescriptor, type NativeIndicatorOutput, type SeriesSpec } from "@luxalgo/vela";
import { validChartColor } from "@/lib/chart/appearance";
import { tpoColorRgba } from "./tpoTimeColors";
import { calculateVwapBands, defaultVwapBands, VWAP_ANCHORS, VWAP_SOURCES, type VwapBandsPreferences } from "./vwapBands";
export function resolveVwapBands(values: Record<string,unknown>): VwapBandsPreferences {
  const d=defaultVwapBands();
  for(const key of ["band1","band2","band3","hideDwm","fill"] as const)if(typeof values[key]==="boolean")d[key]=values[key];
  for(const key of ["band1Mult","band2Mult","band3Mult"] as const)if(typeof values[key]==="number"&&Number.isFinite(values[key])&&values[key]>=0&&values[key]<=50)d[key]=values[key];
  for(const key of ["bullColor","bearColor","bandsColor"] as const)if(validChartColor(values[key]))d[key]=values[key];
  if(VWAP_ANCHORS.includes(values.anchor as VwapBandsPreferences["anchor"]))d.anchor=values.anchor as VwapBandsPreferences["anchor"];
  if(VWAP_SOURCES.includes(values.source as VwapBandsPreferences["source"]))d.source=values.source as VwapBandsPreferences["source"];
  if(values.bandsMode==="Standard Deviation"||values.bandsMode==="Percentage")d.bandsMode=values.bandsMode;
  return d;
}
const tint=(color:string,alpha:number)=>{const [r,g,b]=tpoColorRgba(color);return `rgba(${r},${g},${b},${alpha})`;};
const id=(title:string,ordinal:number,kind:"line"|"fill"="line")=>stableSeriesId({instanceId:"vwap",kind,title,ordinal});
export function vwapBandsInputs(): InputSchema[] {
  const d=defaultVwapBands();
  return [{key:"anchor",title:"Anchor Period",type:"string",defval:"Session",options:[...VWAP_ANCHORS]},
    {key:"source",title:"Source",type:"string",defval:"HLC3",options:[...VWAP_SOURCES]},
    {key:"bandsMode",title:"Bands Mode",type:"string",defval:"Standard Deviation",options:["Standard Deviation","Percentage"]},
    ...[1,2,3].flatMap(i=>[{key:`band${i}`,title:`Band #${i}`,type:"bool" as const,defval:i===1},
      {key:`band${i}Mult`,title:`Band #${i} Multiplier`,type:"float" as const,defval:i,min:0,max:50,step:.5}]),
    {key:"hideDwm",title:"Hide VWAP on 1D or Above",type:"bool",defval:true},
    ...(["bullColor","bearColor","bandsColor"] as const).map((key,i)=>({key,title:["Bullish","Bearish","Bands"][i],type:"color" as const,defval:d[key],tab:"Style"})),
    {key:"fill",title:"Bands Fill",type:"bool",defval:true,tab:"Style"}];
}
export function vwapBandsOutput(bars: ReturnType<NativeIndicatorContext["bars"]>, style: VwapBandsPreferences, timeframe:string): NativeIndicatorOutput {
  const result=calculateVwapBands(bars,style,timeframe);
  const series:SeriesSpec[]=[{id:id("VWAP",0),title:"VWAP",paneId:"",kind:"line",points:bars.map((b,i)=>({time:b.time,value:result.mean[i],...(result.mean[i]===null?{}:{color:b.close>=result.mean[i]!?style.bullColor:style.bearColor})})),style:{color:style.bullColor,width:1,lineStyle:"solid"}}];
  const fills:NonNullable<NativeIndicatorOutput["fills"]>=[];
  for(const index of [1,2,3]){
    const band=result.bands.find(b=>b.index===index),upper=`Upper Band #${index}`,lower=`Lower Band #${index}`,up=id(upper,index*2-1),down=id(lower,index*2);
    const display=band?undefined:{pane:false,legend:false,dataWindow:false,priceScale:false};
    // Explicit nulls also clear pinned renderer buffers when a band is disabled.
    series.push({id:up,title:upper,paneId:"",kind:"line",display,points:bars.map((b,i)=>({time:b.time,value:band?.upper[i]??null})),style:{color:tint(style.bearColor,.6),width:1,lineStyle:"solid"}},
      {id:down,title:lower,paneId:"",kind:"line",display,points:bars.map((b,i)=>({time:b.time,value:band?.lower[i]??null})),style:{color:tint(style.bullColor,.6),width:1,lineStyle:"solid"}});
    if(band&&style.fill)fills.push({id:id(`band${index-1}`,index-1,"fill"),paneId:"",fromSeriesId:up,toSeriesId:down,color:tint(style.bandsColor,.05)});
  }
  return {series,fills};
}
export function vwapBandsDescriptor(): NativeIndicatorDescriptor {
  return {type:"af-vwap",title:"VWAP Bands",shortTitle:"VWAP",overlay:true,paneHint:"price",multiInstance:true,waitsForHistory:true,
    inputsSchema:vwapBandsInputs,defaultInputs:()=>({...defaultVwapBands()}),create:()=>{
      let context:NativeIndicatorContext|undefined, values:Record<string,InputValue>={},active=false,last:NativeIndicatorOutput|undefined;
      const emit=()=>{if(!active||!context)return;try{last=vwapBandsOutput(context.bars(),resolveVwapBands(values),context.timeframe);context.emit(last);context.setStatus(context.live?"live":"idle");}
        catch{const bars=context.bars();context.emit({series:(last?.series??[]).map(series=>({...series,points:bars.map(b=>({time:b.time,value:null}))})),fills:[]});context.setStatus("idle");}};
      return {start(ctx,inputs){context=ctx;values=inputs;active=true;emit();},onBars:emit,onViewport(){},setInputs(inputs){values=inputs;emit();},
        suspend(){active=false;},resume(){active=true;emit();},stop(){active=false;context=undefined;}};
    }};
}
