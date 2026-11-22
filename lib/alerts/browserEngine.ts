import type { OHLCV } from "@/types/trading";
import type { AlertRule, RuleEvent } from "@/types/alerts";
import { isTickInterval, nextBucket } from "@/lib/market/intervals";
import { isQuoteOnly, requiredViews, requiredHistoryViews, ruleMessage, type MarketView } from "./rules";
import { ruleCadence, stepRule, type RuleRuntimeState } from "./runtime";
import { alertScopeSymbols, membershipOnlyChange } from "./dependencies";
import { closesOnly, isExpired, oneShot, scopeFinished } from "./schedule";
import { scopeStopped } from "./rateLimit";
import { isPineRule } from "./pineRules";
import { requiredTpoHistory, tpoHistoryKey, tpoSettingsTape, type TpoHistoryView } from "./tpoSource";
import type { TpoCandleSnapshot } from "@/lib/orderflow/tpoCandleSource";
export { WATCHLIST_CANDLE_LIMIT } from "./dependencies";

export interface EngineDeps {
  tpoHistory?: (view: TpoHistoryView) => Promise<TpoCandleSnapshot>;
  rules: () => AlertRule[];
  bars: (symbol: string, timeframe: string) => readonly OHLCV[];
  quote: (symbol: string) => MarketView["quote"] | undefined;
  ensure: (symbol: string, timeframe: string, count?: number) => Promise<unknown>;
  fire: (rule: AlertRule, event: RuleEvent) => void;
  now?: () => number;
  candleContext?: (symbol: string, timeframe: string) => MarketView["candleContext"];
}
interface Target { rule: AlertRule; symbol: string }

/** Processes each delivered update; quotes and post-aggregation trades have separate routes. */
export class BrowserRuleEngine {
  private states = new Map<string, RuleRuntimeState>();
  private ensured = new Map<string, number>();
  private unavailable = new Set<string>();
  private signatures = new Map<string, string>();
  private definitions = new Map<string, AlertRule>();
  private completed = new Set<string>();
  private indexedRules?: AlertRule[];
  private index = new Map<string, Target[]>();
  private dataEpoch = 0;
  private tpoHistories = new Map<string, { at: number; count: number; value?: TpoCandleSnapshot; pending: boolean }>();
  constructor(private deps: EngineDeps) {}
  private now() { return this.deps.now?.() ?? Date.now(); }
  private symbolsOf(rule: AlertRule): string[] {
    return alertScopeSymbols(rule);
  }
  private active() { return this.deps.rules().filter(rule => rule.status === "active" && !rule.serverSide && !isPineRule(rule) && !isExpired(rule, this.now())); }
  private targets(market: string): Target[] {
    const rules = this.deps.rules();
    if (rules !== this.indexedRules) {
      this.indexedRules = rules;
      this.index.clear();
      for (const rule of rules.filter(rule => rule.status === "active" && !rule.serverSide && !isPineRule(rule))) {
        for (const symbol of this.symbolsOf(rule)) {
          const markets = new Set([symbol, ...requiredViews(rule.condition, { symbol, timeframe: rule.scope.timeframe }).map(view => view.symbol)]);
          for (const market of markets) this.index.set(market, [...(this.index.get(market) ?? []), { rule, symbol }]);
        }
      }
    }
    return (this.index.get(market) ?? []).filter(target => target.rule.status === "active" && !target.rule.serverSide && !isExpired(target.rule, this.now()) && !scopeStopped(target.rule, target.symbol) && !this.completed.has(`${target.rule.id}:${target.symbol}`) && !scopeFinished(target.rule, target.symbol));
  }
  /** Shared histories are prepared with bounded concurrency and retried after failure. */
  async prepare(): Promise<void> {
    const epoch = this.dataEpoch;
    const jobs: (() => Promise<void>)[] = [];
    const wanted = new Map<string, { symbol: string; timeframe: string; count: number }>();
    const tpoWanted = new Map<string, TpoHistoryView>();
    for (const rule of this.active()) {
      if (isQuoteOnly(rule.condition) && !closesOnly(rule) && rule.trigger !== "once_per_bar") continue;
      for (const symbol of this.symbolsOf(rule)) {
        if (scopeFinished(rule, symbol) || scopeStopped(rule, symbol)) continue;
        if (this.deps.tpoHistory && !this.deps.quote(symbol)?.simulated) for (const view of requiredTpoHistory(rule.condition, { symbol, timeframe: rule.scope.timeframe })) {
          const key = tpoHistoryKey(view.symbol, view.timeframe, view.tape);
          if ((tpoWanted.get(key)?.count ?? 0) < view.count) tpoWanted.set(key, view);
        }
        const views = requiredHistoryViews(rule.condition, { symbol, timeframe: rule.scope.timeframe });
        if (!views.some(view => view.symbol === symbol && view.timeframe === rule.scope.timeframe)) views.push({ symbol, timeframe: rule.scope.timeframe, count: 300 });
        for (const view of views) {
          const key = `${view.symbol}:${view.timeframe}`;
          if (!wanted.has(key) || wanted.get(key)!.count < view.count) wanted.set(key, view);
        }
      }
    }
    for (const key of this.tpoHistories.keys()) if (!tpoWanted.has(key)) this.tpoHistories.delete(key);
    for (const [key, view] of tpoWanted) {
      const cached = this.tpoHistories.get(key);
      if (cached?.pending || cached && cached.count >= view.count && this.now() - cached.at < 15000) continue;
      const entry = { at: this.now(), count: view.count, value: cached?.value, pending: true };
      this.tpoHistories.set(key, entry);
      jobs.push(async () => {
        if (epoch !== this.dataEpoch) return;
        try { const value = await this.deps.tpoHistory!(view); if (epoch === this.dataEpoch && this.tpoHistories.get(key) === entry) entry.value = value; }
        catch { if (epoch === this.dataEpoch) entry.value = undefined; }
        finally { entry.pending = false; entry.at = this.now(); }
      });
    }
    for (const [key, view] of wanted) {
      if ((this.ensured.get(key) ?? 0) >= view.count) continue;
      this.ensured.set(key, view.count);
      jobs.push(async () => {
        if (epoch !== this.dataEpoch) return;
        try {
          await this.deps.ensure(view.symbol, view.timeframe, view.count);
          if (epoch !== this.dataEpoch) return;
          if (!this.deps.bars(view.symbol, view.timeframe).length) throw new Error("No history");
          this.unavailable.delete(key);
        } catch {
          if (epoch !== this.dataEpoch) return;
          if (this.ensured.get(key) === view.count) this.ensured.delete(key);
          this.unavailable.add(key);
        }
      });
    }
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (cursor < jobs.length) await jobs[cursor++]();
    }));
  }
  private resolve = (symbol: string, timeframe: string): MarketView | undefined => {
    const bars = this.deps.bars(symbol, timeframe), quote = this.deps.quote(symbol);
    const tpoSource: MarketView["tpoSource"] = this.deps.tpoHistory ? settings => {
      const tape = tpoSettingsTape(symbol, settings), entry = tape ? this.tpoHistories.get(tpoHistoryKey(symbol, timeframe, tape)) : undefined;
      return entry && this.now() - entry.at < 45000 ? entry.value : undefined;
    } : undefined;
    return bars.length || quote ? { bars, quote, candleContext: this.deps.candleContext?.(symbol, timeframe), tpoSource } : undefined;
  };
  private run(rule: AlertRule, symbol: string, closedThrough?: number) {
    const current = this.deps.rules().find(candidate => candidate.id === rule.id);
    if (!current || current.status !== "active" || scopeStopped(current, symbol)) return;
    rule = current;
    const key = `${rule.id}:${symbol}`, now = this.now();
    let previous = this.states.get(key);
    if (rule.exchangeOnly) {
      const quote = this.deps.quote(symbol);
      if (!quote || quote.simulated !== false || typeof quote.time !== "number" || !Number.isFinite(quote.time) ||
        quote.time < rule.createdAt || quote.time < now - 30 * 60_000 || quote.time > now + 60_000) return;
      previous = { met: false, firedAt: 0, ...previous, initialized: true };
    }
    const step = stepRule(rule, symbol, previous, this.resolve, now, closedThrough);
    this.states.set(key, step.state);
    if (!step.fire || !step.evaluation) return;
    if (oneShot(rule)) this.completed.add(key);
    this.deps.fire(rule, {
      id: crypto.randomUUID(), ruleId: rule.id, name: rule.name, symbol,
      timeframe: rule.scope.timeframe, price: step.evaluation.price, time: now,
      message: ruleMessage(rule, symbol, step.evaluation), source: "browser",
      simulated: this.deps.quote(symbol)?.simulated,
      barTime: step.state.firedBar,
    });
  }
  /** Technical conditions run after aggregation; quote-only conditions run on quote delivery. */
  onPrice(symbol: string, source: "quote" | "trade" | "all" = "all") {
    for (const { rule, symbol: own } of this.targets(symbol)) {
      if (closesOnly(rule)) continue;
      const quoteOnly = isQuoteOnly(rule.condition) && rule.trigger !== "once_per_bar";
      if (source === "quote" && !quoteOnly || source === "trade" && quoteOnly) continue;
      this.run(rule, own);
    }
  }
  onClose(symbol: string, timeframe: string, barTime?: number) {
    for (const { rule, symbol: own } of this.targets(symbol)) {
      if (!closesOnly(rule)) continue;
      const cadence = ruleCadence(rule, own);
      if (cadence.timeframe !== timeframe || !requiredViews(rule.condition, { symbol: own, timeframe: rule.scope.timeframe }).some(view => view.symbol === symbol && view.timeframe === timeframe)) continue;
      const through = barTime === undefined ? undefined : isTickInterval(timeframe) ? barTime : nextBucket(timeframe, barTime);
      this.run(rule, own, through);
    }
  }
  /** Creation, edits and resume establish a baseline and never emit historical signals. */
  prime() {
    const rules = this.deps.rules();
    const active = new Set(rules.filter(rule => rule.status === "active" && !rule.serverSide && !isPineRule(rule)).map(rule => rule.id));
    for (const id of this.signatures.keys()) if (!active.has(id)) this.reset(id);
    for (const rule of rules.filter(rule => rule.status === "active" && !rule.serverSide && !isPineRule(rule))) {
      const signature = JSON.stringify([rule.condition, rule.scope, rule.frequency, rule.repeat, rule.cooldownMs, rule.trigger, rule.expiresAt, rule.exchangeOnly, rule.rate?.resetAt]);
      if (this.signatures.get(rule.id) !== signature) {
        const before = this.definitions.get(rule.id);
        const definition = (value: AlertRule) => JSON.stringify([value.condition, value.scope, value.frequency, value.repeat, value.cooldownMs, value.trigger, value.expiresAt, value.exchangeOnly]);
        if (before && rule.rate?.resetSymbols?.length && before.rate?.resetAt !== rule.rate.resetAt && definition(before) === definition(rule)) {
          for (const symbol of rule.rate.resetSymbols) { this.states.delete(`${rule.id}:${symbol}`); this.completed.delete(`${rule.id}:${symbol}`); }
          this.indexedRules = undefined;
        }
        else if (!membershipOnlyChange(before, rule)) this.reset(rule.id);
        else {
          for (const key of this.states.keys()) if (key.startsWith(`${rule.id}:`) && !this.symbolsOf(rule).includes(key.slice(rule.id.length + 1))) this.states.delete(key);
          for (const key of this.completed) if (key.startsWith(`${rule.id}:`) && !this.symbolsOf(rule).includes(key.slice(rule.id.length + 1))) this.completed.delete(key);
          this.indexedRules = undefined;
        }
        this.signatures.set(rule.id, signature);
        this.definitions.set(rule.id, rule);
      }
      if (rule.exchangeOnly) continue;
      for (const symbol of this.symbolsOf(rule)) {
        if (scopeStopped(rule, symbol)) continue;
        const key = `${rule.id}:${symbol}`;
        const previous = this.states.get(key);
        if (previous?.initialized) continue;
        const step = stepRule(rule, symbol, undefined, this.resolve, this.now());
        const last = rule.lastFired?.[symbol];
        this.states.set(key, { ...step.state, firedAt: previous?.firedAt ?? last?.time ?? (rule.scope.type === "symbol" ? rule.lastTriggeredAt : undefined) ?? 0,
          firedBar: previous?.firedBar ?? last?.bar, hasFired: previous?.hasFired ?? Boolean(last) });
      }
    }
  }
  /** Source restarts discard observations while keeping the last firing's cooldown. */
  invalidateData() {
    this.dataEpoch++;
    this.tpoHistories.clear();
    this.ensured.clear();
    this.unavailable.clear();
    for (const [key, state] of this.states) this.states.set(key, { ...state, quotes: undefined, closedAt: undefined, initialized: false });
  }
  reset(ruleId?: string) {
    if (ruleId) {
      for (const key of this.states.keys()) if (key.startsWith(`${ruleId}:`)) this.states.delete(key);
      this.signatures.delete(ruleId);
      this.definitions.delete(ruleId);
      for (const key of this.completed) if (key.startsWith(`${ruleId}:`)) this.completed.delete(key);
    } else {
      this.states.clear(); this.signatures.clear(); this.definitions.clear(); this.completed.clear();
    }
    this.indexedRules = undefined;
  }
  get missing(): string[] { return [...this.unavailable]; }
}
