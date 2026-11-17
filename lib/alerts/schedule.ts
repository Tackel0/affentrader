import type { AlertRule, AlertTrigger } from "@/types/alerts";
import type { AlertLifecycleFields } from "@/types/alerts";
import {expirationReason,lifecycleError} from "./lifecycle";

export interface AlertTiming extends AlertLifecycleFields {
  createdAt?:number;
  lastTriggeredAt?:number;
  trigger?: AlertTrigger;
  frequency: "tick" | "close";
  repeat: boolean;
  expiresAt?: number;
}
export const TRIGGER_LABELS: Record<AlertTrigger, string> = {
  once: "Only once", every_time: "Every time", once_per_bar: "Once per bar",
  once_per_close: "Once per bar close", once_per_minute: "Once per minute",
};
export const isExpired = (alert: Pick<AlertTiming, "expiresAt"|"createdAt"|"lastTriggeredAt"|"activity">, now = Date.now()) => expirationReason(alert,now)!==undefined;
export const closesOnly = (alert: AlertTiming) => alert.trigger ? alert.trigger === "once_per_close" : alert.frequency === "close";
export const oneShot = (alert: AlertTiming) => alert.trigger ? alert.trigger === "once" : !alert.repeat;
export const timingFields = (trigger: AlertTrigger): Pick<AlertTiming, "trigger" | "frequency" | "repeat"> => ({ trigger, frequency: trigger === "once_per_close" ? "close" : "tick", repeat: trigger !== "once" });
export const timingLabel = (alert: AlertTiming) => alert.trigger ? TRIGGER_LABELS[alert.trigger] : `${alert.frequency === "close" ? "Bar close" : "On transition"}${alert.repeat ? " · repeating" : ""}`;
export function validateTiming(alert: AlertTiming): string | null {
  if (alert.trigger !== undefined && !Object.hasOwn(TRIGGER_LABELS, alert.trigger)) return "Unknown trigger frequency.";
  if (alert.expiresAt !== undefined && (!Number.isSafeInteger(alert.expiresAt) || alert.expiresAt <= 0 || alert.expiresAt > 8_640_000_000_000_000)) return "Invalid expiration time.";
  return lifecycleError(alert);
}
export function completedWatchlist(rule: AlertRule, symbols = rule.triggeredSymbols ?? []): boolean {
  return rule.scope.type === "watchlist" && rule.scope.symbols.length > 0 && rule.scope.symbols.every(symbol => symbols.includes(symbol));
}
export function scopeFinished(rule: AlertRule, symbol: string): boolean {
  return oneShot(rule) && rule.scope.type === "watchlist" && (rule.triggeredSymbols ?? []).includes(symbol);
}
export function defaultExpiry(now = Date.now()): number {
  const date = new Date(now), month = date.getUTCMonth() + 2;
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate());
  return Date.UTC(date.getUTCFullYear(), month, day, date.getUTCHours(), date.getUTCMinutes());
}
export function utcInput(time?: number): string {
  return time === undefined || !Number.isFinite(time) || Math.abs(time) > 8_640_000_000_000_000 ? "" : new Date(time).toISOString().slice(0, 19);
}
export function parseUtcInput(text: string): number | undefined {
  if (!text) return undefined;
  const time = Date.parse(`${text}Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, text.length) === text ? time : Number.NaN;
}
