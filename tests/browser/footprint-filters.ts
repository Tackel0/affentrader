import {Vela,registerChartType,registerRendererLayer,type OHLCV} from "@luxalgo/vela";
import {defaultFootprint,footprintSettings,resolveFootprintInstances,footprintPlacements,paintFootprintBar,paintFootprintInstanceCandles} from "@/lib/orderflow/footprint";
import {footprintDisplayBar} from "@/lib/orderflow/footprintCells";
import {FootprintHistory} from "@/lib/orderflow/footprintHistory";
import {footprintStatistics} from "@/lib/orderflow/footprintStatistics";
import type {Tick} from "@/types/trading";
const start=Date.UTC(2026,10,4,12),minute=60000;
const bars:OHLCV[]=[-1,0,1].map(offset=>({time:start+offset*minute,open:100,close:104,low:98,high:106,volume:offset?0:225}));
const history=new FootprintHistory("1m"),rows=[[100,100,100,100],[5,5,1,1],[0,8,0,2],[3,0,1,0],[2,2,1,1]];
history.add(rows.flatMap(([buy,sell,bc,sc],i)=>[{side:"buy"as const,quantity:buy,tradeCount:bc},{side:"sell"as const,quantity:sell,tradeCount:sc}].filter(t=>t.quantity>0).map((t,j):Tick=>({id:`${i}/${j}`,symbol:"FILTERS-FIXTURE",time:start+i*2+j+1,price:100+i,simulated:true,...t}))));
registerChartType({id:"footprint",label:"Footprint",basePainting:"none",settings:footprintSettings()});
registerRendererLayer({id:"footprint",placement:"above-data",create:()=>{let canvas:HTMLCanvasElement|undefined;return{mount(value){canvas=value;},render(args){const ctx=canvas?.getContext("2d");if(!ctx||!canvas)return;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.scale(args.coords.dpr,args.coords.dpr);
  const instances=resolveFootprintInstances(args.settings),places=footprintPlacements(args,instances);paintFootprintInstanceCandles(ctx,args,instances,places);const status:string[]=[];
  for(const instance of instances){const style=instance.style,step=style.rowSize||1,place=places.get(instance.id)!;
    for(const raw of history.read({step,ratio:style.imbalanceRatio},instance.id)){const shown=footprintDisplayBar(raw,step,style);paintFootprintBar(ctx,args,shown,undefined,step,{...style,candleVisible:false},place);const totals=footprintStatistics(shown);
      status.push(`${instance.id.toUpperCase()}: ${shown.levels.filter(r=>!r.filtered).length}/${shown.levels.length} rows, POC ${Number.isFinite(shown.poc)?shown.poc:"none"}, raw volume ${totals.total}`);
    }
    ctx.fillStyle=args.theme.textColor;ctx.font="11px Arial";ctx.textAlign="center";ctx.fillText(instance.id==="fp1"?"FP1 · unfiltered":"FP2 · filtered",args.coords.timeToX(start)+place.offset,args.bounds.top+24,place.width);
  }
  document.querySelector("#status")!.textContent=`SIMULATED · ${status.join(" · ")}`;
}};}});
const chart=new Vela(document.querySelector<HTMLElement>("#chart")!,{symbol:"FILTERS-FIXTURE",timeframe:"1m",live:false,bars:3,priceStyle:"footprint",theme:"light",volume:false,drawings:{toolbar:false},animations:{intro:false}},{dataFeed:{load:async cfg=>cfg.data??bars,subscribe:()=>()=>{}}});
chart.renderer.applyConfig({chartTypes:{footprint:{...defaultFootprint(),rowSize:1,valueAreaBackground:"#7b1fa222",valueAreaColor:"#7b1fa2",pocColor:"#7b1fa2",fp2Enabled:true,fp2RowSize:1,fp2VolumeMode:"bid-ask",fp2MaxVolume:10,fp2ValueAreaBackground:"#ff980022",fp2ValueAreaColor:"#f57c00",fp2PocColor:"#f57c00"}}});
let average=false;void chart.ready().then(async()=>{await chart.historyComplete();chart.setVisibleRange({from:start-minute,to:start+minute});
  for(const id of ["off","reset","blank","average","settings"]){const button=document.querySelector<HTMLButtonElement>(`#${id}`)!;button.disabled=false;button.onclick=()=>{
    if(id==="settings"){chart.renderer.openSettings("Footprint");return;}
    if(id==="average"){average=!average;chart.renderer.applyConfig({chartTypes:{footprint:{averageTradeSize:average,fp2AverageTradeSize:average}}});return;}
    chart.renderer.applyConfig({chartTypes:{footprint:{fp2MinVolume:id==="blank"?1000:0,fp2MaxVolume:id==="reset"?10:0}}});
  };}
});
