import type { AlertRule } from "@/types/alerts";
import { intervalMs, isTickInterval, nextBucket } from "@/lib/market/intervals";
import { closesOnly, isExpired, oneShot, scopeFinished } from "./schedule";
import { scopeStopped } from "./rateLimit";
import { baseVolume, quoteRange } from "@/lib/market/quoteMetrics";
import { drawingCondition,drawingObservationKey } from "./drawing";
import { evaluateCondition, requiredViews, type Evaluation, type MarketView, type RuleScope, type ViewResolver } from "./rules";

type QuoteField = "price" | "changePercent" | "volume" | "high" | "low";
export interface QuoteObservation {
  at: number;
  simulated: boolean;
  fields: Partial<Record<QuoteField, number>>;
}
/** Durable per-rule/scope state; every stored number is finite and JSON-safe. */
export interface RuleRuntimeState {
  tpo?: Record<string, import("@/types/tpoAlerts").TpoAlertObservation>;
  drawing?: import("@/types/drawingAlerts").DrawingObservation;
  met: boolean;
  firedAt: number;
  initialized?: boolean;
  quotes?: Record<string, QuoteObservation>;
  closedAt?: number;
  firedBar?: number;
  hasFired?: boolean;
}
export interface RuleStep {
  state: RuleRuntimeState;
  evaluation?: Evaluation;
  fire: boolean;
}

export function ruleCadence(rule: AlertRule, symbol: string): RuleScope {
  const scope = { symbol, timeframe: rule.scope.timeframe };
  return requiredViews(rule.condition, scope).sort((a, b) => intervalMs(a.timeframe) - intervalMs(b.timeframe))[0] ?? scope;
}
export function confirmedBars(view: MarketView, timeframe: string, through: number) {
  return view.bars.filter(bar => Number.isFinite(bar.time) && (isTickInterval(timeframe) ? bar.time <= through : nextBucket(timeframe, bar.time) <= through));
}
function snapshot(view: MarketView, now: number): QuoteObservation | undefined {
  const quote = view.quote;
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return;
  const range = quoteRange(quote);
  const raw: Record<QuoteField, number | null> = { price: quote.price, changePercent: quote.changePercent, volume: baseVolume(quote), high: range.high, low: range.low };
  const fields: QuoteObservation["fields"] = {};
  for (const field of Object.keys(raw) as QuoteField[]) {
    const value = raw[field];
    if (value !== null && Number.isFinite(value)) fields[field] = value;
  }
  return { at: view.at ?? (Number.isFinite(quote.time) ? quote.time! : now), simulated: Boolean(quote.simulated), fields };
}
function previousQuote(sample: QuoteObservation): NonNullable<MarketView["quote"]> {
  const value = (field: QuoteField) => sample.fields[field] ?? Number.NaN;
  return { price: value("price"), previous: value("price"), changePercent: value("changePercent"), volume: value("volume"), high: value("high"), low: value("low"), time: sample.at, simulated: sample.simulated };
}

/** Evaluate a confirmed candle at its own boundary, never against a later live price. */
export function closeView(view: MarketView, timeframe: string, through: number): MarketView {
  const bars = confirmedBars(view, timeframe, through), last = bars.at(-1), before = bars.at(-2);
  if (!last) return { bars: [], candleContext: view.candleContext, tpoSource: view.tpoSource };
  const end = (time: number) => isTickInterval(timeframe) ? time : nextBucket(timeframe, time);
  const at = end(last.time), previousAt = before ? end(before.time) : at;
  const quote = view.quote;
  const exactSnapshot = quote && Number.isFinite(quote.time) && quote.time! <= at && quote.time! > (before?.time ?? last.time);
  return {
    candleContext: view.candleContext,
    tpoSource: view.tpoSource,
    bars, at, previousAt,
    quote: { price: last.close, previous: before?.close ?? Number.NaN,
      changePercent: exactSnapshot ? quote.changePercent : Number.NaN,
      volume: exactSnapshot ? quote.volume : Number.NaN,
      high: exactSnapshot ? quote.high : Number.NaN,
      low: exactSnapshot ? quote.low : Number.NaN,
      metrics: exactSnapshot ? quote.metrics : undefined,
      time: at, simulated: quote?.simulated,
    },
  };
}

/** One observed state transition, shared by the browser and the persistent runner. */
export function stepRule(rule: AlertRule, symbol: string, previous: RuleRuntimeState | undefined, resolve: ViewResolver, now: number, closedThrough?: number): RuleStep {
  const initial = previous ?? { met: false, firedAt: 0 };
  const drawing=drawingCondition(rule),geometryChanged=Boolean(drawing&&initial.drawing&&initial.drawing.fingerprint!==drawingObservationKey(drawing));
  if (rule.status !== "active" || rule.drawingIssue || isExpired(rule, now) || scopeStopped(rule, symbol) || scopeFinished(rule, symbol) || oneShot(rule) && initial.hasFired) return { state: initial, fire: false };
  const scope = { symbol, timeframe: rule.scope.timeframe };
  const close = closesOnly(rule);
  let boundary: number | undefined;
  if (close) {
    const cadence = ruleCadence(rule, symbol), view = resolve(cadence.symbol, cadence.timeframe);
    if (!view) return { state: initial, fire: false };
    const last = isTickInterval(cadence.timeframe)
      ? closedThrough !== undefined ? view.bars.findLast(bar => bar.time <= closedThrough) : view.bars.at(-2)
      : confirmedBars(view, cadence.timeframe, closedThrough ?? now).at(-1);
    if (!last) return { state: initial, fire: false };
    boundary = isTickInterval(cadence.timeframe) ? last.time : nextBucket(cadence.timeframe, last.time);
    if (initial.closedAt !== undefined && boundary <= initial.closedAt) return { state: initial, fire: false };
  }
  const samples = { ...initial.quotes };
  let sourceChanged = false, stale = false;
  const resolved = new Map<string, MarketView | undefined>();
  const read: ViewResolver = (market, timeframe) => {
    const key = `${market}|${timeframe}`;
    if (resolved.has(key)) return resolved.get(key);
    const input = resolve(market, timeframe);
    if (!input) { resolved.set(key, undefined); return; }
    const view = close ? { ...closeView(input, timeframe, boundary!), timeframe } : { ...input, timeframe, at: input.quote?.time ?? now };
    view.previousDrawing=initial.drawing;
    view.previousTpo=initial.tpo;
    const current = snapshot(view, now), before = initial.quotes?.[key];
    if (current) {
      if (before && current.at < before.at) stale = true;
      if (before && current.simulated !== before.simulated) sourceChanged = true;
      samples[key] = current;
      if (!close && before && current.simulated === before.simulated) {
        view.previousQuote = previousQuote(before);
        view.previousAt = before.at;
      }
    }
    resolved.set(key, view);
    return view;
  };
  const evaluation = evaluateCondition(rule.condition, scope, read);
  if (stale) return { state: initial, fire: false };
  const state: RuleRuntimeState = { ...initial, tpo:evaluation.tpo, drawing:evaluation.drawing??initial.drawing, quotes: samples, initialized: sourceChanged ? false : initial.initialized };
  if (evaluation.incomplete && !evaluation.met) return { state, evaluation, fire: false };
  if (!Number.isFinite(evaluation.price)) return { state, evaluation, fire: false };
  const seeded = initial.initialized ?? (previous !== undefined && previous.quotes === undefined);
  const cadence = ruleCadence(rule, symbol);
  const currentBars = resolve(cadence.symbol, cadence.timeframe)?.bars;
  const currentBar = isTickInterval(cadence.timeframe) ? currentBars?.at(-1)?.time : currentBars?.findLast(bar => bar.time <= now)?.time;
  const barId = close ? boundary : currentBar;
  const eventMatches = rule.trigger ? evaluation.met : evaluation.met && (evaluation.event || !initial.met);
  const minuteReady = rule.trigger !== "once_per_minute" || !(initial.hasFired || initial.firedAt > 0) || now - initial.firedAt >= 60_000;
  const barReady = rule.trigger !== "once_per_bar" || barId !== undefined && barId !== initial.firedBar;
  const fire = seeded && !sourceChanged && !geometryChanged && eventMatches && minuteReady && barReady && (initial.firedAt === 0 && !initial.hasFired || now - initial.firedAt >= rule.cooldownMs);
  state.initialized = true;
  state.met = evaluation.met;
  if (boundary !== undefined) state.closedAt = boundary;
  if (fire) { state.firedAt = now; state.hasFired = true; if (barId !== undefined) state.firedBar = barId; }
  return { state, evaluation, fire };
}
