import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { FootprintHistory } from "../lib/orderflow/footprintHistory";
import { footprintDisplayBar } from "../lib/orderflow/footprintCells";
import { footprintStatistics } from "../lib/orderflow/footprintStatistics";
import type { Tick } from "../types/trading";
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
  const times=[...new Set(source.rows.map(r=>Math.floor(r.time/60000)*60000))];let comparedMetrics=0;
  for(const step of [1,10,100])for(const averageTradeSize of [false,true])for(const time of times){
    const raw=source.rows.filter(r=>Math.floor(r.time/60000)*60000===time),buys=raw.filter(r=>r.buy),sells=raw.filter(r=>!r.buy);
    const buy=buys.reduce((s,r)=>s+r.quantity,0),sell=sells.reduce((s,r)=>s+r.quantity,0),total=buy+sell,delta=buy-sell;
    const buyCount=buys.reduce((s,r)=>s+r.count,0),sellCount=sells.reduce((s,r)=>s+r.count,0);
    const expected={buy,sell,total,delta,buyPercent:buy/total*100,sellPercent:sell/total*100,deltaPercent:delta/total*100,buyCount,sellCount,tradeCount:buyCount+sellCount};
    const bar=history.read({step,ratio:3}).find(b=>b.time===time)!;
    const actual=footprintStatistics(footprintDisplayBar(bar,step,{averageTradeSize,imbalanceRatio:3}));
    for(const key of Object.keys(expected) as Array<keyof typeof expected>){const value=actual[key];assert.notEqual(value,null);assert.ok(Math.abs(value!-expected[key])<=Math.max(1e-9,Math.abs(expected[key])*1e-9),`${source.symbol}/${key}: ${value} != ${expected[key]}`);comparedMetrics++;}
  }
  results.push({symbol:source.symbol,observedExecutions:source.rows.length,candles:times.length,comparedMetrics});
}
const report={checkedAt:new Date().toISOString(),sourceCapture:capture.checkedAt,results,scope:"Independent raw-tuple oracle for all ten Footprint metrics across three price grids and raw/average cell geometry. Retained public source capture, not fresh network data, complete venue history or direct Vela pixel equivalence."};
await writeFile("artifacts/footprint-statistics-source.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
