"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { alertRawStorage, ALERT_STORAGE_KEY } from "@/lib/alerts/browserPersistence";
import type { AlertLog, PriceAlert } from "@/types/trading";
import type { AlertRule, RuleEvent } from "@/types/alerts";
import { completedWatchlist, isExpired, oneShot } from "@/lib/alerts/schedule";
import { watchlistMembers } from "@/lib/alerts/dependencies";
import { admitTrigger, scopeStopped } from "@/lib/alerts/rateLimit";
import { pineEvent } from "@/lib/alerts/pineRules";
import { pineRunEpoch, pineMarketSource } from "@/lib/alerts/pineRecoveryState";
import type { PineDeliveryBatch } from "@/types/pineAlerts";
import {trackedActivity,editedActivity,triggeredActivity,expirationReason} from "@/lib/alerts/lifecycle";
import { retainedTpoReference } from "@/lib/alerts/tpoDraft";
interface AlertState {
  alerts: PriceAlert[];
  logs: AlertLog[];
  /** Indicator, watchlist and combined alerts. */
  rules: AlertRule[];
  events: RuleEvent[];
  add: (alert: PriceAlert) => void;
  update: (id: string, patch: Partial<PriceAlert>) => void;
  edit:(id:string,patch:Partial<PriceAlert>,now?:number)=>void;
  remove: (id: string) => void;
  trigger: (
    id: string,
    price: number,
    time: number,
    simulated: boolean,
    barTime?: number,
    observedAt?: number,
  ) => AlertLog | null;
  clearLogs: () => void;
  addRule: (rule: AlertRule) => void;
  updateRule: (id: string, patch: Partial<AlertRule>) => void;
  editRule:(id:string,patch:Partial<AlertRule>,now?:number)=>void;
  removeRule: (id: string) => void;
  /** Replace every server-side rule with the server's authoritative copy. */
  replaceServerRules: (rules: AlertRule[]) => void;
  /** Record a firing; one-shot rules become `triggered`. */
  recordFiring: (event: RuleEvent) => boolean;
  recordPineBatch: (ruleId: string, batch: PineDeliveryBatch) => RuleEvent[];
  ensurePineEpochs: () => void;
  clearEvents: () => void;
  expire: (now?: number) => void;
  syncWatchlists: (lists: readonly { id: string; symbols: string[] }[]) => AlertRule[];
}
const MAX_EVENTS = 300;
function withValidTpoReference(alert: PriceAlert): PriceAlert {
  return alert.tpoReference === undefined ? alert : { ...alert, tpoReference: retainedTpoReference(alert.tpoReference, alert) };
}
function commitBrowserFiring(rule: AlertRule, event: RuleEvent): { rule: AlertRule; accepted: boolean } {
  const members = rule.scope.type === "symbol" ? [rule.scope.symbol] : rule.scope.symbols;
  if (rule.serverSide || rule.status !== "active" || isExpired(rule, Date.now()) || isExpired(rule, event.time) || scopeStopped(rule, event.symbol) || !members.includes(event.symbol)) return { rule, accepted: false };
  const admission = admitTrigger(rule, event.symbol, event.time, rule.scope.type === "watchlist");
  if (!admission.allowed) return { rule: { ...rule, rate: admission.rate, stop: admission.stop, status: admission.stop ? "stopped" : rule.status }, accepted: false };
  const triggeredSymbols = oneShot(rule) && rule.scope.type === "watchlist" ? [...new Set([...(rule.triggeredSymbols ?? []), event.symbol])] : rule.triggeredSymbols;
  return { accepted: true, rule: { ...rule, activity:triggeredActivity(rule), rate: admission.rate, stop: admission.stop, lastTriggeredAt: event.time, triggeredSymbols,
    scriptState: event.scriptGate ? { ...rule.scriptState, [event.symbol]: { ...rule.scriptState?.[event.symbol], [event.scriptGate.key]: { bar: event.scriptGate.bar, time: event.time, ...(event.scriptGate.token ? { token: event.scriptGate.token } : {}) } } } : rule.scriptState,
    lastFired: { ...rule.lastFired, [event.symbol]: { time: event.time, ...(Number.isFinite(event.barTime) ? { bar: event.barTime } : {}) } },
    status: admission.stop ? "stopped" : oneShot(rule) && (rule.scope.type !== "watchlist" || completedWatchlist(rule, triggeredSymbols)) ? "triggered" : rule.status } };
}
export const useAlertStore = create<AlertState>()(
  persist(
    (set, get) => ({
      alerts: [],
      logs: [],
      rules: [],
      events: [],
      add: (alert) => set((s) => ({ alerts: [...s.alerts, withValidTpoReference({...alert,activity:alert.activity??editedActivity(alert)})] })),
      edit:(id,patch,now=Date.now())=>set(s=>({alerts:s.alerts.map(a=>a.id===id?withValidTpoReference({...a,...patch,activity:editedActivity(a,now),expiration:undefined}):a)})),
      update: (id, patch) =>
        set((s) => ({
          alerts: s.alerts.map((a) => (a.id === id ? withValidTpoReference({ ...a, ...patch }) : a)),
        })),
      remove: (id) =>
        set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),
      trigger: (id, price, time, simulated, barTime, observedAt = Date.now()) => {
        const alert = get().alerts.find(
          (a) => a.id === id && a.status === "active" && !isExpired(a, observedAt) && !scopeStopped(a, a.symbol),
        );
        if (!alert) return null;
        const admission = admitTrigger(alert, alert.symbol, observedAt);
        if (!admission.allowed) {
          set(state => ({ alerts: state.alerts.map(a => a.id === id ? { ...a, rate: admission.rate, stop: admission.stop, status: admission.stop ? "stopped" : a.status } : a) }));
          return null;
        }
        const log: AlertLog = {
          id: crypto.randomUUID(),
          alertId: id,
          name: alert.name,
          symbol: alert.symbol,
          price,
          time,
          simulated,
          condition: alert.condition,
        };
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id
              ? {
                  ...a,
                  lastTriggeredAt: time,
                  activity:triggeredActivity(a,observedAt),
                  lastTriggeredBar: barTime,
                  rate: admission.rate,
                  stop: admission.stop,
                  status: admission.stop ? "stopped" : oneShot(a) ? "triggered" : "active",
                }
              : a,
          ),
          logs: [log, ...s.logs].slice(0, 200),
        }));
        return log;
      },
      clearLogs: () => set({ logs: [], events: [] }),
      addRule: (rule) => set((s) => ({ rules: [...s.rules, {...rule,activity:rule.activity??editedActivity(rule)}] })),
      editRule:(id,patch,now=Date.now())=>set(s=>({rules:s.rules.map(r=>r.id===id?{...r,...patch,activity:editedActivity(r,now),expiration:undefined}:r)})),
      updateRule: (id, patch) =>
        set((s) => ({
          rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),
      removeRule: (id) =>
        set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
      replaceServerRules: (rules) =>
        set((s) => ({
          rules: [...s.rules.filter((r) => !r.serverSide), ...rules],
        })),
      ensurePineEpochs: () => set(state => state.rules.some(rule => rule.kind === "pine" && !rule.serverSide && !rule.pineEpoch)
        ? { rules: state.rules.map(rule => rule.kind === "pine" && !rule.serverSide && !rule.pineEpoch ? { ...rule, pineEpoch: crypto.randomUUID() } : rule) } : state),
      recordPineBatch: (ruleId, batch) => {
        const accepted: RuleEvent[] = [];
        set(state => {
          const rule = state.rules.find(rule => rule.id === ruleId), symbol = batch.series.symbol, source = pineMarketSource(batch.series.simulated);
          if (!rule || rule.serverSide || pineRunEpoch(rule, symbol) !== batch.cursor.epoch) return state;
          const previous = rule.pineCursors?.[symbol]?.[source];
          if (previous?.id === batch.cursor.id && previous.sequence >= batch.cursor.sequence) return state;
          if (previous && previous.id !== batch.cursor.id) throw new Error("Pine journal identity does not match the saved firing state.");
          let current = rule, events = state.events;
          if (!isExpired(rule, Date.now())) for (const [index, signal] of batch.result.signals.entries()) {
            const event = pineEvent(current, signal, batch.series, batch.cursor.time, "browser");
            if (!event) continue;
            event.id = `pine:${batch.cursor.id}:${batch.cursor.sequence}:${index}`;
            if (events.some(existing => existing.id === event.id)) continue;
            const committed = commitBrowserFiring(current, event); current = committed.rule;
            if (committed.accepted) { accepted.push(event); events = [event, ...events].slice(0, MAX_EVENTS); }
          }
          current = { ...current, pineCursors: { ...current.pineCursors, [symbol]: { ...current.pineCursors?.[symbol], [source]: batch.cursor } } };
          return { rules: state.rules.map(rule => rule.id === ruleId ? current : rule), events };
        });
        return accepted;
      },
      recordFiring: event => {
        let accepted = false;
        set(s => {
          if (s.events.some(e => e.id === event.id)) return s;
          const events = [event, ...s.events].slice(0, MAX_EVENTS);
          // The server snapshot owns its status and counters; replaying event history cannot rearm it.
          if (event.source === "server") { accepted = true; return { events }; }
          const rule = s.rules.find(r => r.id === event.ruleId && !r.serverSide && r.status === "active");
          if (!rule || isExpired(rule, event.time) || scopeStopped(rule, event.symbol)) return s;
          const committed = commitBrowserFiring(rule, event); accepted = committed.accepted;
          return { events: accepted ? events : s.events, rules: s.rules.map(r => r.id === rule.id ? committed.rule : r) };
        });
        return accepted;
      },
      clearEvents: () => set({ events: [] }),
      expire: (now = Date.now()) => set(state => {
        let changed=false;
        const sweep=<T extends PriceAlert|AlertRule>(alert:T):T=>{
          let next=alert;
          if(!next.activity){next={...next,activity:trackedActivity(next,now)};changed=true;}
          const reason=expirationReason(next,now);
          if(["active","paused"].includes(next.status)&&reason){next={...next,status:"expired",expiration:{reason,time:now}};changed=true;}
          return next;
        };
        const alerts=state.alerts.map(sweep),rules=state.rules.map(rule=>rule.serverSide?rule:sweep(rule));
        return changed?{alerts,rules}:state;
      }),
      syncWatchlists: lists => {
        const changed: AlertRule[] = [];
        set(state => {
          const rules = state.rules.map(rule => {
            if (rule.scope.type !== "watchlist") return rule;
            const listId = rule.scope.listId;
            const list = lists.find(list => list.id === listId);
            if (!list) return rule;
            const next = watchlistMembers(rule, list.symbols);
            if (next !== rule) changed.push(next);
            return next;
          });
          return changed.length ? { rules } : state;
        });
        return changed;
      },
    }),
    { name: ALERT_STORAGE_KEY, storage: createJSONStorage(() => alertRawStorage) },
  ),
);
