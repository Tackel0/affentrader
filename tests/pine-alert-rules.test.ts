import { describe, expect, it } from "vitest";
import type { AlertRule } from "@/types/alerts";
import type { PineAlertSnapshot, PineSignal, PineOrderFill } from "@/types/pineAlerts";
import { pineEvent, pineSeries } from "@/lib/alerts/pineRules";
import { validateRuleShape } from "@/lib/alerts/rules";
import { parseWorkspace } from "@/lib/workspace";
import { restartRule } from "@/lib/alerts/rateLimit";
import { watchlistMembers } from "@/lib/alerts/dependencies";
const definition=():PineAlertSnapshot=>({source:'//@version=6\nindicator("Named")\nplot(close,"Price")\nalertcondition(close>100,"Above","{{ticker}} {{plot_0}}")',title:"Named",inputs:{},libraries:{},selection:{type:"condition",id:"alertcondition_0"},history:300,chartType:"candles",timezone:"UTC"});
const rule=():AlertRule=>({id:"pine",name:"Pine",kind:"pine",status:"active",scope:{type:"symbol",symbol:"BTCUSDT",timeframe:"1m"},condition:{op:"leaf",leaf:{type:"pine",snapshot:definition()}},trigger:"once_per_bar",frequency:"tick",repeat:true,cooldownMs:0,sound:false,browserNotification:false,serverSide:false,createdAt:1000});
const signal=(patch:Partial<PineSignal>={}):PineSignal=>({type:"alertcondition",id:"alertcondition_0",title:"Above",message:'{{ticker}} {{exchange}} {{interval}} {{close}} {{plot_0}} {{plot("Price")}}',time:60000,price:110,plots:{"0":105,Price:105},confirmed:false,...patch});
const data=pineSeries("BTCUSDT","1m",[{time:60000,open:100,high:112,low:99,close:110,volume:20}]);
const fill=():PineOrderFill=>({id:"fill-1",orderId:"S",action:"sell",contracts:3,price:109,comment:"Reverse",alertMessage:"Custom {{close}}",positionSize:-2,previousPositionSize:1,leg:"entry"});
const orderSignal=():PineSignal=>signal({type:"order_fill",id:"fill-1",price:109,fill:fill()});
describe("saved Pine signal gates",()=>{
  it("keeps recovery identities source-specific and validates them in complete workspace backups",()=>{
    const r=rule();r.pineEpoch="run-1";r.pineCursors={BTCUSDT:{exchange:{id:crypto.randomUUID(),sequence:12,time:61000,epoch:"run-1"},simulation:{id:crypto.randomUUID(),sequence:3,time:62000,epoch:"run-1"}}};expect(validateRuleShape(r)).toBeNull();
    const workspace={version:1,chart:{state:{symbol:"BTCUSDT",timeframe:"1m",chartType:"candles",feedMode:"auto",indicators:[],drawings:{},pineLibraries:{}}},watchlists:{state:{lists:[{id:"w",name:"Crypto",symbols:["BTCUSDT"]}],activeId:"w"}},alerts:{state:{alerts:[],logs:[],rules:[r]}}};expect(parseWorkspace(JSON.stringify(workspace)).alerts.state.rules).toEqual([r]);
    r.pineCursors.BTCUSDT.exchange!.epoch="different";expect(()=>parseWorkspace(JSON.stringify(workspace))).toThrow(/journal firing cursors/);r.pineCursors.BTCUSDT.exchange!.epoch="run-1";r.pineCursors.BTCUSDT.exchange!.sequence=-1;expect(validateRuleShape(r)).toMatch(/journal firing cursors/);
  });
  it("restarts only stopped member runs and prunes recovery state when a market leaves",()=>{
    const r=rule();r.pineEpoch="global";r.scope={type:"watchlist",listId:"w",symbols:["BTCUSDT","ETHUSDT"],timeframe:"1m"};r.expiresAt=999999;r.rate={recent:[],stoppedSymbols:{BTCUSDT:1000}};r.pineCursors={BTCUSDT:{exchange:{id:crypto.randomUUID(),sequence:3,time:1000,epoch:"global"}},ETHUSDT:{exchange:{id:crypto.randomUUID(),sequence:9,time:1000,epoch:"global"}}};
    const restarted=restartRule(r,2000,true);expect(restarted.pineEpoch).toBe("global");expect(restarted.pineMemberEpochs?.BTCUSDT).not.toBe("global");expect(restarted.pineCursors?.ETHUSDT).toEqual(r.pineCursors.ETHUSDT);expect(restarted.pineCursors?.BTCUSDT).toBeUndefined();expect(validateRuleShape(restarted)).toBeNull();
    const pruned=watchlistMembers(restarted,["ETHUSDT"],2001);expect(pruned.pineMemberEpochs).toEqual({});expect(pruned.pineCursors).toEqual({ETHUSDT:r.pineCursors.ETHUSDT});
  });
  it("matches the selected declaration and expands market/plot placeholders",()=>{
    const event=pineEvent(rule(),signal(),data,61000,"browser")!;
    expect(event.message).toBe("BTCUSDT: BTCUSDT BINANCE 1 110 105 105");expect(event.scriptGate).toEqual({key:"alertcondition_0",bar:60000});
    expect(pineEvent(rule(),signal({id:"alertcondition_1"}),data,61000,"browser")).toBeUndefined();
  });
  it("retains a per-bar gate across JSON persistence",()=>{
    const r=rule();r.scriptState={BTCUSDT:{alertcondition_0:{bar:60000,time:61000}}};
    expect(pineEvent(JSON.parse(JSON.stringify(r)),signal(),data,62000,"browser")).toBeUndefined();
    expect(pineEvent(r,signal({time:120000}),data,121000,"browser")).toBeDefined();
  });
  it("requires confirmed conditions and applies a rolling-minute gate",()=>{
    const r=rule();r.trigger="once_per_close";expect(pineEvent(r,signal(),data,61000,"browser")).toBeUndefined();
    expect(pineEvent(r,signal({confirmed:true}),data,120000,"browser")).toBeDefined();
    r.trigger="once_per_minute";r.scriptState={BTCUSDT:{alertcondition_0:{bar:0,time:1000}}};
    expect(pineEvent(r,signal(),data,60999,"browser")).toBeUndefined();expect(pineEvent(r,signal(),data,61000,"browser")).toBeDefined();
  });
  it("uses script frequency for calls and the shared once-per-bar call group",()=>{
    const r=rule();if(r.condition.op==='leaf'&&r.condition.leaf.type==='pine')r.condition.leaf.snapshot.selection={type:"calls"};
    r.scriptState={BTCUSDT:{alert_calls:{bar:60000,time:61000}}};
    expect(pineEvent(r,signal({type:"alert",id:"alert_2",freq:"once_per_bar"}),data,62000,"server")).toBeUndefined();
    expect(pineEvent(r,signal({type:"alert",id:"alert_3",freq:"all"}),data,62000,"server")).toBeDefined();
  });
  it("honors expiration, stopped scopes and cooldown",()=>{
    const r=rule();r.expiresAt=61000;expect(pineEvent(r,signal(),data,61000,"browser")).toBeUndefined();
    r.expiresAt=999999;r.rate={recent:[],stoppedSymbols:{BTCUSDT:1000}};expect(pineEvent(r,signal(),data,61000,"browser")).toBeUndefined();
    r.rate=undefined;r.cooldownMs=60000;r.lastFired={BTCUSDT:{time:60000}};expect(pineEvent(r,signal(),data,61000,"browser")).toBeUndefined();
  });
  it("validates snapshots and rejects asynchronous Pine events nested in a math rule",()=>{
    const r=rule();expect(validateRuleShape(r)).toBeNull();
    const mixed={...r,kind:"composite",condition:{op:"all",conditions:[r.condition]}};expect(validateRuleShape(mixed)).toMatch(/own subscription/);
    const bad=rule();if(bad.condition.op==='leaf'&&bad.condition.leaf.type==='pine')bad.condition.leaf.snapshot.history=1;expect(validateRuleShape(bad)).toMatch(/history/);
  });
  it("round trips complete frozen code, libraries and gates through workspace validation",()=>{
    const r=rule();r.scriptState={BTCUSDT:{alertcondition_0:{bar:60000,time:61000}}};
    const workspace={version:1,chart:{state:{symbol:"BTCUSDT",timeframe:"1m",chartType:"candles",feedMode:"auto",indicators:[],drawings:{},pineLibraries:{}}},watchlists:{state:{lists:[{id:"w",name:"Crypto",symbols:["BTCUSDT"]}],activeId:"w"}},alerts:{state:{alerts:[],logs:[],rules:[r]}}};
    expect(parseWorkspace(JSON.stringify(workspace)).alerts.state.rules).toEqual([r]);
  });
  it("expands every documented strategy placeholder and leaves nested order message tokens literal",()=>{
    const r=rule();if(r.condition.op!=="leaf"||r.condition.leaf.type!=="pine")throw Error("Fixture");r.condition.leaf.snapshot.selection={type:"orders"};
    r.message='{{strategy.order.action}}|{{strategy.order.contracts}}|{{strategy.order.price}}|{{strategy.order.id}}|{{strategy.order.comment}}|{{strategy.order.alert_message}}|{{strategy.position_size}}|{{strategy.market_position}}|{{strategy.market_position_size}}|{{strategy.prev_market_position}}|{{strategy.prev_market_position_size}}';
    const event=pineEvent(r,orderSignal(),data,61000,"browser")!;
    expect(event.message).toBe('BTCUSDT: sell|3|109|S|Reverse|Custom {{close}}|-2|short|2|long|1');expect(event.strategyFill).toEqual(fill());
  });
  it("gates duplicate fills by identity while allowing separate fills in the same bar",()=>{
    const r=rule();if(r.condition.op!=="leaf"||r.condition.leaf.type!=="pine")throw Error("Fixture");r.condition.leaf.snapshot.selection={type:"orders"};
    const first=pineEvent(r,orderSignal(),data,61000,"browser")!;r.scriptState={BTCUSDT:{order_fills:{bar:60000,time:61000,token:first.scriptGate!.token}}};
    expect(pineEvent(JSON.parse(JSON.stringify(r)),orderSignal(),data,62000,"browser")).toBeUndefined();
    expect(pineEvent(r,{...orderSignal(),fill:{...fill(),id:"fill-2"}},data,62000,"browser")).toBeDefined();
    expect(pineEvent(r,signal({type:"alert",freq:"all"}),data,62000,"browser")).toBeUndefined();
  });
  it("filters fills/calls independently and preserves dynamic call messages in combined mode",()=>{
    const r=rule();if(r.condition.op!=="leaf"||r.condition.leaf.type!=="pine")throw Error("Fixture");r.condition.leaf.snapshot.selection={type:"calls"};
    expect(pineEvent(r,orderSignal(),data,61000,"browser")).toBeUndefined();r.condition.leaf.snapshot.selection={type:"both"};r.message="Fill message";
    expect(pineEvent(r,orderSignal(),data,61000,"browser")?.message).toBe("BTCUSDT: Fill message");
    expect(pineEvent(r,signal({type:"alert",message:"Dynamic call",freq:"all"}),data,61000,"browser")?.message).toBe("BTCUSDT: Dynamic call");
  });
  it("validates persisted fill identities and structured emulator executions in backups",()=>{
    const r=rule();r.scriptState={BTCUSDT:{order_fills:{bar:60000,time:61000,token:"fill-1"}}};expect(validateRuleShape(r)).toBeNull();
    r.scriptState.BTCUSDT.order_fills.token="x".repeat(301);expect(validateRuleShape(r)).toMatch(/gates/);r.scriptState.BTCUSDT.order_fills.token="fill-1";
    const e={id:"event",ruleId:r.id,name:r.name,symbol:"BTCUSDT",time:61000,price:109,source:"browser",message:"Fill",strategyFill:fill(),scriptGate:{key:"order_fills",bar:60000,token:"fill-1"}};
    const workspace={version:1,chart:{state:{symbol:"BTCUSDT",timeframe:"1m",chartType:"candles",feedMode:"auto",indicators:[],drawings:{},pineLibraries:{}}},watchlists:{state:{lists:[{id:"w",name:"Crypto",symbols:["BTCUSDT"]}],activeId:"w"}},alerts:{state:{alerts:[],logs:[],rules:[r],events:[e]}}};
    expect(parseWorkspace(JSON.stringify(workspace)).alerts.state.events).toEqual([e]);e.strategyFill.contracts=-1;expect(()=>parseWorkspace(JSON.stringify(workspace))).toThrow(/event/);
  });
});
