import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDrawing } from "@luxalgo/vela";
import { drawingCondition,drawingFingerprint,drawingGeometry } from "@/lib/alerts/drawing";
import type { AlertRule } from "@/types/alerts";
import type { DrawingAlertCondition } from "@/types/drawingAlerts";
let dir="";
const now=1_800_000_000_000,minute=60000;
const condition=():DrawingAlertCondition=>({type:"drawing",geometry:drawingGeometry(createDrawing("fibretracement",{id:"fib-1",paneId:"price",anchors:[{time:now-minute,price:100},{time:now,price:200}]})!.serialize())!,target:{type:"level",ratio:0.5},operator:"crossing"});
const rule=(c=condition(),patch:Partial<AlertRule>={}):AlertRule=>({id:"drawing-server",name:"Drawing server",kind:"drawing",status:"active",scope:{type:"symbol",symbol:"HL:xyz:XYZ100",timeframe:"1m"},condition:{op:"leaf",leaf:c},trigger:"every_time",frequency:"tick",repeat:true,cooldownMs:0,sound:false,browserNotification:false,serverSide:true,createdAt:now,...patch});
const quote=(price:number)=>({price,previous:price,changePercent:0,volume:1,high:price,low:price});
const source=(price:number)=>({bars:async()=>[],quotes:async()=>({"HL:xyz:XYZ100":quote(price)})});
beforeEach(async()=>{dir=await mkdtemp(path.join(tmpdir(),"affentrader-drawing-"));process.env.AFFENTRADER_DATA=dir;vi.resetModules();});
afterEach(async()=>{delete process.env.AFFENTRADER_DATA;await rm(dir,{recursive:true,force:true});});
describe("server drawing subscriptions",()=>{
  it("persists logarithmic construction and owner through axis updates and restart without a phantom crossing",async()=>{
    let service=await import("@/lib/server/alertService");const c=condition();c.geometry={...c.geometry,anchors:[{time:now-minute,price:100},{time:now,price:400}],chartCellId:"cell-1",logLevels:true};const r=rule(c);await service.upsertRule(r);
    expect((await service.evaluateRules(source(249),now+1)).fired).toBe(0);expect((await service.evaluateRules(source(251),now+2)).fired).toBe(1);
    const before=(await service.store.read()).rules[0],logarithmic={...c.geometry,logarithmic:true};await service.updateLinkedDrawing(r.id,drawingFingerprint(c.geometry),logarithmic,now+3);
    expect((await service.evaluateRules(source(201),now+4)).fired).toBe(0);expect((await service.store.read()).rules[0].rate).toEqual(before.rate);
    expect((await service.evaluateRules(source(199),now+5)).fired).toBe(1);vi.resetModules();service=await import("@/lib/server/alertService");expect(drawingCondition((await service.store.read()).rules[0])!.geometry).toMatchObject({logarithmic:true,logLevels:true,chartCellId:"cell-1"});
    expect((await service.evaluateRules(source(201),now+6)).fired).toBe(1);await expect(service.updateLinkedDrawing(r.id,drawingFingerprint(logarithmic),{...logarithmic,chartCellId:"cell-2"},now+7)).rejects.toThrow();
  });
  it("preserves actual observed Fib crossing state and counters through a real JSON/module restart",async()=>{
    let service=await import("@/lib/server/alertService");await service.upsertRule(rule());expect((await service.evaluateRules(source(149),now+1)).fired).toBe(0);expect((await service.evaluateRules(source(150),now+2)).fired).toBe(1);expect((await service.evaluateRules(source(151),now+3)).fired).toBe(0);
    vi.resetModules();service=await import("@/lib/server/alertService");expect((await service.evaluateRules(source(151),now+4)).fired).toBe(0);expect((await service.evaluateRules(source(149),now+5)).fired).toBe(1);
    const saved=(await service.store.read()).rules[0];expect(saved.rate?.recent).toHaveLength(2);expect((await service.listEvents()).events.map(event=>event.message)).toEqual([expect.stringContaining("Fib retracement"),expect.stringContaining("Fib retracement")]);
  });
  it("updates only geometry and rebaselines without rearming limits, timing gates or credentials",async()=>{
    const service=await import("@/lib/server/alertService"),r=rule(condition(),{webhook:{url:"https://example.com/hook",secret:"fixture-secret"}});await service.upsertRule(r);await service.evaluateRules(source(149),now+1);await service.evaluateRules(source(150),now+2);
    const before=(await service.store.read()).rules[0],c=drawingCondition(before)!,moved={...c.geometry,anchors:c.geometry.anchors.map(anchor=>({...anchor,price:anchor.price+20}))};
    const saved=await service.updateLinkedDrawing(r.id,drawingFingerprint(c.geometry),moved,now+3);expect(saved.rate).toEqual(before.rate);expect(saved.lastFired).toEqual(before.lastFired);expect(saved.webhook).toEqual(before.webhook);expect(saved.status).toBe(before.status);
    expect((await service.evaluateRules(source(180),now+4)).fired).toBe(0);expect((await service.evaluateRules(source(169),now+5)).fired).toBe(1);expect((await service.evaluateRules(source(170),now+6)).fired).toBe(1);
    await expect(service.updateLinkedDrawing(r.id,drawingFingerprint(c.geometry),c.geometry,now+7)).rejects.toThrow(/changed/);
  });
  it("rejects stale in-flight evaluation after the linked drawing changes",async()=>{
    const service=await import("@/lib/server/alertService"),r=rule();await service.upsertRule(r);await service.evaluateRules(source(149),now+1);const c=drawingCondition(r)!;
    const inFlight={bars:async()=>[],quotes:async()=>{await service.updateLinkedDrawing(r.id,drawingFingerprint(c.geometry),{...c.geometry,anchors:c.geometry.anchors.map(anchor=>({...anchor,price:anchor.price+20}))},now+2);return {"HL:xyz:XYZ100":quote(151)};}};
    expect((await service.evaluateRules(inFlight,now+3)).fired).toBe(0);expect((await service.evaluateRules(source(169),now+4)).fired).toBe(0);expect((await service.evaluateRules(source(170),now+5)).fired).toBe(1);
  });
  it("stops a removed drawing and requires repair plus an explicit restart",async()=>{
    const service=await import("@/lib/server/alertService"),r=rule();await service.upsertRule(r);await service.evaluateRules(source(149),now+1);const c=drawingCondition(r)!;
    expect((await service.updateLinkedDrawing(r.id,drawingFingerprint(c.geometry),null,now+2)).status).toBe("stopped");expect((await service.evaluateRules(source(151),now+3)).fired).toBe(0);await expect(service.controlRule(r.id,"restart",now+4)).rejects.toThrow(/removed/);
    await expect(service.updateLinkedDrawing(r.id,drawingFingerprint(c.geometry),c.geometry,now+5)).rejects.toThrow(/changed/);
    const repaired=await service.updateLinkedDrawing(r.id,"missing",c.geometry,now+5);expect(repaired.status).toBe("stopped");expect(repaired.drawingIssue).toBeUndefined();await service.controlRule(r.id,"restart",now+6);expect((await service.evaluateRules(source(149),now+7)).fired).toBe(0);expect((await service.evaluateRules(source(150),now+8)).fired).toBe(1);
  });
  it("requires authentication and compare-and-swap for narrow geometry API patches",async()=>{
    const service=await import("@/lib/server/alertService"),r=rule();await service.upsertRule(r);const c=drawingCondition(r)!,{accessKey}=await import("@/lib/server/security"),key=await accessKey(),{NextRequest}=await import("next/server"),{PATCH}=await import("@/app/api/alerts/route");
    const request=(drawing:unknown,expected=drawingFingerprint(c.geometry),authorized=true)=>new NextRequest("http://localhost/api/alerts",{method:"PATCH",headers:{"content-type":"application/json",...(authorized?{"x-affentrader-key":key}:{})},body:JSON.stringify({id:r.id,expected,drawing})});
    expect((await PATCH(request(c.geometry,undefined,false))).status).toBe(401);expect((await PATCH(request({...c.geometry,id:"other"}))).status).toBe(400);expect((await PATCH(request({...c.geometry,anchors:c.geometry.anchors.map(anchor=>({...anchor,price:anchor.price+10}))}))).status).toBe(200);expect((await PATCH(request(c.geometry))).status).toBe(400);expect((await PATCH(request({anchors:[]}))).status).toBe(400);
  });
  it("persists intrabar native VWAP samples together with their observed prices",async()=>{
    let service=await import("@/lib/server/alertService");const geometry=drawingGeometry(createDrawing("anchoredvwap",{id:"vwap",paneId:"price",anchors:[{time:now-2*minute,price:100}]})!.serialize())!,r=rule({type:"drawing",geometry,target:{type:"level",series:"mid"},operator:"crossing"});await service.upsertRule(r);
    const data=Array.from({length:3},(_,i)=>({time:now-(2-i)*minute,open:100+i*10,high:110+i*10,low:90+i*10,close:100+i*10,volume:i+1})),market={bars:async()=>structuredClone(data),quotes:async()=>({"HL:xyz:XYZ100":quote(128)})};await service.evaluateRules(market,now+1);
    vi.resetModules();service=await import("@/lib/server/alertService");data[2]={...data[2],high:400,low:120,close:400,volume:100};const result=await service.evaluateRules({...market,quotes:async()=>({"HL:xyz:XYZ100":quote(200)})},now+2);expect(result.fired).toBe(1);expect((await service.store.read()).edges[`${r.id}:HL:xyz:XYZ100`].drawing?.price).toBe(200);
  });
});
