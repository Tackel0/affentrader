import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { DomTrades } from "../lib/orderflow/domTrades";
import type { Tick } from "../types/trading";
const capture = JSON.parse(readFileSync("artifacts/kraken-recorded-replay-live.json", "utf8")) as {trades:Tick[]};
assert.equal(capture.trades.length,75);
assert.equal(new Set(capture.trades.map(t=>t.id)).size,75);
for(const t of capture.trades) { assert.equal(t.symbol,"KRK:BTC/USD");assert.equal(t.simulated,false);assert.equal(Math.round(t.price*10)/10,t.price); }
const last=Math.max(...capture.trades.map(t=>t.time));
const model=new DomTrades("KRK:BTC/USD",Math.min(...capture.trades.map(t=>t.time))-1);
for(const trade of capture.trades)assert.equal(model.add(trade,last),true);
const results=[];
for(const step of [.1,1,5,10,25])for(const unit of ["base","quote"] as const){
  const expected=new Map<number,{bought:number;sold:number}>();
  for(const trade of capture.trades){
    // Independent integer-tenths index for this verified 0.1-price sample.
    const stepTenths=Math.round(step*10);
    const price=Math.floor((Math.round(trade.price*10)+stepTenths/2)/stepTenths)*stepTenths/10;
    const row=expected.get(price)??{bought:0,sold:0},value=trade.quantity*(unit==="base"?1:trade.price);
    row[trade.side==="buy"?"bought":"sold"]+=value;expected.set(price,row);
  }
  const actual=model.rows(step,unit,last+5000);assert.equal(actual.size,expected.size);
  for(const [price,row] of actual){
    const raw=expected.get(price);assert.ok(raw);
    for(const [field,value] of [["bought",raw.bought],["sold",raw.sold],["delta",raw.bought-raw.sold],["volume",raw.bought+raw.sold]] as const)
      assert.ok(Math.abs(row[field]-value)<=Math.max(1e-10,Math.abs(value)*1e-12),`${unit} ${step} ${price} ${field}`);
    assert.equal(row.last,null);
  }
  results.push({step,unit,rows:actual.size,passed:true});
}
const start=performance.now(),capacity=new DomTrades("LOAD",0);
for(let i=0;i<100000;i++)assert.equal(capacity.add({id:String(i),symbol:"LOAD",price:100+i%1000,quantity:1,time:i,side:i%2?"buy":"sell",simulated:false},100000),true);
const rows=capacity.rows(1,"base",100000);
assert.equal([...rows.values()].reduce((sum,r)=>sum+r.volume,0),100000);
const elapsedMs=performance.now()-start;
const report={checkedAt:new Date().toISOString(),observations:75,results,capacity:{observations:100000,rawPrices:1000,elapsedMs,exactVolume:100000},scope:"Independent recorded Kraken nearest-grid/base-and-actual-quote checks; bounded model load, not browser/UI performance or Vela formula equivalence."};
writeFileSync("artifacts/dom-trades-source-verification.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
