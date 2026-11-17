import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { FootprintHistory } from "../lib/orderflow/footprintHistory";
import { footprintValueArea } from "../lib/orderflow/footprintValueArea";
import { createFootprintPocCache } from "../lib/orderflow/footprintPoc";
import type { Tick } from "../types/trading";
type Observation = { time:number; price:number; quantity:number; buy:boolean; count:number };
const capture = JSON.parse(await readFile("artifacts/bubble-price-grid-live.json","utf8"));
const sources: {symbol:string;rows:Observation[]}[] = [
  {symbol:"BTCUSDT",rows:capture.raw.binanceTrades.map((r:{T:number;p:string;q:string;m:boolean;f:number;l:number})=>({time:r.T,price:+r.p,quantity:+r.q,buy:!r.m,count:r.l-r.f+1}))},
  {symbol:"KRK:BTC/USD",rows:capture.raw.krakenTrades.result["BTC/USD"].map((r:unknown[])=>({time:Math.floor(Number(r[2])*1000),price:Number(r[0]),quantity:Number(r[1]),buy:r[3]==="b",count:1}))},
  {symbol:"HL:BTC",rows:capture.raw.hlTrades.map((r:{time:number;px:string;sz:string;side:string})=>({time:r.time,price:+r.px,quantity:+r.sz,buy:r.side==="B",count:1}))},
];
const results=[];
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*1e-9),`${a} != ${b}`);
for (const source of sources) {
  const ticks:Tick[]=source.rows.map((r,i)=>({id:String(i),symbol:source.symbol,time:r.time,price:r.price,quantity:r.quantity,side:r.buy?"buy":"sell",simulated:false,tradeCount:r.count}));
  const history=new FootprintHistory("1m"); history.add(ticks);
  const times=[...new Set(source.rows.map(r=>Math.floor(r.time/60000)*60000))].sort((a,b)=>a-b);
  const candles=times.map(time=>{const rows=source.rows.filter(r=>Math.floor(r.time/60000)*60000===time);return {time,low:Math.min(...rows.map(r=>r.price)),high:Math.max(...rows.map(r=>r.price))};});
  let valueAreas=0,midpointReferences=0,observedRevisits=0;
  for (const step of [10,20,30,50,100]) {
    const bars=history.read({step,ratio:3});
    for (const average of [false,true]) {
      const expectedPocs=new Map<number,number>();
      for (const time of times) {
        const grouped=new Map<number,{buy:number;sell:number;bc:number;sc:number}>();
        for(const raw of source.rows) if(Math.floor(raw.time/60000)*60000===time){
          const price=Math.floor(raw.price/step)*step,row=grouped.get(price)??{buy:0,sell:0,bc:0,sc:0};
          row[raw.buy?"buy":"sell"]+=raw.quantity;row[raw.buy?"bc":"sc"]+=raw.count;grouped.set(price,row);
        }
        const rows=[...grouped].sort((a,b)=>a[0]-b[0]).map(([price,r])=>({price,total:average?(r.bc?r.buy/r.bc:0)+(r.sc?r.sell/r.sc:0):r.buy+r.sell}));
        const poc=[...rows].sort((a,b)=>b.total-a.total||a.price-b.price)[0],total=rows.reduce((sum,r)=>sum+r.total,0);
        expectedPocs.set(time,poc.price+step/2);
        for(const percent of [1,30,70,100]){
          const included=new Set([poc.price]);let includedTotal=poc.total;
          while(includedTotal<(percent/100)*total){
            const selected=[...included].sort((a,b)=>a-b),low=rows.findIndex(r=>r.price===selected[0]),high=rows.findIndex(r=>r.price===selected.at(-1));
            const candidates=[rows[low-1],rows[high+1]].filter(Boolean).sort((a,b)=>b.total-a.total||b.price-a.price);
            if(!candidates.length)break;included.add(candidates[0].price);includedTotal+=candidates[0].total;
          }
          const area=footprintValueArea(bars.find(b=>b.time===time)!,step,percent,average)!;assert.ok(area);
          near(area.low,Math.min(...included));near(area.high,Math.max(...included)+step);near(area.pocMid,poc.price+step/2);near(area.selectedVolume,includedTotal);near(area.representedVolume,total);valueAreas++;
        }
      }
      const refs=createFootprintPocCache().read(bars,candles,"1m",step,average);
      assert.equal(refs.length,times.length);
      for(const ref of refs){const price=expectedPocs.get(ref.time)!;near(ref.price,price);
        const expected=candles.find(c=>c.time>ref.time&&c.low<=price&&c.high>=price)?.time??null;
        assert.equal(ref.touched,expected);midpointReferences++;if(expected!==null)observedRevisits++;
      }
    }
  }
  results.push({symbol:source.symbol,executions:ticks.length,valueAreas,midpointReferences,observedRevisits});
}
const count=20000,synthetic=Array.from({length:count},(_,i)=>({time:60000+i*60000,low:100+i%11,high:102+i%11}));
const prints=synthetic.map((c,i)=>({time:c.time,volume:1,delta:1,poc:100+i%11,levels:[{price:100+i%11,upperPrice:101+i%11,buyVolume:1,sellVolume:0,imbalance:null}]}));
const began=performance.now(),refs=createFootprintPocCache().read(prints,synthetic,"1m",1);assert.equal(refs.length,count);
const report={checkedAt:new Date().toISOString(),sourceCapture:capture.checkedAt,results,modelTiming:{syntheticCandles:count,indexedReferences:refs.length,milliseconds:performance.now()-began},
  scope:"Independent raw-tuple value-area/POC oracle at five row sizes, four percentages and raw/mean bases. Later touch checks use only observed execution-derived minute ranges, not complete provider OHLCV. Retained public capture, not a fresh network outage, browser performance test or direct Vela pixel comparison."};
await writeFile("artifacts/footprint-value-area-source.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
