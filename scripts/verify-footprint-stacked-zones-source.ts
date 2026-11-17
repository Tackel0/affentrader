import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {performance} from "node:perf_hooks";
import {FootprintHistory} from "../lib/orderflow/footprintHistory";
import {footprintDisplayBar} from "../lib/orderflow/footprintCells";
import {createFootprintStackedZoneCache} from "../lib/orderflow/footprintStackedZones";
import {firstObservedRangeTouches} from "../lib/orderflow/referenceTouches";
import type {Tick} from "../types/trading";
type Raw={time:number;price:number;quantity:number;buy:boolean;count:number};
const capture=JSON.parse(await readFile("artifacts/bubble-price-grid-live.json","utf8"));
const sources:{symbol:string;rows:Raw[]}[]=[
  {symbol:"BTCUSDT",rows:capture.raw.binanceTrades.map((r:{T:number;p:string;q:string;m:boolean;f:number;l:number})=>({time:r.T,price:+r.p,quantity:+r.q,buy:!r.m,count:r.l-r.f+1}))},
  {symbol:"KRK:BTC/USD",rows:capture.raw.krakenTrades.result["BTC/USD"].map((r:unknown[])=>({time:Math.floor(Number(r[2])*1000),price:Number(r[0]),quantity:Number(r[1]),buy:r[3]==="b",count:1}))},
  {symbol:"HL:BTC",rows:capture.raw.hlTrades.map((r:{time:number;px:string;sz:string;side:string})=>({time:r.time,price:+r.px,quantity:+r.sz,buy:r.side==="B",count:1}))},
];
const results=[];
for(const source of sources){
  const history=new FootprintHistory("1m");history.add(source.rows.map((r,i):Tick=>({id:String(i),symbol:source.symbol,time:r.time,price:r.price,quantity:r.quantity,side:r.buy?"buy":"sell",tradeCount:r.count,simulated:false})));
  const times=[...new Set(source.rows.map(r=>Math.floor(r.time/60000)*60000))].sort((a,b)=>a-b),candles=times.map(time=>{const rows=source.rows.filter(r=>Math.floor(r.time/60000)*60000===time);return{time,low:Math.min(...rows.map(r=>r.price)),high:Math.max(...rows.map(r=>r.price))};});
  let configurations=0,zoneComparisons=0,observedRevisits=0;
  for(const step of [1,5,10,20])for(const ratio of [1,3])for(const minRows of [2,3])for(const averageTradeSize of [false,true])for(const filtered of [false,true]){
    const prints=history.read({step,ratio}).map(bar=>footprintDisplayBar(bar,step,{imbalanceRatio:ratio,averageTradeSize,maxVolume:filtered?.05:0}));
    const expected:Array<{time:number;side:"buy"|"sell";lower:number;upper:number;rows:number;from:number;touched:number|null}>=[];
    for(const time of times){
      const grouped=new Map<number,{buy:number;sell:number;bc:number;sc:number}>();
      for(const raw of source.rows)if(Math.floor(raw.time/60000)*60000===time){const index=Math.floor(raw.price/step),row=grouped.get(index)??{buy:0,sell:0,bc:0,sc:0};row[raw.buy?"buy":"sell"]+=raw.quantity;row[raw.buy?"bc":"sc"]+=raw.count;grouped.set(index,row);}
      const rows=[...grouped].sort((a,b)=>a[0]-b[0]).map(([index,r])=>{const buy=averageTradeSize?(r.bc?r.buy/r.bc:0):r.buy,sell=averageTradeSize?(r.sc?r.sell/r.sc:0):r.sell;return{index,buy,sell,visible:!filtered||buy+sell<=.05};});
      const map=new Map(rows.map(row=>[row.index,row]));
      for(const side of ["buy","sell"]as const){let run:typeof rows=[];
        const emit=()=>{if(run.length>=minRows){const lower=run[0].index*step,upper=(run.at(-1)!.index+1)*step,from=time+60000,touched=candles.find(c=>c.time>=from&&c.low<=upper&&c.high>=lower)?.time??null;expected.push({time,side,lower,upper,rows:run.length,from,touched});}run=[];};
        for(const row of rows){const opposite=map.get(row.index+(side==="buy"?-1:1)),own=row[side],other=opposite?.[side==="buy"?"sell":"buy"]??0;
          // An observed zero side is valid; an absent/filtered row is unknown.
          const flagged=row.visible&&opposite?.visible===true&&own>0&&own>=ratio*other;
          if(!flagged){emit();continue;}if(run.length&&run.at(-1)!.index+1!==row.index)emit();run.push(row);
        }emit();
      }
    }
    const actual=createFootprintStackedZoneCache().read(prints,candles,"1m",step,minRows);assert.deepEqual(actual,expected);
    configurations++;zoneComparisons+=actual.length;observedRevisits+=actual.filter(zone=>zone.touched!==null).length;
  }
  results.push({symbol:source.symbol,executions:source.rows.length,configurations,zoneComparisons,observedRevisits});
}
const count=20000,bars=Array.from({length:count},(_,i)=>({time:60000+i*60000,low:100+i%11,high:102+i%11})),refs=bars.map((bar,i)=>({from:bar.time+60000,low:100+i%11,high:103+i%11}));
const began=performance.now();const overlaps=firstObservedRangeTouches(bars,refs);assert.equal(overlaps.length,count);
const report={checkedAt:new Date().toISOString(),sourceCapture:capture.checkedAt,results,indexTiming:{candles:count,queries:count,milliseconds:performance.now()-began},scope:"Independent retained raw-tuple stacks/filter/mean oracle and brute observed-range revisits across 64 configurations per venue. Requires observed visible diagonal counterparts, matching the inspected Vela comparator; this is not full visual equivalence, fresh network data or complete exchange history. Timing covers only the indexed overlap query."};
await writeFile("artifacts/footprint-stacked-zones-source.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
