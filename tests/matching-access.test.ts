import {describe,it,expect,vi} from "vitest";
import {ExecutionLease,type BrowserLocks} from "@/lib/browser/coordination";
import {inspectPaperLocks} from "@/lib/trading/lockInspection";
const settle=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
describe("matching access evidence",()=>{
  it("distinguishes a separate holder from duplicate coordinators in one browser context",async()=>{
    const held=[{name:"affentrader-paper-execution-v1",clientId:"holder"}],pending=[{name:"affentrader-paper-execution-v1",clientId:"waiter"}];expect(await inspectPaperLocks({query:async()=>({held,pending})})).toMatchObject({matchingContexts:2,holderAlsoWaiting:false});pending.push({name:"affentrader-paper-execution-v1",clientId:"holder"});expect(await inspectPaperLocks({query:async()=>({held,pending})})).toMatchObject({matchingContexts:2,holderAlsoWaiting:true});
  });
  it("counts only paper locks without exposing browser client identifiers",async()=>{
    const query=vi.fn(async()=>({held:[{name:"affentrader-paper-execution-v1",mode:"exclusive" as const,clientId:"private-context"},{name:"affentrader-paper-write-v1"},{name:"unrelated"}],pending:[{name:"affentrader-paper-execution-v1"},{name:"affentrader-paper-execution-v1"},{name:"affentrader-paper-write-v1"}]}));
    const result=await inspectPaperLocks({query});expect(result).toEqual({executionHeld:1,executionWaiting:2,writesHeld:1,writesWaiting:1,matchingContexts:null,holderAlsoWaiting:null});expect(JSON.stringify(result)).not.toContain("private-context");expect(query).toHaveBeenCalledOnce();
  });
  it("does not invent a holder when query reports no locks",async()=>expect(await inspectPaperLocks({query:async()=>({})})).toEqual({executionHeld:0,executionWaiting:0,writesHeld:0,writesWaiting:0,matchingContexts:0,holderAlsoWaiting:false}));
  it("reports unavailable inspection and query failures",async()=>{await expect(inspectPaperLocks({} as LockManager)).rejects.toThrow(/cannot inspect/);await expect(inspectPaperLocks({query:async()=>{throw new Error("denied");}})).rejects.toThrow("denied");});
  it("distinguishes idle, waiting, preparing and running without claiming ownership early",async()=>{
    let grant!:()=>void,finish!:()=>void;
    const preparing=new Promise<void>(resolve=>{finish=resolve;});
    const locks:BrowserLocks={request:async<T>(_name:string,_options:unknown,callback:()=>Promise<T>)=>{await new Promise<void>(resolve=>{grant=resolve;});return callback();}};
    const lease=new ExecutionLease(locks,()=>preparing,"test","unsupported");expect(lease.snapshot().phase).toBe("idle");lease.start();expect(lease.snapshot().phase).toBe("waiting");grant();await settle();expect(lease.snapshot()).toMatchObject({status:"standby",phase:"preparing"});expect(lease.owns(0)).toBe(false);finish();await settle();expect(lease.snapshot()).toMatchObject({status:"primary",phase:"running",epoch:1});lease.stop();expect(lease.snapshot()).toMatchObject({status:"standby",phase:"idle"});
  });
  it("cannot publish a canceled preparation as running",async()=>{
    let finish!:()=>void;const locks:BrowserLocks={request:async(_name,_options,callback)=>callback()};const lease=new ExecutionLease(locks,()=>new Promise<void>(resolve=>{finish=resolve;}),"test","unsupported");lease.start();await settle();lease.stop();finish();await settle();expect(lease.snapshot()).toMatchObject({phase:"idle",epoch:0});
  });
  it("marks unsupported or failed preparation explicitly",async()=>{
    const unsupported=new ExecutionLease(undefined,async()=>{},"test","unsupported");unsupported.start();expect(unsupported.snapshot()).toMatchObject({phase:"failed",status:"unavailable"});
    const locks:BrowserLocks={request:async(_name,_options,callback)=>callback()};const lease=new ExecutionLease(locks,async()=>{throw new Error("unreadable");},"test","unsupported");lease.start();await settle();expect(lease.snapshot()).toMatchObject({phase:"failed",status:"unavailable",error:"unreadable"});lease.stop();
  });
});
