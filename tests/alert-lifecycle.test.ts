import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {PriceAlert} from "@/types/trading";
import type {AlertRule,RuleEvent} from "@/types/alerts";
import {expirationReason,lifecycleError,yearAfter,expirationLabel} from "@/lib/alerts/lifecycle";
import {useAlertStore} from "@/stores/useAlertStore";
import {membershipOnlyChange,watchlistMembers} from "@/lib/alerts/dependencies";
const OLD=Date.UTC(2024,0,10,12),NOW=Date.UTC(2026,0,10,12);
const price=(patch:Partial<PriceAlert>={}):PriceAlert=>({id:"price",name:"Lifecycle price",symbol:"BTCUSDT",condition:"crossing",price:100,status:"active",repeat:true,frequency:"tick",timeframe:"1m",sound:false,browserNotification:false,simulated:false,createdAt:OLD,activity:{trackedAt:OLD},...patch});
const rule=(patch:Partial<AlertRule>={}):AlertRule=>({id:"rule",name:"Lifecycle rule",kind:"technical",status:"active",scope:{type:"symbol",symbol:"BTCUSDT",timeframe:"1m"},condition:{op:"leaf",leaf:{type:"compare",left:{type:"quote",field:"price"},comparator:">",right:{type:"number",value:100}}},frequency:"tick",repeat:true,cooldownMs:0,sound:false,browserNotification:false,serverSide:false,createdAt:OLD,activity:{trackedAt:OLD},...patch});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);useAlertStore.setState({alerts:[],rules:[],logs:[],events:[]});});
afterEach(()=>vi.useRealTimers());
describe("alert calendar lifetime",()=>{
  it("requires strictly more than a year and clamps UTC leap-day anniversaries",()=>{
    const created=Date.UTC(2024,1,29,15,45,12,345),anniversary=Date.UTC(2025,1,28,15,45,12,345),a=price({createdAt:created,activity:{trackedAt:created}});
    expect(yearAfter(created)).toBe(anniversary);expect(expirationReason(a,anniversary)).toBeUndefined();expect(expirationReason(a,anniversary+1)).toBe("inactivity");expect(yearAfter(Date.UTC(2023,11,31))).toBe(Date.UTC(2024,11,31));
  });
  it.each(["createdAt","trackedAt","editedAt","triggeredAt","lastTriggeredAt"])("keeps a recent %s independently active",field=>{
    const a=price();if(field==="createdAt"||field==="lastTriggeredAt")a[field]=NOW;else a.activity={...a.activity!,[field]:NOW};
    expect(expirationReason(a,NOW)).toBeUndefined();expect(expirationReason(a,yearAfter(NOW)+1)).toBe("inactivity");
  });
  it("does not guess a legacy edit history, while explicit deadlines still apply immediately",()=>{
    expect(expirationReason(price({activity:undefined}),NOW)).toBeUndefined();expect(expirationReason(price({activity:undefined,expiresAt:NOW}),NOW)).toBe("date");expect(expirationReason(price({expiresAt:NOW}),NOW)).toBe("date");
    expect(lifecycleError({activity:{trackedAt:NaN}})).toMatch(/activity/);expect(lifecycleError({expiration:{reason:"inactivity",time:-1}})).toMatch(/expiration/);
  });
});
describe("actual browser alert lifetime state",()=>{
  it("migrates unknown activity once, retaining creation time and server ownership",()=>{
    const store=useAlertStore.getState();store.add(price({activity:undefined}));
    useAlertStore.setState({alerts:[price({activity:undefined})],rules:[rule({activity:undefined}),rule({id:"server",serverSide:true,activity:undefined})]});store.expire(NOW);
    const first=useAlertStore.getState();expect(first.alerts[0]).toMatchObject({createdAt:OLD,activity:{trackedAt:NOW},status:"active"});expect(first.alerts[0].activity!.editedAt).toBeUndefined();expect(first.rules[0].activity).toEqual({trackedAt:NOW});expect(first.rules[1].activity).toBeUndefined();
    store.expire(NOW+1000);expect(useAlertStore.getState().alerts[0]).toBe(first.alerts[0]);
  });
  it("expires active/paused browser subscriptions without touching server or terminal records",()=>{
    useAlertStore.setState({alerts:[price(),price({id:"paused",status:"paused"}),price({id:"done",status:"triggered"})],rules:[rule(),rule({id:"server",serverSide:true})]});useAlertStore.getState().expire(NOW);
    const state=useAlertStore.getState();expect(state.alerts.map(a=>a.status)).toEqual(["expired","expired","triggered"]);expect(state.rules.map(r=>r.status)).toEqual(["expired","active"]);expect(state.alerts[0].expiration).toEqual({reason:"inactivity",time:NOW});expect(expirationLabel(state.alerts[0])).toContain("inactive for over a year");expect(state.logs).toHaveLength(0);
  });
  it("renews only explicit edits and preserves trustworthy trigger history through rearming",()=>{
    useAlertStore.setState({alerts:[price()],rules:[rule()]});const store=useAlertStore.getState();store.update("price",{name:"Automatic metadata"});store.updateRule("rule",{drawingIssue:"Unavailable"});store.expire(NOW);expect(useAlertStore.getState().alerts[0].status).toBe("expired");
    store.edit("price",{status:"active",activity:{trackedAt:0}},NOW);store.editRule("rule",{status:"active",drawingIssue:undefined},NOW);store.expire(NOW+1);expect(useAlertStore.getState().alerts[0]).toMatchObject({createdAt:OLD,status:"active",activity:{trackedAt:OLD,editedAt:NOW}});expect(useAlertStore.getState().alerts[0].expiration).toBeUndefined();expect(useAlertStore.getState().rules[0].activity!.editedAt).toBe(NOW);
    store.trigger("price",101,OLD,false,OLD,NOW+100);store.update("price",{lastTriggeredAt:undefined});expect(useAlertStore.getState().alerts[0].activity!.triggeredAt).toBe(NOW+100);store.expire(yearAfter(NOW)+1);expect(useAlertStore.getState().alerts[0].status).toBe("active");
  });
  it("rejects an aged firing even if the queued event's own timestamp precedes expiration",()=>{
    useAlertStore.setState({alerts:[price()],rules:[rule()]});const event:RuleEvent={id:"event",ruleId:"rule",name:"old",symbol:"BTCUSDT",timeframe:"1m",price:101,time:OLD+1000,message:"old",source:"browser"};
    expect(useAlertStore.getState().recordFiring(event)).toBe(false);expect(useAlertStore.getState().trigger("price",101,OLD+1000,false,undefined,NOW)).toBeNull();expect(useAlertStore.getState().events).toEqual([]);
  });
  it("does not renew activity when watchlist membership or runtime bookkeeping changes",()=>{
    const before=rule({kind:"watchlist",scope:{type:"watchlist",listId:"list",symbols:["BTCUSDT"],timeframe:"1m"},activity:{trackedAt:NOW}}),after=watchlistMembers({...before,activity:{trackedAt:NOW,triggeredAt:NOW+1}},["BTCUSDT","ETHUSDT"],NOW+2);
    expect(membershipOnlyChange(before,after)).toBe(true);expect(after.activity!.editedAt).toBeUndefined();
    expect(watchlistMembers(rule({kind:"watchlist",scope:{type:"watchlist",listId:"list",symbols:["BTCUSDT"],timeframe:"1m"}}),["ETHUSDT"],NOW).expiration).toEqual({reason:"inactivity",time:NOW});
  });
});
