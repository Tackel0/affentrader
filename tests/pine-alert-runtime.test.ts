import { afterEach, describe, expect, it } from "vitest";
import { PineSandbox } from "@/lib/alerts/pineSandbox";
import type { PineAlertSnapshot, PineSeries } from "@/types/pineAlerts";
import type { QuickJSContext } from "quickjs-emscripten-core";
import { PineSession } from "@/lib/alerts/pineSession";
const now=1_800_000_000_000;
const snapshot=(source:string):PineAlertSnapshot=>({source,title:"Probe",inputs:{},libraries:{},selection:{type:"calls"},history:300,chartType:"candles",timezone:"Etc/UTC"});
const series=():PineSeries=>({symbol:"BTCUSDT",timeframe:"1m",info:{timezone:"Etc/UTC",currency:"USDT",mintick:0.01},bars:Array.from({length:50},(_,i)=>({time:now-(49-i)*60_000,open:90,high:95,low:85,close:90,volume:10}))});
const active:PineSandbox[]=[];
afterEach(()=>{for(const vm of active)vm.dispose();active.length=0;});
const create=(source:string)=>{const vm=new PineSandbox(snapshot(source));active.push(vm);return vm;};
describe("isolated Pine alert runtime",()=>{
  it("warms without historical alerts, catalogs false conditions and observes live alert() calls",async()=>{
    const vm=create('//@version=6\nindicator("Probe")\nlevel=input.float(100,"Level")\nif close>level\n    alert("Higher " + str.tostring(close),alert.freq_all)\nalertcondition(close>level,"Above","Above {{close}}")');
    const data=series();
    const warm=await vm.run({series:data,now:now+1});
    expect(warm.signals).toEqual([]);expect(warm.inspection.conditions).toEqual([{id:"alertcondition_0",title:"Above",message:"Above {{close}}"}]);
    expect(warm.inspection.hasCalls).toBe(true);expect(warm.inspection.title).toBe("Probe");
    data.bars[49]={...data.bars[49],high:110,close:110,volume:11};
    const result=await vm.run({series:data,now:now+2});
    expect(result.signals.map(x=>x.type)).toEqual(["alert","alertcondition"]);
    expect(result.signals[0].message).toBe("Higher 110");
  });
  it("preserves varip across ticks and resets on a new actual bar",async()=>{
    const vm=create('//@version=6\nindicator("Counter")\nvarip int count=0\nif barstate.isnew\n    count:=0\ncount+=1\nalert(str.tostring(count),alert.freq_all)');
    const data=series();await vm.run({series:data,now:now+1});
    data.bars[49].volume++;expect((await vm.run({series:data,now:now+2})).signals[0].message).toBe("2");
    data.bars[49].volume++;expect((await vm.run({series:data,now:now+3})).signals[0].message).toBe("3");
    data.bars.push({...data.bars[49],time:now+60_000,volume:1});
    expect((await vm.run({series:data,now:now+60_001})).signals[0].message).toBe("1");
  });
  it("honors native once-per-close calls while observing an unchanged final candle close",async()=>{
    const vm=create('//@version=6\nindicator("Close")\nalert("Confirmed",alert.freq_once_per_bar_close)');
    const data=series();await vm.run({series:data,now:now+1});
    data.bars[49].volume++;expect((await vm.run({series:data,now:now+2})).signals).toEqual([]);
    expect((await vm.run({series:data,now:now+60_000,closedBar:now})).signals[0].message).toBe("Confirmed");
  });
  it("bridges timezone calculations without exposing host globals",async()=>{
    const vm=create('//@version=6\nindicator("Clock")\nalert(str.format_time(time,"HH:mm","America/New_York"),alert.freq_all)');
    const data=series();await vm.run({series:data,now:now+1});data.bars[49].volume++;
    expect((await vm.run({series:data,now:now+2})).signals[0].message).toMatch(/^\d\d:\d\d$/);
  });
  it("uses frozen Heikin-Ashi values and chart flags for live conditions",async()=>{
    const definition=snapshot('//@version=6\nindicator("Heikin values")\nalert(str.tostring(close)+":"+str.tostring(open)+":"+str.tostring(chart.is_heikinashi),alert.freq_all)');
    definition.chartType="heikinashi";const vm=new PineSandbox(definition);active.push(vm);
    const data=series();await vm.run({series:data,now:now+1});
    data.bars[49]={...data.bars[49],open:90,high:120,low:80,close:110,volume:11};
    const result=await vm.run({series:data,now:now+2});
    expect(result.signals[0]).toMatchObject({message:"100:90:true",price:100,bar:{open:90,high:120,low:80,close:100}});
  });
  it("freezes source, inputs and imported library bodies before the first run",async()=>{
    const definition=snapshot('//@version=6\nimport User/Threshold/1 as threshold\nindicator("Frozen")\nlevel=input.float(100,"Level")\nif threshold.above(close,level)\n    alert("Frozen",alert.freq_all)');
    definition.libraries={"User/Threshold/1":'//@version=6\nlibrary("Threshold")\nexport above(float price,float level)=>price>level'};
    definition.inputs={Level:100};
    const vm=new PineSandbox(definition);active.push(vm);
    definition.inputs.Level=200;definition.libraries["User/Threshold/1"]='invalid';definition.source='invalid';
    const data=series();await vm.run({series:data,now:now+1});data.bars[49]={...data.bars[49],high:110,close:110,volume:11};
    expect((await vm.run({series:data,now:now+2})).signals[0].message).toBe("Frozen");
  });
  it("rejects missing libraries and malformed frozen input overrides",async()=>{
    const vm=create('//@version=6\nimport User/Missing/1 as missing\nindicator("Missing")\nplot(close)');
    await expect(vm.run({series:series(),now:now+1})).rejects.toThrow(/Missing|library|resolve/i);
    const definition=snapshot('//@version=6\nindicator("Inputs")\nlength=input.int(10,"Length",minval=1)\nplot(ta.sma(close,length))');
    definition.inputs={Length:0};const invalid=new PineSandbox(definition);active.push(invalid);
    await expect(invalid.run({series:series(),now:now+1})).rejects.toThrow(/Length|range/i);
  });
  it("routes request.security through the supplied series provider",async()=>{
    const vm=create('//@version=6\nindicator("Secondary")\nref=request.security("ETHUSDT","5",close)\nalert(str.tostring(ref),alert.freq_all)');
    const requested:string[]=[];
    const loader=async(symbol:string,timeframe:string)=>{requested.push(`${symbol}:${timeframe}`);const data=series();return {...data,symbol,timeframe,bars:data.bars.map((bar,i)=>({...bar,time:now-(49-i)*(timeframe==='5m'?300000:60000),open:150,high:151,low:149,close:150}))};};
    const data=series();await vm.run({series:data,now:now+1},loader);data.bars[49].volume++;
    const result=await vm.run({series:data,now:now+2},loader);
    expect(requested).toContain("ETHUSDT:5m");expect(result.signals[0].message).toBe("150");
  });
  it("stops on a provider failure rather than inventing a secondary value",async()=>{
    const vm=create('//@version=6\nindicator("Missing data")\nref=request.security("ETHUSDT","5",close)\nalert(str.tostring(ref),alert.freq_all)');
    await expect(vm.run({series:series(),now:now+1},async()=>{throw Error("Provider unavailable");})).rejects.toThrow(/Provider unavailable/);
  });
  it("distinguishes a real observation with unchanged OHLCV from a duplicate poll",async()=>{
    const vm=create('//@version=6\nindicator("Ticks")\nvarip int count=0\nif barstate.isnew\n    count:=0\ncount+=1\nalert(str.tostring(count),alert.freq_all)');
    const data=series();await vm.run({series:data,now:now+1});
    expect((await vm.run({series:data,now:now+2})).signals).toEqual([]);
    expect((await vm.run({series:data,now:now+3,observation:"trade-1"})).signals[0].message).toBe("2");
    expect((await vm.run({series:data,now:now+4,observation:"trade-2"})).signals[0].message).toBe("3");
  });
  it("runs a default strategy's alert calls only on newly confirmed candles",async()=>{
    const vm=create('//@version=6\nstrategy("Strategy calls")\nalert("Closed",alert.freq_all)');
    const data=series();await vm.run({series:data,now:now+1});
    expect((await vm.run({series:data,now:now+2,observation:"trade"})).signals).toEqual([]);
    expect((await vm.run({series:data,now:now+60000,closedBar:now})).signals[0].message).toBe("Closed");
    data.bars.push({...data.bars[49],time:now+60000,volume:1});
    expect((await vm.run({series:data,now:now+60001,observation:"next-trade"})).signals).toEqual([]);
  });
  it("reads the strategy's actual every-tick setting rather than its schema default",async()=>{
    const vm=create('//@version=6\nstrategy("Tick strategy",calc_on_every_tick=true)\nalert("Tick",alert.freq_all)');
    const data=series();const warm=await vm.run({series:data,now:now+1});expect(warm.inspection.title).toBe("Tick strategy");
    data.bars[49].volume++;expect((await vm.run({series:data,now:now+2,observation:"actual-trade"})).signals[0].message).toBe("Tick");
  });
  it("does not expose Node, network or storage through interpreter functions",async()=>{
    const vm=create('//@version=6\nindicator("Isolation")\nplot(close)');await vm.run({series:series(),now:now+1});
    const guest=(vm as unknown as {vm:QuickJSContext}).vm;
    const result=guest.unwrapResult(guest.evalCode('[typeof process,typeof require,typeof fetch,typeof localStorage,__intl.constructor("return typeof process")()].join(",")'));
    expect(guest.getString(result)).toBe(new Array(5).fill("undefined").join(","));result.dispose();
  });
  it("interrupts work exceeding its wall-clock budget",async()=>{
    const vm=new PineSandbox(snapshot('//@version=6\nindicator("Budget")\nplot(close)'),1);active.push(vm);
    await expect(vm.run({series:series(),now:now+1})).rejects.toThrow();
  });
  it("finalizes an observed bar before processing its successor",async()=>{
    const session=new PineSession(snapshot('//@version=6\nindicator("Close transition")\nalert("close",alert.freq_once_per_bar_close)'));
    try{const data=series();await session.observe({series:data,now:now+1});data.bars.push({...data.bars[49],time:now+60000});
      const result=await session.observe({series:data,now:now+60001});expect(result.signals).toHaveLength(1);expect(result.signals[0]).toMatchObject({time:now,confirmed:true});
    }finally{session.dispose();}
  });
  it("warms a fresh Pine context when switching between exchange and simulated sequences",async()=>{
    const session=new PineSession(snapshot('//@version=6\nindicator("Source boundary")\nvarip int count=0\ncount+=1\nalert(str.tostring(count),alert.freq_all)'));
    try {
      const data=series();await session.observe({series:data,now:now+1});data.bars[49].volume++;
      expect((await session.observe({series:data,now:now+2})).signals[0].message).toBe("51");
      data.simulated=true;expect((await session.observe({series:data,now:now+3})).signals).toEqual([]);
      data.bars[49].volume++;expect((await session.observe({series:data,now:now+4})).signals[0].message).toBe("51");
      data.simulated=false;expect((await session.observe({series:data,now:now+5})).signals).toEqual([]);
    } finally { session.dispose(); }
  });
});
