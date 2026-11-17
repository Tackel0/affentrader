import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { loadKrakenClosedBars } from "../lib/market/kraken";
import { calculateVwapBands, defaultVwapBands, VWAP_ANCHORS } from "../lib/orderflow/vwapBands";
const response=await fetch("https://api.kraken.com/0/public/OHLC?pair=BTCUSD&interval=60",{signal:AbortSignal.timeout(15000)});
assert.ok(response.ok);const raw=await response.json();
const bars=await loadKrakenClosedBars("BTC/USD","1h",async()=>Response.json(raw));assert.ok(bars.length>100);
const rows=(Object.values(raw.result).find(Array.isArray) as unknown[][]).slice(0,-1);
function clock(time:number,anchor:string){
  const date=new Date(time);
  if(anchor==="Year")return String(date.getUTCFullYear());
  if(anchor==="Quarter")return `${date.getUTCFullYear()}Q${Math.ceil((date.getUTCMonth()+1)/3)}`;
  if(anchor==="Month")return date.toISOString().slice(0,7);
  if(anchor==="Week")date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
  return date.toISOString().slice(0,10);
}
let checked=0;
for(const anchor of VWAP_ANCHORS)for(const source of ["HLC3","OHLC4","Close"] as const)for(const bandsMode of ["Standard Deviation","Percentage"] as const){
  const style={...defaultVwapBands(),anchor,source,bandsMode,band2:true,band3:true},out=calculateVwapBands(bars,style,"1h");
  for(let i=0;i<rows.length;i++){
    const prefix=rows.slice(0,i+1).filter(r=>clock(Number(r[0])*1000,anchor)===clock(Number(rows[i][0])*1000,anchor));
    const price=(r:unknown[])=>source==="Close"?Number(r[4]):source==="OHLC4"?(Number(r[1])+Number(r[2])+Number(r[3])+Number(r[4]))/4:(Number(r[2])+Number(r[3])+Number(r[4]))/3;
    const weight=prefix.reduce((s,r)=>s+Number(r[6]),0);
    if(!weight){assert.equal(out.mean[i],null);continue;}
    const mean=prefix.reduce((s,r)=>s+price(r)*Number(r[6]),0)/weight;
    const deviation=Math.sqrt(prefix.reduce((s,r)=>s+(price(r)-mean)**2*Number(r[6]),0)/weight);
    assert.ok(Math.abs(out.mean[i]!-mean)<1e-6);assert.ok(Math.abs(out.deviation[i]!-deviation)<1e-6);
    const offset=bandsMode==="Percentage"?mean/100:deviation;
    for(const band of out.bands){assert.ok(Math.abs(band.upper[i]!-(mean+band.index*offset))<1e-6);assert.ok(Math.abs(band.lower[i]!-(mean-band.index*offset))<1e-6);}
    checked++;
  }
}
const report={capturedAt:new Date().toISOString(),candles:bars.length,configurations:30,prefixChecks:checked,scope:"Closed Kraken BTC/USD hourly candles; independent raw OHLCV two-pass oracle; no execution-price claims.",raw};
await writeFile("artifacts/vwap-bands-live.json",JSON.stringify(report,null,2));console.log(JSON.stringify({...report,raw:undefined}));
