import { afterEach, describe, expect, it } from "vitest";
import { PineSandbox } from "@/lib/alerts/pineSandbox";
import type { PineAlertSnapshot, PineSeries } from "@/types/pineAlerts";
const now=1_800_000_000_000;
const definition=(source:string):PineAlertSnapshot=>({source,title:"Fill checks",inputs:{},libraries:{},selection:{type:"orders"},history:50,chartType:"candles",timezone:"UTC"});
const series=():PineSeries=>({symbol:"BTCUSDT",timeframe:"1m",info:{mintick:0.01,mincontract:0.001,currency:"USDT",timezone:"UTC"},bars:Array.from({length:50},(_,index)=>({time:now-(49-index)*60000,open:90,high:95,low:85,close:90,volume:10}))});
const active:PineSandbox[]=[];
afterEach(()=>{for(const vm of active)vm.dispose();active.length=0;});
const create=(source:string)=>{const vm=new PineSandbox(definition(source));active.push(vm);return vm;};
const tick=(data:PineSeries,price:number)=>{const last=data.bars.at(-1)!;last.close=price;last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);last.volume++;};
describe("native strategy order-fill observations",()=>{
  it("fills a queued market at the next observed price and preserves its ledger across ticks",async()=>{
    const vm=create('//@version=6\nstrategy("Market",calc_on_every_tick=true)\nif barstate.isrealtime and strategy.position_size==0\n    strategy.entry("L",strategy.long,qty=2,comment="Entry",alert_message="Custom")');
    const data=series();expect((await vm.run({series:data,now:now+1})).signals).toEqual([]);
    tick(data,100);expect((await vm.run({series:data,now:now+2,observation:"place"})).signals).toEqual([]);
    tick(data,110);const filled=await vm.run({series:data,now:now+3,observation:"fill"});
    expect(filled.signals).toHaveLength(1);expect(filled.signals[0]).toMatchObject({type:"order_fill",price:110,fill:{orderId:"L",action:"buy",contracts:2,price:110,comment:"Entry",alertMessage:"Custom",positionSize:2,previousPositionSize:0}});
    expect((await vm.run({series:data,now:now+4,observation:"fill"})).signals).toEqual([]);
    tick(data,111);expect((await vm.run({series:data,now:now+5,observation:"later"})).signals).toEqual([]);
  });
  it("observes live fills of a close-only strategy before its next script calculation",async()=>{
    const vm=create('//@version=6\nstrategy("Close only")\nif barstate.isrealtime and strategy.position_size==0\n    strategy.entry("L",strategy.long,qty=1)');
    const data=series();await vm.run({series:data,now:now+1});
    tick(data,100);expect((await vm.run({series:data,now:now+2,observation:"intrabar"})).signals).toEqual([]);
    expect((await vm.run({series:data,now:now+60000,closedBar:now})).signals).toEqual([]);
    data.bars.push({time:now+60000,open:105,high:105,low:105,close:105,volume:1});
    const result=await vm.run({series:data,now:now+60001,observation:"new-bar"});
    expect(result.signals[0]).toMatchObject({type:"order_fill",price:105,confirmed:false,fill:{contracts:1,orderId:"L"}});
  });
  it("waits for a stop and emits the actual successful profit leg of its bracket",async()=>{
    const vm=create('//@version=6\nstrategy("Bracket",calc_on_every_tick=true)\nif barstate.isrealtime\n    if strategy.position_size==0\n        strategy.entry("L",strategy.long,qty=1,stop=100)\n    else\n        strategy.exit("B","L",stop=80,limit=120,alert_message="Generic",alert_profit="Profit",alert_loss="Loss",comment_profit="Target")');
    const data=series();await vm.run({series:data,now:now+1});tick(data,95);await vm.run({series:data,now:now+2,observation:"place"});
    tick(data,99);expect((await vm.run({series:data,now:now+3,observation:"wait"})).signals).toEqual([]);
    tick(data,102);expect((await vm.run({series:data,now:now+4,observation:"entry"})).signals[0]).toMatchObject({price:102,fill:{action:"buy",contracts:1}});
    tick(data,121);const result=await vm.run({series:data,now:now+5,observation:"target"});
    expect(result.signals[0]).toMatchObject({type:"order_fill",fill:{orderId:"B",action:"sell",contracts:1,positionSize:0,previousPositionSize:1,alertMessage:"Profit",comment:"Target",leg:"profit"}});
  });
  it("keeps entry and immediate-close executions as two distinct fills in one bar",async()=>{
    const vm=create('//@version=6\nstrategy("Immediate",calc_on_every_tick=true)\nif barstate.isrealtime\n    if strategy.position_size==0\n        strategy.entry("L",strategy.long,qty=1)\n    else\n        strategy.close_all(immediately=true,alert_message="Exit")');
    const data=series();await vm.run({series:data,now:now+1});tick(data,100);await vm.run({series:data,now:now+2,observation:"place"});tick(data,101);
    const result=await vm.run({series:data,now:now+3,observation:"round-trip"});
    expect(result.signals).toHaveLength(2);expect(result.signals.map(signal=>signal.fill?.action)).toEqual(["buy","sell"]);
    expect(new Set(result.signals.map(signal=>signal.fill?.id)).size).toBe(2);expect(result.signals[1].fill?.alertMessage).toBe("Exit");
  });
  it("uses reversal transaction size including the closed and opened exposure",async()=>{
    const vm=create('//@version=6\nstrategy("Reversal",calc_on_every_tick=true)\nif barstate.isrealtime\n    if strategy.position_size==0\n        strategy.entry("L",strategy.long,qty=1)\n    else if strategy.position_size>0\n        strategy.entry("S",strategy.short,qty=2)');
    const data=series();await vm.run({series:data,now:now+1});tick(data,100);await vm.run({series:data,now:now+2,observation:"place"});tick(data,101);await vm.run({series:data,now:now+3,observation:"long"});tick(data,102);
    const result=await vm.run({series:data,now:now+4,observation:"reverse"});expect(result.signals[0].fill).toMatchObject({orderId:"S",action:"sell",contracts:3,previousPositionSize:1,positionSize:-2});
  });
  it("suppresses disable_alert fills and emits no event for rejected or cancelled orders",async()=>{
    const vm=create('//@version=6\nstrategy("Disabled",calc_on_every_tick=true)\nif barstate.isrealtime and strategy.position_size==0\n    strategy.entry("L",strategy.long,qty=1,disable_alert=true)');
    const data=series();await vm.run({series:data,now:now+1});tick(data,100);await vm.run({series:data,now:now+2,observation:"place"});tick(data,101);expect((await vm.run({series:data,now:now+3,observation:"disabled"})).signals).toEqual([]);
    const rejected=create('//@version=6\nstrategy("Rejected",initial_capital=1,calc_on_every_tick=true)\nif barstate.isrealtime\n    strategy.entry("Too big",strategy.long,qty=100)\n    strategy.entry("Cancel",strategy.long,stop=1000,qty=1)\n    strategy.cancel("Cancel")');
    const other=series();await rejected.run({series:other,now:now+1});tick(other,100);await rejected.run({series:other,now:now+2,observation:"place"});tick(other,101);expect((await rejected.run({series:other,now:now+3,observation:"reject"})).signals).toEqual([]);
  });
  it("rejects fill selection for an indicator and suppresses historical strategy executions",async()=>{
    await expect(create('//@version=6\nindicator("Invalid")\nplot(close)').run({series:series(),now:now+1})).rejects.toThrow(/strategy/);
    const vm=create('//@version=6\nstrategy("Historical")\nif bar_index%2==0\n    strategy.entry("L",strategy.long,qty=1)\nelse\n    strategy.close_all()');
    expect((await vm.run({series:series(),now:now+1})).signals).toEqual([]);
  });
  it("does not reuse a pre-creation high to fill a newly placed intrabar stop",async()=>{
    const vm=create('//@version=6\nstrategy("Old extrema",calc_on_every_tick=true)\nif barstate.isrealtime and strategy.position_size==0\n    strategy.entry("L",strategy.long,qty=1,stop=150)');
    const data=series();data.bars[49].high=200;await vm.run({series:data,now:now+1});tick(data,100);await vm.run({series:data,now:now+2,observation:"place"});tick(data,101);
    expect((await vm.run({series:data,now:now+3,observation:"still-below"})).signals).toEqual([]);
    tick(data,151);expect((await vm.run({series:data,now:now+4,observation:"reached"})).signals[0].fill).toMatchObject({orderId:"L",price:151});
  });
  it("keeps partial-close quantities and the remaining position across later observations",async()=>{
    const vm=create('//@version=6\nstrategy("Partial",calc_on_every_tick=true)\nif barstate.isrealtime\n    if strategy.position_size==0\n        strategy.entry("L",strategy.long,qty=4)\n    else if strategy.position_size==4\n        strategy.close("L",qty_percent=50,alert_message="Half")');
    const data=series();await vm.run({series:data,now:now+1});tick(data,100);await vm.run({series:data,now:now+2,observation:"place"});tick(data,101);await vm.run({series:data,now:now+3,observation:"entry"});tick(data,102);
    expect((await vm.run({series:data,now:now+4,observation:"partial"})).signals[0].fill).toMatchObject({contracts:2,positionSize:2,previousPositionSize:4,alertMessage:"Half"});
    tick(data,103);expect((await vm.run({series:data,now:now+5,observation:"hold"})).signals).toEqual([]);
  });
  it("selects the loss-leg message and comment and preserves strategy.order fields",async()=>{
    const vm=create('//@version=6\nstrategy("Order loss",calc_on_every_tick=true)\nif barstate.isrealtime\n    if strategy.position_size==0\n        strategy.order("O",strategy.long,qty=1,alert_message="Order custom")\n    else\n        strategy.exit("B",stop=95,limit=120,alert_message="Generic",alert_loss="Stop hit",comment_loss="Loss leg")');
    const data=series();await vm.run({series:data,now:now+1});tick(data,100);await vm.run({series:data,now:now+2,observation:"place"});tick(data,101);
    expect((await vm.run({series:data,now:now+3,observation:"entry"})).signals[0].fill?.alertMessage).toBe("Order custom");tick(data,94);
    expect((await vm.run({series:data,now:now+4,observation:"loss"})).signals[0].fill).toMatchObject({action:"sell",leg:"loss",comment:"Loss leg",alertMessage:"Stop hit",positionSize:0});
  });
  it("recalculates a close-only script after its native fill when requested",async()=>{
    const vm=create('//@version=6\nstrategy("Recalculate",calc_on_order_fills=true,process_orders_on_close=true)\nif barstate.isrealtime\n    if strategy.position_size==0\n        strategy.entry("L",strategy.long,qty=1)\n    else\n        alert("Filled",alert.freq_all)');
    const data=series();await vm.run({series:data,now:now+1});
    const result=await vm.run({series:data,now:now+60000,closedBar:now});
    expect(result.signals.map(signal=>signal.type)).toEqual(["order_fill","alert"]);expect(result.signals[1].message).toBe("Filled");
  });
  it("waits for a confirmed close before process_orders_on_close fills a close-only entry",async()=>{
    const vm=create('//@version=6\nstrategy("On close",process_orders_on_close=true)\nif barstate.isrealtime and strategy.position_size==0\n    strategy.entry("L",strategy.long,qty=1)');
    const data=series();await vm.run({series:data,now:now+1});tick(data,100);expect((await vm.run({series:data,now:now+2,observation:"open"})).signals).toEqual([]);
    const result=await vm.run({series:data,now:now+60000,closedBar:now});expect(result.signals[0]).toMatchObject({type:"order_fill",confirmed:true,price:100});
  });
  it("emits separate entry and forced-risk executions with their actual custom messages",async()=>{
    const vm=create('//@version=6\nstrategy("Risk",calc_on_every_tick=true)\nstrategy.risk.max_intraday_filled_orders(1,alert_message="Risk limit")\nif barstate.isrealtime and strategy.position_size==0\n    strategy.entry("L",strategy.long,qty=1,alert_message="Entry")');
    const data=series();await vm.run({series:data,now:now+1});tick(data,100);await vm.run({series:data,now:now+2,observation:"place"});tick(data,101);
    const result=await vm.run({series:data,now:now+3,observation:"risk"});expect(result.signals.map(signal=>signal.fill?.action)).toEqual(["buy","sell"]);
    expect(result.signals[1].fill).toMatchObject({positionSize:0,previousPositionSize:1,alertMessage:"Risk limit"});
  });
  it("retains trailing state across observed price updates and selects its leg message",async()=>{
    const vm=create('//@version=6\nstrategy("Trail",calc_on_every_tick=true)\nif barstate.isrealtime\n    if strategy.position_size==0\n        strategy.entry("L",strategy.long,qty=1)\n    else\n        strategy.exit("Trail","L",trail_points=5,trail_offset=100,alert_trailing="Trail hit")');
    const data=series();await vm.run({series:data,now:now+1});tick(data,100);await vm.run({series:data,now:now+2,observation:"place"});tick(data,101);await vm.run({series:data,now:now+3,observation:"entry"});tick(data,110);expect((await vm.run({series:data,now:now+4,observation:"peak"})).signals).toEqual([]);tick(data,108);
    expect((await vm.run({series:data,now:now+5,observation:"trail"})).signals[0].fill).toMatchObject({action:"sell",leg:"trailing",alertMessage:"Trail hit"});
  });
});
