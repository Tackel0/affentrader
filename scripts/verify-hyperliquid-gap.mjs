import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
const prefix = process.argv[2] ?? "candle-recovery";
if (!/^[a-z0-9-]{1,64}$/.test(prefix)) throw new Error("Use a simple lowercase artifact prefix.");

const result = await build({
  stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
    import assert from "node:assert/strict";
    import {writeFile} from "node:fs/promises";
    import {MarketService} from "./lib/market/service";
    import {useChartStore} from "./stores/useChartStore";
    const originalFetch=globalThis.fetch, NativeSocket=globalThis.WebSocket;
    const sockets:WebSocket[]=[], observed:any[]=[], closes:any[]=[], sourceBars:any[]=[], transitions:any[]=[];
    let dropUntil=0,dropped=0;
    class ProbeSocket extends NativeSocket {
      constructor(url:string|URL,protocols?:string|string[]){
        super(url,protocols);sockets.push(this);
        this.addEventListener("message",event=>{
          try{const message=JSON.parse(String(event.data));if(message.channel==="candle")sourceBars.push(...(Array.isArray(message.data)?message.data:[message.data]));}catch{}
          if(Date.now()<dropUntil){dropped++;event.stopImmediatePropagation();}
        });
      }
    }
    const memory=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)};};
    Object.assign(globalThis,{WebSocket:ProbeSocket,localStorage:memory(),sessionStorage:memory()});
    globalThis.fetch=(async(url:any,options:any)=>{
      if(String(url).startsWith("/api/market"))return new Response("[]",{headers:{"content-type":"application/json"}});
      const response=await originalFetch(String(url).startsWith("/")?"http://localhost:3000"+url:url,options);
      if(String(url).includes("kind=candles")){try{const body=await response.clone().json();sourceBars.push(...(body.candles??[]));}catch{}}
      return response;
    }) as typeof fetch;
    async function until(check:()=>boolean,timeout=25000){const end=Date.now()+timeout;while(!check()){if(Date.now()>end)throw new Error("Public gap verification timed out");await new Promise(resolve=>setTimeout(resolve,100));}}
    const service=new MarketService(),key="HL:BTC:1m";
    const offState=useChartStore.subscribe((state,previous)=>{if(state.candleRecoveries[key]!==previous.candleRecoveries[key])transitions.push({at:Date.now(),status:state.candleRecoveries[key]?.status??"complete",technicalBars:service.barsFor("HL:BTC","1m").length});});
    try{
      useChartStore.getState().set({symbol:"HL:BTC",timeframe:"1m"});
      service.start(["HL:BTC"],"auto");
      const off=service.subscribe("HL:BTC","1m",bar=>observed.push({...bar}));
      service.onClose((symbol,timeframe,bar)=>{if(symbol==="HL:BTC"&&timeframe==="1m")closes.push({...bar});});
      await service.history("HL:BTC","1m",10);await until(()=>observed.length>=2);
      const before={...observed.at(-1)},beforeCount=observed.length,beforeCloses=closes.length,pausedAt=Date.now();
      dropUntil=pausedAt+130000;
      console.log("Public BTC/1m probe: suppressing only this isolated client's incoming deliveries for 130 seconds.");
      await until(()=>Date.now()>=dropUntil,140000);
      await until(()=>transitions.some(value=>value.at>=pausedAt&&value.status==="complete")&&observed.at(-1)?.time>before.time,45000);
      const after={...observed.at(-1)},repaired=observed.slice(beforeCount);
      const restored=service.barsFor("HL:BTC","1m").filter(bar=>bar.time>=before.time);
      const missing=[...new Set(restored.filter(bar=>bar.time>before.time&&bar.time<after.time).map(bar=>bar.time))];
      assert(missing.length>=1,"No missed closed candle was restored");
      assert(closes.slice(beforeCloses).every(bar=>bar.time>=after.time),"Recovery replayed a historical close signal");
      assert(transitions.some(value=>value.status==="loading"&&value.technicalBars===0),"Incomplete technical history was exposed");
      assert([...repaired,...restored].every(bar=>sourceBars.some(row=>Number(row.t)===bar.time&&Number(row.o)===bar.open&&Number(row.h)===bar.high&&Number(row.l)===bar.low&&Number(row.c)===bar.close&&Number(row.v)===bar.volume)),"A restored candle did not match actual provider data");
      const proof={source:"Actual Hyperliquid candles and HTTP history; isolated client delivery suppression",verifiedAt:new Date().toISOString(),symbol:"HL:BTC",timeframe:"1m",suppressionMs:130000,droppedDeliveries:dropped,socketConnections:sockets.length,before,after,restoredClosedCandleTimes:missing,repairCallbacks:repaired.length,historicalCloseSignals:0,allRestoredBarsMatchProvider:true,recoveryTransitions:transitions};
      await writeFile("artifacts/${prefix}-live.json",JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));off();
    }finally{offState();service.stop();for(const socket of sockets)socket.close();}
  ` },
  bundle: true, write: false, platform: "node", format: "esm", target: "node24",
  tsconfig: "tsconfig.json", external: ["node:*"],
});
const output = new URL(`../artifacts/${prefix}-live-runner.mjs`, import.meta.url);
await writeFile(output, result.outputFiles[0].contents);
await import(output.href);
