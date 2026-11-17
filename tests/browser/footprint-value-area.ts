import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, resolveFootprintInstances, footprintPlacements, paintFootprintBar, paintFootprintInstanceCandles } from "@/lib/orderflow/footprint";
import { footprintDisplayBar } from "@/lib/orderflow/footprintCells";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { createFootprintPocCache, paintFootprintPocExtensions } from "@/lib/orderflow/footprintPoc";
import { footprintValueArea } from "@/lib/orderflow/footprintValueArea";
import type { Tick } from "@/types/trading";
const start=Date.UTC(2026,10,4,12),minute=60000;
const bars:OHLCV[]=[{time:start,open:101,close:103,low:100,high:105,volume:20},{time:start+minute,open:104,close:105,low:104,high:106,volume:21},
  {time:start+2*minute,open:101,close:102,low:101,high:103,volume:18},{time:start+3*minute,open:100,close:101,low:99,high:102,volume:13}];
const source=[[[100,1],[101,4],[102,10],[103,4],[104,1]],[[104,6],[105,15]],[[101,5],[102,10],[103,3]],[[99,2],[100,8],[101,3]]];
const history=new FootprintHistory("1m");
history.add(source.flatMap((rows,i)=>rows.map(([price,quantity],j):Tick=>({id:`${i}/${j}`,symbol:"VA-FIXTURE",time:bars[i].time+j+1,price,quantity,side:j%2?"sell":"buy",tradeCount:j===2?10:1,simulated:true}))));
let revealed=4;
registerChartType({id:"footprint",label:"Footprint",basePainting:"none",settings:footprintSettings()});
registerRendererLayer({id:"footprint",placement:"above-data",create:()=>{
  let canvas:HTMLCanvasElement|undefined;const caches=new Map<string,ReturnType<typeof createFootprintPocCache>>();
  return{mount(value){canvas=value;},render(args){
    const ctx=canvas?.getContext("2d");if(!ctx||!canvas)return;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.scale(args.coords.dpr,args.coords.dpr);
    const instances=resolveFootprintInstances(args.settings),places=footprintPlacements(args,instances),through=start+revealed*minute;
    paintFootprintInstanceCandles(ctx,args,instances,places);
    const labels:string[]=[];
    for(const instance of instances){const style=instance.style,step=style.rowSize||1,place=places.get(instance.id)!;
      const model=history.read({step,ratio:style.imbalanceRatio},instance.id).filter(b=>b.time<through).map(b=>footprintDisplayBar(b,step,style));
      for(const raw of model){paintFootprintBar(ctx,args,raw,undefined,step,{...style,candleVisible:false},place);
        const area=footprintValueArea(raw,step,style.valueAreaPercent,style.averageTradeSize);if(area)labels.push(`${new Date(raw.time).toISOString().slice(11,16)} VA ${area.low}–${area.high}; POC ${area.pocMid}`);
      }
      let cache=caches.get(instance.id);if(!cache){cache=createFootprintPocCache();caches.set(instance.id,cache);}
      const refs=cache.read(model,args.bars,"1m",step,style.averageTradeSize,through);paintFootprintPocExtensions(ctx,args,refs,style,place);
      if(instance.id==="fp1")document.querySelector("#revisits")!.textContent=`${args.bars.length<2?"Projection withheld: fewer than two loaded candles. ":""}${refs.map(ref=>`${new Date(ref.time).toISOString().slice(11,16)} POC ${ref.price}: ${ref.touched===null?"unrevisited":new Date(ref.touched).toISOString().slice(11,16)}`).join(" · ")}`;
    }
    document.querySelector("#status")!.textContent=`SIMULATED completed prefix · ${revealed}/4 candles · ${labels.join(" · ")}`;
  }};
}});
const chart=new Vela(document.querySelector<HTMLElement>("#chart")!,{symbol:"VA-FIXTURE",timeframe:"1m",live:false,bars:4,priceStyle:"footprint",theme:"light",volume:false,drawings:{toolbar:false},animations:{intro:false}},
  {dataFeed:{load:async cfg=>cfg.data??bars.slice(0,revealed),subscribe:()=>()=>{}}});
chart.renderer.applyConfig({chartTypes:{footprint:{...defaultFootprint(),rowSize:1,valueAreaBackground:"#2962ff22",valueAreaColor:"#2962ff",valueAreaWidth:2,pocExtend:true,pocWidth:2,pocColor:"#7b1fa2"}}});
const range={from:start-minute,to:start+4*minute};
void chart.ready().then(async()=>{await chart.historyComplete();chart.setVisibleRange(range);
  for(const id of ["single","prefix","all","settings"]){const button=document.querySelector<HTMLButtonElement>(`#${id}`)!;button.disabled=false;
    button.onclick=()=>{if(id==="settings"){chart.renderer.openSettings("Footprint");return;}revealed=id==="single"?1:id==="prefix"?2:4;void chart.setMarket({data:bars.slice(0,revealed)}).then(()=>chart.setVisibleRange(range));};
  }
});
