import { afterEach,describe,it,expect,vi } from "vitest";
import type { PineAlertSnapshot,PineSeries } from "@/types/pineAlerts";
class WorkerDouble {
  static all:WorkerDouble[]=[];sent:Record<string,unknown>[]=[];terminated=false;
  onmessage?:({data}:{data:Record<string,unknown>})=>void;onerror?:(event:{message:string})=>void;
  constructor(){WorkerDouble.all.push(this);}postMessage(data:Record<string,unknown>){this.sent.push(data);}terminate(){this.terminated=true;}
}
const snapshot:PineAlertSnapshot={source:'//@version=5\nindicator("Inspector")\nplot(close)',title:"Inspector",inputs:{},libraries:{},selection:{type:"calls"},history:50,chartType:"candles",timezone:"UTC"};
const series:PineSeries={symbol:"BTCUSDT",timeframe:"1m",bars:[],info:{}};
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();WorkerDouble.all=[];});
async function clients(){vi.stubGlobal("Worker",WorkerDouble);vi.resetModules();return import("@/lib/alerts/pineClient");}
describe("Pine client generation fencing",()=>{
  it("terminates an old worker and ignores its queued result, error and storage-error messages",async()=>{
    const {pineAlertClient:client}=await clients();const first=client.run("one","a",snapshot,{series,now:1}).catch(error=>error),old=WorkerDouble.all[0];client.shutdown();expect(await first).toBeInstanceOf(Error);expect(old.terminated).toBe(true);
    const second=client.run("two","b",snapshot,{series,now:2}),current=WorkerDouble.all[1],id=current.sent[0].id;
    old.onmessage?.({data:{type:"storage_error",message:"late failure"}});old.onerror?.({message:"late worker error"});old.onmessage?.({data:{type:"result",id,result:{old:true}}});
    current.onmessage?.({data:{type:"result",id,result:{signals:[]}}});expect(await second).toEqual({signals:[]});expect(current.terminated).toBe(false);client.shutdown();
  });
  it("does not route a delayed secondary-series reply into the replacement worker",async()=>{
    const {pineAlertClient:client}=await clients();let resolve!:(series:PineSeries)=>void;const reply=new Promise<PineSeries>(r=>{resolve=r;});
    const first=client.run("one","a",snapshot,{series,now:1},()=>reply).catch(error=>error),old=WorkerDouble.all[0];old.onmessage?.({data:{type:"fetch",id:"series-1",owner:old.sent[0].id,symbol:"ETHUSDT",timeframe:"1m",count:50}});client.shutdown();await first;
    const second=client.run("two","b",snapshot,{series,now:2}),current=WorkerDouble.all[1];resolve(series);await reply;await Promise.resolve();expect(current.sent).toHaveLength(1);expect(old.sent).toHaveLength(1);
    current.onmessage?.({data:{type:"result",id:current.sent[0].id,result:{signals:[]}}});await second;client.shutdown();
  });
  it("keeps one-off input inspection independent of saved-runtime shutdown",async()=>{
    const {pineAlertClient:runtime,pineAlertInspector:inspector}=await clients();const first=runtime.run("saved","a",snapshot,{series,now:1}).catch(error=>error),inspection=inspector.run("inspect","b",snapshot,{series,now:1}),worker=WorkerDouble.all[1];runtime.shutdown();await first;
    worker.onmessage?.({data:{type:"result",id:worker.sent[0].id,result:{inspection:{title:"Inspector"}}}});expect(await inspection).toEqual({inspection:{title:"Inspector"}});expect(worker.terminated).toBe(false);inspector.shutdown();
  });
});
