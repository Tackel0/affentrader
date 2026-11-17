import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
const channel = process.argv[2] ?? "candle";
if (!["candle", "trades", "both"].includes(channel)) throw new Error("Choose candle, trades or both.");
const targets = channel === "both" ? ["candle", "trades"] : [channel];
const result = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { MarketService } from "./lib/market/service";
import { useChartStore } from "./stores/useChartStore";
import { createSiteSession, siteAccessConfig, SITE_COOKIE } from "./lib/server/siteAccess";
const settings=siteAccessConfig();if(!settings)throw new Error("Load the local private server environment before running this verifier.");
const nativeFetch=globalThis.fetch, NativeSocket=globalThis.WebSocket, sockets:any[]=[], deliveries:any[]=[];
const counters:any[]=[],clientCloses:number[]=[],historyRequests:any[]=[];let suppress=false,dropped=0,armedAt=0;
const targets=${JSON.stringify(targets)};
class ObservedSocket extends NativeSocket {
  index:number;
  constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.index=sockets.length;sockets.push(this);counters.push({candle:0,trades:0,allMids:0,pong:0});
    this.addEventListener("message",event=>{let message:any;try{message=JSON.parse(String(event.data));}catch{return;}
      if(Object.hasOwn(counters[this.index],message.channel))counters[this.index][message.channel]++;
      if(suppress&&this.index===0&&targets.includes(message.channel)){dropped++;event.stopImmediatePropagation();}
    });
  }
  close(code?:number,reason?:string){clientCloses[this.index]??=Date.now();return super.close(code,reason);}
}
const memory=()=>{const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};};
Object.assign(globalThis,{WebSocket:ObservedSocket,localStorage:memory(),sessionStorage:memory()});
const cookie=SITE_COOKIE+"="+createSiteSession(settings);
globalThis.fetch=(async(input:any,init:any)=>{
  const url=String(input);if(url.startsWith("/api/market"))return Response.json([]);
  const headers=new Headers(init?.headers);if(url.startsWith("/"))headers.set("cookie",cookie);
  const at=Date.now(),response=await nativeFetch(url.startsWith("/")?"http://localhost:3000"+url:url,{...init,headers});
  if(url.includes("kind=candles")){const body=await response.clone().json().catch(()=>({}));historyRequests.push({at,completedAt:Date.now(),status:response.status,rows:Array.isArray(body.candles)?body.candles.length:0});}
  return response;
}) as typeof fetch;
async function until(predicate:()=>boolean,timeout:number){const deadline=Date.now()+timeout;while(!predicate()){if(Date.now()>deadline)throw new Error("Public channel verification timed out");await new Promise(resolve=>setTimeout(resolve,100));}}
const service=new MarketService();
try{
  useChartStore.getState().set({symbol:"HL:BTC",timeframe:"1m"});service.start(["HL:BTC"],"auto");
  service.subscribe("HL:BTC","1m",bar=>deliveries.push({kind:"candle",at:Date.now(),time:bar.time,close:bar.close}));
  service.onTick(tick=>deliveries.push({kind:"trades",at:Date.now(),time:tick.time,price:tick.price}));
  await service.history("HL:BTC","1m",6);
  await until(()=>counters[0]?.candle>=2&&counters[0]?.trades>=2&&deliveries.some(row=>row.kind==="candle")&&deliveries.some(row=>row.kind==="trades"),30000);
  const before={...counters[0]},deliveredBefore=deliveries.length;armedAt=Date.now();suppress=true;
  console.log("Suppressing only "+${JSON.stringify(channel)}+" deliveries to this isolated client; unrelated real streams remain enabled.");
  await until(()=>sockets.length>=2&&counters[1]?.candle>0&&counters[1]?.trades>0&&targets.every(kind=>deliveries.slice(deliveredBefore).some(row=>row.kind===kind&&row.at>armedAt+20000)),90000);
  assert(dropped>0);assert(counters[0].allMids>before.allMids,"Unrelated traffic did not remain active");
  assert(sockets[0].readyState!==NativeSocket.OPEN,"The selectively broken socket was not replaced");
  assert(clientCloses[0]>=armedAt,"No client-initiated recovery was observed");
  const quietChecks=historyRequests.filter(row=>row.at>=armedAt&&row.completedAt<=clientCloses[0]);
  if(${JSON.stringify(channel)}==="both")assert(quietChecks.some(row=>row.status===200&&row.rows>0),"No successful REST evidence preceded the client reconnect");
  const restored=targets.map(kind=>deliveries.filter(row=>row.kind===kind&&row.at>armedAt+20000).at(-1));
  const after=restored.reduce((a,b)=>a.at>b.at?a:b);
  const report={source:"Actual public Hyperliquid BTC socket and private local history API",suppressedChannel:${JSON.stringify(channel)},verifiedAt:new Date().toISOString(),droppedMessages:dropped,
    sockets:sockets.length,replacementDelayMs:after.at-armedAt,unrelatedMidsDuringSuppression:counters[0].allMids-before.allMids,
    oldSocket:counters[0],replacementSocket:counters[1],clientInitiatedCloseAt:clientCloses[0],quietRESTChecks:quietChecks,restoredDelivery:after,restoredChannels:restored,liveCandleRecovery:useChartStore.getState().candleRecoveries["HL:BTC:1m"]??null};
  await writeFile("artifacts/channel-health-${channel}-live.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{service.stop();for(const socket of sockets)socket.close();}
` }, bundle: true, write: false, platform: "node", format: "esm", target: "node24", tsconfig: "tsconfig.json", external: ["node:*"] });
const output = new URL(`../artifacts/channel-health-${channel}-runner.mjs`, import.meta.url);
await writeFile(output, result.outputFiles[0].contents);
await import(output.href);
