import {afterEach,describe,it,expect,vi} from "vitest";
import {createAccount,type NewOrder} from "@/lib/trading/broker";
import type {BrowserLocks} from "@/lib/browser/coordination";
const KEY="affentrader-paper-v1",order=(patch:Partial<NewOrder>={}):NewOrder=>({symbol:"BTCUSDT",side:"buy",type:"market",quantity:1,...patch});
const settle=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
async function domContextSetup(){
  const {useChartStore}=await import("@/stores/useChartStore");
  useChartStore.setState({symbol:"BTCUSDT",timeframe:"1m",feedMode:"auto",feedEpoch:0,marketEpochs:{},dataSources:{"BTCUSDT:1m":"exchange"},orderBook:{symbol:"BTCUSDT",time:Date.now(),simulated:false,bids:[{price:99,quantity:20}],asks:[{price:101,quantity:20}]}});
  return useChartStore;
}
function environment(){
  const disk=new Map<string,string>([[KEY,JSON.stringify({state:{live:createAccount({feeRate:0,slippageBps:0}),ticket:{side:"buy",type:"limit",quantity:3,reduceOnly:false}}})]]);let quota=false,writes=0;
  const storage={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{if(quota)throw new Error("quota");if(key===KEY)writes++;disk.set(key,value);},removeItem:(key:string)=>disk.delete(key)};
  const tails=new Map<string,Promise<unknown>>();const locks:BrowserLocks={request<T>(name:string,options:{signal?:AbortSignal},callback:()=>Promise<T>){const result=(tails.get(name)??Promise.resolve()).catch(()=>undefined).then(()=>{if(options.signal?.aborted)throw new DOMException("Aborted","AbortError");return callback();});tails.set(name,result);return result;}};
  vi.stubGlobal("navigator",{locks});vi.stubGlobal("localStorage",storage);vi.stubGlobal("sessionStorage",{getItem:()=>null,setItem:()=>{},removeItem:()=>{}});
  return{disk,locks,writes:()=>writes,setQuota:(value:boolean)=>{quota=value;},account:()=>JSON.parse(disk.get(KEY)!).state.live};
}
async function context(){vi.resetModules();const ownership=await import("@/lib/trading/paperOwnership"),{usePaperStore}=await import("@/stores/usePaperStore");return{...ownership,store:usePaperStore};}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.resetModules();});
describe("shared paper account transactions",()=>{
  it("rejects a reviewed DOM order if its chart changes while waiting for account ownership",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);const chart=await domContextSetup();
    const {paperCommands,captureDomOrderContext}=await import("@/lib/trading/paperCommands");let release!:()=>void;
    const held=env.locks.request("affentrader-paper-write-v1",{},()=>new Promise<void>(resolve=>{release=resolve}));await settle();
    const pending=paperCommands.placeDomReviewed({order:order({quantity:3,type:"limit",price:90}),context:captureDomOrderContext(),ladder:true});
    chart.setState({symbol:"ETHUSDT"});release();await held;
    expect(await pending).toBeUndefined();expect(env.account().orders).toHaveLength(0);
  });
  it("freezes the reviewed DOM draft before waiting and revalidates fresh depth inside ownership",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);await domContextSetup();
    const {paperCommands,captureDomOrderContext}=await import("@/lib/trading/paperCommands");let release!:()=>void;
    const held=env.locks.request("affentrader-paper-write-v1",{},()=>new Promise<void>(resolve=>{release=resolve}));await settle();
    const review={order:order({quantity:3,type:"limit",price:90}),context:captureDomOrderContext(),ladder:true};const pending=paperCommands.placeDomReviewed(review);
    review.order.quantity=9;review.context.quantity=9;release();await held;
    expect((await pending)?.order.quantity).toBe(3);expect(env.account().orders[0].quantity).toBe(3);
  });
  it("rejects reviewed DOM placement when depth goes stale during the ownership wait",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);const chart=await domContextSetup();
    const {paperCommands,captureDomOrderContext}=await import("@/lib/trading/paperCommands");let release!:()=>void;
    const held=env.locks.request("affentrader-paper-write-v1",{},()=>new Promise<void>(resolve=>{release=resolve}));await settle();
    const pending=paperCommands.placeDomReviewed({order:order({quantity:3,type:"limit",price:90}),context:captureDomOrderContext(),ladder:true});
    chart.setState(s=>({orderBook:{...s.orderBook!,time:Date.now()-6000}}));release();await held;
    expect(await pending).toBeUndefined();expect(env.account().orders).toHaveLength(0);
  });
  it("reads legacy accounts without writing and commits exit-level orders in guarded format version 1",async()=>{
    const env=environment();env.disk.set(KEY,JSON.stringify({version:0,state:{live:createAccount({initialBalance:50000,feeRate:0,slippageBps:0})}}));const saved=env.disk.get(KEY),a=await context();expect(a.store.getState().live.initialBalance).toBe(50000);expect(env.disk.get(KEY)).toBe(saved);expect(env.writes()).toBe(0);a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order({quantity:2,exitLevels:[{quantity:1,takeProfit:120,stopLoss:80},{quantity:1,takeProfit:130,stopLoss:70}]}),1));expect(JSON.parse(env.disk.get(KEY)!).version).toBe(1);const b=await context();expect(b.store.getState().live.orders.filter(o=>o.reduceOnly)).toHaveLength(4);expect(env.writes()).toBe(1);
  });
  it("freezes entry and amendment exit arrays before waiting for an account write",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);const {paperCommands}=await import("@/lib/trading/paperCommands");let release!:()=>void;let held=env.locks.request("affentrader-paper-write-v1",{},()=>new Promise<void>(resolve=>{release=resolve;}));await settle();const input=order({type:"limit",price:90,exitLevels:[{quantity:1,takeProfit:120,stopLoss:70}]}),pending=paperCommands.place(input);input.exitLevels![0].takeProfit=999;release();await held;const placed=await pending;expect(placed?.order.exitLevels![0].takeProfit).toBe(120);
    held=env.locks.request("affentrader-paper-write-v1",{},()=>new Promise<void>(resolve=>{release=resolve;}));await settle();const patch={exitLevels:[{quantity:1,takeProfit:115,stopLoss:75}]},change=paperCommands.amend(placed!.order.id,patch,0,{mode:"live",epoch:a.store.getState().contextEpoch});patch.exitLevels[0].takeProfit=777;release();await held;expect((await change)?.order?.exitLevels![0].takeProfit).toBe(115);
  });
  it("rolls back entry fill and all new exit pairs on a failed durable save",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);const saved=env.disk.get(KEY),before=structuredClone(a.store.getState().live),{paperCommands}=await import("@/lib/trading/paperCommands");env.setQuota(true);expect(await paperCommands.place(order({exitLevels:[{quantity:.5,takeProfit:120,stopLoss:80},{quantity:.5,takeProfit:130,stopLoss:70}]}))).toBeUndefined();expect(env.disk.get(KEY)).toBe(saved);expect(a.store.getState().live).toEqual(before);
  });
  it("amends and fills a pending Replay entry with its frozen exit pairs without a live write",async()=>{
    const env=environment(),a=await context(),saved=env.disk.get(KEY);a.store.getState().startReplay();a.store.getState().bar("BTCUSDT",{time:1000,open:100,high:100,low:100,close:100});const {paperCommands}=await import("@/lib/trading/paperCommands"),placed=await paperCommands.place(order({type:"limit",price:90,exitLevels:[{quantity:1,takeProfit:120,stopLoss:70}]}));const changed=await paperCommands.amend(placed!.order.id,{price:105,exitLevels:[{quantity:.5,takeProfit:110,stopLoss:80},{quantity:.5,takeProfit:120,stopLoss:70}]},0,{mode:"replay",epoch:a.store.getState().contextEpoch});expect(changed?.ok).toBe(true);expect(a.store.getState().replay.orders.filter(o=>o.status==="working")).toHaveLength(4);expect(a.store.getState().replay.orders.filter(o=>o.reduceOnly).every(o=>o.createdAt===1000&&o.createdSource==="replay")).toBe(true);expect(env.disk.get(KEY)).toBe(saved);
  });
  it("retains per-tab exit drafts through reload without publishing them as account data",async()=>{
    const env=environment(),session=new Map<string,string>();vi.stubGlobal("sessionStorage",{getItem:(key:string)=>session.get(key)??null,setItem:(key:string,value:string)=>session.set(key,value),removeItem:(key:string)=>session.delete(key)});const a=await context(),saved=env.disk.get(KEY);a.store.getState().setTicket({quantity:2,exitLevels:[{quantity:1,takeProfit:120,stopLoss:80},{quantity:1,takeProfit:130,stopLoss:70}]});a.store.getState().setTicket({quantity:.5});const b=await context();expect(b.store.getState().ticket.exitLevels).toHaveLength(2);expect(b.store.getState().ticket.quantity).toBe(.5);expect(env.disk.get(KEY)).toBe(saved);expect(env.writes()).toBe(0);
  });

  it("commits position protection once and makes identical saves a no-op",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order(),1));const {paperCommands,captureProtectionReview}=await import("@/lib/trading/paperCommands"),levels=[{quantity:.5,takeProfit:110,stopLoss:90},{quantity:.5,takeProfit:120,stopLoss:80}],writes=env.writes();expect((await paperCommands.protect("BTCUSDT",levels,captureProtectionReview("BTCUSDT")!))?.ok).toBe(true);expect(env.writes()).toBe(writes+1);expect(env.account().fills).toHaveLength(1);expect(env.account().orders.filter((o:{status:string})=>o.status==="working")).toHaveLength(4);expect((await paperCommands.protect("BTCUSDT",levels,captureProtectionReview("BTCUSDT")!))?.ok).toBe(true);expect(env.writes()).toBe(writes+1);const b=await context();expect(b.store.getState().live.orders.filter(o=>o.status==="working")).toHaveLength(4);
  });
  it("rolls back a complete protection replacement on quota failure",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order({takeProfit:120,stopLoss:80}),1));const {paperCommands,captureProtectionReview}=await import("@/lib/trading/paperCommands"),saved=env.disk.get(KEY),before=structuredClone(a.store.getState().live);env.setQuota(true);expect(await paperCommands.protect("BTCUSDT",[{quantity:1,takeProfit:130,stopLoss:70}],captureProtectionReview("BTCUSDT")!)).toBeUndefined();expect(env.disk.get(KEY)).toBe(saved);expect(a.store.getState().live).toEqual(before);
  });
  it("rejects another tab's protective edits even when position size/entry are unchanged",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order({takeProfit:120,stopLoss:80}),1));const {paperCommands,captureProtectionReview}=await import("@/lib/trading/paperCommands"),review=captureProtectionReview("BTCUSDT")!,b=await context();b.store.getState().observePrice("BTCUSDT",100,false);const tp=b.store.getState().live.orders.find(o=>o.type==="limit")!;await b.editPaper(s=>s.amend(tp.id,{price:125},0));const saved=env.disk.get(KEY);expect(await paperCommands.protect("BTCUSDT",[{quantity:1,takeProfit:130,stopLoss:70}],review)).toBeUndefined();expect(env.disk.get(KEY)).toBe(saved);expect(env.account().orders.find((o:{id:string})=>o.id===tp.id).price).toBe(125);
  });
  it("fences old protection reviews and keeps Replay levels/history local",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order(),1));const {paperCommands,captureProtectionReview}=await import("@/lib/trading/paperCommands"),old=captureProtectionReview("BTCUSDT")!,saved=env.disk.get(KEY);a.store.getState().startReplay();a.store.getState().bar("BTCUSDT",{time:1000,open:100,high:100,low:100,close:100});await a.editPaper(s=>s.place(order()));const levels=[{quantity:1,takeProfit:120,stopLoss:80}];expect(await paperCommands.protect("BTCUSDT",levels,old)).toBeUndefined();expect((await paperCommands.protect("BTCUSDT",levels,captureProtectionReview("BTCUSDT")!))?.ok).toBe(true);expect(a.store.getState().replay.orders.slice(1).every(o=>o.createdAt===1000&&o.createdSource==="replay")).toBe(true);expect(env.disk.get(KEY)).toBe(saved);
  });
  it("does not fill newly protected exits from an older queued observation",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order(),1));vi.spyOn(Date,"now").mockReturnValue(20);await a.editPaper(s=>s.protect("BTCUSDT",[{quantity:1,takeProfit:120,stopLoss:90}]));await a.editLivePaper(s=>s.tick("BTCUSDT",80,19,false));expect(env.account().fills).toHaveLength(1);await a.editLivePaper(s=>s.tick("BTCUSDT",80,21,false));expect(env.account().fills).toHaveLength(2);expect(env.account().positions).toHaveLength(0);
  });

  it("cancels a reviewed chart order atomically and rejects a stale chart revision",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);const placed=await a.editPaper(s=>s.place(order({type:"limit",price:90}),1)),{paperCommands}=await import("@/lib/trading/paperCommands"),review={mode:a.store.getState().mode,epoch:a.store.getState().contextEpoch};await a.editPaper(s=>s.amend(placed!.order.id,{price:95},0));const saved=env.disk.get(KEY);expect(await paperCommands.cancelReviewed(placed!.order.id,0,review)).toBeUndefined();expect(env.disk.get(KEY)).toBe(saved);const writes=env.writes();expect(await paperCommands.cancelReviewed(placed!.order.id,1,review)).toBe(true);expect(env.writes()).toBe(writes+1);expect(env.account().orders[0].status).toBe("canceled");
  });
  it("does not cancel a colliding Replay order from an old live chart review",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);const placed=await a.editPaper(s=>s.place(order({type:"limit",price:90}),1)),{paperCommands}=await import("@/lib/trading/paperCommands"),review={mode:a.store.getState().mode,epoch:a.store.getState().contextEpoch};a.store.getState().startReplay();a.store.getState().bar("BTCUSDT",{time:1000,open:100,high:100,low:100,close:100});await a.editPaper(s=>s.place(order({type:"limit",price:90})));expect(await paperCommands.cancelReviewed(placed!.order.id,0,review)).toBeUndefined();expect(a.store.getState().replay.orders[0].status).toBe("working");expect(env.account().orders[0].status).toBe("working");
  });
  it("rolls back reviewed chart cancellation on quota failure",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);const placed=await a.editPaper(s=>s.place(order({type:"limit",price:90}),1)),{paperCommands}=await import("@/lib/trading/paperCommands"),review={mode:a.store.getState().mode,epoch:a.store.getState().contextEpoch},saved=env.disk.get(KEY);env.setQuota(true);expect(await paperCommands.cancelReviewed(placed!.order.id,0,review)).toBeUndefined();expect(env.disk.get(KEY)).toBe(saved);expect(a.store.getState().live.orders[0].status).toBe("working");
  });

  it("commits partial close and resized protection once and rolls back on quota failure",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order({takeProfit:120,stopLoss:80}),1));const writes=env.writes();await a.editPaper(s=>s.close("BTCUSDT",.25));expect(env.writes()).toBe(writes+1);expect(env.account().positions[0].quantity).toBe(.75);expect(env.account().orders.filter((o:{status:string})=>o.status==="working").map((o:{quantity:number})=>o.quantity)).toEqual([.75,.75]);const saved=env.disk.get(KEY),before=structuredClone(a.store.getState().live);env.setQuota(true);await expect(a.editPaper(s=>s.close("BTCUSDT",.25))).rejects.toThrow("quota");expect(env.disk.get(KEY)).toBe(saved);expect(a.store.getState().live).toEqual(before);
  });
  it("rejects a close review changed by another tab before the write lock is granted",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order(),1));const {paperCommands,captureCloseReview}=await import("@/lib/trading/paperCommands"),review=captureCloseReview("BTCUSDT")!;const b=await context();b.store.getState().observePrice("BTCUSDT",100,false);await b.editPaper(s=>s.close("BTCUSDT",.25));const saved=env.disk.get(KEY);expect(await paperCommands.close("BTCUSDT",.5,review)).toBeUndefined();expect(env.disk.get(KEY)).toBe(saved);expect(env.account().positions[0].quantity).toBe(.75);
  });
  it("rejects symbol and old Replay-context close reviews even with matching exposure",async()=>{
    const env=environment(),a=await context();a.store.getState().startReplay();a.store.getState().bar("BTCUSDT",{time:1000,open:100,high:100,low:100,close:100});await a.editPaper(s=>s.place(order()));const {paperCommands,captureCloseReview}=await import("@/lib/trading/paperCommands"),review=captureCloseReview("BTCUSDT")!;a.store.getState().bar("ETHUSDT",{time:1000,open:100,high:100,low:100,close:100});await a.editPaper(s=>s.place(order({symbol:"ETHUSDT"})));expect(await paperCommands.close("ETHUSDT",.5,review)).toBeUndefined();a.store.getState().startReplay();a.store.getState().bar("BTCUSDT",{time:1000,open:100,high:100,low:100,close:100});await a.editPaper(s=>s.place(order()));expect(await paperCommands.close("BTCUSDT",.5,review)).toBeUndefined();expect(a.store.getState().replay.positions[0].quantity).toBe(1);expect(env.account().fills).toHaveLength(0);
  });
  it("executes a reviewed Replay partial close at its historical clock without a live write",async()=>{
    const env=environment(),a=await context(),saved=env.disk.get(KEY);a.store.getState().startReplay();a.store.getState().bar("BTCUSDT",{time:1000,open:100,high:100,low:100,close:100});await a.editPaper(s=>s.place(order({takeProfit:120,stopLoss:80})));const {paperCommands,captureCloseReview}=await import("@/lib/trading/paperCommands");expect((await paperCommands.close("BTCUSDT",.25,captureCloseReview("BTCUSDT")))?.ok).toBe(true);expect(a.store.getState().replay.positions[0].quantity).toBe(.75);expect(a.store.getState().replay.fills.at(-1)).toMatchObject({quantity:.25,time:1000,source:"replay"});expect(env.disk.get(KEY)).toBe(saved);
  });

  it("saves an amendment once and refuses a second tab's stale revision",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);const placed=await a.editPaper(s=>s.place(order({type:"limit",price:90}),10));const b=await context(),writes=env.writes();expect((await a.editPaper(s=>s.amend(placed!.order.id,{quantity:2,price:95},0)))?.ok).toBe(true);expect(env.writes()).toBe(writes+1);const stale=await b.editPaper(s=>s.amend(placed!.order.id,{price:94},0));expect(stale?.ok).toBe(false);expect(env.account().orders[0]).toMatchObject({price:95,quantity:2,revision:1});expect(env.writes()).toBe(writes+1);
  });
  it("rolls back amended order metadata and prices on a storage failure",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);const placed=await a.editPaper(s=>s.place(order({type:"limit",price:90}),10)),before=structuredClone(a.store.getState().live),saved=env.disk.get(KEY);env.setQuota(true);await expect(a.editPaper(s=>s.amend(placed!.order.id,{price:95},0))).rejects.toThrow("quota");expect(env.disk.get(KEY)).toBe(saved);expect(a.store.getState().live).toEqual(before);
  });
  it("rejects a dialog from a different account even when its order ID collides",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);const live=await a.editPaper(s=>s.place(order({type:"limit",price:90}),10));a.store.getState().startReplay();a.store.getState().bar("BTCUSDT",{time:1000,open:50,high:50,low:50,close:50});const replay=await a.editPaper(s=>s.place(order({type:"limit",price:40})));expect(live?.order.id).toBe(replay?.order.id);const capturedContext={mode:"replay" as const,epoch:a.store.getState().contextEpoch};a.store.getState().setMode("live");const {paperCommands}=await import("@/lib/trading/paperCommands");expect(await paperCommands.amend(replay!.order.id,{price:30},0,capturedContext)).toBeUndefined();expect(env.account().orders[0].price).toBe(90);
  });
  it("does not apply an older queued price to newly amended live conditions",async()=>{
    environment();const a=await context();vi.spyOn(Date,"now").mockReturnValue(20);a.store.getState().observePrice("BTCUSDT",100,false);const placed=await a.editPaper(s=>s.place(order({type:"limit",price:90}),10));await a.editPaper(s=>s.amend(placed!.order.id,{price:95},0));await a.editLivePaper(s=>s.tick("BTCUSDT",94,19,false));expect(a.store.getState().live.fills).toHaveLength(0);await a.editLivePaper(s=>s.tick("BTCUSDT",94,21,false));expect(a.store.getState().live.fills[0].price).toBe(95);
  });
  it("keeps Replay amendment identity and time local without writing the live snapshot",async()=>{
    const env=environment(),a=await context(),saved=env.disk.get(KEY);a.store.getState().startReplay();a.store.getState().bar("BTCUSDT",{time:1000,open:100,high:100,low:100,close:100});const placed=await a.editPaper(s=>s.place(order({type:"limit",price:90})));const changed=await a.editPaper(s=>s.amend(placed!.order.id,{price:105},0));expect(changed?.order).toMatchObject({id:placed!.order.id,modifiedAt:1000,modifiedSource:"replay",status:"filled"});expect(a.store.getState().replay.fills[0]).toMatchObject({price:100,time:1000,source:"replay"});expect(env.disk.get(KEY)).toBe(saved);
  });
  it("commits a reversal and protection cancellation as one durable account write",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order({takeProfit:120,stopLoss:80}),1));const writes=env.writes();const reversed=await a.editPaper(s=>s.reverse("BTCUSDT"));expect(reversed?.ok).toBe(true);expect(env.writes()).toBe(writes+1);expect(env.account().positions[0].quantity).toBe(-1);expect(env.account().orders.filter((o:{status:string})=>o.status==="working")).toHaveLength(0);expect(env.account().fills.at(-1)).toMatchObject({quantity:2,side:"sell",source:"market"});
  });
  it("rejects a reversal queued behind a changed position instead of reversing a different size",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order(),1));const {paperCommands}=await import("@/lib/trading/paperCommands");let release!:()=>void;const held=env.locks.request("affentrader-paper-write-v1",{},()=>new Promise<void>(resolve=>{release=resolve;}));await settle();const partial=a.editPaper(s=>s.place(order({side:"sell",quantity:.5}),2)),reverse=paperCommands.reverse("BTCUSDT");release();await held;await partial;expect(await reverse).toBeUndefined();expect(env.account().positions[0].quantity).toBe(.5);expect(env.account().fills).toHaveLength(2);
  });
  it("rolls back a reversal completely when durable storage fails",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order({stopLoss:80}),1));const saved=env.disk.get(KEY),before=structuredClone(a.store.getState().live);env.setQuota(true);await expect(a.editPaper(s=>s.reverse("BTCUSDT"))).rejects.toThrow("quota");expect(env.disk.get(KEY)).toBe(saved);expect(a.store.getState().live).toEqual(before);
  });
  it("keeps Replay reversals local and uses their historical clock",async()=>{
    const env=environment(),a=await context(),saved=env.disk.get(KEY);a.store.getState().startReplay();a.store.getState().bar("BTCUSDT",{time:1000,open:50,high:50,low:50,close:50});await a.editPaper(s=>s.place(order()));await a.editPaper(s=>s.reverse("BTCUSDT"));expect(a.store.getState().replay.positions[0].quantity).toBe(-1);expect(a.store.getState().replay.fills.at(-1)).toMatchObject({quantity:2,price:50,time:1000,source:"replay"});expect(env.disk.get(KEY)).toBe(saved);expect(a.store.getState().live.fills).toHaveLength(0);
  });
  it("uses local fresh depth inside serialized placement and retains the recorded basis after hydration",async()=>{
    const env=environment(),a=await context(),time=Date.now();a.store.getState().observePrice("BTCUSDT",100,false);a.store.getState().observeBook({symbol:"BTCUSDT",bids:[{price:99,quantity:1}],asks:[{price:101,quantity:1}],time,simulated:false});
    const placed=await a.editPaper(s=>s.place(order(),time));expect(placed?.order.fillPrice).toBe(101);expect(env.account().fills[0].priceBasis).toBe("ask");const b=await context();expect(b.store.getState().live.fills[0].priceBasis).toBe("ask");expect(b.store.getState().liveBooks).toEqual({});
    a.store.getState().clearObservedPrices();expect(a.store.getState().liveBooks).toEqual({});
  });
  it("uses the captured book for queued matching rather than a newer local book",async()=>{
    const env=environment(),a=await context(),time=Date.now();a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order({type:"stop",stopPrice:110}),time));
    a.store.getState().observeBook({symbol:"BTCUSDT",bids:[{price:118,quantity:1}],asks:[{price:120,quantity:1}],time:time+2,simulated:false});
    await a.editLivePaper(s=>s.tick("BTCUSDT",111,time+1,false,{bid:110,ask:112,time:time+1,simulated:false}));expect(env.account().fills[0]).toMatchObject({price:112,priceBasis:"ask"});
  });
  it("keeps Replay orders on historical bar prices despite a fresh live order book",async()=>{
    environment();const a=await context(),time=Date.now();a.store.getState().observePrice("BTCUSDT",100,false);a.store.getState().observeBook({symbol:"BTCUSDT",bids:[{price:99,quantity:1}],asks:[{price:101,quantity:1}],time,simulated:false});a.store.getState().startReplay();a.store.getState().bar("BTCUSDT",{time:1000,open:50,high:50,low:50,close:50});await a.editPaper(s=>s.place(order()));expect(a.store.getState().replay.fills[0]).toMatchObject({price:50,priceBasis:"last",source:"replay"});
  });
  it("discards stale live ticket prices on a feed change while retaining a local synthetic Replay",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);a.store.getState().clearObservedPrices();expect(a.store.getState().liveSources).toEqual({});expect(a.store.getState().prices).toEqual({});const missing=await a.editPaper(s=>s.place(order(),1));expect(missing?.ok).toBe(false);expect(env.account().fills).toHaveLength(0);
    a.store.getState().observePrice("BTCUSDT",100,true);a.store.getState().startReplay(true);a.store.getState().bar("BTCUSDT",{time:1000,open:90,high:90,low:90,close:90});await a.editPaper(s=>s.place(order()));a.store.getState().clearObservedPrices();expect(a.store.getState().prices).toEqual({BTCUSDT:90});expect(a.store.getState().replay.fills[0].source).toBe("replay_simulation");expect(a.store.getState().replaySource).toBe("replay_simulation");await a.editPaper(s=>s.close("BTCUSDT"));expect(a.store.getState().replay.fills[1].source).toBe("replay_simulation");expect(env.account().fills).toHaveLength(0);
  });
  it("rejects an old-feed command awaiting the shared write lock",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);let release!:()=>void;const held=env.locks.request("affentrader-paper-write-v1",{},()=>new Promise<void>(resolve=>{release=resolve;}));await settle();const pending=a.editPaper(s=>s.place(order(),1));a.store.getState().clearObservedPrices();a.store.getState().observePrice("BTCUSDT",90,true);release();await held;await expect(pending).rejects.toThrow(/selected paper account changed/);expect(env.account().orders).toHaveLength(0);
  });
  it("records the matching observation's source independently of a later locally displayed quote",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100,false);await a.editPaper(s=>s.place(order({type:"stop",stopPrice:110}),1));a.store.getState().observePrice("BTCUSDT",120,false);await a.editLivePaper(s=>s.tick("BTCUSDT",120,2,true));expect(env.account().orders[0]).toMatchObject({createdSource:"market",fillSource:"simulation"});expect(env.account().fills[0].source).toBe("simulation");const reloaded=await context();expect(reloaded.store.getState().live.fills[0].source).toBe("simulation");reloaded.store.getState().observePrice("BTCUSDT",100,false);reloaded.store.getState().observePrice("BTCUSDT",100,true);expect(reloaded.store.getState().liveSources.BTCUSDT).toBe("simulation");
  });
  it("serializes opposing bracket observations so one exit cancels its OCO sibling",async()=>{
    const env=environment(),a=await context(),b=await context();a.store.getState().observePrice("BTCUSDT",100);await a.editPaper(s=>s.place(order({takeProfit:110,stopLoss:90}),1));await Promise.all([a.editLivePaper(s=>s.tick("BTCUSDT",115,2)),b.editLivePaper(s=>s.tick("BTCUSDT",80,3))]);expect(env.account().fills).toHaveLength(2);expect(env.account().positions).toHaveLength(0);expect(env.account().orders.filter((o:{status:string})=>o.status==="canceled")).toHaveLength(1);
  });
  it("retains an acknowledged cancel and never turns an already filled order back into a cancel",async()=>{
    const env=environment(),a=await context(),b=await context();a.store.getState().observePrice("BTCUSDT",100);const first=await a.editPaper(s=>s.place(order({type:"limit",price:90}),1));await Promise.all([b.editPaper(s=>s.cancel(first!.order.id)),a.editLivePaper(s=>s.tick("BTCUSDT",80,2))]);expect(env.account().fills).toHaveLength(0);expect(env.account().orders[0].status).toBe("canceled");
    a.store.getState().observePrice("BTCUSDT",100);const second=await a.editPaper(s=>s.place(order({type:"limit",price:90}),3));await Promise.all([a.editLivePaper(s=>s.tick("BTCUSDT",80,4)),b.editPaper(s=>s.cancel(second!.order.id))]);expect(env.account().fills).toHaveLength(1);expect(env.account().orders.at(-1).status).toBe("filled");
  });
  it("preserves independent commands from two stale stores with unique fills and order ids",async()=>{
    const env=environment(),a=await context(),b=await context();a.store.getState().observePrice("BTCUSDT",100);b.store.getState().observePrice("BTCUSDT",100);
    await Promise.all([a.editPaper(s=>s.place(order(),1)),b.editPaper(s=>s.place(order({side:"sell",quantity:0.25}),2))]);
    expect(env.account().positions[0].quantity).toBe(0.75);expect(env.account().fills).toHaveLength(2);expect(new Set(env.account().orders.map((o:{id:string})=>o.id)).size).toBe(2);
  });
  it("matches a shared working order once even when two stale contexts receive the same sample",async()=>{
    const env=environment(),a=await context(),b=await context();a.store.getState().observePrice("BTCUSDT",100);await a.editPaper(s=>s.place(order({type:"limit",price:90}),1));
    await Promise.all([a.editLivePaper(s=>s.tick("BTCUSDT",80,2)),b.editLivePaper(s=>s.tick("BTCUSDT",80,2))]);expect(env.account().fills).toHaveLength(1);expect(env.account().positions[0].quantity).toBe(1);expect(env.account().cash).toBe(99910);
  });
  it("does not let local quotes or ticket edits overwrite another tab's newer account",async()=>{
    const env=environment(),a=await context(),b=await context();a.store.getState().observePrice("BTCUSDT",100);await a.editPaper(s=>s.place(order(),1));const saved=env.disk.get(KEY),writes=env.writes();
    b.store.getState().observePrice("BTCUSDT",500);b.store.getState().setTicket({quantity:9});b.store.getState().startReplay();b.store.getState().bar("BTCUSDT",{time:10,open:100,high:100,low:100,close:100});await b.editPaper(s=>s.place(order({quantity:2})));
    expect(env.disk.get(KEY)).toBe(saved);expect(env.writes()).toBe(writes);await b.store.persist.rehydrate();expect(b.store.getState().live.positions[0].quantity).toBe(1);expect(b.store.getState().replay.positions[0].quantity).toBe(2);expect(b.store.getState().mode).toBe("replay");expect(b.store.getState().prices.BTCUSDT).toBe(100);expect(b.store.getState().ticket.quantity).toBe(9);
  });
  it("keeps matching live orders when the elected tab is displaying its local Replay account",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100);await a.editPaper(s=>s.place(order({type:"stop",stopPrice:110}),1));a.store.getState().startReplay();a.store.getState().bar("BTCUSDT",{time:1000,open:50,high:50,low:50,close:50});await a.editPaper(s=>s.place(order({quantity:2})));
    await a.editLivePaper(s=>s.tick("BTCUSDT",120,2));expect(env.account().fills).toHaveLength(1);expect(env.account().positions[0].avgPrice).toBe(120);expect(a.store.getState().replay.positions[0].avgPrice).toBe(50);expect(a.store.getState().prices.BTCUSDT).toBe(50);a.store.getState().setMode("live");expect(a.store.getState().prices.BTCUSDT).toBe(120);
  });
  it("publishes one snapshot and rolls back both memory and disk on a failed account save",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100);await a.editPaper(s=>{s.place(order(),1);s.place(order(),2);});expect(env.writes()).toBe(1);const saved=env.disk.get(KEY);env.setQuota(true);
    await expect(a.editPaper(s=>{s.place(order({quantity:2}),3);s.cancelAll();})).rejects.toThrow("quota");expect(env.disk.get(KEY)).toBe(saved);expect(a.store.getState().live.positions[0].quantity).toBe(2);expect(a.store.getState().live.fills).toHaveLength(2);
    a.store.getState().startReplay();a.store.getState().bar("BTCUSDT",{time:10,open:100,high:100,low:100,close:100});expect((await a.editPaper(s=>s.place(order())))?.ok).toBe(true);expect(env.disk.get(KEY)).toBe(saved);
  });
  it("retains invalid saved state and refuses unsupported/direct shared writes",async()=>{
    const env=environment(),a=await context();env.disk.set(KEY,JSON.stringify({state:{live:{cash:123}}}));await expect(a.editPaper(s=>s.place(order()))).rejects.toThrow(/could not be read/);a.store.getState().observePrice("BTCUSDT",100);expect(env.disk.get(KEY)).toBe(JSON.stringify({state:{live:{cash:123}}}));expect(()=>a.store.getState().place(order())).toThrow(/serialized/);
    const newer=JSON.stringify({version:99,state:{live:createAccount()}});env.disk.set(KEY,newer);await expect(a.editPaper(s=>s.cancelAll())).rejects.toThrow(/could not be read/);expect(env.disk.get(KEY)).toBe(newer);env.disk.delete(KEY);await expect(a.editPaper(s=>s.cancelAll())).rejects.toThrow(/could not be read/);expect(env.disk.has(KEY)).toBe(false);
    vi.stubGlobal("navigator",{});await expect(a.editPaper(s=>s.cancelAll())).rejects.toThrow(/Web Locks/);
  });
  it("rejects a command queued for a different live/replay context even after returning to live",async()=>{
    const env=environment(),a=await context();let release!:()=>void;const held=env.locks.request("affentrader-paper-write-v1",{},()=>new Promise<void>(resolve=>{release=resolve;}));await settle();
    const pending=a.editPaper(s=>s.place(order(),1));a.store.getState().startReplay();a.store.getState().setMode("live");release();await held;await expect(pending).rejects.toThrow(/selected paper account changed/);expect(env.account().orders).toHaveLength(0);
  });
  it("hands the actual account to one waiting owner and fences a queued old-owner fill",async()=>{
    const env=environment(),a=await context(),b=await context();a.store.getState().observePrice("BTCUSDT",100);await a.editPaper(s=>s.place(order({type:"limit",price:90}),1));const first=a.paperExecutionOwner(),second=b.paperExecutionOwner();first.start();second.start();await settle();expect(first.snapshot().status).toBe("primary");expect(second.snapshot().status).toBe("standby");
    let release!:()=>void;const held=env.locks.request("affentrader-paper-write-v1",{},()=>new Promise<void>(resolve=>{release=resolve;}));await settle();const epoch=first.snapshot().epoch,pending=a.editLivePaper(s=>s.tick("BTCUSDT",80,2),()=>first.owns(epoch));first.stop();release();await held;expect(await pending).toBeUndefined();await settle();expect(second.snapshot().status).toBe("primary");expect(env.account().fills).toHaveLength(0);
    await b.editLivePaper(s=>s.tick("BTCUSDT",80,3),()=>second.owns(second.snapshot().epoch));expect(env.account().fills).toHaveLength(1);second.stop();
  });
  it("ignores a live sample received before a newly accepted order",async()=>{
    const env=environment(),a=await context();a.store.getState().observePrice("BTCUSDT",100);await a.editPaper(s=>s.place(order({type:"stop",stopPrice:110}),20));await a.editLivePaper(s=>s.tick("BTCUSDT",120,19));expect(env.account().fills).toHaveLength(0);await a.editLivePaper(s=>s.tick("BTCUSDT",121,21));expect(env.account().fills).toHaveLength(1);
  });
});

describe("local Replay accounting",()=>{
  it("uses the historical clock and never reuses an old same-bar extreme for a newly placed order",async()=>{
    environment();const a=await context();a.store.getState().startReplay();await expect(a.editPaper(s=>s.place(order({type:"limit",price:90})))).rejects.toThrow(/Replay cursor bar/);a.store.getState().bar("BTCUSDT",{time:1000,open:100,high:120,low:80,close:110});const placed=await a.editPaper(s=>s.place(order({type:"limit",price:90})));expect(placed?.order.createdAt).toBe(1000);
    a.store.getState().bar("BTCUSDT",{time:1000,open:100,high:120,low:80,close:111});expect(a.store.getState().replay.fills).toHaveLength(0);a.store.getState().bar("BTCUSDT",{time:1000,open:100,high:120,low:80,close:89});expect(a.store.getState().replay.fills).toHaveLength(1);expect(a.store.getState().replay.fills[0].time).toBe(1000);
    a.store.getState().bar("BTCUSDT",{time:999,open:10,high:10,low:10,close:10});expect(a.store.getState().prices.BTCUSDT).toBe(89);a.store.getState().startReplay();expect(a.store.getState().replay.fills).toHaveLength(0);expect(a.store.getState().replayClock).toBeUndefined();
  });
  it("keeps per-tab tickets through reload without putting them in shared account snapshots",async()=>{
    const env=environment(),session=new Map<string,string>();vi.stubGlobal("sessionStorage",{getItem:(key:string)=>session.get(key)??null,setItem:(key:string,value:string)=>session.set(key,value),removeItem:(key:string)=>session.delete(key)});const a=await context();expect(a.store.getState().ticket.quantity).toBe(3);await a.editPaper(s=>s.cancelAll());expect(JSON.parse(env.disk.get(KEY)!).state.ticket).toBeUndefined();const reloaded=await context();expect(reloaded.store.getState().ticket.quantity).toBe(3);
  });
});
