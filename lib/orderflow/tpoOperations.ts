import type { TpoPreferences } from "./tpoSettings";
export interface TpoOperations { scope: string; links: [number, number][]; expanded: [number, boolean][] }
export const emptyTpoOperations = (): TpoOperations => ({ scope: "", links: [], expanded: [] });
const stamp = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && Math.abs(n) <= 8640000000000000;
export function validTpoOperations(value: unknown): value is TpoOperations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as TpoOperations;
  return Object.keys(v).length === 3 && typeof v.scope === "string" && v.scope.length <= 512 &&
    Array.isArray(v.links) && v.links.length <= 1024 && v.links.every(p => Array.isArray(p) && p.length === 2 && stamp(p[0]) && stamp(p[1]) && p[0] < p[1]) &&
    new Set(v.links.map(p => p.join(":"))).size === v.links.length &&
    Array.isArray(v.expanded) && v.expanded.length <= 1024 && v.expanded.every(p => Array.isArray(p) && p.length === 2 && stamp(p[0]) && typeof p[1] === "boolean") &&
    new Set(v.expanded.map(p => p[0])).size === v.expanded.length;
}
export function tpoOperationScope(style: TpoPreferences, timeframe: string, symbol?: string): string {
  return JSON.stringify([symbol ?? "", timeframe, style.sessionPeriod ?? "Day", style.sessionZone,
    style.sessionStartMinutes, style.sessionMinutes, style.weekdaysOnly, style.blockMinutes,
    ...((style.tradingHours ?? "Full day") === "Full day" ? [] : [style.tradingHours, style.customStart ?? 0, style.customEnd ?? 0])]);
}
export function scopedTpoOperations(style: TpoPreferences, timeframe: string, symbol?: string): TpoOperations {
  const scope = tpoOperationScope(style, timeframe, symbol);
  return validTpoOperations(style.sessionOperations) && style.sessionOperations.scope === scope ? style.sessionOperations : { ...emptyTpoOperations(), scope };
}
export type TpoSessionAction = "expand" | "collapse" | "previous" | "following" | "unmerge" | "unmerge-all";
export function changeTpoOperations(ops: TpoOperations, groups: readonly (readonly number[])[], index: number, action: TpoSessionAction): TpoOperations {
  const next = structuredClone(ops), group = groups[index]; if (!group) return next;
  if (action === "expand" || action === "collapse") {
    next.expanded = next.expanded.filter(p => p[0] !== group[0]); next.expanded.push([group[0], action === "expand"]);
    if (next.expanded.length > 1024) next.expanded.shift();
  } else if (action === "unmerge-all") next.links = [];
  else if (action === "unmerge") next.links = next.links.filter(([a, b]) => !group.includes(a) || !group.includes(b));
  else {
    const a = action === "previous" ? groups[index - 1]?.at(-1) : group.at(-1), b = action === "previous" ? group[0] : groups[index + 1]?.[0];
    if (a !== undefined && b !== undefined && a < b && !next.links.some(p => p[0] === a && p[1] === b) && next.links.length < 1024) next.links.push([a, b]);
  }
  return next;
}
