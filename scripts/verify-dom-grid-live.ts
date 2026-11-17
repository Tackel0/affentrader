import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fetchPriceGridMetadata } from "../lib/market/priceGridMetadata";
import { parseAssets } from "../lib/market/hyperliquid";
import { domGridChoice } from "../lib/orderflow/domPriceGrid";
async function json(url:string,body?:unknown){
  const response=await fetch(url,{...(body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  assert.ok(response.ok,`Public venue returned ${response.status}`);return response.json();
}
const settled=await Promise.allSettled([
  json("https://data-api.binance.vision/api/v3/exchangeInfo?symbol=BTCUSDT"),
  json("https://api.kraken.com/0/public/AssetPairs?pair=BTCUSD&assetVersion=1"),
  json("https://api.hyperliquid.xyz/info",{type:"metaAndAssetCtxs"}),
]);
for(const result of settled)assert.equal(result.status,"fulfilled",result.status==="rejected"?String(result.reason):"");
const [bn,kr,hl]=settled.map(r=>(r as PromiseFulfilledResult<any>).value);
const btc=hl[0].universe.findIndex((row:{name:string})=>row.name==="BTC");assert.ok(btc>=0);
const price=Number(hl[1][btc].markPx),decimals=Number(hl[0].universe[btc].szDecimals);
const expectedHl=10**-Math.max(0,Math.min(6-decimals,4-Math.floor(Math.log10(price))));
const inputs=[
  {symbol:"BTCUSDT",raw:bn,price:76000,expected:Number(bn.symbols[0].filters.find((f:{filterType:string})=>f.filterType==="PRICE_FILTER").tickSize)},
  {symbol:"KRK:BTC/USD",raw:kr,price:76000,expected:Number(kr.result["BTC/USD"].tick_size)},
  {symbol:"HL:BTC",raw:{assets:parseAssets(hl[0],hl[1],"")},price,expected:expectedHl},
];
const results=[];
for(const input of inputs){
  const metadata=await fetchPriceGridMetadata(input.symbol,async()=>Response.json(input.raw));
  const choice=domGridChoice(input.symbol,{metadata,pending:false,error:""},input.price,100);
  assert.equal(choice.verified,true);assert.equal(choice.tick,input.expected);
  results.push({symbol:input.symbol,tick:choice.tick,price:input.price,source:choice.source,passed:true});
}
const report={checkedAt:new Date().toISOString(),results,scope:"Fresh public raw BTC venue metadata versus DOM grid selection. Hyperliquid raw response adapted to existing app-route assets shape; this does not test the route or actual live browser book, historical tick rules or complete data coverage.",raw:{binance:bn,kraken:kr,hyperliquid:hl}};
await writeFile("artifacts/dom-grid-live.json",JSON.stringify(report,null,2));console.log(JSON.stringify({checkedAt:report.checkedAt,results}));
