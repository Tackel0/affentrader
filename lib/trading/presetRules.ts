import {providerOf,isSymbolId} from "@/lib/symbolId";
import {loadHyperliquidAssets} from "@/lib/market/hyperliquidClient";
import {priceTick} from "@/lib/market/hyperliquid";
import type {PresetRules} from "./orderPresets";
const cache=new Map<string,{at:number;rules:PresetRules}>();
export async function loadPresetRules(symbol:string,fetcher:typeof fetch=fetch,allowNetwork=true):Promise<PresetRules>{
  if(!isSymbolId(symbol))throw new Error("Invalid instrument.");const hit=cache.get(symbol);if(hit&&Date.now()-hit.at>=0&&Date.now()-hit.at<300000)return hit.rules;
  if(!allowNetwork)throw new Error("Verified contract rules are not cached for offline preset use.");
  let rules:PresetRules;
  if(providerOf(symbol)==="hyperliquid"){
    const asset=(await loadHyperliquidAssets(fetcher)).find(a=>a.symbol===symbol);if(!asset||!Number.isInteger(asset.szDecimals)||asset.szDecimals<0||asset.szDecimals>6)throw new Error("Verified Hyperliquid contract precision is unavailable.");
    rules={symbol,source:"Hyperliquid",quantityStep:Number(`1e-${asset.szDecimals}`),tick:price=>priceTick(price,asset.szDecimals)};
  }else if(providerOf(symbol)==="binance"){
    const response=await fetcher(`/api/market?resource=exchangeInfo&symbol=${encodeURIComponent(symbol)}`,{signal:AbortSignal.timeout(20000)}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error("Binance instrument rules are unavailable.");const entry=(Array.isArray(body?.symbols)?body.symbols:[]).find((s:{symbol:string}|null)=>s?.symbol===symbol),filters=(Array.isArray(entry?.filters)?entry.filters:[]) as {filterType:string;tickSize?:string;stepSize?:string}[],step=Number(filters?.find(f=>f?.filterType==="PRICE_FILTER")?.tickSize),quantityStep=Number(filters?.find(f=>f.filterType==="LOT_SIZE")?.stepSize);
    if(!Number.isFinite(step)||step<=0||!Number.isFinite(quantityStep)||quantityStep<=0)throw new Error("Verified Binance tick/quantity steps are unavailable.");rules={symbol,source:"Binance",quantityStep,tick:()=>step};
  }else throw new Error("Verified venue tick/quantity rules are unavailable for this Yahoo instrument.");
  cache.set(symbol,{at:Date.now(),rules});if(cache.size>100)cache.delete(cache.keys().next().value!);return rules;
}
