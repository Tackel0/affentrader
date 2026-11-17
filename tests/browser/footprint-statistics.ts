import { Vela, registerChartType, registerRendererLayer, type OHLCV } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, resolveFootprintInstances, footprintPlacements, paintFootprintBar, paintFootprintInstanceCandles } from "@/lib/orderflow/footprint";
import { FOOTPRINT_STAT_TOGGLES, footprintStatistics } from "@/lib/orderflow/footprintStatistics";
import { footprintDisplayBar } from "@/lib/orderflow/footprintCells";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import type { Tick } from "@/types/trading";
const start=Date.UTC(2026,10,4,12),minute=60000;
const bars:OHLCV[]=[50,40,40].map((volume,i)=>({time:start+i*minute,open:100,close:101,low:98,high:104,volume}));
const tuples:Array<Array<[number,number,"buy"|"sell",number|undefined]>>=[[[100,20,"buy",2],[100,10,"sell",5],[101,10,"buy",1],[101,10,"sell",2]],[[100,10,"buy",undefined],[101,30,"sell",5]],[[100,20,"buy",2],[101,20,"sell",2]]];
const history=new FootprintHistory("1m");history.add(tuples.flatMap((rows,i)=>rows.map(([price,quantity,side,tradeCount],j):Tick=>({id:`${i}/${j}`,symbol:"STATS-FIXTURE",time:bars[i].time+j+1,price,quantity,side,tradeCount,simulated:true}))));
let revealed=3,above=false,average=false;
registerChartType({id:"footprint",label:"Footprint",basePainting:"none",settings:footprintSettings()});
registerRendererLayer({id:"footprint",placement:"above-data",create:()=>{
  let canvas:HTMLCanvasElement|undefined;
  return{mount(value){canvas=value;},render(args){const ctx=canvas?.getContext("2d");if(!ctx||!canvas)return;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.scale(args.coords.dpr,args.coords.dpr);
    const instances=resolveFootprintInstances(args.settings),places=footprintPlacements(args,instances);paintFootprintInstanceCandles(ctx,args,instances,places);
    const summaries:string[]=[];
    for(const instance of instances){const style=instance.style,step=style.rowSize||1;
      for(const raw of history.read({step,ratio:style.imbalanceRatio},instance.id).filter(b=>b.time<start+revealed*minute)){
        const displayed=footprintDisplayBar(raw,step,style);paintFootprintBar(ctx,args,displayed,undefined,step,{...style,candleVisible:false},places.get(instance.id));
        const s=footprintStatistics(displayed);summaries.push(`${new Date(raw.time).toISOString().slice(11,16)}: volume ${s.total}, delta ${s.delta}, trades ${s.tradeCount??"unknown"}`);
      }
    }
    document.querySelector("#status")!.textContent=`SIMULATED completed prefix · ${revealed}/3 candles · ${average?"Mean cell sizes":"Raw cell volumes"} · ${summaries.join(" · ")}`;
  }};
}});
const chart=new Vela(document.querySelector<HTMLElement>("#chart")!,{symbol:"STATS-FIXTURE",timeframe:"1m",live:false,bars:3,priceStyle:"footprint",theme:"light",volume:false,drawings:{toolbar:false},animations:{intro:false}},
  {dataFeed:{load:async cfg=>cfg.data??bars.slice(0,revealed),subscribe:()=>()=>{}}});
chart.renderer.applyConfig({chartTypes:{footprint:{...defaultFootprint(),rowSize:1,statisticsVisible:true,statisticsSize:10,...Object.fromEntries(FOOTPRINT_STAT_TOGGLES.map(key=>[key,true]))}}});
const range={from:start-minute,to:start+3*minute};
void chart.ready().then(async()=>{await chart.historyComplete();chart.setVisibleRange(range);
  for(const id of ["position","average","prefix","all","settings"]){const button=document.querySelector<HTMLButtonElement>(`#${id}`)!;button.disabled=false;button.onclick=()=>{
    if(id==="settings"){chart.renderer.openSettings("Footprint");return;}
    if(id==="position"){above=!above;chart.renderer.applyConfig({chartTypes:{footprint:{statisticsPosition:above?"above":"below"}}});return;}
    if(id==="average"){average=!average;chart.renderer.applyConfig({chartTypes:{footprint:{averageTradeSize:average}}});return;}
    revealed=id==="prefix"?2:3;void chart.setMarket({data:bars.slice(0,revealed)}).then(()=>chart.setVisibleRange(range));
  };}
});
