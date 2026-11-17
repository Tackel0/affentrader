import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

const result = await build({
  stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
    import assert from "node:assert/strict";
    import {writeFile} from "node:fs/promises";
    import {MarketService} from "./lib/market/service";
    import {useChartStore} from "./stores/useChartStore";
    const originalFetch=globalThis.fetch, NativeSocket=globalThis.WebSocket;
    const sockets:WebSocket[]=[], raw=new Map<string,{price:number,time:number}>(), deliveries:Record<string,number>={}, mismatches:any[]=[];
    const symbols=["HL:BTC","HL:ETH","HL:SOL"];
    let metadataChecks=0, quotePublications=0, executionTicks=0, currentChannel="";
    class ProbeSocket extends NativeSocket {
      constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);sockets.push(this);this.addEventListener("message",event=>{
        const message=JSON.parse(String(event.data));currentChannel=message.channel;deliveries[message.channel]=(deliveries[message.channel]??0)+1;
        if(message.channel==="trades")for(const trade of message.data??[]){const symbol="HL:"+trade.coin,old=raw.get(symbol);if(symbols.includes(symbol)&&(!old||trade.time>=old.time))raw.set(symbol,{price:Number(trade.px),time:trade.time});}
      });}
    }
    const memory=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)};};
    Object.assign(globalThis,{WebSocket:ProbeSocket,localStorage:memory(),sessionStorage:memory()});
    globalThis.fetch=((url:any,options:any)=>String(url).startsWith("/api/market")?Promise.resolve(new Response("[]")):originalFetch(String(url).startsWith("/")?"http://localhost:3000"+url:url,options)) as typeof fetch;
    const service=new MarketService();
    const off=useChartStore.subscribe((state,previous)=>{
      if(state.quotes===previous.quotes)return;quotePublications++;
      for(const symbol of symbols){const quote=state.quotes[symbol],old=previous.quotes[symbol],source=raw.get(symbol);if(!quote||quote.priceBasis!=="trade"||!source)continue;
        if(quote.price!==source.price||quote.time!==source.time)mismatches.push({symbol,quote:{price:quote.price,time:quote.time},source});
        if(currentChannel==="allMids"&&old?.priceBasis==="trade"&&quote.price===old.price&&quote.time===old.time){metadataChecks++;if(quote.history!==old.history)mismatches.push({symbol,error:"Metadata appended a price observation"});}
      }
    });
    try{
      service.onTick(()=>executionTicks++);service.start([],"auto",symbols,symbols);
      const end=Date.now()+35000;
      while(!(symbols.every(symbol=>useChartStore.getState().quotes[symbol]?.priceBasis==="trade")&&metadataChecks>3&&(deliveries.allMids??0)>=2)){
        if(Date.now()>end)throw new Error("Public quote verification timed out");await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.deepEqual(mismatches,[]);assert.equal(executionTicks,0);
      const proof={verifiedAt:new Date().toISOString(),source:"Actual public Hyperliquid messages, compared inside isolated MarketService",symbols,deliveries,quotePublications,metadataChecks,executionTicks,mismatches,quotes:Object.fromEntries(symbols.map(symbol=>{const quote=useChartStore.getState().quotes[symbol];return [symbol,{price:quote.price,time:quote.time,priceBasis:quote.priceBasis,referencePrice:quote.referencePrice,historyLength:quote.history.length,source:raw.get(symbol)}];}))};
      await writeFile("artifacts/quote-basis-live.json",JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));
    }finally{off();service.stop();for(const socket of sockets)socket.close();}
  ` },
  bundle: true, write: false, platform: "node", format: "esm", target: "node24",
  tsconfig: "tsconfig.json", external: ["node:*"],
});
const output = new URL("../artifacts/quote-basis-live-runner.mjs", import.meta.url);
await writeFile(output, result.outputFiles[0].contents);
await import(output.href);
