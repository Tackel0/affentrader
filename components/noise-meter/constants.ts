import type {
  NoiseApiPayload,
  PriorWindowDays,
  PriorWindowRule,
  ReturnRule,
} from "@/lib/terminal/noiseMeter";

export const PRESET_TICKERS: ReadonlyArray<{ ticker: string; label: string }> = [
  { ticker: "SPY", label: "SPY" },
  { ticker: "QQQ", label: "QQQ" },
  { ticker: "^GSPC", label: "S&P 500" },
  { ticker: "^NDX", label: "NDX" },
  { ticker: "^GDAXI", label: "DAX" },
  { ticker: "IWM", label: "IWM" },
  { ticker: "NVDA", label: "NVDA" },
  { ticker: "TSLA", label: "TSLA" },
];

export const QUICK_GAPS = [-2.0, -1.0, 0.5, 1.0, 1.5, 2.0, 3.0] as const;
export const QUICK_TODAY_MOVES = [-5.0, -3.0, -1.5, 1.5, 3.0, 5.0, 7.0] as const;
export const QUICK_STREAKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const PRIOR_WINDOW_OPTIONS: readonly PriorWindowDays[] = [3, 5, 7, 10, 20];
export const LOOKBACK_DEPTHS = [2, 3, 4, 5] as const;
export const HISTORY_RANGES: ReadonlyArray<{ value: 5 | 10 | 15 | "max"; label: string }> = [
  { value: 5, label: "5J" },
  { value: 10, label: "10J" },
  { value: 15, label: "15J" },
  { value: "max", label: "Max" },
];

export const ANY_NEG_RULE: ReturnRule = { op: "any", thresholdPct: -2 };
export const ANY_PRIOR_WIN: PriorWindowRule = { days: 5, op: "any", thresholdPct: -8 };
export const DEFAULT_PRIOR_WIN: PriorWindowRule = { days: 7, op: "lte", thresholdPct: -10 };

export type PatternMode = "leadup" | "days";

export interface PatternPreset {
  id: string;
  mode: PatternMode;
  label: string;
  lookbackDays?: 2 | 3 | 4 | 5;
  dayMinus4?: ReturnRule;
  dayMinus3?: ReturnRule;
  dayMinus2?: ReturnRule;
  prev?: ReturnRule;
  day0: ReturnRule;
  priorWindow?: PriorWindowRule;
}

export const PATTERN_PRESETS: ReadonlyArray<PatternPreset> = [
  {
    id: "win7-m10-p5",
    mode: "leadup",
    label: "Vor-7T ≤ −10 % → +5 %",
    day0: { op: "gte", thresholdPct: 5 },
    priorWindow: { days: 7, op: "lte", thresholdPct: -10 },
  },
  {
    id: "win5-m8-p4",
    mode: "leadup",
    label: "Vor-5T ≤ −8 % → +4 %",
    day0: { op: "gte", thresholdPct: 4 },
    priorWindow: { days: 5, op: "lte", thresholdPct: -8 },
  },
  {
    id: "win10-m12-p3",
    mode: "leadup",
    label: "Vor-10T ≤ −12 % → +3 %",
    day0: { op: "gte", thresholdPct: 3 },
    priorWindow: { days: 10, op: "lte", thresholdPct: -12 },
  },
  {
    id: "win20-m15-p4",
    mode: "leadup",
    label: "Vor-20T ≤ −15 % → +4 %",
    day0: { op: "gte", thresholdPct: 4 },
    priorWindow: { days: 20, op: "lte", thresholdPct: -15 },
  },
  {
    id: "win5-p8-m3",
    mode: "leadup",
    label: "Vor-5T ≥ +8 % → −3 %",
    day0: { op: "lte", thresholdPct: -3 },
    priorWindow: { days: 5, op: "gte", thresholdPct: 8 },
  },
  {
    id: "m5-p5",
    mode: "days",
    lookbackDays: 2,
    label: "−5 % → +5 %",
    prev: { op: "lte", thresholdPct: -5 },
    day0: { op: "gte", thresholdPct: 5 },
  },
  {
    id: "m3-p3",
    mode: "days",
    lookbackDays: 2,
    label: "−3 % → +3 %",
    prev: { op: "lte", thresholdPct: -3 },
    day0: { op: "gte", thresholdPct: 3 },
  },
  {
    id: "3xm2",
    mode: "days",
    lookbackDays: 3,
    label: "3× ≤ −2 %",
    dayMinus2: { op: "lte", thresholdPct: -2 },
    prev: { op: "lte", thresholdPct: -2 },
    day0: { op: "lte", thresholdPct: -2 },
  },
  {
    id: "2xm3",
    mode: "days",
    lookbackDays: 2,
    label: "2× ≤ −3 %",
    prev: { op: "lte", thresholdPct: -3 },
    day0: { op: "lte", thresholdPct: -3 },
  },
  {
    id: "day-m5",
    mode: "days",
    lookbackDays: 2,
    label: "Tag ≤ −5 %",
    prev: { op: "any", thresholdPct: -3 },
    day0: { op: "lte", thresholdPct: -5 },
  },
  {
    id: "day-p5",
    mode: "days",
    lookbackDays: 2,
    label: "Tag ≥ +5 %",
    prev: { op: "any", thresholdPct: -3 },
    day0: { op: "gte", thresholdPct: 5 },
  },
];

export type PrimaryView = "forecast" | "pattern" | "gaps";
export type DetailTab = "gaps" | "streaks" | "analogues";
export type PatternDayKey = "dayMinus4" | "dayMinus3" | "dayMinus2" | "prev" | "day0";
export type MatchSortKey =
  | "session"
  | "priorWindowPct"
  | "prevDayPct"
  | "day0Pct"
  | "nextDayPct"
  | "fwd21dPct"
  | "fwd63dPct"
  | "dropToBottomPct"
  | "daysToBottom";

export function invertRule(rule: ReturnRule): ReturnRule {
  if (rule.op === "any") return rule;
  return {
    op: rule.op === "lte" ? "gte" : "lte",
    thresholdPct: Object.is(-rule.thresholdPct, -0) ? 0 : -rule.thresholdPct,
  };
}

export function relaxRule(rule: ReturnRule, step = 0.5): ReturnRule {
  if (rule.op === "any") return rule;
  const abs = Math.abs(rule.thresholdPct);
  if (abs <= step) {
    return { ...rule, thresholdPct: 0 };
  }
  const scaled = abs * 0.75;
  const snapped = Math.min(abs - step, Math.floor(scaled / step) * step);
  const signed = (Math.sign(rule.thresholdPct) * Math.round(snapped * 100)) / 100;
  return {
    ...rule,
    thresholdPct: Object.is(signed, -0) ? 0 : signed,
  };
}

export function rulesEqual(a: ReturnRule, b: ReturnRule): boolean {
  if (a.op !== b.op) return false;
  if (a.op === "any") return true;
  return Math.abs(a.thresholdPct - b.thresholdPct) < 0.05;
}

export function fmtPct(v: number | null | undefined, signed = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = signed ? (v > 0 ? "+" : v < 0 ? "−" : "") : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1).replace(".", ",")} %`;
}

export function fmtPct2(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${Math.abs(v).toFixed(2).replace(".", ",")} %`;
}

export function fmtSigned2(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(2).replace(".", ",")} %`;
}

export function fmtPrice(v: number | null | undefined, currency?: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const formatted = v.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

export function fmtShortDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.`;
}

export function sourceLabel(src: NoiseApiPayload["live"]["priceSource"]): string {
  switch (src) {
    case "premarket":
      return "Premarket Live";
    case "afterhours":
      return "After-Hours Live";
    case "regular":
      return "Heutiges Open-Gap";
    default:
      return "Letzter Close";
  }
}

export function liveMoveShortLabel(src: NoiseApiPayload["live"]["priceSource"]): string {
  switch (src) {
    case "premarket":
      return "Premarket";
    case "afterhours":
      return "After-Hours";
    case "regular":
      return "Live";
    default:
      return "Letzter Close";
  }
}
