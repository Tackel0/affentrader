import type { Condition } from "@/types/alerts";
import type { TpoAlertSettings } from "@/types/tpoAlerts";
import type { RuleScope } from "./rules";
import { tpoAlertHistory } from "./tpo";
import { tpoExplicitTape, type TpoCandleQuery, type TpoTape } from "@/lib/orderflow/tpoCandleSource";
import { intervalMs } from "@/lib/market/intervals";
export interface TpoHistoryView extends RuleScope { tape: TpoTape; count: number }
export const tpoHistoryKey = (symbol: string, timeframe: string, tape: TpoTape) => JSON.stringify([symbol, timeframe, tape]);
export function requiredTpoHistory(condition: Condition, scope: RuleScope): TpoHistoryView[] {
  const found = new Map<string, TpoHistoryView>();
  const visit = (node: Condition) => {
    if (node.op !== "leaf") { node.conditions.forEach(visit); return; }
    if (node.leaf.type !== "tpo") return;
    const { settings } = node.leaf, symbol = node.leaf.symbol ?? scope.symbol, timeframe = node.leaf.timeframe ?? scope.timeframe;
    const tape = tpoExplicitTape(symbol, settings); if (!tape) return;
    const key = tpoHistoryKey(symbol, timeframe, tape), count = tpoAlertHistory(settings, timeframe);
    if ((found.get(key)?.count ?? 0) < count) found.set(key, { symbol, timeframe, tape, count });
  };
  visit(condition); return [...found.values()];
}
export function tpoAlertQuery(view: TpoHistoryView, now: number, epoch: string): TpoCandleQuery {
  const to = Math.floor(now / 15000) * 15000;
  return { ...view, from: Math.floor((to - view.count * intervalMs(view.timeframe) / .28) / 86400000) * 86400000 - 86400000,
    to, adjustDividends: false, epoch };
}
export const tpoSettingsTape = (symbol: string, settings: TpoAlertSettings) => tpoExplicitTape(symbol, settings);
