import { describe, expect, it } from "vitest";
import { DomTrades } from "@/lib/orderflow/domTrades";
import type { Tick } from "@/types/trading";
const tick = (id:string,patch:Partial<Tick>={}):Tick => ({id,symbol:"KRK:BTC/USD",price:100,quantity:2,side:"buy",time:10000,simulated:false,...patch});
describe("DOM panel-session executions",()=>{
  it("keeps bought/sold/delta separate from waiting liquidity and rebins retained raw prices",()=>{
    const model=new DomTrades("KRK:BTC/USD",9000);
    model.add(tick("a",{price:100.1,quantity:2}),10000);
    model.add(tick("b",{price:100.2,quantity:3,side:"sell"}),10000);
    expect(model.rows(1,"base",10000).get(100)).toMatchObject({bought:2,sold:3,volume:5,delta:-1});
    const precise=model.rows(.1,"base",10000);
    expect(precise.get(100.1)?.bought).toBe(2);expect(precise.get(100.2)?.sold).toBe(3);
    expect(model.rows(1,"quote",10000).get(100)?.bought).toBeCloseTo(200.2);
    expect(model.rows(1,"quote",10000).get(100)?.sold).toBeCloseTo(300.6);
  });
  it("excludes old, other-source, simulated and invalid observations and never imports retained history",()=>{
    const model=new DomTrades("KRK:BTC/USD",10000);
    for(const patch of [{time:9999},{symbol:"BTCUSDT"},{simulated:true},{time:11001},{price:NaN},{quantity:0},{side:"unknown" as Tick["side"]}])
      expect(model.add(tick("invalid",patch),10000)).toBe(false);
    expect(model.observations).toBe(0);expect(model.rows(1,"base",10000).size).toBe(0);
    expect(model.add(tick("valid"),10000)).toBe(true);
  });
  it("deduplicates reconnect deliveries, snapshots inputs, and fails closed on conflicting IDs",()=>{
    const model=new DomTrades("KRK:BTC/USD",9000), input=tick("a");
    model.add(input,10000);input.quantity=999;
    expect(model.add(tick("a"),10000)).toBe(false);expect(model.observations).toBe(1);
    expect(model.rows(1,"base",10000).get(100)?.bought).toBe(2);
    model.add(tick("a",{quantity:3}),10000);expect(model.error).toMatch(/Conflicting/);
    expect(model.rows(1,"base",10000).size).toBe(0);
    model.reset(11000);expect(model.error).toBe("");expect(model.observations).toBe(0);
    expect(model.add(tick("old"),11000)).toBe(false);
    expect(model.add(tick("a",{time:11000}),11000)).toBe(true);
  });
  it("uses ordered newest execution for Last, expires after five seconds and preserves totals",()=>{
    const model=new DomTrades("KRK:BTC/USD",9000);
    model.add(tick("new",{time:11000,seq:2,quantity:3,side:"sell"}),11000);
    model.add(tick("old",{time:10000,quantity:2}),11000);
    expect(model.rows(1,"base",15999).get(100)).toMatchObject({last:3,lastSide:"sell",bought:2,sold:3});
    expect(model.rows(1,"base",16000).get(100)).toMatchObject({last:null,bought:2,sold:3});
    model.add(tick("equal",{time:11000,seq:3,quantity:4}),11000);
    expect(model.rows(1,"quote",11000).get(100)).toMatchObject({last:400,bought:600,sold:300});
    model.reset(11000);
    model.add(tick("next",{time:11000,quantity:1}),11000);
    expect(model.rows(1,"base",11000).get(100)).toMatchObject({last:1,bought:1,sold:0});
  });
  it("bounds session memory explicitly instead of silently truncating totals",()=>{
    const model=new DomTrades("KRK:BTC/USD",9000,{ids:2,prices:2});
    model.add(tick("a"),10000);model.add(tick("b"),10000);
    expect(model.add(tick("a"),10000)).toBe(false);expect(model.error).toBe("");
    model.add(tick("c"),10000);expect(model.error).toMatch(/capacity/);expect(model.rows(1,"base",10000).size).toBe(0);
    const prices=new DomTrades("KRK:BTC/USD",9000,{ids:10,prices:1});
    prices.add(tick("a"),10000);prices.add(tick("b",{price:101}),10000);expect(prices.error).toMatch(/capacity/);
  });
});
