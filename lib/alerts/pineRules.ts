import type { AlertRule, Condition, RuleEvent } from "@/types/alerts";
import type { PineSignal, PineSeries } from "@/types/pineAlerts";
import { bybitMarket, providerOf, symbolInfo, tickerOf, spotQuoteCurrency } from "@/lib/symbolId";
import { scopeFinished, isExpired } from "./schedule";
import { scopeStopped } from "./rateLimit";
import { strategyRuntimeTimeframe } from "@/lib/strategy/data";
import { isPineOrderFill } from "./pineValidation";

export const pineSnapshot = (condition: Condition) => condition.op === "leaf" && condition.leaf.type === "pine" ? condition.leaf.snapshot : undefined;
export const isPineRule = (rule: AlertRule) => Boolean(pineSnapshot(rule.condition));
export const PINE_FILL_MESSAGE = "{{strategy.order.action}} {{strategy.order.contracts}} {{ticker}} @ {{strategy.order.price}}";
export const pineFillTemplate = (source: string) => source.match(/^\s*\/\/@strategy_alert_message\s+(.+)$/m)?.[1] ?? PINE_FILL_MESSAGE;
export function pineSeries(symbol: string, timeframe: string, bars: PineSeries["bars"], simulated = false, extra: PineSeries["info"] = {}): PineSeries {
  const meta = symbolInfo(symbol), provider = providerOf(symbol), ticker = tickerOf(symbol);
  return { symbol, timeframe, bars, simulated, info: { ticker, tickerid: symbol, main_tickerid: symbol, timezone: provider === "alpaca" ? "America/New_York" : meta?.timezone || "Etc/UTC", description: meta?.name ?? ticker,
    prefix: provider === "alpaca" ? symbol.slice(0, 3) : provider === "yahoo" ? meta?.exchange ?? "YAHOO" : provider.toUpperCase(),
    type: provider === "hyperliquid" || bybitMarket(symbol)?.category === "linear" ? "futures" : provider === "alpaca" || provider === "yahoo" ? meta?.type ?? "stock" : "crypto",
    currency: provider === "alpaca" || provider === "hyperliquid" ? "USD" : provider === "binance" || provider === "bybit" ? spotQuoteCurrency(ticker) : provider === "kraken" ? ticker.split("/")[1] : meta?.currency ?? "", session: provider === "alpaca" || provider === "yahoo" ? "regular" : "24x7", ...extra } };
}
export function pineMessage(message: string, signal: PineSignal, series: PineSeries, now: number): string {
  const bar = signal.bar ?? series.bars.find(bar => bar.time === signal.time) ?? series.bars.at(-1)!;
  const values: Record<string, string | number> = { ticker: tickerOf(series.symbol), exchange: series.info.prefix, interval: strategyRuntimeTimeframe(series.timeframe), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, time: new Date(signal.time).toISOString(), timenow: new Date(now).toISOString() };
  const fill = signal.fill, position = (size: number) => size > 0 ? "long" : size < 0 ? "short" : "flat";
  if (fill) Object.assign(values, { "strategy.order.action": fill.action, "strategy.order.contracts": fill.contracts, "strategy.order.price": fill.price,
    "strategy.order.id": fill.orderId, "strategy.order.comment": fill.comment, "strategy.order.alert_message": fill.alertMessage,
    "strategy.position_size": fill.positionSize, "strategy.market_position": position(fill.positionSize), "strategy.market_position_size": Math.abs(fill.positionSize),
    "strategy.prev_market_position": position(fill.previousPositionSize), "strategy.prev_market_position_size": Math.abs(fill.previousPositionSize) });
  return message.replace(/\{\{(.*?)\}\}/g, (token, key: string) => {
    if (key in values) return String(values[key]);
    const plot = /^plot_(\d+)$/.exec(key)?.[1] ?? /^plot\("(.*)"\)$/.exec(key)?.[1];
    return plot !== undefined && Number.isFinite(signal.plots[plot]) ? String(signal.plots[plot]) : token;
  }).slice(0, 2000);
}
/** Gating reads the latest persisted rule for every event, including multi-call observations. */
export function pineEvent(rule: AlertRule, signal: PineSignal, series: PineSeries, now: number, source: "browser" | "server"): RuleEvent | undefined {
  const snapshot = pineSnapshot(rule.condition), symbol = series.symbol;
  if (!snapshot || rule.status !== "active" || isExpired(rule, now) || scopeStopped(rule, symbol) || scopeFinished(rule, symbol)) return;
  const condition = snapshot.selection.type === "condition";
  const fill = signal.type === "order_fill";
  if (fill ? !["orders", "both"].includes(snapshot.selection.type) || !isPineOrderFill(signal.fill) : condition ? signal.type !== "alertcondition" || signal.id !== (snapshot.selection as { id: string }).id : !["calls", "both"].includes(snapshot.selection.type) || signal.type !== "alert") return;
  const mode = fill ? "every_time" : condition ? rule.trigger ?? "once_per_close" : signal.freq === "all" ? "every_time" : signal.freq === "once_per_bar_close" ? "once_per_close" : "once_per_bar";
  if (mode === "once_per_close" && !signal.confirmed) return;
  const key = fill ? "order_fills" : condition ? signal.id : "alert_calls", gate = rule.scriptState?.[symbol]?.[key];
  if (fill && gate?.token === signal.fill!.id) return;
  if ((mode === "once_per_bar" || mode === "once_per_close") && gate?.bar === signal.time) return;
  if (mode === "once_per_minute" && gate && now - gate.time < 60_000) return;
  if (rule.cooldownMs > 0 && rule.lastFired?.[symbol] && now - rule.lastFired[symbol].time < rule.cooldownMs) return;
  const template = fill ? rule.message || pineFillTemplate(snapshot.source) : signal.type === "alert" ? signal.message : rule.message || signal.message || signal.title || snapshot.title;
  return { id: crypto.randomUUID(), ruleId: rule.id, name: rule.name, symbol, timeframe: series.timeframe, price: signal.price, time: now, message: `${symbol}: ${pineMessage(template, signal, series, now)}`, source, simulated: series.simulated,
    barTime: signal.time, scriptGate: { key, bar: signal.time, ...(fill ? { token: signal.fill!.id } : {}) }, ...(fill ? { strategyFill: signal.fill } : {}) };
}
