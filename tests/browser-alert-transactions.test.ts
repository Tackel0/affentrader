import { afterEach,describe,it,expect,vi } from "vitest";
import type { BrowserLocks } from "@/lib/alerts/browserLease";
const fixture=()=>({id:"p",name:"Price",symbol:"BTCUSDT",condition:"crossing" as const,price:150,status:"active" as const,repeat:false,trigger:"once" as const,frequency:"tick" as const,timeframe:"1m",sound:false,browserNotification:false,simulated:false,createdAt:1});
function environment(){
  const disk=new Map<string,string>();let writes=0,quota=false;const storage={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{if(quota)throw new Error("quota");writes++;disk.set(key,value);},removeItem:(key:string)=>disk.delete(key)};
  const tails=new Map<string,Promise<unknown>>();const locks:BrowserLocks={request<T>(name:string,_options:{signal?:AbortSignal},callback:()=>Promise<T>){const result=(tails.get(name)??Promise.resolve()).catch(()=>undefined).then(callback);tails.set(name,result);return result;}};
  vi.stubGlobal("navigator",{locks});vi.stubGlobal("localStorage",storage);return{disk,setQuota:(value:boolean)=>{quota=value;},writes:()=>writes};
}
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
describe("actual persisted browser alert commands",()=>{
  it("preserves a concurrent renewal against a stale tab's inactivity sweep",async()=>{
    const env=environment(),old=Date.UTC(2024,0,10),now=Date.UTC(2026,0,10);vi.resetModules();const first=await import("@/lib/alerts/browserOwnership"),a=await import("@/stores/useAlertStore");await first.editAlerts(store=>store.add({...fixture(),createdAt:old,activity:{trackedAt:old}}));vi.resetModules();const second=await import("@/lib/alerts/browserOwnership");
    await second.editAlerts(store=>store.edit("p",{name:"Renewed"},now));await first.editAlerts(store=>store.expire(now+1));expect(a.useAlertStore.getState().alerts[0]).toMatchObject({name:"Renewed",status:"active",activity:{trackedAt:old,editedAt:now}});expect(JSON.parse(env.disk.get("affentrader-alerts-v1")!).state.alerts[0].expiration).toBeUndefined();
    await first.editAlerts(store=>store.expire(Date.UTC(2027,0,10)+1));expect(a.useAlertStore.getState().alerts[0].expiration?.reason).toBe("inactivity");await second.editAlerts(store=>store.edit("p",{status:"active"},Date.UTC(2027,0,11)));await first.editAlerts(()=>undefined);expect(a.useAlertStore.getState().alerts[0].status).toBe("active");
  });
  it("rolls back expiration and activity migration together when saving fails",async()=>{
    const env=environment(),old=Date.UTC(2024,0,10),now=Date.UTC(2026,0,10);env.disk.set("affentrader-alerts-v1",JSON.stringify({state:{alerts:[{...fixture(),createdAt:old,activity:{trackedAt:old}},{...fixture(),id:"legacy",createdAt:old}],rules:[],logs:[],events:[]}}));vi.resetModules();const {editAlerts}=await import("@/lib/alerts/browserOwnership"),{useAlertStore}=await import("@/stores/useAlertStore");const saved=env.disk.get("affentrader-alerts-v1");env.setQuota(true);
    await expect(editAlerts(store=>store.expire(now))).rejects.toThrow("quota");expect(env.disk.get("affentrader-alerts-v1")).toBe(saved);expect(useAlertStore.getState().alerts[0].status).toBe("active");expect(useAlertStore.getState().alerts[1].activity).toBeUndefined();env.setQuota(false);await editAlerts(store=>store.expire(now));expect(useAlertStore.getState().alerts[0].expiration).toEqual({reason:"inactivity",time:now});expect(useAlertStore.getState().alerts[1].activity).toEqual({trackedAt:now});
  });
  it("merges independent commands from two stale module/store instances without overwriting either",async()=>{
    const env=environment();vi.resetModules();const first=await import("@/lib/alerts/browserOwnership"),a=await import("@/stores/useAlertStore");vi.resetModules();const second=await import("@/lib/alerts/browserOwnership"),b=await import("@/stores/useAlertStore");
    expect(a.useAlertStore.getState().alerts).toHaveLength(0);expect(b.useAlertStore.getState().alerts).toHaveLength(0);
    await Promise.all([first.editAlerts(store=>store.add(fixture())),second.editAlerts(store=>store.add({...fixture(),id:"second"}))]);
    expect(JSON.parse(env.disk.get("affentrader-alerts-v1")!).state.alerts.map((value:{id:string})=>value.id)).toEqual(["p","second"]);
    await first.editAlerts(store=>store.update("p",{status:"paused"}));await second.editAlerts(store=>store.update("second",{price:170}));
    const saved=JSON.parse(env.disk.get("affentrader-alerts-v1")!).state.alerts;expect(saved).toEqual([expect.objectContaining({id:"p",status:"paused"}),expect.objectContaining({id:"second",price:170})]);
  });
  it("commits multiple changes as one snapshot and rolls back memory and disk on quota failure",async()=>{
    const env=environment();vi.resetModules();const {editAlerts}=await import("@/lib/alerts/browserOwnership"),{useAlertStore}=await import("@/stores/useAlertStore");
    await editAlerts(store=>{store.add(fixture());store.add({...fixture(),id:"second"});});expect(env.writes()).toBe(1);const saved=env.disk.get("affentrader-alerts-v1");env.setQuota(true);
    await expect(editAlerts(store=>{store.remove("p");store.add({...fixture(),id:"third"});})).rejects.toThrow("quota");expect(env.disk.get("affentrader-alerts-v1")).toBe(saved);expect(useAlertStore.getState().alerts.map(value=>value.id)).toEqual(["p","second"]);
    env.setQuota(false);await editAlerts(store=>store.update("p",{status:"paused"}));expect(JSON.parse(env.disk.get("affentrader-alerts-v1")!).state.alerts[0].status).toBe("paused");
  });
  it("rolls back a first unsaved command and retains invalid external storage instead of overwriting it",async()=>{
    const env=environment();vi.resetModules();const {editAlerts}=await import("@/lib/alerts/browserOwnership"),{useAlertStore}=await import("@/stores/useAlertStore");env.setQuota(true);
    await expect(editAlerts(store=>store.add(fixture()))).rejects.toThrow("quota");expect(useAlertStore.getState().alerts).toEqual([]);env.setQuota(false);env.disk.set("affentrader-alerts-v1","not json");
    await expect(editAlerts(store=>store.add(fixture()))).rejects.toThrow(/could not be read/);expect(env.disk.get("affentrader-alerts-v1")).toBe("not json");expect(useAlertStore.getState().alerts).toEqual([]);
    const invalid=JSON.stringify({state:{alerts:"invalid",logs:[]}});env.disk.set("affentrader-alerts-v1",invalid);await expect(editAlerts(store=>store.add(fixture()))).rejects.toThrow(/could not be read/);expect(env.disk.get("affentrader-alerts-v1")).toBe(invalid);
  });
});
