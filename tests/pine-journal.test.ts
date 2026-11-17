import { afterEach, describe, expect, it } from "vitest";
import { PineJournalSession, deltaSeries, applySeriesDelta } from "@/lib/alerts/pineJournal";
import type { PineAlertSnapshot, PineSeries } from "@/types/pineAlerts";
const now=1_800_000_000_000;
const snapshot=(source:string):PineAlertSnapshot=>({source,title:"Recovery",inputs:{},libraries:{},selection:{type:"both"},history:50,chartType:"candles",timezone:"UTC"});
const series=():PineSeries=>({symbol:"BTCUSDT",timeframe:"1m",simulated:false,info:{timezone:"UTC",currency:"USDT",mintick:0.01},bars:Array.from({length:50},(_,i)=>({time:now-(49-i)*60_000,open:90,high:95,low:85,close:90,volume:10}))});
const tick=(data:PineSeries,price:number)=>{const last=data.bars.at(-1)!;last.close=price;last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);last.volume++;};
const active:PineJournalSession[]=[];
const create=(definition:PineAlertSnapshot,journal?:PineJournalSession["journal"])=>{const value=new PineJournalSession(definition,{epoch:"run-1",journal:journal?JSON.parse(JSON.stringify(journal)):undefined,expected:journal?.acknowledged?{id:journal.id,sequence:journal.acknowledged}:undefined});active.push(value);return value;};
afterEach(()=>{for(const value of active)value.dispose();active.length=0;});
describe("durable Pine observation replay",()=>{
  it("encodes only actual candle changes, removals and metadata without mixing sources",()=>{
    const before=series(),after=structuredClone(before);after.bars.splice(10,1);after.bars.shift();tick(after,100);after.info.currency="USD";after.simulated=true;
    const delta=deltaSeries(before,after);expect(delta.bars).toHaveLength(1);expect(delta.remove).toHaveLength(1);
    expect(applySeriesDelta(before,delta,after.symbol,after.timeframe,false)).toEqual(after);
  });
  it("recovers a live-only position, its pending bracket and Pine variables from JSON",async()=>{
    const definition=snapshot('//@version=6\nstrategy("Recover position",calc_on_every_tick=true)\nvarip int observations=0\nif barstate.isrealtime\n    observations+=1\n    if strategy.position_size==0\n        strategy.entry("L",strategy.long,qty=1)\n    else\n        strategy.exit("B","L",limit=120,stop=80,alert_profit="Target")\n    alert(str.tostring(observations),alert.freq_all)');
    const uninterrupted=create(definition),data=series();await uninterrupted.observe({series:data,now:now+1});tick(data,100);await uninterrupted.observe({series:data,now:now+2,observation:"place"});tick(data,101);await uninterrupted.observe({series:data,now:now+3,observation:"entry"});uninterrupted.acknowledge(3);
    const restored=create(definition,uninterrupted.journal);tick(data,121);
    const frame={series:data,now:now+4,observation:"target"};
    const expected=await uninterrupted.observe(frame),actual=await restored.observe(frame);
    expect(actual.signals).toEqual(expected.signals);expect(actual.restored).toBe(3);
    expect(actual.signals.find(signal=>signal.type==="order_fill")?.fill).toMatchObject({orderId:"B",action:"sell",previousPositionSize:1,positionSize:0,alertMessage:"Target"});
    expect(actual.signals.find(signal=>signal.type==="alert")?.message).toBe("3");
  });
  it("restores pending markets and seeded/unseeded random sequences exactly",async()=>{
    const definition=snapshot('//@version=6\nstrategy("Random",calc_on_every_tick=true)\nif barstate.isrealtime\n    if strategy.position_size==0\n        strategy.entry("L",strategy.long,qty=1)\n    alert(str.tostring(math.random())+":"+str.tostring(math.random(seed=42)),alert.freq_all)');
    const first=create(definition),data=series();await first.observe({series:data,now:now+1});tick(data,100);await first.observe({series:data,now:now+2,observation:"pending"});first.acknowledge(2);
    const other=create(definition,first.journal);tick(data,101);const frame={series:data,now:now+3,observation:"filled"};
    expect((await other.observe(frame)).signals).toEqual((await first.observe(frame)).signals);
  });
  it("replays exact secondary replies and only asks the provider for a new observation",async()=>{
    const definition=snapshot('//@version=6\nstrategy("Secondary",calc_on_every_tick=true)\nref=request.security("ETHUSDT","5",close)\nif barstate.isrealtime\n    alert(str.tostring(ref),alert.freq_all)');
    let price=150,calls=0;const loader=async(symbol:string,timeframe:string)=>{calls++;return {...series(),symbol,timeframe,bars:series().bars.map((bar,i)=>({...bar,time:now-(49-i)*300_000,open:price,high:price,low:price,close:price}))};};
    const first=create(definition),data=series();await first.observe({series:data,now:now+1},loader);tick(data,100);await first.observe({series:data,now:now+2,observation:"old"},loader);first.acknowledge(2);
    const other=create(definition,first.journal);price=999;calls=0;tick(data,101);const frame={series:data,now:now+3,observation:"new"};
    const actual=await other.observe(frame,loader);expect(calls).toBe(1);expect(actual.signals).toEqual((await first.observe(frame,loader)).signals);
  });
  it("regenerates unacknowledged signal batches with their original identity and clock",async()=>{
    const definition=snapshot('//@version=6\nstrategy("Outbox",calc_on_every_tick=true)\nif barstate.isrealtime\n    alert("Tick",alert.freq_all)');
    const first=create(definition),data=series();await first.observe({series:data,now:now+1});first.acknowledge(1);tick(data,100);const original=await first.observe({series:data,now:now+2,observation:"uncommitted"});
    const other=create(definition,first.journal);tick(data,101);const output=await other.observe({series:data,now:now+3,observation:"current"});
    expect(output.deliveries.map(batch=>batch.cursor.sequence)).toEqual([2,3]);expect(output.deliveries[0].cursor).toEqual(original.cursor);expect(output.deliveries[0].result.signals).toEqual(original.signals);
  });
  it("rejects corrupt replay evidence and retains a runtime-version mismatch",async()=>{
    const definition=snapshot('//@version=6\nstrategy("Integrity",calc_on_every_tick=true)\nalert("Live",alert.freq_all)');
    const first=create(definition),data=series();await first.observe({series:data,now:now+1});const saved=structuredClone(first.journal!);
    saved.records[0].digest="invalid";await expect(create(definition,saved).observe({series:data,now:now+2})).rejects.toThrow(/verification failed/);
    saved.revision="old";await expect(create(definition,saved).observe({series:data,now:now+2})).rejects.toThrow(/runtime or definition changed/);
  });
  it("refuses missing journals referenced by durable firing state",async()=>{
    const instance=new PineJournalSession(snapshot('//@version=6\nstrategy("Missing")\nplot(close)'),{epoch:"run-1",expected:{id:"missing",sequence:3}});active.push(instance);
    await expect(instance.observe({series:series(),now:now+1})).rejects.toThrow(/missing or older/);
  });
  it("recovers Pine collections and their intrabar mutations rather than only primitive variables",async()=>{
    const definition=snapshot('//@version=6\nstrategy("Collections",calc_on_every_tick=true)\nvarip prices=array.new_float(0)\nif barstate.isrealtime\n    array.push(prices,close)\n    if array.size(prices)>3\n        array.shift(prices)\n    alert(str.tostring(array.size(prices))+":"+str.tostring(array.sum(prices)),alert.freq_all)');
    const first=create(definition),data=series();await first.observe({series:data,now:now+1});
    for(let i=0;i<4;i++){tick(data,100+i);await first.observe({series:data,now:now+2+i,observation:`tick-${i}`});}first.acknowledge(5);
    const restored=create(definition,first.journal);tick(data,104);const frame={series:data,now:now+6,observation:"after-restart"};
    const actual=await restored.observe(frame);expect(actual.signals).toEqual((await first.observe(frame)).signals);expect(actual.signals[0].message).toBe("3:309");
  });
  it("uses the consumer cursor when it is older than the journal acknowledgement",async()=>{
    const definition=snapshot('//@version=6\nstrategy("Older backup",calc_on_every_tick=true)\nif barstate.isrealtime\n    alert("Live",alert.freq_all)');
    const first=create(definition),data=series();await first.observe({series:data,now:now+1});tick(data,100);await first.observe({series:data,now:now+2,observation:"committed"});first.acknowledge(2);
    const restored=new PineJournalSession(definition,{epoch:"run-1",journal:structuredClone(first.journal!),expected:{id:first.journal!.id,sequence:1}});active.push(restored);tick(data,101);
    const result=await restored.observe({series:data,now:now+3,observation:"current"});expect(result.deliveries.map(batch=>batch.cursor.sequence)).toEqual([2,3]);expect(result.deliveries[0].result.signals[0].message).toBe("Live");
  });
  it("rejects changed input evidence even when historical output would remain empty",async()=>{
    const definition=snapshot('//@version=6\nstrategy("Evidence")\nplot(close)'),first=create(definition),data=series();await first.observe({series:data,now:now+1});const saved=structuredClone(first.journal!);saved.records[0].now++;
    await expect(create(definition,saved).observe({series:data,now:now+2})).rejects.toThrow(/verification failed/);
    const bytes=structuredClone(first.journal!);bytes.bytes++;
    await expect(create(definition,bytes).observe({series:data,now:now+2})).rejects.toThrow(/byte count/);
  });
  it("cancels recovery before executing another observation and rejects reuse after disposal",async()=>{
    const definition=snapshot('//@version=6\nstrategy("Cancel")\nplot(close)'),first=create(definition),data=series();await first.observe({series:data,now:now+1});first.acknowledge(1);
    let cancelled=false;const progress:number[]=[];
    const restored=new PineJournalSession(definition,{epoch:"run-1",journal:structuredClone(first.journal!),expected:{id:first.journal!.id,sequence:1},progress:completed=>{progress.push(completed);cancelled=true;},cancelled:()=>cancelled});active.push(restored);
    await expect(restored.observe({series:data,now:now+2})).rejects.toThrow(/cancelled/);expect(progress).toEqual([1]);expect(restored.journal!.records).toHaveLength(1);
    first.dispose();await expect(first.observe({series:data,now:now+3})).rejects.toThrow(/cancelled/);
  });
});
