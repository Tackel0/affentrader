import type { OHLCV, QuoteMetrics } from "@/types/trading";
import { baseVolume, quoteRange } from "@/lib/market/quoteMetrics";
import type {
  AlertRule,
  Comparator,
  Condition,
  Leaf,
  Operand,
} from "@/types/alerts";
import {
  defaultParameters,
  findTaIndicator,
  highest,
  lowest,
  sma,
  source,
  type Series,
} from "@/lib/ta";
import { detectCandlePatterns } from "@/lib/patterns/candles";
import { isSymbolId } from "@/lib/symbolId";
import { validatePineRecoveryFields } from "./pineRecoveryState";
import { lineValueAt } from "./line";
import { isTickInterval, isValidInterval } from "@/lib/market/intervals";
import { validateTiming } from "./schedule";
import { measureMovement } from "./movement";
import { validateRateFields } from "./rateLimit";
import { validatePineSnapshot } from "./pineValidation";
import { MAX_HISTORY_BARS } from "@/lib/market/klines";
import { describeDrawing, drawingHistory, evaluateDrawing, validateDrawingCondition } from "./drawing";
import type { DrawingObservation } from "@/types/drawingAlerts";
import { evaluateTpo, tpoAlertHistory, validateTpoCondition } from "./tpo";
import type { TpoAlertObservation, TpoAlertSettings } from "@/types/tpoAlerts";
import type { TpoCandleSnapshot } from "@/lib/orderflow/tpoCandleSource";

/** What the evaluator may know about one market. */
export interface MarketView {
  tpoSource?: (settings: TpoAlertSettings) => TpoCandleSnapshot | undefined;
  candleContext?: { ready: boolean; generation: string };
  previousTpo?: Record<string, TpoAlertObservation>;
  previousDrawing?: DrawingObservation;
  bars: readonly OHLCV[];
  /** Tick charts use collected bar identifiers on a synthetic time grid. */
  timeframe?: string;
  quote?: {
    price: number;
    previous: number;
    changePercent: number;
    volume: number;
    high: number;
    low: number;
    metrics?: QuoteMetrics;
    time?: number;
    simulated?: boolean;
  };
  previousQuote?: MarketView["quote"];
  /** Evaluation clock, independent of wall time for confirmed-bar evaluations. */
  at?: number;
  previousAt?: number;
}

export type ViewResolver = (
  symbol: string,
  timeframe: string,
) => MarketView | undefined;

export interface RuleScope {
  symbol: string;
  timeframe: string;
}

export interface Evaluation {
  tpo?: Record<string, TpoAlertObservation>;
  drawing?: DrawingObservation;
  met: boolean;
  /** Human text describing why, used in notifications. */
  detail: string;
  /** Last price in the rule's own market. */
  price: number;
  /** True when a required market had no data yet. */
  incomplete: boolean;
  /** A crossing/channel transition occurred on this observation. */
  event: boolean;
}

const cache = new WeakMap<readonly OHLCV[], Map<string, Series>>();

function indicatorSeries(
  bars: readonly OHLCV[],
  operand: Extract<Operand, { type: "indicator" }>,
): Series {
  const study = findTaIndicator(operand.indicator);
  if (!study) throw new Error(`Unknown indicator ${operand.indicator}`);
  const last = bars.at(-1);
  const key = `${operand.indicator}|${JSON.stringify(operand.params ?? {})}|${operand.plot ?? ""}|${bars.length}|${last?.time}|${last?.open}|${last?.high}|${last?.low}|${last?.close}|${last?.volume}`;
  let store = cache.get(bars);
  if (!store) {
    store = new Map();
    cache.set(bars, store);
  }
  const hit = store.get(key);
  if (hit) return hit;
  const output = study.compute(bars, {
    ...defaultParameters(study),
    ...(operand.params ?? {}),
  });
  const plot = output.plots.find((p) => p.id === operand.plot) ?? output.plots[0];
  store.set(key, plot.values);
  return plot.values;
}

interface Pair {
  current: number;
  previous: number;
}

function resolveOperand(operand: Operand, view: MarketView): Pair {
  switch (operand.type) {
    case "number":
      return { current: operand.value, previous: operand.value };
    case "quote": {
      const q = view.quote;
      if (!q) return { current: Number.NaN, previous: Number.NaN };
      if (operand.field === "price")
        return { current: q.price, previous: view.previousQuote?.price ?? q.previous };
      const read = (q: NonNullable<MarketView["quote"]>) =>
        operand.field === "changePercent"
          ? q.changePercent
          : operand.field === "volume"
            ? baseVolume(q) ?? Number.NaN
            : operand.field === "high"
              ? quoteRange(q).high ?? Number.NaN
              : quoteRange(q).low ?? Number.NaN;
      const value = read(q);
      return { current: value, previous: view.previousQuote ? read(view.previousQuote) : value };
    }
    case "line": {
      // Price quotes are live, so read the line now; candle values use the bar's own time.
      const times = view.bars.map((b) => b.time);
      const last = times.at(-1);
      const now = view.at ?? (view.quote || last === undefined ? Date.now() : last);
      const before = view.previousAt ?? (view.quote || times.length < 2 ? now : times[times.length - 2]);
      return { current: lineValueAt(operand, now), previous: lineValueAt(operand, before) };
    }
    case "price": {
      const series = source(view.bars, operand.field);
      return {
        current: series.at(-1) ?? Number.NaN,
        previous: series.at(-2) ?? Number.NaN,
      };
    }
    case "indicator": {
      const series = indicatorSeries(view.bars, operand);
      return {
        current: series.at(-1) ?? Number.NaN,
        previous: series.at(-2) ?? Number.NaN,
      };
    }
  }
}

function compare(comparator: Comparator, left: Pair, right: Pair): boolean {
  const values = [left.current, left.previous, right.current, right.previous];
  const finiteCurrent =
    Number.isFinite(left.current) && Number.isFinite(right.current);
  if (!finiteCurrent) return false;
  switch (comparator) {
    case ">":
      return left.current > right.current;
    case "<":
      return left.current < right.current;
    case ">=":
      return left.current >= right.current;
    case "<=":
      return left.current <= right.current;
  }
  if (!values.every(Number.isFinite)) return false;
  const up = left.previous < right.previous && left.current >= right.current;
  const down = left.previous > right.previous && left.current <= right.current;
  return comparator === "crossing_up" ? up : comparator === "crossing_down" ? down : up || down;
}

function operandLabel(operand: Operand): string {
  switch (operand.type) {
    case "number":
      return String(operand.value);
    case "line":
      return "trendline";
    case "price":
      return operand.field;
    case "quote":
      return `quote ${operand.field === "volume" ? "base volume" : operand.field}`;
    case "indicator": {
      const study = findTaIndicator(operand.indicator);
      const params = Object.values({
        ...(study ? defaultParameters(study) : {}),
        ...(operand.params ?? {}),
      }).join(",");
      return `${study?.shortName ?? operand.indicator}(${params})`;
    }
  }
}

const COMPARATOR_TEXT: Record<Comparator, string> = {
  ">": "is above",
  "<": "is below",
  ">=": "is at or above",
  "<=": "is at or below",
  crossing: "crosses",
  crossing_up: "crosses above",
  crossing_down: "crosses below",
};

function evaluateLeaf(
  leaf: Exclude<Leaf, { type: "tpo" }>,
  view: MarketView,
): { met: boolean; detail: string } {
  switch (leaf.type) {
    case "drawing": return evaluateDrawing(leaf,view);
    case "pine": return { met: false, detail: "Pine script evaluation requires its isolated runtime." };
    case "movement": {
      const movement = movementValue(leaf, view);
      return {
        met: movement !== undefined && (leaf.direction === "up" ? movement.change >= leaf.amount : movement.change <= -leaf.amount),
        detail: `${operandLabel(leaf.operand)} moved ${movement ? movement.change.toFixed(2) : "?"}${leaf.unit === "percent" ? "%" : " units"} from ${leaf.bars} bars ago`,
      };
    }
    case "compare": {
      const left = resolveOperand(leaf.left, view);
      const right = resolveOperand(leaf.right, view);
      return {
        met: compare(leaf.comparator, left, right),
        detail: `${operandLabel(leaf.left)} ${COMPARATOR_TEXT[leaf.comparator]} ${operandLabel(leaf.right)}`,
      };
    }
    case "band": {
      const value = resolveOperand(leaf.operand, view);
      const inside = (v: number) => v >= leaf.low && v <= leaf.high;
      if (!Number.isFinite(value.current)) return { met: false, detail: "" };
      const nowInside = inside(value.current);
      const wasInside = Number.isFinite(value.previous) ? inside(value.previous) : nowInside;
      const met =
        leaf.mode === "inside"
          ? nowInside
          : leaf.mode === "outside"
            ? !nowInside
            : leaf.mode === "entering"
              ? !wasInside && nowInside
              : wasInside && !nowInside;
      return {
        met,
        detail: `${operandLabel(leaf.operand)} ${leaf.mode === "entering" ? "enters" : leaf.mode === "exiting" ? "leaves" : leaf.mode === "inside" ? "is inside" : "is outside"} ${leaf.low}–${leaf.high}`,
      };
    }
    case "change": {
      let percent = Number.NaN;
      if (leaf.bars > 0 && view.bars.length > leaf.bars) {
        const last = view.bars.at(-1)!.close;
        const base = view.bars.at(-1 - leaf.bars)!.close;
        percent = base ? ((last - base) / base) * 100 : Number.NaN;
      } else if (leaf.bars === 0 && view.quote) percent = view.quote.changePercent;
      const met =
        Number.isFinite(percent) &&
        (leaf.direction === "up"
          ? percent >= leaf.percent
          : leaf.direction === "down"
            ? percent <= -leaf.percent
            : Math.abs(percent) >= leaf.percent);
      return {
        met,
        detail: `price changed ${Number.isFinite(percent) ? percent.toFixed(2) : "?"}% over ${leaf.bars ? `${leaf.bars} bars` : "the provider period"}`,
      };
    }
    case "volume_spike": {
      const volume = source(view.bars, "volume");
      const average = sma(volume.slice(0, -1), leaf.length).at(-1);
      const current = volume.at(-1);
      const met =
        average !== undefined &&
        Number.isFinite(average) &&
        average > 0 &&
        current !== undefined &&
        current >= average * leaf.multiple;
      return { met, detail: `volume is ${leaf.multiple}× its ${leaf.length}-bar average` };
    }
    case "extreme": {
      const bars = view.bars;
      if (bars.length <= leaf.length) return { met: false, detail: "" };
      const prior = bars.slice(0, -1);
      const last = bars.at(-1)!;
      const reference =
        leaf.kind === "high"
          ? highest(source(prior, "high"), leaf.length).at(-1)
          : lowest(source(prior, "low"), leaf.length).at(-1);
      const met =
        reference !== undefined &&
        Number.isFinite(reference) &&
        (leaf.kind === "high" ? last.close > reference : last.close < reference);
      return { met, detail: `new ${leaf.length}-bar ${leaf.kind}` };
    }
    case "pattern": {
      const bars = view.bars.slice(-40);
      if (bars.length < 5) return { met: false, detail: "" };
      const hits = detectCandlePatterns(bars, {
        ids: [leaf.patternId],
        from: bars.length - 1,
      });
      return {
        met: hits.some((h) => h.index === bars.length - 1),
        detail: `${hits[0]?.name ?? leaf.patternId} pattern`,
      };
    }
  }
}

function movementValue(leaf: Extract<Leaf, { type: "movement" }>, view: MarketView) {
  const bars = !isTickInterval(view.timeframe ?? "") && view.at !== undefined && (view.bars.at(-1)?.time ?? -Infinity) > view.at
    ? view.bars.filter(bar => bar.time <= view.at!) : view.bars;
  const series = leaf.operand.type === "price" ? source(bars, leaf.operand.field) : indicatorSeries(bars, leaf.operand);
  return measureMovement(series, leaf.bars, leaf.unit);
}

/** Every (symbol, timeframe) a condition needs data for. */
export function requiredViews(
  condition: Condition,
  scope: RuleScope,
): RuleScope[] {
  const found = new Map<string, RuleScope>();
  const visit = (node: Condition) => {
    if (node.op === "leaf") {
      const symbol = node.leaf.symbol ?? scope.symbol;
      const timeframe = node.leaf.timeframe ?? scope.timeframe;
      found.set(`${symbol}:${timeframe}`, { symbol, timeframe });
    } else node.conditions.forEach(visit);
  };
  visit(condition);
  return [...found.values()];
}

/** Required depth per series; shared leaves request the deepest history only once. */
export function requiredHistoryViews(condition: Condition, scope: RuleScope): (RuleScope & { count: number })[] {
  const found = new Map<string, RuleScope & { count: number }>();
  const visit = (node: Condition) => {
    if (node.op !== "leaf") { node.conditions.forEach(visit); return; }
    const leaf = node.leaf, symbol = leaf.symbol ?? scope.symbol, timeframe = leaf.timeframe ?? scope.timeframe;
    let count = 300;
    if (leaf.type === "pine") count = leaf.snapshot.history;
    else if (leaf.type === "tpo") count = tpoAlertHistory(leaf.settings, timeframe);
    else if (leaf.type === "drawing") count = drawingHistory(leaf,timeframe);
    else if (leaf.type === "movement") {
      const study = leaf.operand.type === "indicator" ? findTaIndicator(leaf.operand.indicator) : undefined;
      const params = study ? { ...defaultParameters(study), ...(leaf.operand.type === "indicator" ? leaf.operand.params : {}) } : {};
      // Recursive studies need warm-up before the reference value, not only before the latest bar.
      const warmup = Object.values(params).reduce((total, value) => total + (Number.isFinite(value) && value >= 1 ? Math.ceil(value) * 3 : 0), 0);
      count = Math.max(count, leaf.bars + warmup + 2);
    } else if (leaf.type === "change") count = Math.max(count, leaf.bars + 2);
    else if (leaf.type === "volume_spike" || leaf.type === "extreme") count = Math.max(count, leaf.length + 2);
    const key = `${symbol}:${timeframe}`;
    found.set(key, { symbol, timeframe, count: Math.min(MAX_HISTORY_BARS, Math.max(found.get(key)?.count ?? 0, count)) });
  };
  visit(condition);
  return [...found.values()];
}

/** Quote extrema require a verified provider range, independently of chart history. */
export function requiredQuoteRanges(condition: Condition, scope: RuleScope): string[] {
  const found = new Set<string>();
  const visit = (node: Condition) => {
    if (node.op !== "leaf") { node.conditions.forEach(visit); return; }
    const leaf = node.leaf;
    const operands = leaf.type === "compare" ? [leaf.left, leaf.right] : leaf.type === "band" ? [leaf.operand] : [];
    if (operands.some(o => o.type === "quote" && (o.field === "high" || o.field === "low"))) found.add(leaf.symbol ?? scope.symbol);
  };
  visit(condition);
  return [...found];
}

/** True when the rule can be decided from quotes alone (no candle history). */
export function isQuoteOnly(condition: Condition): boolean {
  const operandQuote = (operand: Operand) =>
    operand.type === "number" || operand.type === "quote" || operand.type === "line";
  const visit = (node: Condition): boolean => {
    if (node.op !== "leaf") return node.conditions.every(visit);
    const leaf = node.leaf;
    if (leaf.type === "compare")
      return operandQuote(leaf.left) && operandQuote(leaf.right);
    if(leaf.type==="drawing")return ["fibretracement","fibextension","fibextensiontrend","hline","hray","crossline","box"].includes(leaf.geometry.type);
    if (leaf.type === "band") return operandQuote(leaf.operand);
    if (leaf.type === "change") return leaf.bars === 0;
    return false;
  };
  return visit(condition);
}

export function evaluateCondition(
  condition: Condition,
  scope: RuleScope,
  resolve: ViewResolver,
): Evaluation {
  let incomplete = false;
  let drawing: DrawingObservation | undefined;
  const tpo: Record<string, TpoAlertObservation> = {};
  let hasTpo = false;
  const own = resolve(scope.symbol, scope.timeframe);
  const price = own?.quote?.price ?? own?.bars.at(-1)?.close ?? Number.NaN;
  const run = (node: Condition): { met: boolean; event: boolean; details: string[] } => {
    if (node.op === "leaf") {
      if (node.leaf.type === "tpo") hasTpo = true;
      const symbol = node.leaf.symbol ?? scope.symbol;
      const timeframe = node.leaf.timeframe ?? scope.timeframe;
      const view = resolve(symbol, timeframe);
      if (!view) {
        incomplete = true;
        return { met: false, event: false, details: [] };
      }
      try {
        const leaf = node.leaf;
        if (leaf.type === "tpo") {
          const result = evaluateTpo(leaf, view, symbol, timeframe); incomplete ||= result.incomplete;
          if (result.sample) tpo[result.key] = result.sample;
          return { met: result.met, event: result.met, details: result.met ? [result.detail] : [] };
        }
        if(leaf.type==="drawing"){
          const result=evaluateDrawing(leaf,view);incomplete ||= result.incomplete;drawing=result.sample;
          return {met:result.met,event:result.event,details:result.met?[result.detail]:[]};
        }
        const operands = leaf.type === "compare" ? [leaf.left, leaf.right] : leaf.type === "band" ? [leaf.operand] : [];
        if (operands.some(o => !Number.isFinite(resolveOperand(o, view).current))) {
          incomplete = true;
          return { met: false, event: false, details: [] };
        }
        const history = view.bars;
        const missing = leaf.type === "pine" ? true : leaf.type === "movement" ? movementValue(leaf, view) === undefined
          : leaf.type === "change" ? leaf.bars > 0 ? history.length <= leaf.bars : !Number.isFinite(view.quote?.changePercent)
          : leaf.type === "volume_spike" ? history.length <= leaf.length || history.slice(-leaf.length - 1).some(bar => !Number.isFinite(bar.volume))
          : leaf.type === "extreme" ? history.length <= leaf.length
          : leaf.type === "pattern" ? history.length < 5 : false;
        if (missing) { incomplete = true; return { met: false, event: false, details: [] }; }
        const result = evaluateLeaf(leaf, view);
        const label = node.leaf.symbol && node.leaf.symbol !== scope.symbol ? `${node.leaf.symbol}: ` : "";
        const event = result.met && (leaf.type === "compare" && leaf.comparator.startsWith("crossing") || leaf.type === "band" && ["entering", "exiting"].includes(leaf.mode));
        return { met: result.met, event, details: result.met ? [`${label}${result.detail}`] : [] };
      } catch {
        incomplete = true;
        return { met: false, event: false, details: [] };
      }
    }
    const results = node.conditions.map(run);
    if (node.op === "all") {
      const met = results.length > 0 && results.every((r) => r.met);
      return { met, event: met && results.some(r => r.event), details: met ? results.flatMap((r) => r.details) : [] };
    }
    const hit = results.filter((r) => r.met);
    return { met: hit.length > 0, event: hit.some(r => r.event), details: hit.flatMap((r) => r.details) };
  };
  const result = run(condition);
  return {
    met: result.met,
    detail: result.details.join(" and "),
    price,
    incomplete,
    event: result.event,
    drawing,
    ...(hasTpo ? { tpo } : {}),
  };
}

/** Message shown for a fired rule. */
export function ruleMessage(rule: AlertRule, symbol: string, evaluation: Evaluation): string {
  const base = rule.message?.trim() || evaluation.detail || rule.name;
  return `${symbol}: ${base}`;
}

/** Edge-triggering helper: fires only when a condition turns from false to true. */
export class EdgeTracker {
  private state = new Map<string, { met: boolean; firedAt: number }>();
  /** True if (key) should fire now. */
  update(key: string, met: boolean, now: number, cooldownMs: number): boolean {
    const previous = this.state.get(key);
    const rising = met && !previous?.met;
    const cooled = !previous || now - previous.firedAt >= cooldownMs;
    const fire = rising && cooled;
    this.state.set(key, {
      met,
      firedAt: fire ? now : (previous?.firedAt ?? 0),
    });
    return fire;
  }
  has(key: string): boolean {
    return this.state.has(key);
  }
  /** Record the current state without firing, so a rule only reacts to later transitions. */
  seed(key: string, met: boolean, now: number) {
    this.state.set(key, { met, firedAt: this.state.get(key)?.firedAt ?? 0 });
    void now;
  }
  forget(prefix: string) {
    for (const key of this.state.keys()) if (key.startsWith(prefix)) this.state.delete(key);
  }
  clear() {
    this.state.clear();
  }
}

export function leafCount(condition: Condition): number {
  return condition.op === "leaf"
    ? 1
    : condition.conditions.reduce((n, c) => n + leafCount(c), 0);
}

export function validateCondition(condition: unknown, depth = 0): string | null {
  if (depth > 6) return "Conditions are nested too deeply.";
  if (!condition || typeof condition !== "object") return "Invalid condition.";
  const node = condition as Condition;
  if (node.op === "leaf") {
    const leaf = node.leaf as Leaf | undefined;
    if (!leaf || typeof leaf.type !== "string") return "Invalid condition.";
    if (!["compare", "band", "movement", "change", "volume_spike", "extreme", "pattern", "pine", "drawing", "tpo"].includes(leaf.type)) return "Unknown condition type.";
    if (leaf.type === "tpo") return leaf.symbol !== undefined && !isSymbolId(leaf.symbol) ? "Invalid TPO symbol." : validateTpoCondition(leaf, leaf.timeframe);
    if(leaf.type==="drawing")return leaf.symbol!==undefined||leaf.timeframe!==undefined?"Drawing market context belongs in the alert scope.":validateDrawingCondition(leaf);
    if (leaf.type === "pine") return leaf.symbol !== undefined || leaf.timeframe !== undefined ? "Pine market context belongs in the alert scope." : validatePineSnapshot(leaf.snapshot);
    const operands: Operand[] =
      leaf.type === "compare" ? [leaf.left, leaf.right] : leaf.type === "band" || leaf.type === "movement" ? [leaf.operand] : [];
    for (const operand of operands) {
      if (!operand || typeof operand.type !== "string") return "Invalid operand.";
      if (!["number", "price", "quote", "line", "indicator"].includes(operand.type)) return "Unknown operand type.";
      if (operand.type === "price" && !["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "volume"].includes(operand.field)) return "Unknown price source.";
      if (operand.type === "indicator" && !findTaIndicator(operand.indicator))
        return `Unknown indicator ${operand.indicator}.`;
      if (operand.type === "number" && !Number.isFinite(operand.value)) return "Enter a valid number.";
      if (operand.type === "line") {
        const points = [operand.from, operand.to];
        if (!points.every((p) => p && Number.isFinite(p.time) && Number.isFinite(p.price) && p.price > 0))
          return "A trendline needs two valid points.";
        if (operand.from.time === operand.to.time) return "A trendline needs two different times.";
        if (!["none", "left", "right", "both"].includes(operand.extend)) return "Invalid trendline extension.";
      }
    }
    if (leaf.type === "movement") {
      if (!["price", "indicator"].includes(leaf.operand.type)) return "Movement alerts need a candle price or indicator source.";
      if (!["up", "down"].includes(leaf.direction) || !["absolute", "percent"].includes(leaf.unit)) return "Invalid movement operator.";
      if (!Number.isFinite(leaf.amount) || leaf.amount <= 0) return "Movement amount must be a finite positive number.";
      if (!Number.isSafeInteger(leaf.bars) || leaf.bars < 1 || leaf.bars >= MAX_HISTORY_BARS) return `Movement lookback must be 1–${MAX_HISTORY_BARS - 1} bars.`;
      if (leaf.operand.type === "indicator") {
        const study = findTaIndicator(leaf.operand.indicator)!;
        if (leaf.operand.params !== undefined && (!leaf.operand.params || typeof leaf.operand.params !== "object" || Array.isArray(leaf.operand.params))) return "Invalid indicator inputs.";
        for (const [id, value] of Object.entries(leaf.operand.params ?? {})) {
          const parameter = study.parameters.find(input => input.key === id);
          if (!parameter || !Number.isFinite(value) || parameter.min !== undefined && value < parameter.min || parameter.max !== undefined && value > parameter.max) return "Invalid indicator input.";
          if (parameter.step === 1 && !Number.isInteger(value)) return "Indicator periods must be whole numbers.";
        }
        const output = study.compute([], { ...defaultParameters(study), ...leaf.operand.params });
        const selectedPlot = leaf.operand.plot;
        if (selectedPlot !== undefined && !output.plots.some(plot => plot.id === selectedPlot)) return "Unknown indicator output.";
      }
    }
    if (leaf.type === "band" && !(leaf.high > leaf.low)) return "The upper bound must be above the lower bound.";
    if (leaf.type === "change" && !(leaf.percent > 0)) return "Percent change must be positive.";
    if (leaf.type === "volume_spike" && !(leaf.multiple > 0 && leaf.length >= 1)) return "Invalid volume spike settings.";
    if (leaf.type === "extreme" && !(leaf.length >= 1)) return "Invalid lookback.";
    if (leaf.symbol !== undefined && !isSymbolId(leaf.symbol)) return "Invalid symbol.";
    if (leaf.timeframe !== undefined && !isValidInterval(leaf.timeframe)) return "Invalid condition interval.";
    return null;
  }
  if ((node.op !== "all" && node.op !== "any") || !Array.isArray(node.conditions)) return "Invalid condition group.";
  if (!node.conditions.length) return "A condition group needs at least one condition.";
  if (node.conditions.length > 12) return "Too many conditions in one group.";
  for (const child of node.conditions) {
    const error = validateCondition(child, depth + 1);
    if (error) return error;
  }
  return null;
}

/** Compact one-line description of a condition tree, for lists and logs. */
export function describeCondition(condition: Condition): string {
  if (condition.op !== "leaf")
    return condition.conditions
      .map((c) => (c.op === "leaf" ? describeCondition(c) : `(${describeCondition(c)})`))
      .join(condition.op === "all" ? " AND " : " OR ");
  const leaf = condition.leaf;
  const where = leaf.symbol ? `${leaf.symbol} ` : "";
  switch (leaf.type) {
    case "tpo": return `${where}price ${leaf.direction.replaceAll("_", " ")} latest completed TPO ${leaf.level.toUpperCase()} (${leaf.settings.blockMinutes} min blocks, ${leaf.settings.sessionZone})`;
    case "drawing": return describeDrawing(leaf);
    case "pine": return `${leaf.snapshot.title} · ${leaf.snapshot.selection.type === "calls" ? "Any alert() function call" : leaf.snapshot.selection.type === "orders" ? "Order fills only" : leaf.snapshot.selection.type === "both" ? "Order fills and alert() calls" : leaf.snapshot.selection.id}`;
    case "compare":
      return `${where}${operandLabel(leaf.left)} ${COMPARATOR_TEXT[leaf.comparator]} ${operandLabel(leaf.right)}`;
    case "band":
      return `${where}${operandLabel(leaf.operand)} ${leaf.mode} ${leaf.low}–${leaf.high}`;
    case "change":
      return `${where}${leaf.direction === "down" ? "falls" : leaf.direction === "up" ? "rises" : "moves"} ${leaf.percent}% ${leaf.bars ? `in ${leaf.bars} bars` : "over the provider period"}`;
    case "movement":
      return `${where}${operandLabel(leaf.operand)} moving ${leaf.direction} ${leaf.amount}${leaf.unit === "percent" ? "%" : " units"} in ${leaf.bars} bars`;
    case "volume_spike":
      return `${where}volume ≥ ${leaf.multiple}× average`;
    case "extreme":
      return `${where}new ${leaf.length}-bar ${leaf.kind}`;
    case "pattern":
      return `${where}${leaf.patternId} pattern`;
  }
}


/**
 * Shared structural check for a rule, used by the server before storing one
 * and by workspace import. Returns an error message or null.
 */
export function validateRuleShape(input: unknown): string | null {
  if (!input || typeof input !== "object") return "Invalid rule.";
  const r = input as AlertRule;
  if (typeof r.id !== "string" || !r.id || r.id.length > 80) return "Rule needs an id.";
  if (typeof r.name !== "string" || !r.name.trim() || r.name.length > 100)
    return "Rule needs a name (max 100 characters).";
  if (!["technical", "watchlist", "composite", "pine", "drawing"].includes(r.kind)) return "Unknown rule kind.";
  const isDrawing=r.condition?.op==="leaf"&&r.condition.leaf?.type==="drawing";
  if((r.kind==="drawing")!==isDrawing)return "A drawing alert needs its own linked drawing condition.";
  if(isDrawing&&r.scope?.type!=="symbol")return "Drawing alerts monitor one symbol.";
  if(r.drawingIssue!==undefined&&(typeof r.drawingIssue!=="string"||r.drawingIssue.length>500))return "Invalid drawing availability message.";
  if(r.drawingRevision!==undefined&&(typeof r.drawingRevision!=="string"||!r.drawingRevision||r.drawingRevision.length>100))return "Invalid drawing revision.";
  const recoveryError = validatePineRecoveryFields(r); if (recoveryError) return recoveryError;
  const isPine = r.condition?.op === "leaf" && r.condition.leaf?.type === "pine";
  if ((r.kind === "pine") !== isPine) return "A Pine alert needs its own saved script condition.";
  if (!["active", "paused", "triggered", "expired", "stopped"].includes(r.status)) return "Unknown rule status.";
  const rateError = validateRateFields(r);
  if (rateError) return rateError;
  if (r.status === "stopped" && !r.stop) return "Stopped alert needs a reason.";
  const timingError = validateTiming(r);
  if (timingError) return timingError;
  if (!["tick", "close"].includes(r.frequency)) return "Unknown frequency.";
  if (!r.scope || typeof r.scope !== "object" || typeof r.scope.timeframe !== "string")
    return "Rule needs a scope.";
  if (r.scope.type === "symbol") {
    if (!isSymbolId(r.scope.symbol)) return "Invalid symbol.";
  } else if (r.scope.type === "watchlist") {
    if (
      !Array.isArray(r.scope.symbols) ||
      r.scope.symbols.length > 1000 ||
      !r.scope.symbols.every((s) => isSymbolId(s))
    )
      return "A watchlist rule needs at most 1000 valid symbols.";
  } else return "Unknown scope.";
  if (r.triggeredSymbols !== undefined && (!Array.isArray(r.triggeredSymbols) || r.triggeredSymbols.length > 1000 || r.triggeredSymbols.some(symbol => !isSymbolId(symbol)) || new Set(r.triggeredSymbols).size !== r.triggeredSymbols.length)) return "Invalid completed watchlist members.";
  if (r.lastFired !== undefined && (typeof r.lastFired !== "object" || r.lastFired === null || Array.isArray(r.lastFired) || Object.keys(r.lastFired).length > 1000 || Object.entries(r.lastFired).some(([symbol, value]) => !isSymbolId(symbol) || !value || !Number.isSafeInteger(value.time) || value.time < 0 || value.bar !== undefined && (!Number.isSafeInteger(value.bar) || value.bar < 0)))) return "Invalid firing history.";
  if (r.scriptState !== undefined && (!r.scriptState || typeof r.scriptState !== "object" || Array.isArray(r.scriptState) || Object.keys(r.scriptState).length > 1000 || Object.entries(r.scriptState).some(([symbol, gates]) => !isSymbolId(symbol) || !gates || typeof gates !== "object" || Array.isArray(gates) || Object.keys(gates).length > 100 || Object.entries(gates).some(([key, gate]) => !/^[\w-]{1,80}$/.test(key) || !gate || !Number.isSafeInteger(gate.bar) || gate.bar < 0 || !Number.isSafeInteger(gate.time) || gate.time < 0 || gate.token !== undefined && (typeof gate.token !== "string" || !gate.token || gate.token.length > 300))))) return "Invalid Pine firing gates.";
  if (r.scope.type === "watchlist" && r.trigger !== undefined && r.expiresAt === undefined) return "Watchlist alerts need an expiration time.";
  const conditionError = validateCondition(r.condition);
  if (conditionError) return conditionError;
  const tpoProblem = (node: Condition): string | null => node.op === "leaf" ? node.leaf.type === "tpo" ? validateTpoCondition(node.leaf, node.leaf.timeframe ?? r.scope.timeframe) : null
    : node.conditions.map(tpoProblem).find(problem => problem !== null) ?? null;
  const profileError = tpoProblem(r.condition); if (profileError) return profileError;
  const containsPine = (node: Condition): boolean => node.op === "leaf" ? node.leaf.type === "pine" : node.conditions.some(containsPine);
  const containsDrawing=(node:Condition):boolean=>node.op==="leaf"?node.leaf.type==="drawing":node.conditions.some(containsDrawing);
  if(!isDrawing&&containsDrawing(r.condition))return "Drawing events need their own subscription.";
  if (!isPine && containsPine(r.condition)) return "Pine script events need their own subscription.";
  if (!Number.isFinite(r.cooldownMs) || r.cooldownMs < 0 || r.cooldownMs > 86_400_000 * 7)
    return "Invalid cooldown.";
  if (r.message !== undefined && (typeof r.message !== "string" || r.message.length > 500))
    return "Message is too long.";
  return null;
}
