import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { loadKrakenRecentTrades } from "../lib/market/kraken";
import { buildSessionVolumeProfiles } from "../lib/orderflow/volumeProfileModel";
import { defaultVolumeProfile } from "../lib/orderflow/volumeProfileSettings";
const response=await fetch("https://api.kraken.com/0/public/Trades?pair=BTCUSD&assetVersion=1&count=1000",{signal:AbortSignal.timeout(15000)});assert.ok(response.ok);
const raw=await response.json(),trades=await loadKrakenRecentTrades("BTC/USD",1000,async()=>Response.json(raw));assert.ok(trades.length>0);
const cases=[
  ["Full day",0,1440],["Pre-market",540,810],["Market",810,1200],["Post-market",1200,1440],
  ["London",480,990],["New York",780,1320],["Asian",0,540],["Custom",1320,120],["Custom",1020,1080],
] as const,report=[];
for(const [tradingHours,start,end] of cases){
  const style={...defaultVolumeProfile(),tradingHours,rowSize:100,customStart:Math.floor(start/60)*100+start%60,customEnd:Math.floor(end/60)*100+end%60};
  const model=buildSessionVolumeProfiles(trades,style,"KRK:BTC/USD"),expected=new Map<number,{buy:number;sell:number;count:number}>(),seen=new Set<number>();
  for(const row of raw.result["BTC/USD"] as unknown[][]){
    const id=Number(row[6]);if(seen.has(id))continue;seen.add(id);
    const time=Math.floor(Number(row[2])*1000),midnight=Math.floor(time/86400000)*86400000,minute=(time-midnight)/60000;
    const included=end>start?minute>=start&&minute<end:minute>=start||minute<end;if(!included)continue;
    const anchor=midnight+start*60000-(end<=start&&minute<end?86400000:0),value=expected.get(anchor)??{buy:0,sell:0,count:0};
    value[row[3]==="b"?"buy":"sell"]+=Number(row[1]);value.count++;expected.set(anchor,value);
  }
  assert.equal(model.sessions.length,expected.size);
  for(const session of model.sessions){const wanted=expected.get(session.start);assert.ok(wanted);
    assert.ok(Math.abs(session.rows.reduce((n,r)=>n+r.buy,0)-wanted.buy)<1e-9);
    assert.ok(Math.abs(session.rows.reduce((n,r)=>n+r.sell,0)-wanted.sell)<1e-9);assert.equal(session.tradeCount,wanted.count);
  }
  report.push({tradingHours,start,end,profiles:model.sessions.length,executions:[...expected.values()].reduce((n,v)=>n+v.count,0)});
}
await writeFile("artifacts/session-profile-hours-live.json",JSON.stringify({capturedAt:new Date().toISOString(),source:"Recent observed Kraken BTC/USD executions; named UTC windows only, no venue-calendar equivalence claim.",trades:trades.length,cases:report,raw},null,2));
console.log(JSON.stringify({trades:trades.length,cases:report}));
