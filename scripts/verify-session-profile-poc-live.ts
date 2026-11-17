import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import { loadKrakenClosedBars,loadKrakenRecentTrades } from "../lib/market/kraken";
import { buildSessionVolumeProfiles } from "../lib/orderflow/volumeProfileModel";
import { defaultVolumeProfile } from "../lib/orderflow/volumeProfileSettings";
import { createProfilePocExtensionCache } from "../lib/orderflow/profilePocExtensions";
const capture=JSON.parse(await readFile("artifacts/session-profile-hours-live.json","utf8"));
const trades=await loadKrakenRecentTrades("BTC/USD",1000,async()=>Response.json(capture.raw));assert.ok(trades.length>0);
const end=Math.floor(Math.max(...trades.map(t=>t.time))/3600000)*3600000+3600000,start=end-3600000;
const hhmm=(time:number)=>{const d=new Date(time);return d.getUTCHours()*100+d.getUTCMinutes();};
const style={...defaultVolumeProfile(),rowSize:100,tradingHours:"Custom" as const,customStart:hhmm(start),customEnd:hhmm(end),extendPoc:true};
const response=await fetch("https://api.kraken.com/0/public/OHLC?pair=BTCUSD&interval=1",{signal:AbortSignal.timeout(15000)});assert.ok(response.ok);const raw=await response.json();
const bars=await loadKrakenClosedBars("BTC/USD","1m",async()=>Response.json(raw)),model=buildSessionVolumeProfiles(trades,style,"KRK:BTC/USD");
assert.equal(model.sessions.length,1);assert.equal(model.sessions[0].end,end);assert.ok(bars.at(-1)!.time>=end);
const extension=createProfilePocExtensionCache().read(bars,model.sessions).get(model.sessions[0].start)!;assert.ok(extension);
// Independent raw-tuple oracle: integer $100 bins, midpoint-nearest maximum,
// then the first closed candle containing that center at/after the end.
const quantities=new Map<number,number>(),seen=new Set<number>();
for(const row of capture.raw.result["BTC/USD"] as unknown[][]){const id=Number(row[6]),time=Math.floor(Number(row[2])*1000);if(seen.has(id)||time<start||time>=end)continue;seen.add(id);
  const bin=Math.floor(Number(row[0])/100);quantities.set(bin,(quantities.get(bin)??0)+Number(row[1]));}
const low=Math.min(...quantities.keys()),high=Math.max(...quantities.keys()),center=(low+high)/2,maximum=Math.max(...quantities.values());
const candidates=[...quantities].filter(([,q])=>q===maximum).map(([b])=>b).sort((a,b)=>Math.abs(a-center)-Math.abs(b-center)||a-b),price=candidates[0]*100+50;
assert.equal(extension.price,price);
const rows=(Object.values(raw.result).find(Array.isArray) as unknown[][]).slice(0,-1);
const touched=rows.find(r=>Number(r[0])*1000>=end&&Number(r[3])<=price&&Number(r[2])>=price);
const expected=touched?Number(touched[0])*1000:null;assert.equal(extension.touched,expected);
const report={checkedAt:new Date().toISOString(),sourceCapture:capture.capturedAt,executions:trades.length,candles:bars.length,sessionEnd:new Date(end).toISOString(),price,firstObservedTouch:expected===null?null:new Date(expected).toISOString(),scope:"Retained public Kraken executions plus freshly loaded closed OHLC ranges; observed source coverage only.",raw};
await writeFile("artifacts/session-profile-poc-live.json",JSON.stringify(report,null,2));console.log(JSON.stringify({...report,raw:undefined}));
