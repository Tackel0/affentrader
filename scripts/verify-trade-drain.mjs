import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
const result = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
  import assert from "node:assert/strict";
  import {writeFile} from "node:fs/promises";
  import {MarketService} from "./lib/market/service";
  import {useChartStore} from "./stores/useChartStore";
  const originalFetch=globalThis.fetch, NativeSocket=globalThis.WebSocket, originalError=console.error;
  const sockets:WebSocket[]=[], rows:Array<{socket:number;row:any}>=[], delivered:any[]=[], candles:any[]=[], failures:any[]=[];
  class ProbeSocket extends NativeSocket {
    constructor(url:string|URL,protocols?:string|string[]){
      super(url,protocols);const index=sockets.length;sockets.push(this);
      this.addEventListener("message",event=>{try{const message=JSON.parse(String(event.data));if(message.channel==="trades"&&Array.isArray(message.data))for(const row of message.data)rows.push({socket:index,row});}catch{}});
    }
  }
  const memory=()=>{const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};};
  Object.assign(globalThis,{WebSocket:ProbeSocket,localStorage:memory(),sessionStorage:memory()});
  globalThis.fetch=(async(url:any,init:any)=>String(url).startsWith("/api/market")?new Response("[]",{headers:{"content-type":"application/json"}}):originalFetch(String(url).startsWith("/")?"http://localhost:3000"+url:url,init)) as typeof fetch;
  console.error=(...args:any[])=>{failures.push(args.map(value=>value instanceof Error?value.message:String(value)));if(!args.some(value=>value instanceof Error&&value.message.startsWith("intentional probe")))originalError(...args);};
  async function until(check:()=>boolean,timeout=30000){const end=Date.now()+timeout;while(!check()){if(Date.now()>end)throw Error("Trade-drain probe timed out");await new Promise(resolve=>setTimeout(resolve,100));}}
  const service=new MarketService();let faulty=true,quoteFaults=0,tradeFaults=0,phase=0,resetAt=0;
  const bar=(value:any)=>candles.push({phase,...value});
  service.onQuote(value=>{if(faulty&&value.priceBasis==="trade"){quoteFaults++;throw Error("intentional probe quote consumer");}});
  service.onTick(()=>{if(faulty){tradeFaults++;throw Error("intentional probe trade consumer");}});
  service.onTick(value=>delivered.push({phase,...value}));
  try{
    useChartStore.getState().set({symbol:"HL:BTC",timeframe:"1m"});
    service.start(["HL:BTC"],"auto");service.subscribe("HL:BTC","1m",bar);
    await service.history("HL:BTC","1m",10);
    await until(()=>delivered.length>=30&&candles.length>=2);
    const firstCount=delivered.length;assert(quoteFaults>0&&tradeFaults>0,"Fault injection did not run");
    faulty=false;
    await until(()=>delivered.length>=firstCount+10);
    let detach=()=>{};
    detach=service.onQuote(value=>{
      if(value.priceBasis!=="trade")return;detach();resetAt=Date.now();phase=1;
      service.stop();service.start(["HL:BTC"],"auto");service.subscribe("HL:BTC","1m",bar);
    });
    await until(()=>phase===1&&delivered.filter(value=>value.phase===1).length>=30&&candles.filter(value=>value.phase===1).length>=2);
    const matches=(tick:any,minimumSocket:number)=>rows.some(({socket,row})=>socket>=minimumSocket&&Number(row.tid)===tick.seq&&Number(row.time)===tick.time&&Number(row.px)===tick.price&&Number(row.sz)===tick.quantity);
    assert(delivered.every(tick=>matches(tick,tick.phase===1?1:0)),"Delivered data did not match actual provider messages");
    const retained=service.tradesFor("HL:BTC");assert(retained.length>0&&retained.every(tick=>matches(tick,1)),"Old generation trades contaminated replacement state");
    assert(service.barsFor("HL:BTC","1m").length>0,"Replacement candle series stayed unavailable");
    assert(!useChartStore.getState().candleRecoveries["HL:BTC:1m"],"Replacement candle recovery did not finish");
    const expected=failures.filter(args=>args.some(value=>value.startsWith("intentional probe")));
    assert.equal(expected.length,2,"A permanently failing consumer flooded the error log");
    assert.equal(failures.length,expected.length,"Unexpected market processing errors occurred");
    const proof={verifiedAt:new Date().toISOString(),source:"Actual public Hyperliquid BTC trades/candles; isolated in-memory MarketService",intentionalConsumerFailures:{quote:quoteFaults,trade:tradeFaults},reportedFailureEpisodes:expected.length,
      deliveredBeforeRestart:delivered.filter(value=>value.phase===0).length,deliveredAfterRestart:delivered.filter(value=>value.phase===1).length,socketConnections:sockets.length,sourceRestartedInsideQuoteCallbackAt:resetAt,
      allDeliveredTicksMatchProvider:true,retainedReplacementTicks:retained.length,allRetainedTicksMatchReplacementMessages:true,replacementCandleCallbacks:candles.filter(value=>value.phase===1).length,
      quote:useChartStore.getState().quotes["HL:BTC"],unexpectedErrors:failures.filter(args=>!args.some(value=>value.startsWith("intentional probe")))};
    await writeFile("artifacts/trade-drain-live.json",JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));
  }finally{service.stop();for(const socket of sockets)socket.close();console.error=originalError;}
` }, bundle: true, write: false, platform: "node", format: "esm", target: "node24", tsconfig: "tsconfig.json", external: ["node:*"] });
const output = new URL("../artifacts/trade-drain-live-runner.mjs", import.meta.url);
await writeFile(output, result.outputFiles[0].contents);
await import(output.href);
