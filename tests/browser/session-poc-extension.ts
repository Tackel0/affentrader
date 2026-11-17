import { Vela, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { buildSessionVolumeProfiles } from "@/lib/orderflow/volumeProfileModel";
import { defaultVolumeProfile } from "@/lib/orderflow/volumeProfileSettings";
import { paintVolumeProfiles } from "@/lib/orderflow/volumeProfileRenderer";
const start=Date.UTC(2026,10,4,12),minute=60000;
let touched=false;
const bars=():OHLCV[]=>Array.from({length:71},(_,i)=>({time:start+i*minute,open:i<60?101:103,close:i<60?102:103.5,high:i<60?103:104,low:i<60?100:touched&&i===65?100.5:103,volume:100}));
const style={...defaultVolumeProfile(),sessionStartMinutes:720,sessionMinutes:60,rowSize:1,extendPoc:true,widthPercent:30};
const model=buildSessionVolumeProfiles([{id:"a",symbol:"SVP-FIXTURE",time:start,price:100,quantity:10,side:"buy",simulated:true},
  {id:"b",symbol:"SVP-FIXTURE",time:start+minute,price:102,quantity:2,side:"sell",simulated:true}],style,"SVP-FIXTURE");
registerRendererLayer({id:"svp-extension-fixture",create:()=>{let canvas:HTMLCanvasElement|undefined;return {mount(value){canvas=value;},render(args){
  const ctx=canvas?.getContext("2d");if(!ctx||!canvas)return;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.scale(args.coords.dpr,args.coords.dpr);
  const result=paintVolumeProfiles(ctx,args,{style,model});
  const extension=result.get(start);
  document.querySelector("#status")!.textContent=`SIMULATED fixture · POC ${extension?.price??"waiting"} · ${extension?.touched===null?"no observed touch; extends to plot edge":extension?.touched?`first touch ${new Date(extension.touched).toISOString()}`:"waiting for completed session"}`;
}};}});
const chart=new Vela(document.querySelector<HTMLElement>("#chart")!,{symbol:"SVP-FIXTURE",timeframe:"1m",live:false,bars:71,theme:"light",volume:false,drawings:{toolbar:false},visibleRange:{from:start,to:start+70*minute},animations:{intro:false}},
  {dataFeed:{load:async config=>config.data??bars(),subscribe:()=>()=>{}}});
void chart.ready().then(async()=>{await chart.historyComplete();
  for(const [id,value] of [["untouched",false],["touch",true]] as const){const button=document.querySelector<HTMLButtonElement>(`#${id}`)!;button.disabled=false;button.onclick=()=>{touched=value;void chart.setMarket({data:bars()});};}
});
