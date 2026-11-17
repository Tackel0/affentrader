"use client";
import { useEffect } from "react";
import { marketService } from "@/lib/market/service";
import { useAlertStore } from "@/stores/useAlertStore";
import { useChartStore } from "@/stores/useChartStore";
import { pineAlertClient } from "@/lib/alerts/pineClient";
import { pineSeries, pineSnapshot } from "@/lib/alerts/pineRules";
import { alertScopeSymbols } from "@/lib/alerts/dependencies";
import { isExpired, scopeFinished } from "@/lib/alerts/schedule";
import { scopeStopped } from "@/lib/alerts/rateLimit";
import { playChime, browserNotify } from "@/lib/alerts/notifications";
import { serverAlerts } from "@/lib/alerts/serverClient";
import { useServerStore } from "@/stores/useServerStore";
import { isPopout } from "@/lib/windowScope";
import type { AlertRule } from "@/types/alerts";
import type { PineSeries } from "@/types/pineAlerts";
import { providerOf } from "@/lib/symbolId";
import { pineRunEpoch, pineOwner, pineMarketSource } from "@/lib/alerts/pineRecoveryState";
import { usePineRecoveryStore } from "@/stores/usePineRecoveryStore";
import { browserAlertOwner, editAlerts } from "@/lib/alerts/browserOwnership";
import type { AlertOwnerSnapshot } from "@/lib/alerts/browserLease";

export const pineRuleSignature = (rule: AlertRule) => JSON.stringify([rule.condition, rule.scope, rule.status, rule.rate?.resetAt]);
export async function browserPineSeries(symbol: string, timeframe: string, count: number): Promise<PineSeries> {
  const bars = await marketService.history(symbol, timeframe, count);
  const info = await marketService.velaFeed.symbolInfo?.({ symbol, timeframe });
  return pineSeries(symbol, timeframe, bars, useChartStore.getState().dataSources[`${symbol}:${timeframe}`] === "simulation", info as PineSeries["info"]);
}
export function usePineAlerts(role: AlertOwnerSnapshot) {
  const epoch = useChartStore(state => state.feedEpoch);
  useEffect(() => {
    if (isPopout() || role.status !== "primary") return;
    let disposed = false;
    const lease = browserAlertOwner(), owns = () => !disposed && lease.owns(role.epoch);
    const offOwnership = lease.subscribe(() => { if (!lease.owns(role.epoch)) pineAlertClient.shutdown(); });
    type Entry = { key: string; ruleId: string; symbol: string; signature: string; definition: string; resetAt?: number; ready: boolean; info?: PineSeries["info"] };
    const entries = new Map<string, Entry>();
    const definition = (rule: AlertRule, symbol: string) => JSON.stringify([rule.condition, symbol, rule.scope.timeframe, pineRunEpoch(rule, symbol), useChartStore.getState().marketEpochs[symbol] ?? 0]);
    const evaluate = (entry: Entry, closedBar?: number, prepared?: PineSeries, observation?: string) => {
      const { symbol } = entry;
      const rule = useAlertStore.getState().rules.find(value => value.id === entry.ruleId);
      if (!owns() || !rule || entries.get(entry.key) !== entry) return;
      const current = useAlertStore.getState().rules.find(value => value.id === rule.id);
      if (!current || current.status !== "active" || scopeStopped(current, symbol) || scopeFinished(current, symbol)) return;
      const snapshot = pineSnapshot(current.condition)!;
      const bars = prepared?.bars ?? marketService.barsFor(symbol, current.scope.timeframe).slice(-snapshot.history);
      if (!bars.length) return;
      const key = entry.key, expected = entry.signature;
      const data = prepared ?? pineSeries(symbol, current.scope.timeframe, bars.map(bar => ({ ...bar })), useChartStore.getState().quotes[symbol]?.simulated, entry.info);
      void pineAlertClient.run(key, expected, snapshot, { series: data, now: Date.now(), closedBar, observation }, browserPineSeries, { owner: key, epoch: pineRunEpoch(current, symbol)!, expected: current.pineCursors?.[symbol]?.[pineMarketSource(data.simulated)] }).then(async result => {
        if (!owns() || entries.get(key) !== entry) return;
        if (!("deliveries" in result)) throw new Error("Pine recovery result is missing its committed journal.");
        usePineRecoveryStore.getState().update({ owner: key, completed: result.restored, total: result.restored });
        for (const batch of result.deliveries) {
          const committed = await editAlerts(store => {
            const latest = store.rules.find(value => value.id === rule.id);
            if (!latest || definition(latest, symbol) !== entry.definition) return;
            return {latest, events:store.recordPineBatch(rule.id,batch)};
          }, () => owns() && entries.get(key) === entry);
          if (!owns() || !committed) return;
          const {latest,events}=committed;
          pineAlertClient.acknowledge(`${key}:${pineMarketSource(batch.series.simulated)}`, batch.cursor.id, batch.cursor.sequence);
          for (const event of events) {
            const body = `${event.message}${event.strategyFill ? " · EMULATED FILL" : ""}${event.simulated ? " · SIMULATION" : ""}`;
            useChartStore.getState().toast(event.name, body, "success");
            if (latest.sound) playChime(); if (latest.browserNotification) browserNotify(event.name, body);
            const serverKey = useServerStore.getState().key;
            if (latest.webhook && serverKey) void serverAlerts.forward(serverKey, event, latest.webhook).catch(error => useChartStore.getState().toast("Webhook not queued", String(error), "error"));
          }
        }
      }).catch(error => {
        if (!owns() || entries.get(key) !== entry) return;
        const latest = useAlertStore.getState().rules.find(value => value.id === rule.id);
        if (!latest || definition(latest, symbol) !== entry.definition) return;
        void editAlerts(store=>{const value=store.rules.find(value=>value.id===rule.id);if(value&&definition(value,symbol)===entry.definition)store.updateRule(rule.id,{status:"stopped",stop:{reason:"script_error",time:Date.now(),detail:String(error instanceof Error?error.message:error).slice(0,500)}});},owns).catch(()=>useChartStore.getState().toast("Pine recovery storage unavailable","The alert stopped before notifying. Its journal was retained.","error"));
      });
    };
    let retained = "";
    const reconcile = () => {
      if (!owns()) return;
      if (useAlertStore.getState().rules.some(rule => rule.kind === "pine" && !rule.serverSide && !rule.pineEpoch)) { void editAlerts(store=>store.ensurePineEpochs(),owns).catch(error=>useChartStore.getState().toast("Pine alerts not prepared",String(error),"error")); return; }
      const owners = useAlertStore.getState().rules.filter(rule => rule.kind === "pine" && !rule.serverSide).flatMap(rule => (rule.scope.type === "symbol" ? [rule.scope.symbol] : rule.scope.symbols).flatMap(symbol => ["exchange", "simulation"].map(source => ({ owner: `${pineOwner(rule.id, symbol)}:${source}`, epoch: pineRunEpoch(rule, symbol)! }))));
      const nextRetained = JSON.stringify(owners);
      if (retained !== nextRetained) { retained = nextRetained; pineAlertClient.retain(owners); }
      const wanted = new Set<string>();
      for (const rule of useAlertStore.getState().rules.filter(rule => rule.status === "active" && !rule.serverSide && pineSnapshot(rule.condition) && !isExpired(rule))) for (const symbol of alertScopeSymbols(rule)) {
        if (scopeStopped(rule, symbol) || scopeFinished(rule, symbol)) continue;
        const key = pineOwner(rule.id, symbol), expected = definition(rule, symbol); wanted.add(key);
        const existing = entries.get(key), rearm = existing && existing.resetAt !== rule.rate?.resetAt && (!rule.rate?.resetSymbols || rule.rate.resetSymbols.includes(symbol));
        if (existing && existing.definition === expected && !rearm) { existing.resetAt = rule.rate?.resetAt; continue; }
        if (existing) pineAlertClient.drop(key);
        const entry: Entry = { key, definition: expected, signature: crypto.randomUUID(), ruleId: rule.id, symbol, resetAt: rule.rate?.resetAt, ready: false }; entries.set(key, entry);
        void browserPineSeries(symbol, rule.scope.timeframe, pineSnapshot(rule.condition)!.history).then(data => { if (owns() && entries.get(key) === entry) { entry.info = data.info; entry.ready = true; evaluate(entry, undefined, data); } }).catch(error => {
          if (owns() && entries.get(key) === entry) void editAlerts(store=>store.updateRule(rule.id, { status: "stopped", stop: { reason: "script_error", time: Date.now(), detail: `History unavailable: ${String(error).slice(0, 450)}` } }),()=>owns()&&entries.get(key)===entry).catch(saveError=>useChartStore.getState().toast("Pine alert not saved",String(saveError),"error"));
        });
      }
      for (const key of entries.keys()) if (!wanted.has(key)) { entries.delete(key); pineAlertClient.drop(key); }
    };
    const offStore = useAlertStore.subscribe(reconcile); reconcile();
    const offSources = useChartStore.subscribe((state, previous) => { if (state.marketEpochs !== previous.marketEpochs) reconcile(); });
    const offTick = marketService.onTick(tick => { for (const entry of entries.values()) if (entry.ready && entry.symbol === tick.symbol) evaluate(entry, undefined, undefined, tick.id); });
    const offQuote = marketService.onQuote(quote => { if (providerOf(quote.symbol) === "yahoo") for (const entry of entries.values()) if (entry.ready && entry.symbol === quote.symbol) evaluate(entry, undefined, undefined, `${quote.time}:${quote.price}`); });
    const offClose = marketService.onClose((symbol, timeframe, bar) => { for (const entry of entries.values()) if (entry.ready && entry.symbol === symbol && useAlertStore.getState().rules.find(rule => rule.id === entry.ruleId)?.scope.timeframe === timeframe) evaluate(entry, bar.time); });
    const offCandle = marketService.onCandleUpdate(symbol => { for (const entry of entries.values()) if (entry.ready && entry.symbol === symbol) evaluate(entry); });
    return () => { disposed = true; offOwnership(); offStore(); offSources(); offTick(); offQuote(); offClose(); offCandle(); pineAlertClient.shutdown(); entries.clear(); };
  }, [epoch, role.status, role.epoch]);
}
