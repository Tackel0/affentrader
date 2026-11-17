import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {Quote,Tick} from "@/types/trading";

const anchor=Date.UTC(2026,9,26,12);
const quote=(symbol:string,price:number):Quote=>({symbol,price,previous:price,change:0,changePercent:0,high:price,low:price,volume:0,history:[price],time:anchor,simulated:false});
const session=new Map<string,string>();
let services:{stop:()=>void}[]=[];
beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers();vi.setSystemTime(anchor);session.clear();
  const local=new Map<string,string>();
  vi.stubGlobal("localStorage",{getItem:(key:string)=>local.get(key)??null,setItem:(key:string,value:string)=>local.set(key,value),removeItem:(key:string)=>local.delete(key)});
  vi.stubGlobal("sessionStorage",{getItem:(key:string)=>session.get(key)??null,setItem:(key:string,value:string)=>session.set(key,value)});
  vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("Offline");}));
  class Socket {static OPEN=1;readyState=0;onopen=null;onmessage=null;onerror=null;onclose=null;send(){}close(){this.readyState=3;}}
  vi.stubGlobal("WebSocket",Object.assign(vi.fn(function(){return new Socket();}),{OPEN:1}));
});
afterEach(()=>{for(const service of services)service.stop();services=[];vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules();});
async function setup(){const {MarketService}=await import("@/lib/market/service"),{useChartStore}=await import("@/stores/useChartStore");const service=new MarketService();services.push(service);return{service,store:useChartStore};}

describe("explicit multi-provider simulation",()=>{
  it("creates labeled synthetic ticks and quote-only updates for every provider without network access",async()=>{
    const {service,store}=await setup(),ticks:Tick[]=[],quotes:Quote[]=[];
    store.getState().set({symbol:"HL:BTC",timeframe:"5m",quotes:{"HL:BTC":quote("HL:BTC",80000),"YF:AAPL":quote("YF:AAPL",200),"YF:EURUSD=X":quote("YF:EURUSD=X",1.1)}});
    service.onTick(t=>ticks.push(t));service.onQuote(q=>quotes.push(q));
    service.start(["BTCUSDT","HL:BTC","YF:AAPL"],"simulation",["YF:EURUSD=X","HL:ETH"]);
    expect(store.getState().quotes).toEqual({});expect(store.getState().orderBook).toBeNull();
    await vi.advanceTimersByTimeAsync(700);
    expect(new Set(ticks.map(t=>t.symbol))).toEqual(new Set(["BTCUSDT","HL:BTC","YF:AAPL"]));
    expect(new Set(quotes.map(q=>q.symbol))).toEqual(new Set(["BTCUSDT","HL:BTC","YF:AAPL","YF:EURUSD=X","HL:ETH"]));
    expect(ticks.every(t=>t.simulated)).toBe(true);expect(quotes.every(q=>q.simulated&&q.metrics?.range.period==="simulation")).toBe(true);
    expect(store.getState().quotes["HL:BTC"].price).toBeGreaterThan(79000);expect(store.getState().quotes["YF:AAPL"].price).toBeGreaterThan(199);
    expect(fetch).not.toHaveBeenCalled();expect(WebSocket).not.toHaveBeenCalled();
  });
  it.each(["HL:BTC","YF:AAPL"])("provides finite seeded time and tick histories for %s and retains the synthetic source",async symbol=>{
    const {service,store}=await setup();store.getState().set({symbol,timeframe:"5m",quotes:{[symbol]:quote(symbol,500)}});service.start([symbol],"simulation");
    for(const interval of ["1s","5m","4h","1D","100T"]){
      const bars=await service.history(symbol,interval,20),detached=await service.fetchBars(symbol,interval,20);
      expect(bars).toHaveLength(20);expect(detached).toHaveLength(20);expect(store.getState().dataSources[`${symbol}:${interval}`]).toBe("simulation");
      for(const bar of [...bars,...detached]){expect(Object.values(bar).every(Number.isFinite)).toBe(true);expect(bar.low).toBeGreaterThan(0);expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open,bar.close));}
      expect(bars.at(-1)!.close).toBeCloseTo(500,6);expect(detached.at(-1)!.close).toBeCloseTo(500,6);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains a tab's last synthetic anchor across reloads without calling it a market price",async()=>{
    const {service,store}=await setup();store.getState().set({symbol:"HL:BTC",quotes:{"HL:BTC":quote("HL:BTC",80000)}});service.start(["HL:BTC"],"simulation");service.stop();store.getState().set({quotes:{}});
    const {service:reloaded}=await setup();reloaded.start(["HL:BTC"],"simulation");expect((await reloaded.history("HL:BTC","5m",20)).at(-1)!.close).toBeCloseTo(80000);await vi.advanceTimersByTimeAsync(700);expect(store.getState().quotes["HL:BTC"].simulated).toBe(true);expect(store.getState().quotes["HL:BTC"].price).toBeGreaterThan(79000);
  });
  it("rejects late real observations during explicit simulation",async()=>{
    const {service,store}=await setup();service.start(["HL:BTC"],"simulation");await vi.advanceTimersByTimeAsync(700);const snapshot=store.getState().quotes["HL:BTC"],ticks:Tick[]=[];service.onTick(t=>ticks.push(t));
    const internals=service as unknown as {accept:(t:Tick)=>void;quote:(symbol:string,price:number,open:number,high:number,low:number,volume:number,simulated:boolean)=>void};
    internals.accept({symbol:"HL:BTC",id:"late",time:anchor+700,price:80000,quantity:1,side:"buy",simulated:false});internals.quote("HL:BTC",80000,80000,80000,80000,1,false);
    expect(store.getState().quotes["HL:BTC"]).toBe(snapshot);expect(ticks).toHaveLength(0);
  });
  it("keeps automatic Hyperliquid and Yahoo failures unavailable instead of synthesizing a feed",async()=>{
    const {service,store}=await setup(),ticks:Tick[]=[];store.getState().set({symbol:"HL:BTC",timeframe:"5m"});service.onTick(t=>ticks.push(t));service.start(["HL:BTC","YF:AAPL"],"auto");
    await vi.advanceTimersByTimeAsync(20000);expect(ticks).toHaveLength(0);expect(store.getState().quotes).toEqual({});expect(store.getState().feedStatus).not.toBe("simulation");
    for(const symbol of ["HL:BTC","YF:AAPL"]){expect(await service.history(symbol,"5m",20)).toEqual([]);expect(await service.history(symbol,"100T",20)).toEqual([]);expect(store.getState().dataSources[`${symbol}:5m`]).not.toBe("simulation");}
  });
});
