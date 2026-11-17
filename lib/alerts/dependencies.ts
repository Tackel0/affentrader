import type { AlertRule } from "@/types/alerts";
import { isQuoteOnly, requiredViews } from "./rules";
import { isSection, normalizeSymbol } from "@/lib/watchlist";
import { closesOnly, completedWatchlist, isExpired, oneShot, scopeFinished } from "./schedule";
import {expirationReason} from "./lifecycle";
import { scopeStopped } from "./rateLimit";

export const WATCHLIST_CANDLE_LIMIT = 40;
export function alertScopeSymbols(rule: AlertRule): string[] {
  return rule.scope.type === "symbol" ? [rule.scope.symbol] : rule.scope.symbols.slice(0,
    isQuoteOnly(rule.condition) && !closesOnly(rule) && rule.trigger !== "once_per_bar" ? rule.scope.symbols.length : WATCHLIST_CANDLE_LIMIT);
}
/** Every leaf's market must remain subscribed, even when it differs from the scope. */
export function ruleMarketSubscriptions(rules: readonly AlertRule[]) {
  const streams = new Set<string>(), quotes = new Set<string>();
  for (const rule of rules) {
    if (rule.status !== "active" || rule.serverSide || isExpired(rule)) continue;
    const target = isQuoteOnly(rule.condition) && !closesOnly(rule) && rule.trigger !== "once_per_bar" ? quotes : streams;
    for (const symbol of alertScopeSymbols(rule)) {
      if (scopeFinished(rule, symbol) || scopeStopped(rule, symbol)) continue;
      target.add(symbol);
      for (const view of requiredViews(rule.condition, { symbol, timeframe: rule.scope.timeframe })) target.add(view.symbol);
    }
  }
  return { streams: [...streams].sort(), quotes: [...quotes].filter(symbol => !streams.has(symbol)).sort() };
}

/** Normalize venue aliases without uppercasing case-sensitive Hyperliquid names. */
export function normalizeRuleMarkets(rule: AlertRule): AlertRule {
  const symbol = (value: string) => normalizeSymbol(value) ?? value.trim();
  const condition = (node: AlertRule["condition"]): AlertRule["condition"] => node.op === "leaf"
    ? { ...node, leaf: { ...node.leaf, symbol: node.leaf.symbol ? symbol(node.leaf.symbol) : undefined } }
    : { ...node, conditions: node.conditions.map(condition) };
  return { ...rule, condition: condition(rule.condition), scope: rule.scope.type === "symbol"
    ? { ...rule.scope, symbol: symbol(rule.scope.symbol) }
    : { ...rule.scope, symbols: [...new Set(rule.scope.symbols.filter(entry => !isSection(entry)).map(symbol))] } };
}

export function watchlistMembers(rule: AlertRule, members: readonly string[], now = Date.now()): AlertRule {
  if (rule.scope.type !== "watchlist") return rule;
  const symbols = [...new Set(members.filter(entry => !isSection(entry)))];
  if (JSON.stringify(symbols) === JSON.stringify(rule.scope.symbols)) return rule;
  const triggeredSymbols = (rule.triggeredSymbols ?? []).filter(symbol => symbols.includes(symbol));
  const next = { ...rule, scope: { ...rule.scope, symbols }, triggeredSymbols };
  if (next.lastFired) next.lastFired = Object.fromEntries(Object.entries(next.lastFired).filter(([symbol]) => symbols.includes(symbol)));
  if (next.scriptState) next.scriptState = Object.fromEntries(Object.entries(next.scriptState).filter(([symbol]) => symbols.includes(symbol)));
  if (next.pineMemberEpochs) next.pineMemberEpochs = Object.fromEntries(Object.entries(next.pineMemberEpochs).filter(([symbol]) => symbols.includes(symbol)));
  if (next.pineCursors) next.pineCursors = Object.fromEntries(Object.entries(next.pineCursors).filter(([symbol]) => symbols.includes(symbol)));
  if (next.rate) next.rate = { ...next.rate, recent: next.rate.recent.filter(item => symbols.includes(item.symbol)), stoppedSymbols: Object.fromEntries(Object.entries(next.rate.stoppedSymbols).filter(([symbol]) => symbols.includes(symbol))), resetSymbols: next.rate.resetSymbols?.filter(symbol => symbols.includes(symbol)) };
  const reason=expirationReason(next,now);
  if (reason) {next.status="expired";next.expiration??={reason,time:now};}
  else if (next.status !== "stopped" && oneShot(next) && symbols.length > 0 && completedWatchlist(next)) next.status = "triggered";
  else if (next.status === "triggered" && oneShot(next)) next.status = "active";
  return next;
}
export function membershipOnlyChange(before: AlertRule | undefined, after: AlertRule): boolean {
  if (!before || before.scope.type !== "watchlist" || after.scope.type !== "watchlist") return false;
  if (JSON.stringify(before.scope.symbols) === JSON.stringify(after.scope.symbols)) return false;
  if (before.status !== after.status && !(before.status === "triggered" && after.status === "active" && oneShot(after))) return false;
  const stable = (rule: AlertRule) => ({ ...rule, activity:undefined,expiration:undefined,scope: { ...rule.scope, symbols: [] }, status: "active", triggeredSymbols: [], lastFired: undefined, scriptState: undefined, pineMemberEpochs: undefined, pineCursors: undefined, lastTriggeredAt: undefined, rate: undefined, rateResetAt: rule.rate?.resetAt });
  return JSON.stringify(stable(before)) === JSON.stringify(stable(after));
}
