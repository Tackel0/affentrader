import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import type { AlertRule } from "@/types/alerts";
import type { OHLCV } from "@/types/trading";
import type { PineAlertSnapshot } from "@/types/pineAlerts";

type Service = typeof import("@/lib/server/alertService");
let dir = "", service: Service;
const now = 1_800_000_000_000;
const definition = (source: string): PineAlertSnapshot => ({ source, title: "Saved server script", inputs: {}, libraries: {}, selection: { type: "calls" }, history: 50, chartType: "candles", timezone: "UTC" });
const rule = (source: string, patch: Partial<AlertRule> = {}): AlertRule => ({ id: "pine-server", name: "Saved Pine", kind: "pine", status: "active", scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "1m" }, condition: { op: "leaf", leaf: { type: "pine", snapshot: definition(source) } }, trigger: "every_time", frequency: "tick", repeat: true, cooldownMs: 0, sound: false, browserNotification: false, serverSide: true, createdAt: now, ...patch });
const bars = (): OHLCV[] => Array.from({ length: 50 }, (_, index) => ({ time: now - (49 - index) * 60_000, open: 90, high: 95, low: 85, close: 90, volume: 10 }));
const market = (data: OHLCV[]) => ({ bars: async () => structuredClone(data), quotes: async () => ({}) });
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "affentrader-pine-")); process.env.AFFENTRADER_DATA = dir;
  vi.resetModules(); service = await import("@/lib/server/alertService");
});
afterEach(async () => { service.disposePineAlertRuntimes(); delete process.env.AFFENTRADER_DATA; delete process.env.AFFENTRADER_ALLOW_PRIVATE_WEBHOOKS; await rm(dir, { recursive: true, force: true }); });

describe("saved Pine server subscriptions", () => {
  it.each(["missing","corrupt"])("stops visibly when a referenced journal is %s instead of silently warming new state",async(failure)=>{
    await service.upsertRule(rule('//@version=6\nstrategy("Durable",calc_on_every_tick=true)\nif barstate.isrealtime\n    alert("Live",alert.freq_all)'));const data=bars(),source=market(data);await service.evaluateRules(source,now+1);
    const folder=path.join(dir,"pine-recovery"),files=(await readdir(folder)).filter(file=>/^pine-[a-f\d]{64}\.json(?:\.bak)?$/.test(file));expect(files.length).toBeGreaterThan(0);
    for(const file of files){const target=path.join(folder,file);if(failure==="missing")await rm(target);else await writeFile(target,"{broken");}
    service.disposePineAlertRuntimes();vi.resetModules();service=await import("@/lib/server/alertService");data[49].volume++;
    const result=await service.evaluateRules(source,now+2);expect(result.fired).toBe(0);expect(result.errors.join()).toMatch(/journal is missing or older/);expect((await service.store.read()).rules[0]).toMatchObject({status:"stopped",stop:{reason:"script_error"}});expect((await service.listEvents()).events).toEqual([]);
  });
  it("recovers a live-only position and pending bracket through a genuine module/server restart",async()=>{
    const r=rule('//@version=6\nstrategy("Recovery",calc_on_every_tick=true)\nvarip int updates=0\nif barstate.isrealtime\n    updates+=1\n    if strategy.position_size==0\n        strategy.entry("L",strategy.long,qty=1)\n    else\n        strategy.exit("B_"+str.tostring(updates),"L",limit=120,stop=80,alert_profit="Recovered target")');
    if(r.condition.op!=="leaf"||r.condition.leaf.type!=="pine")throw Error("Fixture");r.condition.leaf.snapshot.selection={type:"orders"};
    await service.upsertRule(r);const data=bars(),source=market(data);await service.evaluateRules(source,now+1);data[49]={...data[49],high:100,close:100,volume:11};await service.evaluateRules(source,now+2);data[49]={...data[49],high:101,close:101,volume:12};expect((await service.evaluateRules(source,now+3)).fired).toBe(1);
    const before=(await service.store.read()).rules[0];expect(before.pineCursors?.BTCUSDT.exchange?.sequence).toBe(3);
    service.disposePineAlertRuntimes();vi.resetModules();service=await import("@/lib/server/alertService");
    data[49]={...data[49],high:121,close:121,volume:13};expect((await service.evaluateRules(source,now+4)).fired).toBe(1);
    const events=(await service.listEvents()).events;expect(events).toHaveLength(2);expect(events[1].strategyFill).toMatchObject({orderId:"B_2",action:"sell",previousPositionSize:1,positionSize:0,alertMessage:"Recovered target"});
    expect((await service.store.read()).rules[0].pineCursors?.BTCUSDT.exchange?.sequence).toBe(4);
  });
  it("restores a pending market after pause/resume without clearing its native position state",async()=>{
    const r=rule('//@version=6\nstrategy("Pending",calc_on_every_tick=true)\nif barstate.isrealtime and strategy.position_size==0\n    strategy.entry("L",strategy.long,qty=1)');
    if(r.condition.op!=="leaf"||r.condition.leaf.type!=="pine")throw Error("Fixture");r.condition.leaf.snapshot.selection={type:"orders"};await service.upsertRule(r);
    const data=bars(),source=market(data);await service.evaluateRules(source,now+1);data[49]={...data[49],high:100,close:100,volume:11};await service.evaluateRules(source,now+2);
    const epoch=(await service.store.read()).rules[0].pineEpoch;await service.controlRule(r.id,"pause",now+3);await service.evaluateRules(source,now+4);await service.controlRule(r.id,"resume",now+5);
    expect((await service.store.read()).rules[0].pineEpoch).toBe(epoch);data[49]={...data[49],high:105,close:105,volume:12};expect((await service.evaluateRules(source,now+6)).fired).toBe(1);expect((await service.listEvents()).events[0].strategyFill).toMatchObject({orderId:"L",price:105});
  });
  it("regenerates an uncommitted fill after failure between journal and firing-state writes",async()=>{
    const r=rule('//@version=6\nstrategy("Write ahead",calc_on_every_tick=true)\nif barstate.isrealtime and strategy.position_size==0\n    strategy.entry("L",strategy.long,qty=1)');
    if(r.condition.op!=="leaf"||r.condition.leaf.type!=="pine")throw Error("Fixture");r.condition.leaf.snapshot.selection={type:"orders"};await service.upsertRule(r);
    const data=bars(),source=market(data);await service.evaluateRules(source,now+1);data[49]={...data[49],high:100,close:100,volume:11};await service.evaluateRules(source,now+2);
    data[49]={...data[49],high:101,close:101,volume:12};const broken=vi.spyOn(service.store,"update").mockRejectedValueOnce(Error("Simulated interrupted firing-state write"));
    await expect(service.evaluateRules(source,now+3)).rejects.toThrow(/interrupted/);broken.mockRestore();expect((await service.listEvents()).events).toHaveLength(0);
    service.disposePineAlertRuntimes();vi.resetModules();service=await import("@/lib/server/alertService");data[49]={...data[49],high:102,close:102,volume:13};
    expect((await service.evaluateRules(source,now+4)).fired).toBe(1);const events=(await service.listEvents()).events;expect(events).toHaveLength(1);expect(events[0]).toMatchObject({time:now+3,price:101,strategyFill:{orderId:"L"}});
    expect((await service.evaluateRules(source,now+5)).fired).toBe(0);
  });
  it("never repeats a committed fill when its journal acknowledgement was interrupted",async()=>{
    const r=rule('//@version=6\nstrategy("Ack",calc_on_every_tick=true)\nif barstate.isrealtime and strategy.position_size==0\n    strategy.entry("L",strategy.long,qty=1)');
    if(r.condition.op!=="leaf"||r.condition.leaf.type!=="pine")throw Error("Fixture");r.condition.leaf.snapshot.selection={type:"orders"};await service.upsertRule(r);
    const data=bars(),source=market(data);await service.evaluateRules(source,now+1);data[49]={...data[49],high:100,close:100,volume:11};await service.evaluateRules(source,now+2);
    const repository=await import("@/lib/server/pineJournalStore"),broken=vi.spyOn(repository,"acknowledgePineJournal").mockRejectedValueOnce(Error("Simulated acknowledgement interruption"));
    data[49]={...data[49],high:101,close:101,volume:12};await expect(service.evaluateRules(source,now+3)).rejects.toThrow(/acknowledgement/);broken.mockRestore();expect((await service.listEvents()).events).toHaveLength(1);
    service.disposePineAlertRuntimes();vi.resetModules();service=await import("@/lib/server/alertService");data[49]={...data[49],high:102,close:102,volume:13};expect((await service.evaluateRules(source,now+4)).fired).toBe(0);expect((await service.listEvents()).events).toHaveLength(1);
  });
  it("can continue in the same process after a failed journal acknowledgement",async()=>{
    await service.upsertRule(rule('//@version=6\nstrategy("Ack retry",calc_on_every_tick=true)\nif barstate.isrealtime\n    alert("Live",alert.freq_all)'));const data=bars(),source=market(data);await service.evaluateRules(source,now+1);
    const repository=await import("@/lib/server/pineJournalStore"),broken=vi.spyOn(repository,"acknowledgePineJournal").mockRejectedValueOnce(Error("Temporary acknowledgement failure"));data[49].volume++;
    await expect(service.evaluateRules(source,now+2)).rejects.toThrow(/Temporary acknowledgement/);broken.mockRestore();data[49].volume++;
    const result=await service.evaluateRules(source,now+3);expect(result.fired).toBe(1);expect(result.errors).toEqual([]);expect((await service.store.read()).rules[0]).toMatchObject({status:"active",pineCursors:{BTCUSDT:{exchange:{sequence:3}}}});expect((await service.listEvents()).events).toHaveLength(2);
  });
  it("commits a recovered one-shot batch only once and preserves its original last-trigger time",async()=>{
    await service.upsertRule(rule('//@version=6\nindicator("One shot")\nif barstate.isrealtime\n    alert("A",alert.freq_all)\n    alert("B",alert.freq_all)',{trigger:"once",repeat:false}));const data=bars(),source=market(data);await service.evaluateRules(source,now+1);data[49].volume++;
    const broken=vi.spyOn(service.store,"update").mockRejectedValueOnce(Error("Interrupted primary write"));await expect(service.evaluateRules(source,now+2)).rejects.toThrow(/Interrupted/);broken.mockRestore();
    service.disposePineAlertRuntimes();vi.resetModules();service=await import("@/lib/server/alertService");data[49].volume++;const result=await service.evaluateRules(source,now+10);expect(result.fired).toBe(1);expect((await service.store.read()).rules[0]).toMatchObject({status:"triggered",lastTriggeredAt:now+2,pineCursors:{BTCUSDT:{exchange:{sequence:3}}}});expect((await service.listEvents()).events).toHaveLength(1);
  });
  it("validates browser-forwarded fills and identifies emulator executions in signed webhook payloads",async()=>{
    const {accessKey}=await import("@/lib/server/security"),{NextRequest}=await import("next/server"),{POST}=await import("@/app/api/alerts/events/route");
    const key=await accessKey(),fill={id:"fill-1",orderId:"L",action:"buy",contracts:1,price:101,comment:"Entry",alertMessage:"Custom",positionSize:1,previousPositionSize:0,leg:"entry"};
    const event={ruleId:"browser",name:"Browser fill",symbol:"HL:xyz:BRENTOIL",timeframe:"1m",time:now,price:101,message:"buy 1",strategyFill:fill,simulated:false};
    const request=(value:unknown)=>new NextRequest("http://localhost/api/alerts/events",{method:"POST",headers:{"content-type":"application/json","x-affentrader-key":key},body:JSON.stringify({event:value,webhook:{url:"http://127.0.0.1:9/hook",secret:"test-secret"}})});
    expect((await POST(request(event))).status).toBe(200);
    expect((await POST(request({...event,strategyFill:{...fill,contracts:-1}}))).status).toBe(400);
    expect((await service.listEvents()).events[0]).toMatchObject({symbol:"HL:xyz:BRENTOIL",strategyFill:fill,simulated:false});
    process.env.AFFENTRADER_ALLOW_PRIVATE_WEBHOOKS="1";let payload:unknown;
    expect(await service.processDeliveries(now,async(_url,init)=>{
      const body=String(init?.body),headers=init?.headers as Record<string,string>;payload=JSON.parse(body);
      expect(headers["x-affentrader-signature"]).toBe(`sha256=${createHmac("sha256","test-secret").update(`${headers["x-affentrader-timestamp"]}.${body}`).digest("hex")}`);
      return new Response("ok");
    })).toBe(1);
    expect(payload).toMatchObject({execution:"strategy_emulator",strategyFill:fill,simulated:false});
  });
  it.each(["orders","calls","both"] as const)("runs actual strategy executions with %s event selection",async(selection)=>{
    const r=rule('//@version=6\nstrategy("Combined",calc_on_every_tick=true)\nif barstate.isrealtime\n    if strategy.position_size==0\n        strategy.entry("L",strategy.long,qty=1,alert_message="Entry custom")\n    else\n        strategy.close_all(immediately=true,alert_message="Exit custom")\n    alert("Dynamic call",alert.freq_all)',{message:"{{strategy.order.action}} {{strategy.order.alert_message}}"});
    if(r.condition.op!=="leaf"||r.condition.leaf.type!=="pine")throw Error("Fixture");r.condition.leaf.snapshot.selection={type:selection};
    await service.upsertRule(r);const data=bars(),source=market(data);expect((await service.evaluateRules(source,now+1)).fired).toBe(0);
    data[49]={...data[49],high:100,close:100,volume:11};expect((await service.evaluateRules(source,now+2)).fired).toBe(selection==="orders"?0:1);
    data[49]={...data[49],high:101,close:101,volume:12};expect((await service.evaluateRules(source,now+3)).fired).toBe(selection==="calls"?1:selection==="orders"?2:3);
    const events=(await service.listEvents()).events,fills=events.filter(event=>event.strategyFill);
    expect(fills).toHaveLength(selection==="calls"?0:2);
    if(selection!=="calls"){
      expect(fills.map(event=>event.message).sort()).toEqual(["BTCUSDT: buy Entry custom","BTCUSDT: sell Exit custom"].sort());
      const stored=(await service.store.read()).rules[0];expect(stored.scriptState?.BTCUSDT.order_fills.token).toBe(fills.at(-1)?.strategyFill?.id);
      expect(stored.rate?.recent).toHaveLength(selection==="orders"?2:4);
    }
    if(selection!=="orders")expect(events.filter(event=>!event.strategyFill).map(event=>event.message)).toEqual(["BTCUSDT: Dynamic call","BTCUSDT: Dynamic call"]);
  });
  it("freezes imported code and inputs, suppresses history and persists named-condition bar gates through restart", async () => {
    const r = rule('//@version=6\nimport User/Threshold/1 as threshold\nindicator("Server frozen")\nlevel=input.float(100,"Level")\nplot(close,"Price")\nalertcondition(threshold.above(close,level),"Above","{{ticker}} {{close}} {{plot_0}}")');
    if (r.condition.op !== "leaf" || r.condition.leaf.type !== "pine") throw Error("Invalid fixture");
    r.trigger = "once_per_bar";
    r.condition.leaf.snapshot.selection = { type: "condition", id: "alertcondition_0" };
    r.condition.leaf.snapshot.inputs = { Level: 100 };
    r.condition.leaf.snapshot.libraries = { "User/Threshold/1": '//@version=6\nlibrary("Threshold")\nexport above(float price,float level)=>price>level' };
    await service.upsertRule(r);
    r.condition.leaf.snapshot.inputs.Level = 200; r.condition.leaf.snapshot.libraries["User/Threshold/1"] = "invalid";
    const data = bars(), source = market(data);
    expect((await service.evaluateRules(source, now + 1)).fired).toBe(0);
    data[49] = { ...data[49], high: 110, close: 110, volume: 11 };
    expect((await service.evaluateRules(source, now + 2)).fired).toBe(1);
    expect((await service.listEvents()).events[0].message).toBe("BTCUSDT: BTCUSDT 110 110");
    service.disposePineAlertRuntimes(); vi.resetModules(); service = await import("@/lib/server/alertService");
    expect((await service.evaluateRules(source, now + 3)).fired).toBe(0);
    data[49].volume++;
    expect((await service.evaluateRules(source, now + 4)).fired).toBe(0);
    data.push({ ...data[49], time: now + 60_000, volume: 1 });
    expect((await service.evaluateRules(source, now + 60_001)).fired).toBe(1);
    expect((await service.store.read()).rules[0].scriptState?.BTCUSDT.alertcondition_0.bar).toBe(now + 60_000);
  });
  it("commits multiple alert calls with script-owned frequency against the latest shared call gate", async () => {
    await service.upsertRule(rule('//@version=6\nindicator("Calls")\nalert("A",alert.freq_once_per_bar)\nalert("B",alert.freq_once_per_bar)\nalert("All",alert.freq_all)'));
    const data = bars(), source = market(data); await service.evaluateRules(source, now + 1);
    data[49].volume++;
    expect((await service.evaluateRules(source, now + 2)).fired).toBe(2);
    data[49].volume++;
    expect((await service.evaluateRules(source, now + 3)).fired).toBe(1);
    expect((await service.listEvents()).events.map(event => event.message).sort()).toEqual(["BTCUSDT: A", "BTCUSDT: All", "BTCUSDT: All"].sort());
  });
  it("stops failing scripts explicitly without publishing a fabricated event", async () => {
    await service.upsertRule(rule('//@version=6\nindicator("Failure")\nif barstate.isrealtime\n    runtime.error("Deliberate script failure")\nalert("Never",alert.freq_all)'));
    const data = bars(), source = market(data); await service.evaluateRules(source, now + 1); data[49].volume++;
    const result = await service.evaluateRules(source, now + 2);
    expect(result.fired).toBe(0); expect(result.errors.join()).toMatch(/Deliberate script failure/);
    expect((await service.store.read()).rules[0]).toMatchObject({ status: "stopped", stop: { reason: "script_error", detail: expect.stringContaining("Deliberate script failure") } });
    expect((await service.listEvents()).events).toHaveLength(0);
  });
  it("keeps watchlist Pine contexts independent and stops excessive calls at exactly 15", async () => {
    await service.upsertRule(rule('//@version=6\nindicator("Calls")\nif close>100\n    alert(syminfo.ticker,alert.freq_all)', { scope: { type: "watchlist", listId: "w", symbols: ["BTCUSDT", "ETHUSDT"], timeframe: "1m" }, expiresAt: now + 1_000_000 }));
    const btc = bars(), eth = bars();
    const source = { bars: async (symbol: string) => structuredClone(symbol === "BTCUSDT" ? btc : eth), quotes: async () => ({}) };
    await service.evaluateRules(source, now + 1);
    for (let index = 1; index <= 15; index++) { btc[49] = { ...btc[49], close: 110, high: 110, volume: 10 + index }; expect((await service.evaluateRules(source, now + index + 1)).fired).toBe(1); }
    expect((await service.store.read()).rules[0]).toMatchObject({ status: "active", rate: { stoppedSymbols: { BTCUSDT: expect.any(Number) } } });
    eth[49] = { ...eth[49], close: 120, high: 120, volume: 11 };
    expect((await service.evaluateRules(source, now + 100)).fired).toBe(1);
    expect((await service.listEvents()).events).toHaveLength(16);
  });
  it("discards a signal when the subscription is paused during secondary-data loading", async () => {
    await service.upsertRule(rule('//@version=6\nindicator("Async")\nref=request.security("ETHUSDT","5",close)\nalert(str.tostring(ref),alert.freq_all)'));
    const data = bars(); let pause = false;
    const source = { bars: async (symbol: string, timeframe: string) => {
      if (symbol === "ETHUSDT" && pause) { pause = false; await service.controlRule("pine-server", "pause", now + 2); }
      return data.map((bar, index) => ({ ...bar, time: now - (49 - index) * (timeframe === "5m" ? 300_000 : 60_000) }));
    }, quotes: async () => ({}) };
    await service.evaluateRules(source, now + 1); pause = true; data[49].volume++;
    expect((await service.evaluateRules(source, now + 2)).fired).toBe(0);
    expect((await service.store.read()).rules[0].status).toBe("paused");
    expect((await service.listEvents()).events).toHaveLength(0);
  });
});
