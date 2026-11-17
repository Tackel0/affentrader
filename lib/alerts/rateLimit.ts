import type { AlertRateFields, AlertRateState, AlertRule, AlertStop } from "@/types/alerts";
import { isSymbolId } from "@/lib/symbolId";
import { isExpired } from "./schedule";

export const RATE_WINDOW_MS = 180_000;
export const SYMBOL_TRIGGER_LIMIT = 15;
export const WATCHLIST_TRIGGER_LIMIT = 1000;

export function freshRate(now = Date.now(), before?: AlertRateState): AlertRateState {
  return { recent: [], stoppedSymbols: {}, resetAt: Math.max(now, (before?.resetAt ?? -1) + 1) };
}
export function resumeRate(before?: AlertRateState, now = Date.now()): AlertRateState {
  return { ...freshRate(now, before), recent: before?.recent ?? [], stoppedSymbols: before?.stoppedSymbols ?? {} };
}
export function scopeStopped(alert: AlertRateFields, symbol: string): boolean {
  return Boolean(alert.stop || alert.rate?.stoppedSymbols && Object.hasOwn(alert.rate.stoppedSymbols, symbol));
}
export interface TriggerAdmission extends AlertRateFields {
  allowed: boolean;
  rate: AlertRateState;
}

/** Count committed firings in a rolling window, independently of the display log. */
export function admitTrigger(alert: AlertRateFields, symbol: string, now: number, watchlist = false): TriggerAdmission {
  const recent = (alert.rate?.recent ?? []).filter(item => item.time > now - RATE_WINDOW_MS);
  const rate: AlertRateState = { ...alert.rate, recent, stoppedSymbols: { ...alert.rate?.stoppedSymbols } };
  if (alert.stop || watchlist && Object.hasOwn(rate.stoppedSymbols, symbol)) return { allowed: false, rate, stop: alert.stop };
  const count = watchlist ? recent.filter(item => item.symbol === symbol).length : recent.length;
  const overallFull = watchlist && recent.length >= WATCHLIST_TRIGGER_LIMIT;
  const symbolFull = count >= SYMBOL_TRIGGER_LIMIT;
  if (overallFull || symbolFull) {
    if (watchlist && !overallFull) rate.stoppedSymbols[symbol] = now;
    return { allowed: false, rate, stop: overallFull || !watchlist ? { reason: overallFull ? "watchlist_rate" : "trigger_rate", time: now } : undefined };
  }
  recent.push({ symbol, time: now });
  const allStopped = watchlist && recent.length >= WATCHLIST_TRIGGER_LIMIT;
  const memberStopped = count + 1 >= SYMBOL_TRIGGER_LIMIT;
  if (watchlist && memberStopped) rate.stoppedSymbols[symbol] = now;
  return { allowed: true, rate, stop: allStopped || !watchlist && memberStopped ? { reason: allStopped ? "watchlist_rate" : "trigger_rate", time: now } : undefined };
}

export function restartRule(rule: AlertRule, now = Date.now(), membersOnly = false): AlertRule {
  if(rule.drawingIssue)throw new Error(rule.drawingIssue);
  if (isExpired(rule, now)) throw new Error("Edit the expiration before restarting this alert.");
  if (!membersOnly) return { ...rule, status: "active", stop: undefined, rate: freshRate(now, rule.rate), triggeredSymbols: [], lastFired: {}, scriptState: {}, lastTriggeredAt: undefined,
    ...(rule.kind === "pine" ? { pineEpoch: crypto.randomUUID(), pineMemberEpochs: {}, pineCursors: {} } : {}) };
  if (rule.scope.type !== "watchlist" || rule.status === "stopped") throw new Error("Restart the entire alert first.");
  const stopped = new Set(Object.keys(rule.rate?.stoppedSymbols ?? {}));
  if (!stopped.size) return rule;
  return { ...rule, rate: { ...freshRate(now, rule.rate), recent: (rule.rate?.recent ?? []).filter(item => !stopped.has(item.symbol)), resetSymbols: [...stopped] },
    lastFired: Object.fromEntries(Object.entries(rule.lastFired ?? {}).filter(([symbol]) => !stopped.has(symbol))), scriptState: Object.fromEntries(Object.entries(rule.scriptState ?? {}).filter(([symbol]) => !stopped.has(symbol))),
    ...(rule.kind === "pine" ? { pineMemberEpochs: { ...rule.pineMemberEpochs, ...Object.fromEntries([...stopped].map(symbol => [symbol, crypto.randomUUID()])) }, pineCursors: Object.fromEntries(Object.entries(rule.pineCursors ?? {}).filter(([symbol]) => !stopped.has(symbol))) } : {}) };
}
export function stopMessage(stop: AlertStop): string {
  if(stop.reason==="drawing_unavailable")return `Drawing stopped: ${stop.detail||"Restore the linked drawing before restarting."}`;
  if (stop.reason === "script_error") return `Script stopped: ${stop.detail || "Pine runtime error."}`;
  return stop.reason === "watchlist_rate" ? "Stopped: 1,000 triggers within 3 minutes across this watchlist." : "Stopped: 15 triggers within 3 minutes.";
}

export function validateRateFields(input: AlertRateFields): string | null {
  const timestamp = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
  if (input.stop !== undefined && (!input.stop || typeof input.stop !== "object" || !["trigger_rate", "watchlist_rate", "script_error", "drawing_unavailable"].includes(input.stop.reason) || !timestamp(input.stop.time) || input.stop.detail !== undefined && (typeof input.stop.detail !== "string" || input.stop.detail.length > 500))) return "Invalid alert stop reason.";
  if (input.rate !== undefined) {
    const rate = input.rate;
    if (!rate || typeof rate !== "object" || !Array.isArray(rate.recent) || rate.recent.length > WATCHLIST_TRIGGER_LIMIT || rate.recent.some(item => !item || typeof item !== "object" || !isSymbolId(item.symbol) || !timestamp(item.time))) return "Invalid alert trigger window.";
    if (!rate.stoppedSymbols || typeof rate.stoppedSymbols !== "object" || Array.isArray(rate.stoppedSymbols) || Object.keys(rate.stoppedSymbols).length > 1000 || Object.entries(rate.stoppedSymbols).some(([symbol, time]) => !isSymbolId(symbol) || !timestamp(time))) return "Invalid stopped alert members.";
    if (rate.resetAt !== undefined && !timestamp(rate.resetAt)) return "Invalid alert reset time.";
    if (rate.resetSymbols !== undefined && (!Array.isArray(rate.resetSymbols) || rate.resetSymbols.length > 1000 || rate.resetSymbols.some(symbol => !isSymbolId(symbol)) || new Set(rate.resetSymbols).size !== rate.resetSymbols.length)) return "Invalid restarted alert members.";
  }
  return null;
}
