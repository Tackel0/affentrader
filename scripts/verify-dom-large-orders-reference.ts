import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {runInNewContext} from "node:vm";
import {domLargeThresholds,domOrderTier,type DomHighlight} from "../lib/orderflow/domLargeOrders";
import {defaultDomPreferences} from "../lib/orderflow/domPreferences";
const source=await readFile("artifacts/vela-dom-reference/0kh_muujoeolo.js","utf8"),hash=createHash("sha256").update(source).digest("hex");
assert.equal(hash,"42f2ea4bd3efd7d848ef453f8648616c6fd3469feeaddc70f9ed51c763278c6a");
assert.ok(source.includes("domRecenterSeconds:10"));assert.equal(defaultDomPreferences().delay,10000);
const median=source.slice(source.indexOf("B=e=>{if(0===e.length)"),source.indexOf(",$=e=>",source.indexOf("B=e=>{if(0===e.length)")));
const start=source.indexOf("H=(e,t)=>{let n=\"fixed\""),threshold=source.slice(start,source.indexOf(",L=5e3",start));
const classificationStart=source.indexOf("let i=e*t,l=null===tb?0:"),classification=source.slice(classificationStart,source.indexOf(",o=",classificationStart));
assert.ok(median.startsWith("B=")&&threshold.startsWith("H=")&&classification.startsWith("let i="));
const ref=runInNewContext(`let ${median};let ${threshold};({threshold:H,median:B,tier:(e,t,tb)=>{${classification};return l;}})`,{}, {timeout:1000}) as {median(v:number[]):number|null;threshold(v:DomHighlight,typical:number|null):{large:number;block:number}|null;tier(q:number,p:number,t:unknown):number};
let seed=82371,cases=0,tiers=0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
for(let sample=0;sample<512;sample++){
  const rows=Array.from({length:sample%81},(_,i)=>({price:Math.round((10+i+random())*10)/10,bid:random()<.4?0:Math.round(random()*1000)/10,ask:random()<.4?0:Math.round(random()*1000)/10}));
  const values=rows.flatMap(r=>[r.bid,r.ask].filter(q=>q>0).map(q=>q*r.price));
  for(const setting of [...[2,3,5,10,20].map(multiplier=>({mode:"auto",multiplier} as const)),...[.1,100,1000,1e6].map(value=>({mode:"fixed",value} as const))]){
    const expected=ref.threshold(setting,values.length>=6?ref.median(values):null),actual=domLargeThresholds(rows,setting);
    assert.equal(JSON.stringify(actual),JSON.stringify(expected));cases++;
    for(const row of rows)for(const q of [row.bid,row.ask]){assert.equal(domOrderTier(q,row.price,actual),q>0?ref.tier(q,row.price,expected):0);tiers++;}
    if(expected)for(const value of [expected.large,expected.block,expected.large*(1-1e-10),expected.block*(1-1e-10)]){assert.equal(domOrderTier(value,1,actual),ref.tier(value,1,expected));tiers++;}
  }
}
const report={checkedAt:new Date().toISOString(),sourceHash:hash,thresholdCases:cases,tierCases:tiers,differences:0,scope:"Reviewed public Vela DOM B/H and actual tier branch versus production thresholds/classification; numeric valid inputs, not complete rendering/interaction parity."};
await writeFile("artifacts/dom-large-orders-reference.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
