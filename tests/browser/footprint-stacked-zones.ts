import {Vela,registerChartType,registerRendererLayer,type OHLCV} from "@luxalgo/vela";
import {defaultFootprint,footprintSettings,resolveFootprintInstances,footprintPlacements,paintFootprintBar,paintFootprintInstanceCandles} from "@/lib/orderflow/footprint";
import {footprintDisplayBar} from "@/lib/orderflow/footprintCells";
import {FootprintHistory} from "@/lib/orderflow/footprintHistory";
import {createFootprintStackedZoneCache,paintFootprintStackedZones} from "@/lib/orderflow/footprintStackedZones";
import type {Tick} from "@/types/trading";
const start=Date.UTC(2026,10,4,12),minute=60000;
const bars:OHLCV[]=[{time:start,open:100,close:102,low:99,high:104,volume:34},{time:start+minute,open:107,close:105,low:105,high:108,volume:40},{time:start+2*minute,open:109,close:110,low:109,high:110,volume:0},{time:start+3*minute,open:101,close:102,low:101,high:102,volume:0}];
const history=new FootprintHistory("1m");history.add([0,1].flatMap(i=>[0,1,2].flatMap(j=>["buy","sell"].map((side):Tick=>({id:`${i}/${j}/${side}`,symbol:"STACK-FIXTURE",time:bars[i].time+j*2+(side==="buy"?1:2),price:(i?105:100)+j,side:side as "buy"|"sell",quantity:i?side==="sell"?12:1:side==="buy"?10:1,tradeCount:!i&&side==="buy"?100:1,simulated:true})))));
// Observed diagonal counterparts are required at the outer edges. Without
// these executions, each advertised three-row run has only two valid flags.
history.add([{id:"buy-lower-counterpart",symbol:"STACK-FIXTURE",time:start+10,price:99,side:"sell",quantity:1,tradeCount:1,simulated:true},
  {id:"sell-upper-counterpart",symbol:"STACK-FIXTURE",time:start+minute+10,price:108,side:"buy",quantity:1,tradeCount:1,simulated:true}]);
let revealed=4,average=false,filtered=false;
registerChartType({id:"footprint",label:"Footprint",basePainting:"none",settings:footprintSettings()});
registerRendererLayer({id:"footprint",placement:"above-data",create:()=>{let canvas:HTMLCanvasElement|undefined;const caches=new Map<string,ReturnType<typeof createFootprintStackedZoneCache>>();return{mount(value){canvas=value;},render(args){const ctx=canvas?.getContext("2d");if(!ctx||!canvas)return;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.scale(args.coords.dpr,args.coords.dpr);
  const instances=resolveFootprintInstances(args.settings),places=footprintPlacements(args,instances),through=start+revealed*minute;paintFootprintInstanceCandles(ctx,args,instances,places);const views=instances.map(instance=>{const style=instance.style,step=style.rowSize||1,prints=history.read({step,ratio:style.imbalanceRatio},instance.id).filter(bar=>bar.time<through).map(bar=>footprintDisplayBar(bar,step,style));
    for(const bar of prints)paintFootprintBar(ctx,args,bar,undefined,step,{...style,candleVisible:false},places.get(instance.id));let cache=caches.get(instance.id);if(!cache){cache=createFootprintStackedZoneCache();caches.set(instance.id,cache);}return{instance,zones:cache.read(prints,args.bars,"1m",step,style.stackedRows,through)};});
  for(const view of views)paintFootprintStackedZones(ctx,args,view.zones,view.instance.style,places.get(view.instance.id));
  document.querySelector("#status")!.textContent=`SIMULATED completed prefix · ${revealed}/4 candles · ${average?"Mean":"Raw"} sizing · ${filtered?"Max volume 12":"No filter"} · ${views.reduce((count,view)=>count+view.zones.length,0)} zones · ${views.flatMap(view=>view.zones.map(zone=>`${zone.side} [${zone.lower},${zone.upper}]: ${zone.touched===null?"unrevisited":new Date(zone.touched).toISOString().slice(11,16)}`)).join(" · ")}`;
}};}});
const chart=new Vela(document.querySelector<HTMLElement>("#chart")!,{symbol:"STACK-FIXTURE",timeframe:"1m",live:false,bars:4,priceStyle:"footprint",theme:"light",volume:false,drawings:{toolbar:false},animations:{intro:false}},{dataFeed:{load:async cfg=>cfg.data??bars.slice(0,revealed),subscribe:()=>()=>{}}});
chart.renderer.applyConfig({chartTypes:{footprint:{...defaultFootprint(),rowSize:1,stackedVisible:true,stackedRows:3,valueAreaVisible:false,pocVisible:false}}});const range={from:start-minute,to:start+4*minute};
void chart.ready().then(async()=>{await chart.historyComplete();chart.setVisibleRange(range);for(const id of ["prefix","all","average","filter","settings"]){const button=document.querySelector<HTMLButtonElement>(`#${id}`)!;button.disabled=false;button.onclick=()=>{
  if(id==="settings"){chart.renderer.openSettings("Footprint");return;}if(id==="average"){average=!average;chart.renderer.applyConfig({chartTypes:{footprint:{averageTradeSize:average}}});return;}if(id==="filter"){filtered=!filtered;chart.renderer.applyConfig({chartTypes:{footprint:{maxVolume:filtered?12:0}}});return;}
  revealed=id==="prefix"?2:4;void chart.setMarket({data:bars.slice(0,revealed)}).then(()=>chart.setVisibleRange(range));
};}});
