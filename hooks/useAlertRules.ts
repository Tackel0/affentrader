"use client";
import { useEffect, useRef } from "react";
import { marketService } from "@/lib/market/service";
import { useAlertStore } from "@/stores/useAlertStore";
import { useChartStore } from "@/stores/useChartStore";
import { useServerStore } from "@/stores/useServerStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import { browserNotify, playChime } from "@/lib/alerts/notifications";
import { serverAlerts, ServerError } from "@/lib/alerts/serverClient";
import { requiredQuoteRanges } from "@/lib/alerts/rules";
import { browserAlertOwner, editAlerts } from "@/lib/alerts/browserOwnership";
import type { AlertOwnerSnapshot } from "@/lib/alerts/browserLease";
import type { AlertRule, RuleEvent } from "@/types/alerts";
import { useQuoteRanges } from "./useQuoteRanges";
import { usePineAlerts } from "./usePineAlerts";
import { useDrawingAlerts } from "./useDrawingAlerts";
import { tpoCandlePool } from "@/lib/orderflow/tpoCandleSource";
import { tpoAlertQuery } from "@/lib/alerts/tpoSource";
import { expirationReason } from "@/lib/alerts/lifecycle";

function announce(rule: Pick<AlertRule, "sound" | "browserNotification" | "name">, event: RuleEvent) {
  const message = `${event.message}${event.strategyFill ? " · EMULATED FILL" : ""}${event.simulated ? " · SIMULATION" : ""}`;
  useChartStore.getState().toast(event.name, message, "success");
  if (rule.sound) playChime();
  if (rule.browserNotification) browserNotify(event.name, message);
}
const definition = (r: AlertRule) => JSON.stringify([r.condition,r.scope,r.trigger,r.frequency,r.cooldownMs,r.repeat,r.expiresAt,r.exchangeOnly,r.rate?.resetAt]);
const report = (title: string, error: unknown) => useChartStore.getState().toast(title,error instanceof Error?error.message:String(error),"error");

/** One origin-wide lease owns evaluation and notification; every persisted write is serialized. */
export function useAlertRules(role: AlertOwnerSnapshot) {
  usePineAlerts(role);
  useDrawingAlerts();
  const rules=useAlertStore(s=>s.rules), lists=useWatchlistStore(s=>s.lists), feedEpoch=useChartStore(s=>s.feedEpoch), key=useServerStore(s=>s.key);
  useQuoteRanges(role.status==="primary"?rules.filter(r=>r.status==="active"&&!r.serverSide).flatMap(r=>(r.scope.type==="symbol"?[r.scope.symbol]:r.scope.symbols).flatMap(symbol=>requiredQuoteRanges(r.condition,{symbol,timeframe:r.scope.timeframe}))):[]);
  const engineRef=useRef<BrowserRuleEngine|null>(null);
  useEffect(()=>{
    if(role.status!=="primary")return;
    const valid=()=>browserAlertOwner().owns(role.epoch);
    const engine=new BrowserRuleEngine({
      rules:()=>useAlertStore.getState().rules,
      bars:(symbol,timeframe)=>marketService.barsFor(symbol,timeframe),
      candleContext:(symbol,timeframe)=>{const state=useChartStore.getState(),key=`${symbol}:${timeframe}`;return{
        ready:!state.candleRecoveries[key],generation:JSON.stringify([state.feedEpoch,state.marketEpochs[symbol]??0,state.dataSources[key]??"unknown"])};},
      quote:symbol=>useChartStore.getState().quotes[symbol],
      ensure:(symbol,timeframe,count=300)=>marketService.history(symbol,timeframe,count),
      tpoHistory:view=>{const state=useChartStore.getState();return tpoCandlePool.load(tpoAlertQuery(view,Date.now(),`${state.feedEpoch}:${state.marketEpochs[view.symbol]??0}`));},
      fire:(rule,event)=>{
        void editAlerts(store=>{
          const latest=store.rules.find(candidate=>candidate.id===rule.id);
          return latest&&definition(latest)===definition(rule)&&store.recordFiring(event);
        },valid).then(accepted=>{
          if(!accepted||!valid())return;
          announce(rule,event);
          const server=useServerStore.getState();
          if(rule.webhook?.url&&server.key)void serverAlerts.forward(server.key,event,rule.webhook).catch(error=>report("Webhook not queued",error));
        }).catch(error=>report("Alert event not saved",error));
      },
    });
    engineRef.current=engine;
    const offTick=marketService.onTick(t=>{if(valid())engine.onPrice(t.symbol,"trade");});
    const offQuote=marketService.onQuote(q=>{if(valid())engine.onPrice(q.symbol,"quote");});
    const offCandle=marketService.onCandleUpdate(symbol=>{if(valid())engine.onPrice(symbol,"trade");});
    const offClose=marketService.onClose((symbol,timeframe,bar)=>{if(valid())engine.onClose(symbol,timeframe,bar.time);});
    const sourceTimer=setInterval(()=>{if(valid())void engine.prepare();},15000);
    return()=>{clearInterval(sourceTimer);engine.invalidateData();offTick();offQuote();offClose();offCandle();engineRef.current=null;};
  },[role.status,role.epoch]);
  useEffect(()=>{
    if(role.status!=="primary")return;
    const expire=()=>{
      const now=Date.now();
      const {alerts,rules:currentRules}=useAlertStore.getState();
      const needsSweep=(item:{status:string;activity?:AlertRule["activity"];createdAt?:number;expiresAt?:number;lastTriggeredAt?:number})=>
        !item.activity||((item.status==="active"||item.status==="paused")&&expirationReason(item,now)!==undefined);
      if(!alerts.some(needsSweep)&&!currentRules.some(rule=>!rule.serverSide&&needsSweep(rule)))return;
      void editAlerts(store=>store.expire(),()=>browserAlertOwner().owns(role.epoch)).catch(error=>report("Alert expiration not saved",error));
    };
    expire();const timer=setInterval(expire,1000);return()=>clearInterval(timer);
  },[role.status,role.epoch]);
  useEffect(()=>{engineRef.current?.invalidateData();},[feedEpoch]);
  const signature=JSON.stringify(rules.map(r=>[r.id,r.status,r.serverSide,r.scope,r.condition,r.frequency,r.repeat,r.cooldownMs,r.trigger,r.expiresAt,r.exchangeOnly,r.rate?.resetAt,Object.keys(r.rate?.stoppedSymbols??{})]));
  useEffect(()=>{
    const engine=engineRef.current;if(!engine)return;
    let cancelled=false;engine.prime();void engine.prepare().then(()=>{if(!cancelled)engine.prime();});return()=>{cancelled=true;};
  },[signature,feedEpoch,role.status,role.epoch]);
  const membershipFailures=useRef(new Set<string>());
  useEffect(()=>{
    if(role.status!=="primary")return;
    const valid=()=>browserAlertOwner().owns(role.epoch);
    void editAlerts(store=>store.syncWatchlists(lists),valid).then(async changed=>{
      if(!valid())return;
      for(const rule of changed??[])if(rule.serverSide&&key&&rule.scope.type==="watchlist"){
        try{
          const saved=await serverAlerts.members(key,rule.id,rule.scope.symbols);
          await editAlerts(store=>store.replaceServerRules([...store.rules.filter(r=>r.serverSide&&r.id!==rule.id),saved.rule]),valid);
          membershipFailures.current.delete(rule.id);
        }catch(error){if(valid()&&!membershipFailures.current.has(rule.id)){membershipFailures.current.add(rule.id);report("Server watchlist not updated",error);}}
      }
    }).catch(error=>report("Alert watchlist not saved",error));
  },[lists,rules,key,role.status,role.epoch]);
  const hasServerRules=rules.some(r=>r.serverSide);
  useEffect(()=>{
    if(role.status!=="primary")return;
    if(!key){useServerStore.getState().set({link:"unconfigured",health:null});return;}
    let disposed=false,running=false;
    const valid=()=>!disposed&&browserAlertOwner().owns(role.epoch);
    const sync=async()=>{
      if(running||!valid())return;running=true;
      try{
        const snapshot=await serverAlerts.snapshot(key);if(!valid())return;
        await editAlerts(store=>store.replaceServerRules(snapshot.rules),valid);if(!valid())return;
        const server=useServerStore.getState();server.set({link:"connected",health:snapshot.runner});
        const fresh=await serverAlerts.events(key,server.cursor||(snapshot.cursor>100?snapshot.cursor-100:0));if(!valid())return;
        await editAlerts(store=>{
          for(const event of fresh.events){
            if(event.source!=="server"||!store.recordFiring(event))continue;
            announce(snapshot.rules.find(r=>r.id===event.ruleId)??{name:event.name,sound:true,browserNotification:false},event);
          }
          useServerStore.getState().set({cursor:fresh.cursor});
        },valid);
      }catch(error){if(valid())useServerStore.getState().set({link:error instanceof ServerError&&error.status===401?"unauthorized":"offline"});}
      finally{running=false;}
    };
    useServerStore.getState().set({link:"connecting"});void sync();const timer=setInterval(sync,hasServerRules?10000:30000);
    return()=>{disposed=true;clearInterval(timer);};
  },[key,hasServerRules,role.status,role.epoch]);
}
