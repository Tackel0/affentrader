import { describe,it,expect,vi } from "vitest";
import { AlertWriteQueue,BrowserAlertLease,type BrowserLocks,ALERT_EXECUTION_LOCK,ALERT_WRITE_LOCK } from "@/lib/alerts/browserLease";
import { AlertEvaluator } from "@/lib/alerts/engine";
import type { PriceAlert } from "@/types/trading";

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};};
const settle=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
/** Faithful queued/exclusive/abort behavior; active callbacks keep their lock until settled. */
class Locks implements BrowserLocks {
  private tails=new Map<string,Promise<unknown>>();
  active=new Map<string,number>();max=new Map<string,number>();
  request<T>(name:string,options:{signal?:AbortSignal},callback:()=>Promise<T>):Promise<T>{
    const previous=this.tails.get(name)??Promise.resolve();
    const result=previous.catch(()=>undefined).then(async()=>{
      if(options.signal?.aborted)throw new DOMException("Aborted","AbortError");
      this.active.set(name,(this.active.get(name)??0)+1);this.max.set(name,Math.max(this.max.get(name)??0,this.active.get(name)!));
      try{return await callback();}finally{this.active.set(name,this.active.get(name)!-1);}
    });this.tails.set(name,result);return result;
  }
}
describe("origin-wide browser alert ownership",()=>{
  it("runs exactly one holder and transfers automatically only after synchronous revocation",async()=>{
    const locks=new Locks(),order:string[]=[],first=new BrowserAlertLease(locks,async()=>{order.push("prepare first");}),second=new BrowserAlertLease(locks,async()=>{order.push("prepare second");});
    first.subscribe(()=>{if(first.snapshot().status!=="primary")order.push("first worker stopped");});second.subscribe(()=>{if(second.snapshot().status==="primary")order.push("second worker started");});
    first.start();second.start();await settle();expect(first.snapshot().status).toBe("primary");expect(second.snapshot().status).toBe("standby");const token=first.snapshot().epoch;
    first.stop();expect(first.owns(token)).toBe(false);await settle();expect(second.snapshot().status).toBe("primary");expect(order.indexOf("first worker stopped",1)).toBeLessThan(order.indexOf("second worker started"));expect(locks.max.get(ALERT_EXECUTION_LOCK)).toBe(1);second.stop();
  });
  it("aborts waiting tabs without stealing an active lock",async()=>{
    const locks=new Locks(),first=new BrowserAlertLease(locks,async()=>{}),prepare=vi.fn(async()=>{}),cancelled=new BrowserAlertLease(locks,prepare),third=new BrowserAlertLease(locks,async()=>{});
    first.start();cancelled.start();third.start();await settle();cancelled.stop();first.stop();await settle();expect(prepare).not.toHaveBeenCalled();expect(third.snapshot().status).toBe("primary");third.stop();
  });
  it("does not publish an abandoned acquisition after delayed storage preparation",async()=>{
    const locks=new Locks(),wait=deferred(),first=new BrowserAlertLease(locks,()=>wait.promise),second=new BrowserAlertLease(locks,async()=>{});
    first.start();second.start();await settle();first.stop();expect(first.snapshot().status).toBe("standby");wait.resolve();await settle();expect(first.snapshot().status).toBe("standby");expect(second.snapshot().status).toBe("primary");second.stop();
  });
  it("releases a failed preparation and explicitly disables an unsupported browser",async()=>{
    const locks=new Locks(),first=new BrowserAlertLease(locks,async()=>{throw new Error("Saved alerts are unreadable");}),second=new BrowserAlertLease(locks,async()=>{});
    first.start();second.start();await settle();expect(first.snapshot()).toMatchObject({status:"unavailable",error:"Saved alerts are unreadable"});expect(second.snapshot().status).toBe("primary");first.stop();second.stop();
    const unsupported=new BrowserAlertLease(undefined,async()=>{});unsupported.start();expect(unsupported.snapshot().status).toBe("unavailable");await expect(new AlertWriteQueue(undefined,async()=>{},()=>({})).run(()=>1)).rejects.toThrow(/Web Locks/);
  });
  it("invalidates old epochs after this same tab reacquires ownership",async()=>{
    const first=new BrowserAlertLease(new Locks(),async()=>{});first.start();await settle();const old=first.snapshot().epoch;first.stop();first.start();await settle();expect(first.owns(old)).toBe(false);expect(first.owns(first.snapshot().epoch)).toBe(true);first.stop();
  });
  it("serializes two stale tab edits against the latest durable state",async()=>{
    const locks=new Locks();let disk={first:0,second:0},a={...disk},b={...disk};
    const first=new AlertWriteQueue(locks,async()=>{a={...disk};},()=>a),second=new AlertWriteQueue(locks,async()=>{b={...disk};},()=>b);
    await Promise.all([first.run(state=>{state.first++;disk={...state};}),second.run(state=>{state.second++;disk={...state};})]);expect(disk).toEqual({first:1,second:1});expect(locks.max.get(ALERT_WRITE_LOCK)).toBe(1);
  });
  it("discards a queued event when its owner loses the lease before committing",async()=>{
    const locks=new Locks(),owner=new BrowserAlertLease(locks,async()=>{});owner.start();await settle();const token=owner.snapshot().epoch,hold=deferred();const blocker=locks.request(ALERT_WRITE_LOCK,{},()=>hold.promise);
    const write=vi.fn(),queue=new AlertWriteQueue(locks,async()=>{},()=>({})),pending=queue.run(write,()=>owner.owns(token));owner.stop();hold.resolve();await blocker;expect(await pending).toBeUndefined();expect(write).not.toHaveBeenCalled();
  });
  it("rechecks ownership after asynchronous refresh and releases after a failed write",async()=>{
    const locks=new Locks(),wait=deferred(),action=vi.fn();let valid=true;const queue=new AlertWriteQueue(locks,()=>wait.promise,()=>({}));const pending=queue.run(action,()=>valid);await settle();valid=false;wait.resolve();expect(await pending).toBeUndefined();expect(action).not.toHaveBeenCalled();
    const next=new AlertWriteQueue(locks,async()=>{},()=>({}));await expect(next.run(()=>{throw new Error("quota");})).rejects.toThrow("quota");expect(await next.run(()=>42)).toBe(42);
  });
  it("routes real legacy price transitions through one evaluator and retains saved cadence on takeover",async()=>{
    const locks=new Locks(),owners=[new BrowserAlertLease(locks,async()=>{}),new BrowserAlertLease(locks,async()=>{})],engines=[new AlertEvaluator(),new AlertEvaluator()];
    const alert:PriceAlert={id:"p",name:"Price",symbol:"BTCUSDT",condition:"crossing",price:150,status:"active",repeat:true,trigger:"once_per_minute",frequency:"tick",timeframe:"1m",sound:false,browserNotification:false,simulated:false,createdAt:1};let events=0;
    const tick=(price:number,time:number)=>owners.forEach((owner,index)=>{if(owner.snapshot().status!=="primary")return;for(const id of engines[index].evaluate([alert],"BTCUSDT",price,time,false,"tick",undefined,time)){expect(id).toBe("p");alert.lastTriggeredAt=time;events++;}});
    owners.forEach(owner=>owner.start());await settle();tick(149,1000);tick(151,1001);expect(events).toBe(1);owners[0].stop();await settle();tick(149,1002);tick(151,1003);expect(events).toBe(1);tick(149,62000);expect(events).toBe(2);owners[1].stop();
  });
});
