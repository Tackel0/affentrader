import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import type {AlertRule} from "@/types/alerts";
import {yearAfter} from "@/lib/alerts/lifecycle";
const OLD=Date.UTC(2024,0,10,12),BOUNDARY=yearAfter(OLD),NOW=Date.UTC(2026,0,10,12);
let directory="";
const rule=(patch:Partial<AlertRule>={}):AlertRule=>({id:"lifecycle",name:"Server lifecycle",kind:"technical",status:"active",scope:{type:"symbol",symbol:"BTCUSDT",timeframe:"1m"},condition:{op:"leaf",leaf:{type:"compare",left:{type:"quote",field:"price"},comparator:">",right:{type:"number",value:100}}},trigger:"every_time",frequency:"tick",repeat:true,cooldownMs:0,sound:false,browserNotification:false,serverSide:true,createdAt:OLD,activity:{trackedAt:OLD},...patch});
const source=(price:number)=>({bars:async()=>[],quotes:async()=>({BTCUSDT:{price,previous:price,changePercent:0,volume:1,high:price,low:price}})});
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),"affentrader-lifecycle-"));vi.stubEnv("AFFENTRADER_DATA",directory);vi.resetModules();vi.useFakeTimers();vi.setSystemTime(NOW);});
afterEach(async()=>{vi.useRealTimers();vi.unstubAllEnvs();if(!directory.startsWith(path.join(tmpdir(),"affentrader-lifecycle-")))throw new Error("Unexpected test data path");await rm(directory,{recursive:true,force:true});});
describe("durable server inactivity expiration",()=>{
  it("expires without a market request and persists its reason across a cold restart",async()=>{
    let service=await import("@/lib/server/alertService");await service.store.update(db=>{db.rules=[rule(),rule({id:"paused",status:"paused"}),rule({id:"finished",status:"triggered"})];});
    const quotes=vi.fn(async()=>{throw new Error("No feed");});expect((await service.evaluateRules({bars:async()=>[],quotes},NOW)).fired).toBe(0);expect(quotes).not.toHaveBeenCalled();
    vi.resetModules();service=await import("@/lib/server/alertService");const db=await service.store.read();expect(db.rules.map(r=>r.status)).toEqual(["expired","expired","triggered"]);expect(db.rules[0].expiration).toEqual({reason:"inactivity",time:NOW});expect(db.events).toEqual([]);
  });
  it("gives legacy activity a one-year grace while retaining scheduled expiration",async()=>{
    const service=await import("@/lib/server/alertService");await service.store.update(db=>{db.rules=[rule({activity:undefined}),rule({id:"deadline",activity:undefined,expiresAt:NOW})];});await service.expireRules(NOW);
    let db=await service.store.read();expect(db.rules[0]).toMatchObject({createdAt:OLD,status:"active",activity:{trackedAt:NOW}});expect(db.rules[0].activity!.editedAt).toBeUndefined();expect(db.rules[1].expiration?.reason).toBe("date");
    await service.expireRules(yearAfter(NOW));expect((await service.store.read()).rules[0].status).toBe("active");await service.expireRules(yearAfter(NOW)+1);db=await service.store.read();expect(db.rules[0].expiration?.reason).toBe("inactivity");
  });
  it("renews a saved human edit using server time and retains creation/trigger activity",async()=>{
    const service=await import("@/lib/server/alertService");await service.store.update(db=>{db.rules=[rule({status:"expired",activity:{trackedAt:OLD,triggeredAt:OLD+1000},expiration:{reason:"inactivity",time:NOW-1}})];});
    const saved=await service.upsertRule(rule({name:"Renewed",createdAt:NOW,activity:{trackedAt:0,editedAt:0,triggeredAt:0}}));expect(saved).toMatchObject({createdAt:OLD,status:"active",activity:{trackedAt:OLD,editedAt:NOW,triggeredAt:OLD+1000}});expect(saved.expiration).toBeUndefined();await service.expireRules(NOW+1000);expect((await service.store.read()).rules[0].status).toBe("active");
    await expect(service.controlRule(saved.id,"pause",NOW+1001)).resolves.toMatchObject({activity:{editedAt:NOW}});
  });
  it("renews only on an accepted trigger and retains the receipt clock independently of event history",async()=>{
    const service=await import("@/lib/server/alertService");await service.store.update(db=>{db.rules=[rule({activity:{trackedAt:NOW}})];});expect((await service.evaluateRules(source(90),NOW)).fired).toBe(0);expect((await service.store.read()).rules[0].activity).toEqual({trackedAt:NOW});
    vi.setSystemTime(NOW+1000);expect((await service.evaluateRules(source(110),NOW+1000)).fired).toBe(1);const saved=(await service.store.read()).rules[0];expect(saved.activity).toEqual({trackedAt:NOW,triggeredAt:NOW+1000});expect(saved.activity!.editedAt).toBeUndefined();
    await service.controlRule(saved.id,"restart",NOW+1001);expect((await service.store.read()).rules[0].lastTriggeredAt).toBeUndefined();expect((await service.store.read()).rules[0].activity!.triggeredAt).toBe(NOW+1000);
  });
  it("rejects a valid firing plan when inactivity expires while its quote request is in flight",async()=>{
    const service=await import("@/lib/server/alertService");vi.setSystemTime(BOUNDARY-1);await service.store.update(db=>{db.rules=[rule()];});await service.evaluateRules(source(90),BOUNDARY-1);
    vi.setSystemTime(BOUNDARY);let release!:(value:Awaited<ReturnType<ReturnType<typeof source>["quotes"]>>)=>void,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;}),waiting=service.evaluateRules({bars:async()=>[],quotes:async()=>{started();return new Promise(resolve=>{release=resolve;});}},BOUNDARY);
    await ready;vi.setSystemTime(BOUNDARY+1);release(await source(110).quotes());const result=await waiting,db=await service.store.read();expect(result.fired).toBe(0);expect(db.events).toEqual([]);expect(db.rules[0].expiration).toEqual({reason:"inactivity",time:BOUNDARY+1});
  });
  it("evaluates and records Kraken price alerts through the exchange source", async () => {
    const service = await import("@/lib/server/alertService");
    const symbol = "KRK:BTC/USD";
    let price = 90;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      error: [], result: { "BTC/USD": { c: [String(price)], h: ["0", "120"], l: ["0", "80"], v: ["0", "50"] } },
    }));
    const market = service.exchangeSource(fetcher);
    await service.store.update(db => {
      db.rules = [rule({ scope: { type: "symbol", symbol, timeframe: "1m" }, activity: { trackedAt: NOW } })];
    });
    expect((await service.evaluateRules(market, NOW)).fired).toBe(0);
    price = 110;
    vi.setSystemTime(NOW + 1000);
    expect((await service.evaluateRules(market, NOW + 1000)).fired).toBe(1);
    expect((await service.store.read()).events).toHaveLength(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("api.kraken.com");
  });
});
