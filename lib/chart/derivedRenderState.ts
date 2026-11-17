import { DerivedTransformError } from "./transformCapacity";

export interface DerivedRenderIssue {
  owner: string;
  symbol: string;
  timeframe: string;
  type: string;
  reason: DerivedTransformError["reason"];
  message: string;
}
const issues = new Map<string, { token: symbol; issue: DerivedRenderIssue }>();
const listeners = new Set<() => void>();
export const subscribeDerivedIssues = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const derivedRenderIssue = (layerId: string) => issues.get(layerId)?.issue ?? null;
export function clearDerivedIssue(layerId: string, token: symbol) {
  if (issues.get(layerId)?.token !== token) return;
  issues.delete(layerId); for (const listener of listeners) listener();
}
export function runDerivedPaint(layerId: string, token: symbol, context: Omit<DerivedRenderIssue, "reason" | "message">, paint: () => void) {
  try { paint(); clearDerivedIssue(layerId, token); }
  catch (error) {
    if (!(error instanceof DerivedTransformError)) throw error;
    const issue = { ...context, reason: error.reason, message: error.message }, previous = issues.get(layerId);
    if (previous?.token === token && JSON.stringify(previous.issue) === JSON.stringify(issue)) return;
    issues.set(layerId, { token, issue }); for (const listener of listeners) listener();
  }
}
