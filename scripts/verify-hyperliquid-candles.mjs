import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

// Runs the real MarketService against public feeds with isolated, in-memory
// persistence. It cannot read or change the browser's watchlists or accounts.
const result = await build({
  stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
    import assert from "node:assert/strict";
    import {writeFile} from "node:fs/promises";
    import {MarketService} from "./lib/market/service";
    import {useChartStore} from "./stores/useChartStore";
    const originalFetch=globalThis.fetch, NativeSocket=globalThis.WebSocket;
    const sockets:WebSocket[]=[], rawCandles:any[]=[], observed:any[]=[], ticks:any[]=[];
    class ProbeSocket extends NativeSocket {
      constructor(url:string|URL,protocols?:string|string[]){
        super(url,protocols);sockets.push(this);
        this.addEventListener("message",event=>{
          try{const message=JSON.parse(String(event.data));if(message.channel==="candle"){
            for(const row of Array.isArray(message.data)?message.data:[message.data])rawCandles.push(row);
          }}catch{}
        });
      }
    }
    const memory=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)};};
    Object.assign(globalThis,{WebSocket:ProbeSocket,localStorage:memory(),sessionStorage:memory()});
    globalThis.fetch=((url:any,options:any)=>{
      if(String(url).startsWith("/api/market"))return Promise.resolve(new Response("[]",{headers:{"content-type":"application/json"}}));
      return originalFetch(String(url).startsWith("/")?"http://localhost:3000"+url:url,options);
    }) as typeof fetch;
    async function until(check:()=>boolean,timeout=18000){const end=Date.now()+timeout;while(!check()){if(Date.now()>end)throw new Error("Public feed verification timed out");await new Promise(resolve=>setTimeout(resolve,100));}}
    const service=new MarketService();
    try{
      useChartStore.getState().set({symbol:"HL:BTC",timeframe:"5m"});
      service.start(["HL:BTC"],"auto");
      service.onTick(tick=>ticks.push(tick));
      const off=service.subscribe("HL:BTC","5m",bar=>observed.push({...bar}));
      const history=await service.history("HL:BTC","5m",10);
      assert(history.length>0,"No actual history returned");
      await until(()=>observed.length>=3);
      const before={...observed.at(-1)},firstSocket=sockets.at(-1)!;
      firstSocket.close();
      await until(()=>sockets.length>=2&&sockets.at(-1)!.readyState===NativeSocket.OPEN);
      const afterConnection=observed.length;
      await until(()=>observed.length>afterConnection);
      const after={...observed.at(-1)};
      assert(after.time>=before.time,"Reconnect moved the chart backwards");
      if(after.time===before.time)assert(after.volume>=before.volume,"Reconnect shrank cumulative volume");
      assert(ticks.length>0&&ticks.every(tick=>!tick.simulated),"Public trade stream was unavailable or simulated");
      assert(observed.every(bar=>rawCandles.some(row=>Number(row.t)===bar.time&&Number(row.o)===bar.open&&Number(row.h)===bar.high&&Number(row.l)===bar.low&&Number(row.c)===bar.close&&Number(row.v)===bar.volume)),"A callback did not match a native cumulative snapshot");
      const proof={source:"Hyperliquid public WebSocket + local public history proxy",symbol:"HL:BTC",timeframe:"5m",verifiedAt:new Date().toISOString(),historyBars:history.length,socketConnections:sockets.length,rawCandleMessages:rawCandles.length,chartCallbacks:observed.length,publicTrades:ticks.length,simulationTicks:0,beforeReconnect:before,afterReconnect:after,allCallbacksMatchNativeSnapshots:true};
      await writeFile("artifacts/native-candles-live.json",JSON.stringify(proof,null,2));
      console.log(JSON.stringify(proof,null,2));off();
    }finally{service.stop();for(const socket of sockets)socket.close();}
  ` },
  bundle: true, write: false, platform: "node", format: "esm", target: "node24",
  tsconfig: "tsconfig.json", external: ["node:*"],
});
const output = new URL("../artifacts/native-candles-live-runner.mjs", import.meta.url);
await writeFile(output, result.outputFiles[0].contents);
await import(output.href);
