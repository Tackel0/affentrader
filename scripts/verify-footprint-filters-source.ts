import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {FootprintHistory} from "../lib/orderflow/footprintHistory";
import {footprintDisplayBar} from "../lib/orderflow/footprintCells";
import {footprintValueArea} from "../lib/orderflow/footprintValueArea";
import {footprintStatistics} from "../lib/orderflow/footprintStatistics";
import {createFootprintPocCache} from "../lib/orderflow/footprintPoc";
import type {FootprintVolumeFilters} from "../lib/orderflow/footprintFilters";
import type {Tick} from "../types/trading";
type Raw={time:number;price:number;quantity:number;buy:boolean;count:number};
const capture=JSON.parse(await readFile("artifacts/bubble-price-grid-live.json","utf8"));
const sources:{symbol:string;rows:Raw[]}[]=[
  {symbol:"BTCUSDT",rows:capture.raw.binanceTrades.map((r:{T:number;p:string;q:string;m:boolean;f:number;l:number})=>({time:r.T,price:+r.p,quantity:+r.q,buy:!r.m,count:r.l-r.f+1}))},
  {symbol:"KRK:BTC/USD",rows:capture.raw.krakenTrades.result["BTC/USD"].map((r:unknown[])=>({time:Math.floor(Number(r[2])*1000),price:Number(r[0]),quantity:Number(r[1]),buy:r[3]==="b",count:1}))},
  {symbol:"HL:BTC",rows:capture.raw.hlTrades.map((r:{time:number;px:string;sz:string;side:string})=>({time:r.time,price:+r.px,quantity:+r.sz,buy:r.side==="B",count:1}))},
];
const filters:FootprintVolumeFilters[]=[{},{minVolume:.01},{maxVolume:.05},{minBidVolume:.005},{maxBidVolume:.02},{minAskVolume:.005},{maxAskVolume:.02},{minVolume:.01,maxVolume:.05,minBidVolume:.001,maxAskVolume:.04},{minVolume:1,maxVolume:.1}];
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*1e-9),`${a} != ${b}`);
const results=[];
for(const source of sources){
  const history=new FootprintHistory("1m");history.add(source.rows.map((r,i):Tick=>({id:String(i),symbol:source.symbol,time:r.time,price:r.price,quantity:r.quantity,side:r.buy?"buy":"sell",tradeCount:r.count,simulated:false})));
  const times=[...new Set(source.rows.map(r=>Math.floor(r.time/60000)*60000))].sort((a,b)=>a-b),candles=times.map(time=>{const rows=source.rows.filter(r=>Math.floor(r.time/60000)*60000===time);return{time,low:Math.min(...rows.map(r=>r.price)),high:Math.max(...rows.map(r=>r.price))};});
  let rowComparisons=0,bandComparisons=0,projectionComparisons=0;
  for(const step of [10,30,100])for(const averageTradeSize of [false,true]){
    const bars=history.read({step,ratio:3}),unfilteredRefs=createFootprintPocCache().read(bars,candles,"1m",step,averageTradeSize);
    for(const limits of filters){
      const shown=bars.map(b=>footprintDisplayBar(b,step,{...limits,averageTradeSize,imbalanceRatio:3}));
      for(const displayed of shown){
        const sourceBar=bars.find(b=>b.time===displayed.time)!;assert.deepEqual(footprintStatistics(displayed),footprintStatistics(sourceBar));
        const groups=new Map<number,{buy:number;sell:number;bc:number;sc:number}>();
        for(const raw of source.rows)if(Math.floor(raw.time/60000)*60000===displayed.time){const price=Math.floor(raw.price/step)*step,row=groups.get(price)??{buy:0,sell:0,bc:0,sc:0};row[raw.buy?"buy":"sell"]+=raw.quantity;row[raw.buy?"bc":"sc"]+=raw.count;groups.set(price,row);}
        const expected=[...groups].sort((a,b)=>a[0]-b[0]).map(([price,r])=>{const buy=averageTradeSize?(r.bc?r.buy/r.bc:0):r.buy,sell=averageTradeSize?(r.sc?r.sell/r.sc:0):r.sell;
          const values=[buy+sell,sell,buy],mins=[limits.minVolume,limits.minBidVolume,limits.minAskVolume],maxs=[limits.maxVolume,limits.maxBidVolume,limits.maxAskVolume];
          const pass=values.every((v,i)=>(!mins[i]||v>=mins[i]!)&&(!maxs[i]||v<=maxs[i]!));return{price,total:buy+sell,pass};});
        assert.equal(expected.length,displayed.levels.length);expected.forEach((row,i)=>{assert.equal(displayed.levels[i].price,row.price);assert.equal(!displayed.levels[i].filtered,row.pass);rowComparisons++;});
        const visible=expected.filter(r=>r.pass),poc=[...visible].sort((a,b)=>b.total-a.total||a.price-b.price)[0],total=visible.reduce((sum,r)=>sum+r.total,0);
        const area=footprintValueArea(displayed,step,70,averageTradeSize);
        if(!poc||!(total>0)){assert.ok(Number.isNaN(displayed.poc));assert.equal(area,null);}else{
          near(displayed.poc,poc.price);let low=visible.indexOf(poc),high=low,selected=poc.total;
          while(selected<.7*total){const lower=visible[low-1],upper=visible[high+1];if(!lower&&!upper)break;if(upper&&(!lower||upper.total>=lower.total))selected+=visible[++high].total;else selected+=visible[--low].total;}
          assert.ok(area);near(area.low,visible[low].price);near(area.high,visible[high].price+step);near(area.representedVolume,total);
        }
        bandComparisons++;
      }
      const refs=createFootprintPocCache().read(shown,candles,"1m",step,averageTradeSize);assert.deepEqual(refs,unfilteredRefs);projectionComparisons+=refs.length;
    }
  }
  results.push({symbol:source.symbol,executions:source.rows.length,rowComparisons,bandComparisons,projectionComparisons});
}
const report={checkedAt:new Date().toISOString(),sourceCapture:capture.checkedAt,results,scope:"Independent raw-tuple filter/POC/VA oracle for nine constraint combinations, three grids and raw/mean sizing; preserved raw stats and unfiltered projected POCs. Retained capture, not fresh network data or direct Vela pixel equality. Projection ranges derive only from observed executions."};
await writeFile("artifacts/footprint-filters-source.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
