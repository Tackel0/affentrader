"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  BarChart3,
  Calendar,
  Check,
  Copy,
  Download,
  Gauge,
  History,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { isYahooTicker } from "@/lib/symbolId";
import {
  buildNoiseDataset,
  buildPatternMatchesCsv,
  evaluateNextDayForecast,
  evaluateNoiseScenario,
  evaluatePatternStudy,
  formatPatternSummaryText,
  getLivePatternSnapshot,
  matchesLivePatternSnapshot,
  suggestLiveLeadupPattern,
  suggestLivePattern,
  type NoiseApiPayload,
  type NoiseDataset,
  type NoiseStreakBasis,
  type NoiseVerdictTone,
  type PatternMatch,
  type PriorWindowDays,
  type PriorWindowRule,
  type ReturnRule,
  type ReturnRuleOp,
  type StreakStats,
} from "@/lib/terminal/noiseMeter";
import { AssetBadge } from "./ui";

const PRESET_TICKERS: ReadonlyArray<{ ticker: string; label: string }> = [
  { ticker: "SPY", label: "SPY" },
  { ticker: "QQQ", label: "QQQ" },
  { ticker: "^GSPC", label: "S&P 500" },
  { ticker: "^NDX", label: "NDX" },
  { ticker: "^GDAXI", label: "DAX" },
  { ticker: "IWM", label: "IWM" },
  { ticker: "NVDA", label: "NVDA" },
  { ticker: "TSLA", label: "TSLA" },
];

const QUICK_GAPS = [-2.0, -1.0, 0.5, 1.0, 1.5, 2.0, 3.0] as const;
const QUICK_TODAY_MOVES = [-5.0, -3.0, -1.5, 1.5, 3.0, 5.0, 7.0] as const;
const QUICK_STREAKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const PRIOR_WINDOW_OPTIONS: readonly PriorWindowDays[] = [3, 5, 7, 10, 20];
const LOOKBACK_DEPTHS = [2, 3, 4, 5] as const;
const HISTORY_RANGES: ReadonlyArray<{ value: 5 | 10 | 15 | "max"; label: string }> = [
  { value: 5, label: "5J" },
  { value: 10, label: "10J" },
  { value: 15, label: "15J" },
  { value: "max", label: "Max" },
];

const ANY_NEG_RULE: ReturnRule = { op: "any", thresholdPct: -2 };
const ANY_PRIOR_WIN: PriorWindowRule = { days: 5, op: "any", thresholdPct: -8 };
const DEFAULT_PRIOR_WIN: PriorWindowRule = { days: 7, op: "lte", thresholdPct: -10 };

export type PatternMode = "leadup" | "days";

interface PatternPreset {
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

const PATTERN_PRESETS: ReadonlyArray<PatternPreset> = [
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

type PrimaryView = "forecast" | "pattern" | "gaps";
type DetailTab = "gaps" | "streaks" | "analogues";
type PatternDayKey = "dayMinus4" | "dayMinus3" | "dayMinus2" | "prev" | "day0";
type MatchSortKey =
  | "session"
  | "priorWindowPct"
  | "prevDayPct"
  | "day0Pct"
  | "nextDayPct"
  | "fwd21dPct"
  | "fwd63dPct"
  | "dropToBottomPct"
  | "daysToBottom";

function invertRule(rule: ReturnRule): ReturnRule {
  if (rule.op === "any") return rule;
  return {
    op: rule.op === "lte" ? "gte" : "lte",
    thresholdPct: Object.is(-rule.thresholdPct, -0) ? 0 : -rule.thresholdPct,
  };
}

function relaxRule(rule: ReturnRule, step = 0.5): ReturnRule {
  if (rule.op === "any") return rule;
  const abs = Math.abs(rule.thresholdPct);
  if (abs <= step) {
    return { ...rule, thresholdPct: 0 };
  }
  const scaled = abs * 0.75;
  const snapped = Math.min(abs - step, Math.floor(scaled / step) * step);
  const signed = Math.sign(rule.thresholdPct) * Math.round(snapped * 100) / 100;
  return {
    ...rule,
    thresholdPct: Object.is(signed, -0) ? 0 : signed,
  };
}

function parseLocalePct(raw: string): number | null {
  const cleaned = raw.trim().replace(/\u2212/g, "-").replace(/,/g, ".");
  if (!cleaned || /^[+-]?\.?$/.test(cleaned)) return null;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDraftPct(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export interface NumericPctInputProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  ariaLabel: string;
  onChange: (value: number) => void;
  className?: string;
  showSteppers?: boolean;
}

/**
 * Controlled-draft percentage input that accepts German comma decimals ("-2,5"),
 * Unicode minus ("−5"), and intermediate editing states ("", "-", "-5.") without
 * prematurely snapping to 0; clamps and normalizes cleanly on blur, ArrowUp/ArrowDown,
 * or optional inline −/+ stepper buttons.
 */
export function NumericPctInput({
  id,
  value,
  min,
  max,
  step = 0.5,
  ariaLabel,
  onChange,
  className,
  showSteppers = false,
}: NumericPctInputProps) {
  const [draft, setDraft] = useState<string>(() => formatDraftPct(value));
  const focusedRef = useRef(false);
  const lastEmittedRef = useRef(value);

  useEffect(() => {
    if (!focusedRef.current || Math.abs(value - lastEmittedRef.current) > 1e-9) {
      setDraft(formatDraftPct(value));
      lastEmittedRef.current = value;
    }
  }, [value]);

  const clampVal = (n: number) => {
    const clamped = Math.max(min, Math.min(max, n));
    const rounded = Math.round(clamped * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  const applyStep = (delta: number) => {
    const cur = parseLocalePct(draft) ?? value;
    const next = clampVal(cur + delta);
    lastEmittedRef.current = next;
    setDraft(formatDraftPct(next));
    onChange(next);
  };

  const inputEl = (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      className={className ? `noise-pct-input ${className}` : "noise-pct-input"}
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseLocalePct(raw);
        if (parsed !== null) {
          const next = clampVal(parsed);
          lastEmittedRef.current = next;
          onChange(next);
        }
      }}
      onBlur={() => {
        focusedRef.current = false;
        const parsed = parseLocalePct(draft);
        if (parsed !== null) {
          const next = clampVal(parsed);
          if (Math.abs(next - value) > 1e-9) {
            lastEmittedRef.current = next;
            onChange(next);
          }
          setDraft(formatDraftPct(next));
        } else {
          setDraft(formatDraftPct(value));
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          applyStep(e.key === "ArrowUp" ? step : -step);
        } else if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
    />
  );

  if (!showSteppers) return inputEl;

  return (
    <span className="noise-pct-stepper">
      <button
        type="button"
        className="noise-step-btn"
        aria-label={`${ariaLabel} verringern`}
        onClick={() => applyStep(-step)}
      >
        −
      </button>
      {inputEl}
      <button
        type="button"
        className="noise-step-btn"
        aria-label={`${ariaLabel} erhöhen`}
        onClick={() => applyStep(step)}
      >
        +
      </button>
    </span>
  );
}

function rulesEqual(a: ReturnRule, b: ReturnRule): boolean {
  if (a.op !== b.op) return false;
  if (a.op === "any") return true;
  return Math.abs(a.thresholdPct - b.thresholdPct) < 0.05;
}

function fmtPct(v: number | null | undefined, signed = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = signed ? (v > 0 ? "+" : v < 0 ? "−" : "") : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1).replace(".", ",")} %`;
}

function fmtPct2(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${Math.abs(v).toFixed(2).replace(".", ",")} %`;
}

function fmtSigned2(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(2).replace(".", ",")} %`;
}

function fmtPrice(v: number | null | undefined, currency?: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const formatted = v.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

function fmtShortDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.`;
}

function sourceLabel(src: NoiseApiPayload["live"]["priceSource"]): string {
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

function liveMoveShortLabel(src: NoiseApiPayload["live"]["priceSource"]): string {
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

function NoiseGauge({ score, tone }: { score: number; tone: NoiseVerdictTone }) {
  const clamped = Math.max(0, Math.min(100, score));
  const angleRad = Math.PI * (1 - clamped / 100);
  const cx = 80;
  const cy = 78;
  const r = 62;
  const dotX = cx + r * Math.cos(angleRad);
  const dotY = cy - r * Math.sin(angleRad);
  const accent =
    tone === "signal"
      ? "var(--green, #10b981)"
      : tone === "noise"
        ? "var(--red, #ef4444)"
        : "#f59e0b";

  return (
    <div className={`noise-gauge tone-${tone}`} aria-label={`NoiseMeter Score ${clamped} von 100`}>
      <svg viewBox="0 0 160 96" className="noise-gauge-svg" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="noiseMeterGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        <path
          d="M 18 78 A 62 62 0 0 1 142 78"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.14"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M 18 78 A 62 62 0 0 1 142 78"
          fill="none"
          stroke="url(#noiseMeterGrad)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeOpacity="0.9"
        />
        <line
          x1={cx}
          y1={cy}
          x2={cx + (r - 12) * Math.cos(angleRad)}
          y2={cy - (r - 12) * Math.sin(angleRad)}
          stroke={accent}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="5" fill={accent} />
        <circle cx={dotX} cy={dotY} r="6.5" fill="var(--surface, #131722)" stroke={accent} strokeWidth="3" />
      </svg>
      <div className="noise-gauge-readout">
        <strong className="mono">{clamped}</strong>
        <span>/ 100 Noise</span>
      </div>
      <div className="noise-gauge-scale">
        <span>Signal</span>
        <span>Neutral</span>
        <span>Noise</span>
      </div>
    </div>
  );
}

export function NoiseMeterPanel({
  initialTicker = "SPY",
  onOpenChart,
  onTickerSelect,
}: {
  initialTicker?: string;
  onOpenChart?: (ticker: string) => void;
  onTickerSelect?: (ticker: string) => void;
}) {
  const defaultTicker = isYahooTicker(initialTicker) ? initialTicker.toUpperCase() : "SPY";
  const [ticker, setTicker] = useState(defaultTicker);
  const [input, setInput] = useState(defaultTicker);
  const [years, setYears] = useState<5 | 10 | 15 | "max">("max");
  const [loaded, setLoaded] = useState<{ payload: NoiseApiPayload; dataset: NoiseDataset } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);

  // Clean 3-tab primary navigation for uncluttered overview
  const [activeView, setActiveView] = useState<PrimaryView>("forecast");

  // Interactive scenario controls (default: Close-to-Close streak strictly on Nasdaq/Exchange close)
  const [gapPct, setGapPct] = useState<number>(1.0);
  const [gapTouched, setGapTouched] = useState(false);
  const [todayMovePct, setTodayMovePct] = useState<number>(0);
  const [todayMoveTouched, setTodayMoveTouched] = useState(false);
  const [useExtraFactors, setUseExtraFactors] = useState<boolean>(true);
  const [streakBasis, setStreakBasis] = useState<NoiseStreakBasis>("close");
  const [streakDirection, setStreakDirection] = useState<"red" | "green">("red");
  const [streakDays, setStreakDays] = useState<number>(3);
  const [streakTouched, setStreakTouched] = useState(false);

  // Simplified 2-mode pattern scanner: "leadup" (Vorlauf → Heute) | "days" (Einzeltage)
  const [patternMode, setPatternMode] = useState<PatternMode>("days");
  const [patternLookbackDays, setPatternLookbackDays] = useState<2 | 3 | 4 | 5>(2);
  const [dayMinus4Rule, setDayMinus4Rule] = useState<ReturnRule>(ANY_NEG_RULE);
  const [dayMinus3Rule, setDayMinus3Rule] = useState<ReturnRule>(ANY_NEG_RULE);
  const [dayMinus2Rule, setDayMinus2Rule] = useState<ReturnRule>(ANY_NEG_RULE);
  const [prevDayRule, setPrevDayRule] = useState<ReturnRule>({ op: "lte", thresholdPct: -5 });
  const [day0Rule, setDay0Rule] = useState<ReturnRule>({ op: "gte", thresholdPct: 5 });
  const [priorWindowRule, setPriorWindowRule] = useState<PriorWindowRule>(DEFAULT_PRIOR_WIN);
  const [patternRegime, setPatternRegime] = useState<"all" | "bear" | "bull">("all");
  const [patternMinGapDays, setPatternMinGapDays] = useState<0 | 10>(0);
  const [patternTouched, setPatternTouched] = useState(false);
  const [showAllPatternMatches, setShowAllPatternMatches] = useState(false);
  const [matchSort, setMatchSort] = useState<{ key: MatchSortKey; dir: "asc" | "desc" }>({
    key: "session",
    dir: "desc",
  });
  const [copiedSummary, setCopiedSummary] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("gaps");

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const clean = initialTicker.replace(/^YF:/i, "").trim().toUpperCase();
    if (clean && isYahooTicker(clean) && clean !== ticker) {
      setTicker(clean);
      setInput(clean);
      setGapTouched(false);
      setTodayMoveTouched(false);
      setStreakTouched(false);
      setPatternTouched(false);
      setShowAllPatternMatches(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTicker]);

  const gapTouchedRef = useRef(gapTouched);
  const todayMoveTouchedRef = useRef(todayMoveTouched);
  const streakTouchedRef = useRef(streakTouched);
  const patternTouchedRef = useRef(patternTouched);
  const streakBasisRef = useRef(streakBasis);
  gapTouchedRef.current = gapTouched;
  todayMoveTouchedRef.current = todayMoveTouched;
  streakTouchedRef.current = streakTouched;
  patternTouchedRef.current = patternTouched;
  streakBasisRef.current = streakBasis;
  const [useLastCompletedAsToday, setUseLastCompletedAsToday] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const res = await fetch(
          `/api/terminal-noise?ticker=${encodeURIComponent(ticker)}&years=${years}`,
          { signal: controller.signal },
        );
        const body = (await res.json().catch(() => null)) as (NoiseApiPayload & { error?: string }) | null;
        if (!res.ok || !body) throw new Error(body?.error || `HTTP ${res.status}`);
        if (controller.signal.aborted) return;
        const computed = buildNoiseDataset(body.bars);
        setLoaded({ payload: body, dataset: computed });
        if (!gapTouchedRef.current) {
          setGapPct(body.live.liveGapPct);
        }
        if (!todayMoveTouchedRef.current) {
          setUseLastCompletedAsToday(false);
          setTodayMovePct(body.live.liveTodayReturnPct ?? body.live.liveGapPct);
        }
        if (!streakTouchedRef.current) {
          const liveStreak =
            streakBasisRef.current === "candle"
              ? (body.live.currentCandleStreak ?? computed.currentCandleStreak)
              : (body.live.currentStreak ?? computed.currentStreak);
          setStreakDirection(liveStreak.direction);
          setStreakDays(Math.max(1, liveStreak.count || 1));
        }
        if (!patternTouchedRef.current) {
          const liveRet = body.live.priceSource === "regular" ? body.live.liveTodayReturnPct : null;
          const suggested = suggestLivePattern(computed, liveRet);
          const suggestedLeadup = suggestLiveLeadupPattern(computed, liveRet);
          setPatternMode("days");
          setPatternLookbackDays(2);
          setDayMinus4Rule(ANY_NEG_RULE);
          setDayMinus3Rule(ANY_NEG_RULE);
          setDayMinus2Rule(ANY_NEG_RULE);
          setPrevDayRule(suggested.prevDayRule);
          setDay0Rule(suggested.day0Rule);
          setPriorWindowRule(suggestedLeadup.priorWindowRule);
          setPatternRegime("all");
          setPatternMinGapDays(0);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "NoiseMeter-Daten konnten nicht geladen werden.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [ticker, years, reloadNonce]);

  const data = loaded?.payload ?? null;
  const dataset = loaded?.dataset ?? null;

  const liveCloseStreak =
    dataset?.currentStreak ?? data?.live.currentStreak ?? { direction: "red" as const, count: 1 };
  const liveCandleStreak =
    dataset?.currentCandleStreak ?? data?.live.currentCandleStreak ?? liveCloseStreak;
  const activeLiveStreak = streakBasis === "candle" ? liveCandleStreak : liveCloseStreak;

  const evaluation = useMemo(() => {
    if (!dataset) return null;
    return evaluateNoiseScenario(dataset, {
      gapPct,
      streakDays,
      streakDirection,
      streakBasis,
      weekday: data?.live.nextWeekday,
    });
  }, [dataset, gapPct, streakDays, streakDirection, streakBasis, data?.live.nextWeekday]);

  const priorCompletedDataset = useMemo(() => {
    if (!useLastCompletedAsToday || !data || data.bars.length < 30) return null;
    return buildNoiseDataset(data.bars.slice(0, -1));
  }, [useLastCompletedAsToday, data]);

  const nextDayForecast = useMemo(() => {
    if (!dataset) return null;
    if (useLastCompletedAsToday && priorCompletedDataset) {
      const priorStreak =
        streakBasis === "candle"
          ? priorCompletedDataset.currentCandleStreak
          : priorCompletedDataset.currentStreak;
      return evaluateNextDayForecast(priorCompletedDataset, {
        priorStreakDays: Math.max(1, priorStreak.count || 1),
        priorStreakDirection: priorStreak.direction,
        streakBasis,
        todayMovePct,
        useExtraFactors,
      });
    }
    return evaluateNextDayForecast(dataset, {
      priorStreakDays: streakDays,
      priorStreakDirection: streakDirection,
      streakBasis,
      todayMovePct,
      useExtraFactors,
    });
  }, [dataset, priorCompletedDataset, useLastCompletedAsToday, streakDays, streakDirection, streakBasis, todayMovePct, useExtraFactors]);

  const liveTodayReturn = data ? (data.live.liveTodayReturnPct ?? data.live.liveGapPct) : 0;

  const activePatternInput = useMemo(() => {
    if (!data) return null;
    if (patternMode === "leadup") {
      return {
        ticker: data.ticker,
        prevDayRule: ANY_NEG_RULE,
        day0Rule,
        priorWindowRule,
        regimeFilter: patternRegime,
        minGapDays: patternMinGapDays,
      };
    }
    return {
      ticker: data.ticker,
      dayMinus4Rule: patternLookbackDays >= 5 ? dayMinus4Rule : ANY_NEG_RULE,
      dayMinus3Rule: patternLookbackDays >= 4 ? dayMinus3Rule : ANY_NEG_RULE,
      dayMinus2Rule: patternLookbackDays >= 3 ? dayMinus2Rule : ANY_NEG_RULE,
      prevDayRule,
      day0Rule,
      priorWindowRule: ANY_PRIOR_WIN,
      regimeFilter: patternRegime,
      minGapDays: patternMinGapDays,
    };
  }, [
    data,
    patternMode,
    patternLookbackDays,
    dayMinus4Rule,
    dayMinus3Rule,
    dayMinus2Rule,
    prevDayRule,
    day0Rule,
    priorWindowRule,
    patternRegime,
    patternMinGapDays,
  ]);

  const patternStudy = useMemo(() => {
    if (!dataset || !activePatternInput) return null;
    return evaluatePatternStudy(dataset, activePatternInput);
  }, [dataset, activePatternInput]);

  const livePatternSnapshot = useMemo(() => {
    if (!dataset || !data) return null;
    return getLivePatternSnapshot(
      dataset,
      data.live.priceSource === "regular" ? liveTodayReturn : null,
    );
  }, [dataset, data, liveTodayReturn]);

  const isLiveSetupActive = useMemo(() => {
    if (!livePatternSnapshot || !activePatternInput) return false;
    return matchesLivePatternSnapshot(livePatternSnapshot, activePatternInput);
  }, [livePatternSnapshot, activePatternInput]);

  const sortedPatternMatches = useMemo(() => {
    if (!patternStudy) return [];
    const list = [...patternStudy.matches];
    const { key, dir } = matchSort;
    const mult = dir === "asc" ? 1 : -1;
    list.sort((a: PatternMatch, b: PatternMatch) => {
      if (key === "session") {
        return a.session.localeCompare(b.session) * mult;
      }
      const av = a[key];
      const bv = b[key];
      if (av === null && bv === null) return b.session.localeCompare(a.session);
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av !== bv) return (av - bv) * mult;
      return b.session.localeCompare(a.session);
    });
    return list;
  }, [patternStudy, matchSort]);

  const switchStreakBasis = (nextBasis: NoiseStreakBasis) => {
    setStreakBasis(nextBasis);
    const nextLive = nextBasis === "candle" ? liveCandleStreak : liveCloseStreak;
    setStreakDirection(nextLive.direction);
    setStreakDays(Math.max(1, nextLive.count || 1));
    setStreakTouched(false);
  };

  const selectTicker = (next: string) => {
    const clean = next.replace(/^YF:/i, "").trim().toUpperCase();
    if (!isYahooTicker(clean)) {
      setError("Bitte gib einen gültigen Yahoo-Ticker ein (z. B. SPY, QQQ, ^GSPC, ^GDAXI, NVDA).");
      return;
    }
    setError("");
    setInput(clean);
    setTicker(clean);
    setGapTouched(false);
    setTodayMoveTouched(false);
    setStreakTouched(false);
    setPatternTouched(false);
    setShowAllPatternMatches(false);
    onTickerSelect?.(clean);
  };

  const applyStreakRow = (row: StreakStats) => {
    setStreakDirection(row.direction);
    setStreakDays(row.days);
    setStreakTouched(true);
  };

  const applyLivePattern = (targetMode: PatternMode = patternMode) => {
    if (!dataset || !data) return;
    const liveRet = data.live.priceSource === "regular" ? liveTodayReturn : null;
    if (targetMode === "leadup") {
      const suggested = suggestLiveLeadupPattern(dataset, liveRet);
      setPatternMode("leadup");
      setPriorWindowRule(suggested.priorWindowRule);
      setDay0Rule(suggested.day0Rule);
    } else {
      const suggested = suggestLivePattern(dataset, liveRet);
      setPatternMode("days");
      setPatternLookbackDays(2);
      setDayMinus4Rule(ANY_NEG_RULE);
      setDayMinus3Rule(ANY_NEG_RULE);
      setDayMinus2Rule(ANY_NEG_RULE);
      setPrevDayRule(suggested.prevDayRule);
      setDay0Rule(suggested.day0Rule);
    }
    setPatternRegime("all");
    setPatternTouched(false);
    setShowAllPatternMatches(false);
  };

  const switchPatternMode = (nextMode: PatternMode) => {
    setPatternMode(nextMode);
    if (nextMode === "leadup" && priorWindowRule.op === "any") {
      setPriorWindowRule(DEFAULT_PRIOR_WIN);
    }
    if (matchSort.key === "priorWindowPct" && nextMode === "days") {
      setMatchSort({ key: "session", dir: "desc" });
    } else if (matchSort.key === "prevDayPct" && nextMode === "leadup") {
      setMatchSort({ key: "session", dir: "desc" });
    }
    setPatternTouched(true);
    setShowAllPatternMatches(false);
  };

  const invertPatternRules = () => {
    if (patternMode === "leadup") {
      setPriorWindowRule((cur) => ({ ...cur, ...invertRule(cur) }));
    } else {
      setDayMinus4Rule((cur) => invertRule(cur));
      setDayMinus3Rule((cur) => invertRule(cur));
      setDayMinus2Rule((cur) => invertRule(cur));
      setPrevDayRule((cur) => invertRule(cur));
    }
    setDay0Rule((cur) => invertRule(cur));
    setPatternTouched(true);
    setShowAllPatternMatches(false);
  };

  const relaxPatternRules = () => {
    if (patternMode === "leadup") {
      setPriorWindowRule((cur) => ({ ...cur, ...relaxRule(cur, 1) }));
    } else {
      setDayMinus4Rule((cur) => relaxRule(cur, 0.5));
      setDayMinus3Rule((cur) => relaxRule(cur, 0.5));
      setDayMinus2Rule((cur) => relaxRule(cur, 0.5));
      setPrevDayRule((cur) => relaxRule(cur, 0.5));
    }
    setDay0Rule((cur) => relaxRule(cur, 0.5));
    setPatternTouched(true);
    setShowAllPatternMatches(false);
  };

  const toggleMatchSort = (key: MatchSortKey) => {
    setMatchSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "dropToBottomPct" ? "asc" : "desc" },
    );
  };

  const copyPatternSummary = async () => {
    if (!patternStudy || !data) return;
    const text = formatPatternSummaryText(data.ticker, patternStudy);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      setCopiedSummary(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedSummary(false), 2000);
    } catch {
      /* ignore clipboard denial */
    }
  };

  const exportPatternCsv = () => {
    if (!patternStudy || !data || patternStudy.matches.length === 0) return;
    const csv = buildPatternMatchesCsv(
      patternStudy,
      patternMode,
      priorWindowRule.days,
      patternLookbackDays,
    );
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.ticker.replace(/[^A-Z0-9_-]/gi, "")}-muster-${data.asOf}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const changePatternLookback = (depth: 2 | 3 | 4 | 5) => {
    setPatternLookbackDays(depth);
    if (depth < 5) setDayMinus4Rule(ANY_NEG_RULE);
    if (depth < 4) setDayMinus3Rule(ANY_NEG_RULE);
    if (depth < 3) setDayMinus2Rule(ANY_NEG_RULE);
    setShowAllPatternMatches(false);
  };

  const ruleSetterFor = (which: PatternDayKey) => {
    switch (which) {
      case "dayMinus4":
        return setDayMinus4Rule;
      case "dayMinus3":
        return setDayMinus3Rule;
      case "dayMinus2":
        return setDayMinus2Rule;
      case "prev":
        return setPrevDayRule;
      case "day0":
        return setDay0Rule;
    }
  };

  const updateRuleOp = (which: PatternDayKey, op: ReturnRuleOp) => {
    const updater = ruleSetterFor(which);
    updater((cur) => {
      let nextVal = cur.thresholdPct;
      const defaultMag = which === "prev" || which === "day0" ? 3 : 2;
      if (op === "lte" && nextVal > 0) nextVal = -Math.abs(nextVal || defaultMag);
      if (op === "gte" && nextVal < 0) nextVal = Math.abs(nextVal || defaultMag);
      if (op === "lte" && nextVal === 0) nextVal = -defaultMag;
      if (op === "gte" && nextVal === 0) nextVal = defaultMag;
      return { op, thresholdPct: nextVal };
    });
    setPatternTouched(true);
    setShowAllPatternMatches(false);
  };

  const updatePriorWindowOp = (op: ReturnRuleOp) => {
    setPriorWindowRule((cur) => {
      let nextVal = cur.thresholdPct;
      if (op === "lte" && nextVal > 0) nextVal = -Math.abs(nextVal || 8);
      if (op === "gte" && nextVal < 0) nextVal = Math.abs(nextVal || 8);
      if (op === "lte" && nextVal === 0) nextVal = -8;
      if (op === "gte" && nextVal === 0) nextVal = 8;
      return { ...cur, op, thresholdPct: nextVal };
    });
    setPatternTouched(true);
    setShowAllPatternMatches(false);
  };

  const renderStreakCard = (titleLabel: string) => {
    if (!data || !evaluation) return null;
    return (
      <div className="noise-sim-card">
        <div className="noise-sim-head">
          <span>
            <Activity size={14} /> {titleLabel}
          </span>
          <div className="noise-sim-actions">
            <button
              type="button"
              className={`noise-mini-btn${!streakTouched ? " active" : ""}`}
              onClick={() => {
                setStreakDirection(activeLiveStreak.direction);
                setStreakDays(Math.max(1, activeLiveStreak.count || 1));
                setStreakTouched(false);
              }}
            >
              Aktuell ({activeLiveStreak.count}{" "}
              {activeLiveStreak.direction === "red" ? "rot" : "grün"})
            </button>
            <button
              type="button"
              className={`noise-mini-btn dir-red${streakDirection === "red" ? " active" : ""}`}
              aria-pressed={streakDirection === "red"}
              onClick={() => {
                setStreakDirection("red");
                setStreakTouched(true);
              }}
            >
              Rot
            </button>
            <button
              type="button"
              className={`noise-mini-btn dir-green${streakDirection === "green" ? " active" : ""}`}
              aria-pressed={streakDirection === "green"}
              onClick={() => {
                setStreakDirection("green");
                setStreakTouched(true);
              }}
            >
              Grün
            </button>
          </div>
        </div>
        <div className="noise-basis-row" role="group" aria-label="Streak-Berechnungsbasis">
          <button
            type="button"
            className={`noise-mini-btn${streakBasis === "close" ? " active" : ""}`}
            aria-pressed={streakBasis === "close"}
            title="Schlusskurs gegenüber Vortags-Close (Standard: echte Börsen-Close-Kurse)"
            onClick={() => switchStreakBasis("close")}
          >
            Close (vs Vortag): {liveCloseStreak.count}{" "}
            {liveCloseStreak.direction === "red" ? "rot" : "grün"}
          </button>
          <button
            type="button"
            className={`noise-mini-btn${streakBasis === "candle" ? " active" : ""}`}
            aria-pressed={streakBasis === "candle"}
            title="Nur Kerzenkörper (Close vs. Open — bei Up-Gap kann ein grüner Tag eine rote Kerze sein)"
            onClick={() => switchStreakBasis("candle")}
          >
            Kerzen (C vs O): {liveCandleStreak.count}{" "}
            {liveCandleStreak.direction === "red" ? "rot" : "grün"}
          </button>
        </div>
        <div className="noise-quick-row noise-streak-nums" role="group" aria-label="Anzahl Tage in Folge">
          {QUICK_STREAKS.map((d) => (
            <button
              key={d}
              type="button"
              className={`noise-mini-btn${streakDays === d ? " active" : ""}`}
              aria-pressed={streakDays === d}
              onClick={() => {
                setStreakDays(d);
                setStreakTouched(true);
              }}
            >
              {d}T
            </button>
          ))}
        </div>
        {dataset && dataset.recentDays.length > 0 ? (
          <div className="noise-recent-strip" aria-label="Letzte Handelstage">
            {dataset.recentDays.map((day) => {
              const isGreen = streakBasis === "candle" ? day.greenCandle : day.greenDay;
              const primaryDelta = streakBasis === "candle" ? day.openToClosePct : day.closeToClosePct;
              const differs = day.greenCandle !== day.greenDay;
              return (
                <div
                  key={day.session}
                  className={`noise-recent-day ${isGreen ? "is-green" : "is-red"}${differs ? " is-mixed" : ""}`}
                  title={`${day.session}: Kerze (C vs O) ${fmtSigned2(day.openToClosePct)} · Close vs Vortag ${fmtSigned2(day.closeToClosePct)}`}
                >
                  <span className="noise-recent-date">{fmtShortDate(day.session)}</span>
                  <span className="noise-recent-val mono">
                    {primaryDelta > 0
                      ? `+${primaryDelta.toFixed(1).replace(".", ",")}`
                      : `${primaryDelta.toFixed(1).replace(".", ",")}`}
                    %
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        <p className="noise-sim-hint">
          {evaluation.streakExact.label}: n = {evaluation.streakExact.sampleSize} ·{" "}
          {evaluation.streakAtLeast.label}: n = {evaluation.streakAtLeast.sampleSize}
        </p>
      </div>
    );
  };

  const vol = nextDayForecast?.expectedVolatility ?? null;

  return (
    <section className="noise-meter-panel" aria-label="NoiseMeter Statistik">
      {/* Compact Top Toolbar */}
      <div className="noise-toolbar">
        <form
          className="noise-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            selectTicker(input);
          }}
        >
          <AssetBadge symbol={`YF:${ticker}`} size="xs" />
          <input
            aria-label="NoiseMeter Ticker"
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="SPY, ^GSPC, NVDA…"
          />
          <button type="submit" className="button small primary">
            Analysieren
          </button>
        </form>

        <div className="noise-years-group" role="group" aria-label="Historischer Zeitraum">
          {HISTORY_RANGES.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              className={`button small${years === opt.value ? " primary" : ""}`}
              aria-pressed={years === opt.value}
              onClick={() => setYears(opt.value)}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            className="button small"
            aria-label="Daten aktualisieren"
            title="Live-Quote & Historie neu laden"
            onClick={() => setReloadNonce((n) => n + 1)}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
          {onOpenChart ? (
            <button type="button" className="button small" onClick={() => onOpenChart(ticker)}>
              Chart
            </button>
          ) : null}
        </div>
      </div>

      {/* Quick Ticker Presets */}
      <div className="noise-preset-strip" role="group" aria-label="Schnellwahl Indizes und Aktien">
        {PRESET_TICKERS.map((p) => (
          <button
            key={p.ticker}
            type="button"
            className={`noise-chip${ticker === p.ticker ? " active" : ""}`}
            onClick={() => selectTicker(p.ticker)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="noise-error" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="noise-loading" role="status">
          <Gauge size={18} className="spin" />
          <span>
            {years === "max"
              ? `Lade komplette Historie für ${ticker}…`
              : `Lade ${years}-Jahres-Statistik für ${ticker}…`}
          </span>
        </div>
      ) : null}

      {data && evaluation ? (
        <>
          {/* Compact Executive Hero: Gauge + Verdict + 3 Clickable Overview Tiles */}
          <div className="noise-hero">
            <NoiseGauge score={evaluation.score} tone={evaluation.tone} />

            <div className="noise-verdict">
              <div className="noise-verdict-head">
                <div>
                  <h3>
                    {data.ticker}
                    <span className="noise-asset-name">{data.name}</span>
                  </h3>
                  <div className="noise-meta-row">
                    <span className={`noise-pill tone-${evaluation.tone}`}>{evaluation.verdictLabel}</span>
                    <span className="noise-meta-chip">
                      {sourceLabel(data.live.priceSource)}:{" "}
                      <strong className="mono">{fmtSigned2(data.live.liveGapPct)}</strong>
                    </span>
                    <span className="noise-meta-chip">
                      {data.totalDays.toLocaleString("de-DE")} Tage ({data.bars[0]?.session.slice(0, 4)}–
                      {data.asOf.slice(0, 4)})
                    </span>
                  </div>
                </div>
              </div>

              <p className="noise-verdict-sub">{evaluation.verdictSubtitle}</p>

              {/* 3 Executive At-A-Glance Tiles */}
              <div className="noise-exec-grid" role="group" aria-label="Schnellübersicht">
                {nextDayForecast ? (
                  <button
                    type="button"
                    className={`noise-exec-tile${activeView === "forecast" ? " is-active" : ""}`}
                    onClick={() => setActiveView("forecast")}
                  >
                    <span className="noise-exec-label">
                      <Target size={12} /> Morgen (T+1)
                    </span>
                    <div className="noise-exec-split mono">
                      <strong className="positive">{fmtPct(nextDayForecast.greenProb)}</strong>
                      <span className="muted">/</span>
                      <strong className="negative">{fmtPct(nextDayForecast.redProb)}</strong>
                    </div>
                    <div className="noise-split-bar noise-exec-bar" aria-hidden="true">
                      <div className="noise-split-green" style={{ width: `${nextDayForecast.greenProb}%` }} />
                      <div className="noise-split-red" style={{ width: `${nextDayForecast.redProb}%` }} />
                    </div>
                    <small className="noise-exec-sub">
                      Edge{" "}
                      <b className="mono">
                        {nextDayForecast.edgeVsBasePct > 0
                          ? "+"
                          : nextDayForecast.edgeVsBasePct < 0
                            ? "−"
                            : ""}
                        {Math.abs(nextDayForecast.edgeVsBasePct).toFixed(1).replace(".", ",")} Pp.
                      </b>{" "}
                      · Ø <b className="mono">{fmtSigned2(nextDayForecast.avgNextDayPct)}</b>
                    </small>
                  </button>
                ) : null}

                {vol ? (
                  <button
                    type="button"
                    className={`noise-exec-tile${activeView === "forecast" ? " is-active" : ""}`}
                    onClick={() => setActiveView("forecast")}
                  >
                    <div className="noise-exec-head-row">
                      <span className="noise-exec-label">
                        <Zap size={12} /> Erwartete Vola (T+1)
                      </span>
                      <span className={`noise-vol-regime tone-${vol.regimeTone}`}>{vol.regime}</span>
                    </div>
                    <div className="noise-exec-big mono">±{fmtPct2(vol.expectedAbsMovePct)}</div>
                    <small className="noise-exec-sub">
                      Range <b className="mono">{fmtPct2(vol.expectedRangePct)}</b> ·{" "}
                      <b className="mono">{vol.volRatioVsAtr.toFixed(2).replace(".", ",")}× ATR14</b>
                    </small>
                  </button>
                ) : null}

                {patternStudy ? (
                  <button
                    type="button"
                    className={`noise-exec-tile${activeView === "pattern" ? " is-active" : ""}`}
                    onClick={() => setActiveView("pattern")}
                  >
                    <div className="noise-exec-head-row">
                      <span className="noise-exec-label">
                        <History size={12} /> Muster-Scanner
                      </span>
                      <span className="noise-exec-tag mono">{patternStudy.sampleSize}×</span>
                    </div>
                    <div className="noise-exec-big mono">
                      {patternStudy.sampleSize > 0
                        ? `${fmtPct(patternStudy.bearCycleRate)} Bär`
                        : "0 Treffer"}
                    </div>
                    <small className="noise-exec-sub">
                      {patternStudy.sampleSize > 0 ? (
                        patternStudy.bottomEvaluatedCount > 0 && patternStudy.medianFurtherDropPct !== null ? (
                          <>
                            Drop bis Tief:{" "}
                            <b className="mono negative">
                              {patternStudy.minFurtherDropPct !== null && patternStudy.droppedFurtherRate === 100
                                ? `min. ${fmtPct(patternStudy.minFurtherDropPct, true)}`
                                : fmtPct(patternStudy.medianFurtherDropPct, true)}
                            </b>
                          </>
                        ) : (
                          <>
                            Drop bis Tief: <b className="mono muted">laufend</b>
                          </>
                        )
                      ) : (
                        patternStudy.ruleDescription
                      )}
                    </small>
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Primary 3-Tab Segmented Navigation */}
          <div className="noise-view-tabs" role="tablist" aria-label="NoiseMeter Ansichten">
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "forecast"}
              className={activeView === "forecast" ? "active" : ""}
              onClick={() => setActiveView("forecast")}
            >
              <Target size={14} />
              <span>Morgen &amp; Vola</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "pattern"}
              className={activeView === "pattern" ? "active" : ""}
              onClick={() => setActiveView("pattern")}
            >
              <History size={14} />
              <span>Muster-Scanner</span>
              {patternStudy ? <em className="mono">{patternStudy.sampleSize}×</em> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "gaps"}
              className={activeView === "gaps" ? "active" : ""}
              onClick={() => setActiveView("gaps")}
            >
              <Sparkles size={14} />
              <span>Premarket &amp; Gaps</span>
            </button>
          </div>

          {/* ================================================================ */}
          {/* VIEW 1: MORGEN & ERWARTETE VOLATILITÄT (T+1)                      */}
          {/* ================================================================ */}
          {activeView === "forecast" && nextDayForecast ? (
            <section className="noise-t1-card" aria-label="Morgen-Wahrscheinlichkeit T+1 Szenario">
              <div className="noise-t1-header">
                <div className="noise-t1-title-group">
                  <h4>
                    <Target size={15} /> Morgen-Wahrscheinlichkeit (T+1)
                  </h4>
                  <span className="noise-t1-scenario-badge">{nextDayForecast.scenarioLabel}</span>
                </div>
                <div className="noise-t1-meta">
                  <span className={`noise-t1-conf conf-${nextDayForecast.confidence}`}>
                    Konfidenz: {nextDayForecast.confidence} (n<sub>eff</sub> ={" "}
                    <b className="mono">{nextDayForecast.effectiveSampleSize.toFixed(1).replace(".", ",")}</b>)
                  </span>
                  <button
                    type="button"
                    className={`noise-mini-btn noise-t1-factor-toggle${useExtraFactors ? " active" : ""}`}
                    aria-pressed={useExtraFactors}
                    onClick={() => setUseExtraFactors((prev) => !prev)}
                  >
                    <SlidersHorizontal size={12} />
                    <span>Extra-Faktoren (RSI, ATR, Trend): {useExtraFactors ? "Aktiv" : "Aus"}</span>
                  </button>
                </div>
              </div>

              <div className="noise-t1-headline">
                <div className="noise-t1-prob-side is-green">
                  <span className="noise-t1-prob-label">Morgen Grün (Close &gt; Heute)</span>
                  <strong className="mono positive">{fmtPct(nextDayForecast.greenProb)}</strong>
                </div>
                <div className="noise-t1-edge-badge">
                  <span>Edge vs. Basisrate ({fmtPct(nextDayForecast.baseGreenProb)})</span>
                  <strong
                    className={`mono ${
                      nextDayForecast.edgeVsBasePct > 0
                        ? "positive"
                        : nextDayForecast.edgeVsBasePct < 0
                          ? "negative"
                          : ""
                    }`}
                  >
                    {nextDayForecast.edgeVsBasePct > 0
                      ? "+"
                      : nextDayForecast.edgeVsBasePct < 0
                        ? "−"
                        : ""}
                    {Math.abs(nextDayForecast.edgeVsBasePct).toFixed(1).replace(".", ",")} Pp.
                  </strong>
                </div>
                <div className="noise-t1-prob-side is-red">
                  <span className="noise-t1-prob-label">Morgen Rot (Close &lt; Heute)</span>
                  <strong className="mono negative">{fmtPct(nextDayForecast.redProb)}</strong>
                </div>
              </div>

              <div className="noise-split-bar noise-t1-bar" aria-label="Wahrscheinlichkeit morgen grün gegen rot">
                <div className="noise-split-green" style={{ width: `${nextDayForecast.greenProb}%` }} />
                <div className="noise-split-red" style={{ width: `${nextDayForecast.redProb}%` }} />
              </div>

              <p className="noise-t1-summary">{nextDayForecast.summary}</p>

              {/* Dedicated Expected Next-Day Volatility Panel */}
              {vol ? (
                <div className="noise-vol-box" aria-label="Erwartete Volatilität morgen (T+1)">
                  <div className="noise-vol-head">
                    <div className="noise-t1-title-group">
                      <h5>
                        <Zap size={14} /> Erwartete Volatilität morgen (T+1)
                      </h5>
                      <span className={`noise-vol-regime tone-${vol.regimeTone}`}>
                        Vola {vol.regime} · {vol.volRatioVsAtr.toFixed(2).replace(".", ",")}× ATR14
                      </span>
                    </div>
                    <span className="noise-vol-atr-note mono">
                      Basis ATR(14): {data.live.currentAtr14Pct.toFixed(2).replace(".", ",")} %
                    </span>
                  </div>

                  <div className="noise-vol-grid">
                    <div className="noise-vol-cell">
                      <span>Erwarteter Tages-Move (|C→C|)</span>
                      <strong className="mono">±{fmtPct2(vol.expectedAbsMovePct)}</strong>
                      <small>
                        Kursspanne:{" "}
                        <b className="mono">
                          {fmtPrice(vol.expectedPriceLow)} – {fmtPrice(vol.expectedPriceHigh, data.currency)}
                        </b>
                      </small>
                    </div>

                    <div className="noise-vol-cell">
                      <span>Erwartete Handelsspanne (High–Low)</span>
                      <strong className="mono">{fmtPct2(vol.expectedRangePct)}</strong>
                      <small>
                        True Range (inkl. Gap): <b className="mono">{fmtPct2(vol.expectedTrueRangePct)}</b> ·
                        80 %-Stress: <b className="mono">{fmtPct2(vol.expectedRangeP80Pct)}</b>
                      </small>
                    </div>

                    <div className="noise-vol-cell">
                      <span>Schwankungs-Wahrscheinlichkeiten</span>
                      <div className="noise-vol-tails mono">
                        <span>
                          ≥ 1 %: <b>{fmtPct(vol.probMoveOver1Pct)}</b>
                        </span>
                        <span>
                          ≥ 2 %: <b>{fmtPct(vol.probMoveOver2Pct)}</b>
                        </span>
                        <span>
                          ≥ 3 %: <b>{fmtPct(vol.probMoveOver3Pct)}</b>
                        </span>
                      </div>
                      <small>
                        Hist. Median (unskaliert):{" "}
                        <b className="mono">±{fmtPct2(vol.historicalMedianAbsMovePct)}</b> · Range{" "}
                        <b className="mono">{fmtPct2(vol.historicalMedianRangePct)}</b>
                      </small>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Compact 2-Column Scenario Simulator (Vor-Serie + Heutiger Move side-by-side) */}
              <div className="noise-t1-controls-grid">
                {renderStreakCard(`Vor-Serie im ${data.ticker}`)}

                <div className="noise-sim-card">
                  <div className="noise-sim-head">
                    <label htmlFor="noise-today-move-input">
                      <TrendingUp size={14} /> Heutiger Move (%) nach {streakDays}{" "}
                      {streakDirection === "red" ? "roten" : "grünen"}{" "}
                      {streakBasis === "candle" ? "Kerzen" : "Tagen"}
                    </label>
                    <div className="noise-sim-actions">
                      <button
                        type="button"
                        className={`noise-mini-btn${!todayMoveTouched ? " active" : ""}`}
                        onClick={() => {
                          setTodayMovePct(liveTodayReturn);
                          setTodayMoveTouched(false);
                          setUseLastCompletedAsToday(false);
                        }}
                      >
                        {liveMoveShortLabel(data.live.priceSource)} ({fmtPct(liveTodayReturn, true)})
                      </button>
                      {data.live.priceSource !== "regular" &&
                      dataset &&
                      dataset.lastDayReturnPct !== null ? (
                        <button
                          type="button"
                          className={`noise-mini-btn${
                            useLastCompletedAsToday && Math.abs(todayMovePct - dataset.lastDayReturnPct) < 0.05
                              ? " active"
                              : ""
                          }`}
                          title={`Letzter abgeschlossener Börsen-Close (${dataset.lastSession}) als Basis für T+1 ohne Doppelzählung`}
                          onClick={() => {
                            setTodayMovePct(dataset.lastDayReturnPct!);
                            setTodayMoveTouched(true);
                            setUseLastCompletedAsToday(true);
                          }}
                        >
                          Close {fmtShortDate(dataset.lastSession)} ({fmtPct(dataset.lastDayReturnPct, true)})
                        </button>
                      ) : null}
                      <NumericPctInput
                        id="noise-today-move-input"
                        step={0.1}
                        min={-25}
                        max={25}
                        ariaLabel="Heutiger Tages-Move Prozent"
                        value={Number.isFinite(todayMovePct) ? todayMovePct : 0}
                        onChange={(val) => {
                          setTodayMovePct(val);
                          setTodayMoveTouched(true);
                          setUseLastCompletedAsToday(false);
                        }}
                      />
                    </div>
                  </div>
                  <input
                    type="range"
                    aria-label="Heutiger Tages-Move Regler"
                    className="noise-slider"
                    min="-10"
                    max="10"
                    step="0.1"
                    value={Math.max(-10, Math.min(10, todayMovePct))}
                    onChange={(e) => {
                      setTodayMovePct(Number(e.target.value));
                      setTodayMoveTouched(true);
                    }}
                  />
                  <div className="noise-quick-row">
                    {QUICK_TODAY_MOVES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`noise-mini-btn${Math.abs(todayMovePct - m) < 0.05 ? " active" : ""}`}
                        onClick={() => {
                          setTodayMovePct(m);
                          setTodayMoveTouched(true);
                        }}
                      >
                        {m > 0
                          ? `+${m.toFixed(1).replace(".", ",")}%`
                          : `−${Math.abs(m).toFixed(1).replace(".", ",")}%`}
                      </button>
                    ))}
                  </div>
                  <p className="noise-sim-hint">
                    Projizierter Kurs: <b className="mono">{fmtPrice(vol?.projectedPrice, data.currency)}</b> ·
                    Move: <b className="mono">{nextDayForecast.projected.moveAtrRatio.toFixed(2).replace(".", ",")}× ATR14</b>
                  </p>
                </div>
              </div>

              {/* Compact 4-Metric Context Strip */}
              <div className="noise-t1-metrics">
                <div className="noise-t1-metric">
                  <span>Ø Morgen (T+1)</span>
                  <strong className={`mono ${nextDayForecast.avgNextDayPct >= 0 ? "positive" : "negative"}`}>
                    {fmtSigned2(nextDayForecast.avgNextDayPct)}
                  </strong>
                  <small>
                    Median: <b className="mono">{fmtSigned2(nextDayForecast.medianNextDayPct)}</b>
                  </small>
                </div>
                <div className="noise-t1-metric">
                  <span>Grüne Kerze T+1 (C&gt;O)</span>
                  <strong className="mono">{fmtPct(nextDayForecast.greenCandleProb)}</strong>
                  <small>
                    3T / 5T Ø:{" "}
                    <b className="mono">{fmtSigned2(nextDayForecast.fwd3dAvgPct)}</b> /{" "}
                    <b className="mono">{fmtSigned2(nextDayForecast.fwd5dAvgPct)}</b>
                  </small>
                </div>
                <div className="noise-t1-metric">
                  <span>Projizierter RSI(14)</span>
                  <strong className="mono">{nextDayForecast.projected.rsi14.toFixed(1).replace(".", ",")}</strong>
                  <small>
                    Move:{" "}
                    <b className="mono">
                      {nextDayForecast.projected.moveAtrRatio > 0
                        ? "+"
                        : nextDayForecast.projected.moveAtrRatio < 0
                          ? "−"
                          : ""}
                      {Math.abs(nextDayForecast.projected.moveAtrRatio).toFixed(2).replace(".", ",")}× ATR14
                    </b>
                  </small>
                </div>
                <div className="noise-t1-metric">
                  <span>Trend-Kontext</span>
                  <strong className="mono">
                    {nextDayForecast.projected.aboveSma200 === null
                      ? "—"
                      : nextDayForecast.projected.aboveSma200
                        ? "Über 200-SMA"
                        : "Unter 200-SMA"}
                  </strong>
                  <small>
                    20-EMA Distanz: <b className="mono">{fmtSigned2(nextDayForecast.projected.distEma20Pct)}</b>
                  </small>
                </div>
              </div>

              {/* 4 Empirical Factor Breakdown */}
              {nextDayForecast.factors.length > 0 ? (
                <div className="noise-t1-factors" aria-label="Faktor-Aufschlüsselung für T+1">
                  {nextDayForecast.factors.map((f) => (
                    <article key={f.id} className={`noise-t1-factor stance-${f.stance}`}>
                      <div className="noise-t1-factor-head">
                        <span>{f.label}</span>
                        <em className="mono">n = {f.sampleSize}</em>
                      </div>
                      <div className="noise-t1-factor-cond">{f.condition}</div>
                      <div className="noise-t1-factor-nums mono">
                        <span className="positive">Grün {fmtPct(f.greenProb)}</span>
                        <span className="negative">Rot {fmtPct(f.redProb)}</span>
                      </div>
                      <small>
                        Edge:{" "}
                        <b
                          className={`mono ${
                            f.edgeVsBasePct > 0 ? "positive" : f.edgeVsBasePct < 0 ? "negative" : ""
                          }`}
                        >
                          {f.edgeVsBasePct > 0 ? "+" : f.edgeVsBasePct < 0 ? "−" : ""}
                          {Math.abs(f.edgeVsBasePct).toFixed(1).replace(".", ",")} Pp.
                        </b>{" "}
                        · Ø T+1 <b className="mono">{fmtSigned2(f.avgNextDayPct)}</b>
                      </small>
                    </article>
                  ))}
                </div>
              ) : null}

              {/* Top 6 Historical Twin Days */}
              {nextDayForecast.twins.length > 0 ? (
                <div className="noise-table-wrap noise-t1-twins">
                  <h4>Historische Zwillingstage (ähnlichste Setups → Ergebnis am Folgetag T+1)</h4>
                  <table className="noise-table">
                    <thead>
                      <tr>
                        <th>Datum (Tag 0)</th>
                        <th>Vor-Serie</th>
                        <th>Tag 0 Move</th>
                        <th>RSI(14)</th>
                        <th>Morgen (T+1)</th>
                        <th>Match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nextDayForecast.twins.map((twin) => (
                        <tr key={twin.session}>
                          <td className="mono">{twin.session}</td>
                          <td className={`mono ${twin.priorStreak < 0 ? "negative" : "positive"}`}>
                            {twin.priorStreak < 0
                              ? `${Math.abs(twin.priorStreak)} rot`
                              : twin.priorStreak > 0
                                ? `${twin.priorStreak} grün`
                                : "0"}
                          </td>
                          <td className={`mono ${twin.dayMovePct >= 0 ? "positive" : "negative"}`}>
                            {fmtSigned2(twin.dayMovePct)}
                          </td>
                          <td className="mono">{twin.rsi14.toFixed(1).replace(".", ",")}</td>
                          <td className={`mono ${twin.nextDayGreen ? "positive" : "negative"}`}>
                            <span className={`noise-tag ${twin.nextDayGreen ? "open" : "filled"}`}>
                              {twin.nextDayGreen ? "Grün" : "Rot"} {fmtSigned2(twin.nextDayPct)}
                            </span>
                          </td>
                          <td className="mono">{fmtPct(twin.similarityPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          ) : null}

          {/* ================================================================ */}
          {/* VIEW 2: HISTORISCHER MUSTER-SCANNER (OddStats-Analyse)            */}
          {/* ================================================================ */}
          {activeView === "pattern" && patternStudy ? (
            <section className="noise-pattern-card" aria-label="Historischer Muster-Scanner">
              <div className="noise-pattern-head">
                <div className="noise-t1-title-group">
                  <h4>
                    <History size={15} /> Historischer Muster-Scanner
                  </h4>
                  <span className="noise-t1-scenario-badge">{patternStudy.ruleDescription}</span>
                  {isLiveSetupActive ? (
                    <span className="noise-pattern-active-badge" title="Das aktuelle Markt-Setup erfüllt dieses Muster">
                      Muster aktiv ✓
                    </span>
                  ) : null}
                </div>
                <div className="noise-pattern-head-actions">
                  <span className="noise-meta-chip">
                    <strong className="mono">{patternStudy.sampleSize}×</strong>
                    {patternStudy.minGapDays > 0 && patternStudy.rawSampleSize > patternStudy.sampleSize
                      ? ` (aus ${patternStudy.rawSampleSize})`
                      : ""}{" "}
                    seit {patternStudy.firstYear} ({patternStudy.totalDays.toLocaleString("de-DE")} Tage)
                  </span>
                  <button
                    type="button"
                    className={`noise-mini-btn${copiedSummary ? " active" : ""}`}
                    title="Zusammenfassung in die Zwischenablage kopieren"
                    onClick={() => void copyPatternSummary()}
                  >
                    {copiedSummary ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copiedSummary ? "Kopiert" : "Kopieren"}</span>
                  </button>
                </div>
              </div>

              {/* OddStats-Style Headline & Empirical Bullet Facts */}
              <div className="noise-pattern-summary">
                <p className="noise-pattern-headline">{patternStudy.headline}</p>
                <ul className="noise-pattern-bullets">
                  {patternStudy.bullets.map((b, idx) => (
                    <li key={idx}>{b}</li>
                  ))}
                </ul>
              </div>

              {/* Simplified 2-Mode Switcher (Vorlauf → Heute | Einzeltage) + Lookback Depth + Mirror Action */}
              <div className="noise-pattern-controls-bar">
                <div className="noise-pattern-mode-switch" role="group" aria-label="Muster-Modus">
                  <button
                    type="button"
                    className={`noise-mini-btn${patternMode === "leadup" ? " active" : ""}`}
                    aria-pressed={patternMode === "leadup"}
                    onClick={() => switchPatternMode("leadup")}
                  >
                    Vorlauf → Heute
                  </button>
                  <button
                    type="button"
                    className={`noise-mini-btn${patternMode === "days" ? " active" : ""}`}
                    aria-pressed={patternMode === "days"}
                    onClick={() => switchPatternMode("days")}
                  >
                    Einzeltage
                  </button>
                </div>

                <div className="noise-pattern-toolbar-right">
                  {patternMode === "days" ? (
                    <div className="noise-pattern-depth" role="group" aria-label="Muster Rückblick-Tiefe">
                      <span className="noise-pattern-rule-label">Rückblick:</span>
                      {LOOKBACK_DEPTHS.map((depth) => (
                        <button
                          key={depth}
                          type="button"
                          className={`noise-mini-btn${patternLookbackDays === depth ? " active" : ""}`}
                          aria-pressed={patternLookbackDays === depth}
                          onClick={() => changePatternLookback(depth)}
                        >
                          {depth} Tage
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="noise-mini-btn"
                    title="Richtung umkehren (≤ ↔ ≥ und Vorzeichen spiegeln)"
                    onClick={invertPatternRules}
                  >
                    <ArrowLeftRight size={12} />
                    <span>Spiegeln</span>
                  </button>
                </div>
              </div>

              {/* Mode-Focused Presets */}
              <div className="noise-quick-row noise-pattern-presets" role="group" aria-label="Muster-Vorlagen">
                <button
                  type="button"
                  className={`noise-mini-btn${!patternTouched ? " active" : ""}`}
                  onClick={() => applyLivePattern(patternMode)}
                >
                  {patternMode === "leadup" ? "Live-Vorlauf" : "Live-Muster"}
                </button>
                {PATTERN_PRESETS.filter((preset) => preset.mode === patternMode).map((preset) => {
                  const p4 = preset.dayMinus4 ?? ANY_NEG_RULE;
                  const p3 = preset.dayMinus3 ?? ANY_NEG_RULE;
                  const p2 = preset.dayMinus2 ?? ANY_NEG_RULE;
                  const pPrev = preset.prev ?? ANY_NEG_RULE;
                  const pWin = preset.priorWindow ?? ANY_PRIOR_WIN;
                  const activeD4 = patternLookbackDays >= 5 ? dayMinus4Rule : ANY_NEG_RULE;
                  const activeD3 = patternLookbackDays >= 4 ? dayMinus3Rule : ANY_NEG_RULE;
                  const activeD2 = patternLookbackDays >= 3 ? dayMinus2Rule : ANY_NEG_RULE;
                  const isActive =
                    preset.mode === "leadup"
                      ? rulesEqual(priorWindowRule, pWin) &&
                        (priorWindowRule.op === "any" || priorWindowRule.days === pWin.days) &&
                        rulesEqual(day0Rule, preset.day0)
                      : rulesEqual(activeD4, p4) &&
                        rulesEqual(activeD3, p3) &&
                        rulesEqual(activeD2, p2) &&
                        rulesEqual(prevDayRule, pPrev) &&
                        rulesEqual(day0Rule, preset.day0);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`noise-mini-btn${isActive ? " active" : ""}`}
                      onClick={() => {
                        if (preset.mode === "leadup") {
                          setPriorWindowRule(pWin);
                        } else {
                          setPatternLookbackDays(preset.lookbackDays ?? 2);
                          setDayMinus4Rule(p4);
                          setDayMinus3Rule(p3);
                          setDayMinus2Rule(p2);
                          setPrevDayRule(pPrev);
                        }
                        setDay0Rule(preset.day0);
                        setPatternTouched(true);
                        setShowAllPatternMatches(false);
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {/* Compact Live Context Bar: shows current tape values for the active mode */}
              {livePatternSnapshot ? (
                <div className="noise-pattern-live-bar" aria-label="Aktuelle Ticker-Werte">
                  <div className="noise-pattern-live-metrics">
                    <span className="noise-pattern-live-label">
                      Aktuell ({livePatternSnapshot.sessionLabel}):
                    </span>
                    {patternMode === "leadup" ? (
                      <>
                        <span className="noise-live-chip">
                          Vor-{priorWindowRule.days}T{" "}
                          <b
                            className={`mono ${(livePatternSnapshot.priorWindow[priorWindowRule.days] ?? 0) >= 0 ? "positive" : "negative"}`}
                          >
                            {fmtSigned2(livePatternSnapshot.priorWindow[priorWindowRule.days])}
                          </b>
                        </span>
                        <span className="noise-live-arrow">→</span>
                        <span className="noise-live-chip">
                          Tag 0{" "}
                          <b
                            className={`mono ${(livePatternSnapshot.day0Pct ?? 0) >= 0 ? "positive" : "negative"}`}
                          >
                            {fmtSigned2(livePatternSnapshot.day0Pct)}
                          </b>
                        </span>
                      </>
                    ) : (
                      <>
                        {patternLookbackDays >= 3 ? (
                          <>
                            <span className="noise-live-chip">
                              Tag −2{" "}
                              <b
                                className={`mono ${(livePatternSnapshot.dayMinus2Pct ?? 0) >= 0 ? "positive" : "negative"}`}
                              >
                                {fmtSigned2(livePatternSnapshot.dayMinus2Pct)}
                              </b>
                            </span>
                            <span className="noise-live-arrow">→</span>
                          </>
                        ) : null}
                        <span className="noise-live-chip">
                          Tag −1{" "}
                          <b
                            className={`mono ${(livePatternSnapshot.prevDayPct ?? 0) >= 0 ? "positive" : "negative"}`}
                          >
                            {fmtSigned2(livePatternSnapshot.prevDayPct)}
                          </b>
                        </span>
                        <span className="noise-live-arrow">→</span>
                        <span className="noise-live-chip">
                          Tag 0{" "}
                          <b
                            className={`mono ${(livePatternSnapshot.day0Pct ?? 0) >= 0 ? "positive" : "negative"}`}
                          >
                            {fmtSigned2(livePatternSnapshot.day0Pct)}
                          </b>
                        </span>
                      </>
                    )}
                    <span className={`noise-tag ${livePatternSnapshot.inBearCycle ? "filled" : "open"}`}>
                      {livePatternSnapshot.inBearCycle ? "Bärenmarkt" : "Bullenmarkt"} (52W{" "}
                      {fmtPct(livePatternSnapshot.drawdown52wPct, true)})
                    </span>
                  </div>
                  <button
                    type="button"
                    className="noise-mini-btn"
                    title="Aktuelle Ticker-Bewegung gerundet als Muster übernehmen"
                    onClick={() => applyLivePattern(patternMode)}
                  >
                    Übernehmen
                  </button>
                </div>
              ) : null}

              {/* Clean Mode-Specific Rule Builder */}
              <div className="noise-pattern-builder">
                {patternMode === "leadup" ? (
                  <>
                    {/* Mode 1: Cumulative Vorlauf (3T / 5T / 7T / 10T / 20T) → Heute (Tag 0) */}
                    <div className="noise-pattern-rule">
                      <span className="noise-pattern-rule-label">Vorlauf (kumulativ vor Heute)</span>
                      <div className="noise-pattern-rule-controls">
                        <div className="noise-pattern-ops" role="group" aria-label="Vorlauf Fenster">
                          {PRIOR_WINDOW_OPTIONS.map((w) => (
                            <button
                              key={w}
                              type="button"
                              className={`noise-mini-btn${priorWindowRule.days === w ? " active" : ""}`}
                              aria-pressed={priorWindowRule.days === w}
                              onClick={() => {
                                setPriorWindowRule((cur) => ({ ...cur, days: w }));
                                setPatternTouched(true);
                                setShowAllPatternMatches(false);
                              }}
                            >
                              {w}T
                            </button>
                          ))}
                        </div>
                        <div className="noise-pattern-ops" role="group" aria-label="Vorlauf Bedingung">
                          {(["lte", "gte", "any"] as const).map((op) => (
                            <button
                              key={op}
                              type="button"
                              className={`noise-mini-btn${priorWindowRule.op === op ? " active" : ""}`}
                              aria-pressed={priorWindowRule.op === op}
                              onClick={() => updatePriorWindowOp(op)}
                            >
                              {op === "lte" ? "≤" : op === "gte" ? "≥" : "Egal"}
                            </button>
                          ))}
                        </div>
                        {priorWindowRule.op !== "any" ? (
                          <div className="noise-pattern-num">
                            <NumericPctInput
                              step={1}
                              min={-80}
                              max={100}
                              showSteppers
                              ariaLabel="Vorlauf Schwelle Prozent"
                              value={priorWindowRule.thresholdPct}
                              onChange={(val) => {
                                setPriorWindowRule((cur) => ({
                                  ...cur,
                                  thresholdPct: val,
                                }));
                                setPatternTouched(true);
                              }}
                            />
                            <span>%</span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="noise-pattern-rule">
                      <span className="noise-pattern-rule-label">Heute (Tag 0)</span>
                      <div className="noise-pattern-rule-controls">
                        <div className="noise-pattern-ops" role="group" aria-label="Tag 0 Bedingung">
                          {(["gte", "lte", "any"] as const).map((op) => (
                            <button
                              key={op}
                              type="button"
                              className={`noise-mini-btn${day0Rule.op === op ? " active" : ""}`}
                              aria-pressed={day0Rule.op === op}
                              onClick={() => updateRuleOp("day0", op)}
                            >
                              {op === "lte" ? "≤" : op === "gte" ? "≥" : "Egal"}
                            </button>
                          ))}
                        </div>
                        {day0Rule.op !== "any" ? (
                          <div className="noise-pattern-num">
                            <NumericPctInput
                              step={0.5}
                              min={-40}
                              max={40}
                              showSteppers
                              ariaLabel="Tag 0 Schwelle Prozent"
                              value={day0Rule.thresholdPct}
                              onChange={(val) => {
                                setDay0Rule((cur) => ({
                                  ...cur,
                                  thresholdPct: val,
                                }));
                                setPatternTouched(true);
                              }}
                            />
                            <span>%</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : (
                  /* Mode 2: Individual Day Sequence (Tag -4 .. Tag -1 → Tag 0) */
                  (
                    [
                      ...(patternLookbackDays >= 5
                        ? [
                            {
                              key: "dayMinus4" as const,
                              label: "Tag −4",
                              ariaPrefix: "Tag minus 4",
                              rule: dayMinus4Rule,
                              ops: ["lte", "gte", "any"] as const,
                            },
                          ]
                        : []),
                      ...(patternLookbackDays >= 4
                        ? [
                            {
                              key: "dayMinus3" as const,
                              label: "Tag −3",
                              ariaPrefix: "Tag minus 3",
                              rule: dayMinus3Rule,
                              ops: ["lte", "gte", "any"] as const,
                            },
                          ]
                        : []),
                      ...(patternLookbackDays >= 3
                        ? [
                            {
                              key: "dayMinus2" as const,
                              label: "Tag −2",
                              ariaPrefix: "Tag minus 2",
                              rule: dayMinus2Rule,
                              ops: ["lte", "gte", "any"] as const,
                            },
                          ]
                        : []),
                      {
                        key: "prev" as const,
                        label: "Tag −1 (Vortag)",
                        ariaPrefix: "Tag minus 1",
                        rule: prevDayRule,
                        ops: ["lte", "gte", "any"] as const,
                      },
                      {
                        key: "day0" as const,
                        label: "Tag 0 (Heute)",
                        ariaPrefix: "Tag 0",
                        rule: day0Rule,
                        ops: ["gte", "lte", "any"] as const,
                      },
                    ] as const
                  ).map((item) => {
                    const setter = ruleSetterFor(item.key);
                    return (
                      <div key={item.key} className="noise-pattern-rule">
                        <span className="noise-pattern-rule-label">{item.label}</span>
                        <div className="noise-pattern-rule-controls">
                          <div className="noise-pattern-ops" role="group" aria-label={`${item.ariaPrefix} Bedingung`}>
                            {item.ops.map((op) => (
                              <button
                                key={op}
                                type="button"
                                className={`noise-mini-btn${item.rule.op === op ? " active" : ""}`}
                                aria-pressed={item.rule.op === op}
                                onClick={() => updateRuleOp(item.key, op)}
                              >
                                {op === "lte" ? "≤" : op === "gte" ? "≥" : "Egal"}
                              </button>
                            ))}
                          </div>
                          {item.rule.op !== "any" ? (
                            <div className="noise-pattern-num">
                              <NumericPctInput
                                step={0.5}
                                min={-40}
                                max={40}
                                showSteppers
                                ariaLabel={`${item.ariaPrefix} Schwelle Prozent`}
                                value={item.rule.thresholdPct}
                                onChange={(val) => {
                                  setter((cur) => ({
                                    ...cur,
                                    thresholdPct: val,
                                  }));
                                  setPatternTouched(true);
                                }}
                              />
                              <span>%</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}

                <div className="noise-pattern-rule">
                  <span className="noise-pattern-rule-label">Marktregime &amp; Cluster</span>
                  <div className="noise-pattern-rule-controls">
                    <div className="noise-pattern-ops" role="group" aria-label="Marktregime Filter">
                      {(
                        [
                          ["all", "Alle", patternStudy.regimeCounts.all],
                          ["bear", "Bärenmarkt", patternStudy.regimeCounts.bear],
                          ["bull", "Bullenmarkt", patternStudy.regimeCounts.bull],
                        ] as const
                      ).map(([val, label, count]) => (
                        <button
                          key={val}
                          type="button"
                          className={`noise-mini-btn${patternRegime === val ? " active" : ""}`}
                          aria-pressed={patternRegime === val}
                          onClick={() => {
                            setPatternRegime(val);
                            setShowAllPatternMatches(false);
                          }}
                        >
                          {label} <em className="mono">({count})</em>
                        </button>
                      ))}
                    </div>
                    <div className="noise-pattern-ops" role="group" aria-label="Signal-Abstand Filter">
                      <button
                        type="button"
                        className={`noise-mini-btn${patternMinGapDays === 0 ? " active" : ""}`}
                        aria-pressed={patternMinGapDays === 0}
                        title="Alle passenden Handelstage inkl. Mehrfachtreffer in derselben Crash-Woche"
                        onClick={() => {
                          setPatternMinGapDays(0);
                          setShowAllPatternMatches(false);
                        }}
                      >
                        Alle Tage
                      </button>
                      <button
                        type="button"
                        className={`noise-mini-btn${patternMinGapDays === 10 ? " active" : ""}`}
                        aria-pressed={patternMinGapDays === 10}
                        title="Nur unabhängige Episoden (mind. 10 Handelstage Abstand zwischen Treffern)"
                        onClick={() => {
                          setPatternMinGapDays(10);
                          setShowAllPatternMatches(false);
                        }}
                      >
                        Entclustert (≥ 10T)
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actionable Empty-State Helper when 0 matches */}
              {patternStudy.sampleSize === 0 ? (
                <div className="noise-pattern-empty" role="status">
                  <span>0 Treffer für diese Kombination — schnelle Anpassung:</span>
                  <div className="noise-pattern-empty-actions">
                    {years !== "max" ? (
                      <button
                        type="button"
                        className="noise-mini-btn active"
                        onClick={() => setYears("max")}
                      >
                        Auf Max-Historie erweitern
                      </button>
                    ) : null}
                    {patternRegime !== "all" && patternStudy.regimeCounts.all > 0 ? (
                      <button
                        type="button"
                        className="noise-mini-btn active"
                        onClick={() => setPatternRegime("all")}
                      >
                        Regime auf „Alle“ ({patternStudy.regimeCounts.all}×)
                      </button>
                    ) : null}
                    {patternMinGapDays > 0 && patternStudy.rawSampleSize > 0 ? (
                      <button
                        type="button"
                        className="noise-mini-btn"
                        onClick={() => setPatternMinGapDays(0)}
                      >
                        Cluster-Filter aus
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="noise-mini-btn"
                      onClick={relaxPatternRules}
                    >
                      Schwellen lockern (−25 %)
                    </button>
                  </div>
                </div>
              ) : null}

              {patternStudy.sampleSize > 0 ? (
                <>
                  <div className="noise-t1-metrics">
                    <div className="noise-t1-metric">
                      <span>Treffer &amp; T+1 Vola</span>
                      <strong className="mono">{patternStudy.sampleSize}×</strong>
                      <small>
                        {patternStudy.nextDayVol.sampleSize > 0 ? (
                          <>
                            Ø T+1: <b className="mono">±{fmtPct2(patternStudy.nextDayVol.avgAbsMovePct)}</b> ·
                            Range <b className="mono">{fmtPct2(patternStudy.nextDayVol.avgRangePct)}</b>
                          </>
                        ) : (
                          <>Aus {patternStudy.totalDays.toLocaleString("de-DE")} Handelstagen</>
                        )}
                      </small>
                    </div>
                    <div className="noise-t1-metric">
                      <span>Im Bärenmarkt (≥ 20 %-Zyklus)</span>
                      <strong className={`mono ${patternStudy.bearCycleRate >= 65 ? "negative" : ""}`}>
                        {fmtPct(patternStudy.bearCycleRate)}
                      </strong>
                      <small>
                        {patternStudy.bearCycleCount}/{patternStudy.sampleSize} · Unter 200-SMA:{" "}
                        <b className="mono">
                          {patternStudy.belowSma200Rate !== null ? fmtPct(patternStudy.belowSma200Rate) : "—"}
                        </b>
                      </small>
                    </div>
                    <div className="noise-t1-metric">
                      <span>Weiterer Drop bis Tief</span>
                      {patternStudy.bottomEvaluatedCount > 0 ? (
                        <>
                          <strong className="mono negative">
                            {patternStudy.minFurtherDropPct !== null && patternStudy.droppedFurtherRate === 100
                              ? `min. ${fmtPct(patternStudy.minFurtherDropPct, true)}`
                              : fmtPct(patternStudy.medianFurtherDropPct, true)}
                          </strong>
                          <small>
                            Median: <b className="mono">{fmtPct(patternStudy.medianFurtherDropPct, true)}</b> · Worst:{" "}
                            <b className="mono">{fmtPct(patternStudy.worstFurtherDropPct, true)}</b>
                          </small>
                        </>
                      ) : (
                        <>
                          <strong className="mono muted">laufend</strong>
                          <small>Noch kein bestätigtes Zyklustief</small>
                        </>
                      )}
                    </div>
                    <div className="noise-t1-metric">
                      <span>Tiefer gefallen danach</span>
                      {patternStudy.bottomEvaluatedCount > 0 ? (
                        <>
                          <strong
                            className={`mono ${patternStudy.droppedFurtherRate >= 70 ? "negative" : "positive"}`}
                          >
                            {fmtPct(patternStudy.droppedFurtherRate)}
                          </strong>
                          <small>
                            ≥ 5 % tiefer: <b className="mono">{fmtPct(patternStudy.droppedAtLeast5PctRate)}</b> · Median{" "}
                            <b className="mono">{patternStudy.medianDaysToBottom ?? "—"}T</b> bis Tief
                          </small>
                        </>
                      ) : (
                        <>
                          <strong className="mono muted">laufend</strong>
                          <small>0/{patternStudy.sampleSize} Zyklen abgeschlossen</small>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Forward Returns Matrix (T+1 through 1Y) with inline Win-Rate Micro-Bar */}
                  <div className="noise-table-wrap noise-t1-twins">
                    <h4>Folge-Performance nach dem Muster (T+1 bis 1 Jahr)</h4>
                    <table className="noise-table">
                      <thead>
                        <tr>
                          <th>Horizont</th>
                          <th>n</th>
                          <th>Positiv %</th>
                          <th>Ø Rendite</th>
                          <th>Median</th>
                          <th>Best / Worst</th>
                        </tr>
                      </thead>
                      <tbody>
                        {patternStudy.horizons.map((h) => (
                          <tr key={h.id}>
                            <td>{h.label}</td>
                            <td className="mono">{h.sampleSize}</td>
                            <td className={`mono ${h.sampleSize && h.winRate >= 50 ? "positive" : "negative"}`}>
                              {h.sampleSize ? (
                                <span className="noise-win-cell">
                                  <span>{fmtPct(h.winRate)}</span>
                                  <span className="noise-win-bar" aria-hidden="true">
                                    <span
                                      className="noise-win-bar-fill"
                                      style={{ width: `${Math.max(0, Math.min(100, h.winRate))}%` }}
                                    />
                                  </span>
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className={`mono ${h.avgPct >= 0 ? "positive" : "negative"}`}>
                              {h.sampleSize ? fmtSigned2(h.avgPct) : "—"}
                            </td>
                            <td className={`mono ${h.medianPct >= 0 ? "positive" : "negative"}`}>
                              {h.sampleSize ? fmtSigned2(h.medianPct) : "—"}
                            </td>
                            <td className="mono">
                              {h.sampleSize ? `${fmtPct(h.bestPct, true)} / ${fmtPct(h.worstPct, true)}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Sortable Complete Historical Occurrences Table + CSV Export */}
                  <div className="noise-table-wrap noise-t1-twins">
                    <div className="noise-pattern-table-head">
                      <h4>
                        Alle historischen Treffer ({patternStudy.matches.length})
                        {patternStudy.minGapDays > 0 && patternStudy.rawSampleSize > patternStudy.sampleSize
                          ? ` · entclustert aus ${patternStudy.rawSampleSize}`
                          : ""}
                      </h4>
                      <div className="noise-pattern-table-actions">
                        <button
                          type="button"
                          className="noise-mini-btn"
                          title="Alle Treffer als CSV herunterladen"
                          onClick={exportPatternCsv}
                        >
                          <Download size={12} />
                          <span>CSV</span>
                        </button>
                        {patternStudy.matches.length > 15 ? (
                          <button
                            type="button"
                            className="noise-mini-btn"
                            onClick={() => setShowAllPatternMatches((v) => !v)}
                          >
                            {showAllPatternMatches
                              ? "Kompakt (15)"
                              : `Alle ${patternStudy.matches.length} anzeigen`}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <table className="noise-table">
                      <thead>
                        <tr>
                          {(
                            [
                              ["session", "Datum (Tag 0)"],
                            ] as const
                          ).map(([key, label]) => (
                            <th key={key}>
                              <button
                                type="button"
                                className={`noise-sort-btn${matchSort.key === key ? " active" : ""}`}
                                onClick={() => toggleMatchSort(key)}
                              >
                                <span>{label}</span>
                                {matchSort.key === key ? (
                                  matchSort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                                ) : null}
                              </button>
                            </th>
                          ))}
                          {patternMode === "leadup" ? (
                            <th>
                              <button
                                type="button"
                                className={`noise-sort-btn${matchSort.key === "priorWindowPct" ? " active" : ""}`}
                                onClick={() => toggleMatchSort("priorWindowPct")}
                              >
                                <span>Vor-{priorWindowRule.days}T</span>
                                {matchSort.key === "priorWindowPct" ? (
                                  matchSort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                                ) : null}
                              </button>
                            </th>
                          ) : (
                            <>
                              {patternLookbackDays >= 5 ? <th>Tag −4</th> : null}
                              {patternLookbackDays >= 4 ? <th>Tag −3</th> : null}
                              {patternLookbackDays >= 3 ? <th>Tag −2</th> : null}
                              <th>
                                <button
                                  type="button"
                                  className={`noise-sort-btn${matchSort.key === "prevDayPct" ? " active" : ""}`}
                                  onClick={() => toggleMatchSort("prevDayPct")}
                                >
                                  <span>Tag −1</span>
                                  {matchSort.key === "prevDayPct" ? (
                                    matchSort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                                  ) : null}
                                </button>
                              </th>
                            </>
                          )}
                          {(
                            [
                              ["day0Pct", "Tag 0"],
                            ] as const
                          ).map(([key, label]) => (
                            <th key={key}>
                              <button
                                type="button"
                                className={`noise-sort-btn${matchSort.key === key ? " active" : ""}`}
                                onClick={() => toggleMatchSort(key)}
                              >
                                <span>{label}</span>
                                {matchSort.key === key ? (
                                  matchSort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                                ) : null}
                              </button>
                            </th>
                          ))}
                          <th>Regime</th>
                          {(
                            [
                              ["nextDayPct", "Morgen T+1"],
                              ["fwd21dPct", "1M"],
                              ["fwd63dPct", "3M"],
                              ["dropToBottomPct", "Drop bis Tief"],
                              ["daysToBottom", "Tage"],
                            ] as const
                          ).map(([key, label]) => (
                            <th key={key}>
                              <button
                                type="button"
                                className={`noise-sort-btn${matchSort.key === key ? " active" : ""}`}
                                onClick={() => toggleMatchSort(key)}
                              >
                                <span>{label}</span>
                                {matchSort.key === key ? (
                                  matchSort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                                ) : null}
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(showAllPatternMatches
                          ? sortedPatternMatches
                          : sortedPatternMatches.slice(0, 15)
                        ).map((m) => (
                          <tr key={m.session}>
                            <td className="mono">{m.session}</td>
                            {patternMode === "leadup" ? (
                              <td className={`mono ${(m.priorWindowPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                                {fmtSigned2(m.priorWindowPct)}
                              </td>
                            ) : (
                              <>
                                {patternLookbackDays >= 5 ? (
                                  <td className={`mono ${(m.dayMinus4Pct ?? 0) >= 0 ? "positive" : "negative"}`}>
                                    {fmtSigned2(m.dayMinus4Pct)}
                                  </td>
                                ) : null}
                                {patternLookbackDays >= 4 ? (
                                  <td className={`mono ${(m.dayMinus3Pct ?? 0) >= 0 ? "positive" : "negative"}`}>
                                    {fmtSigned2(m.dayMinus3Pct)}
                                  </td>
                                ) : null}
                                {patternLookbackDays >= 3 ? (
                                  <td className={`mono ${(m.dayMinus2Pct ?? 0) >= 0 ? "positive" : "negative"}`}>
                                    {fmtSigned2(m.dayMinus2Pct)}
                                  </td>
                                ) : null}
                                <td className={`mono ${(m.prevDayPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                                  {fmtSigned2(m.prevDayPct)}
                                </td>
                              </>
                            )}
                            <td className={`mono ${m.day0Pct >= 0 ? "positive" : "negative"}`}>
                              {fmtSigned2(m.day0Pct)}
                            </td>
                            <td>
                              <span className={`noise-tag ${m.inBearCycle ? "filled" : "open"}`}>
                                {m.inBearCycle ? "Bärenmarkt" : "Bullenmarkt"}
                              </span>
                            </td>
                            <td className={`mono ${(m.nextDayPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                              {fmtSigned2(m.nextDayPct)}
                            </td>
                            <td className={`mono ${(m.fwd21dPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                              {fmtSigned2(m.fwd21dPct)}
                            </td>
                            <td className={`mono ${(m.fwd63dPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                              {fmtSigned2(m.fwd63dPct)}
                            </td>
                            <td className={`mono ${m.dropToBottomPct !== null && m.dropToBottomPct < 0 ? "negative" : "muted"}`}>
                              {m.dropToBottomPct !== null ? fmtPct(m.dropToBottomPct, true) : "laufend"}
                            </td>
                            <td className="mono">{m.daysToBottom !== null ? `${m.daysToBottom}T` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          {/* ================================================================ */}
          {/* VIEW 3: PREMARKET, GAPS & STREAKS                                 */}
          {/* ================================================================ */}
          {activeView === "gaps" ? (
            <div className="noise-gaps-section" aria-label="Premarket und Gap-Statistik">
              {evaluation.insights.length > 0 ? (
                <div className="noise-insights-card">
                  <ul className="noise-insights">
                    {evaluation.insights.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Interactive Premarket & Streak Simulator */}
              <div className="noise-simulator">
                <div className="noise-sim-card">
                  <div className="noise-sim-head">
                    <label htmlFor="noise-gap-input">
                      <Sparkles size={14} /> Premarket / Gap-Szenario (%)
                    </label>
                    <div className="noise-sim-actions">
                      <button
                        type="button"
                        className={`noise-mini-btn${!gapTouched ? " active" : ""}`}
                        onClick={() => {
                          setGapPct(data.live.liveGapPct);
                          setGapTouched(false);
                        }}
                      >
                        Live ({fmtPct(data.live.liveGapPct, true)})
                      </button>
                      <NumericPctInput
                        id="noise-gap-input"
                        step={0.1}
                        min={-20}
                        max={20}
                        ariaLabel="Premarket Gap Prozent"
                        value={Number.isFinite(gapPct) ? gapPct : 0}
                        onChange={(val) => {
                          setGapPct(val);
                          setGapTouched(true);
                        }}
                      />
                    </div>
                  </div>
                  <input
                    type="range"
                    aria-label="Premarket Gap Regler"
                    className="noise-slider"
                    min="-5"
                    max="5"
                    step="0.1"
                    value={Math.max(-5, Math.min(5, gapPct))}
                    onChange={(e) => {
                      setGapPct(Number(e.target.value));
                      setGapTouched(true);
                    }}
                  />
                  <div className="noise-quick-row">
                    {QUICK_GAPS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        className={`noise-mini-btn${Math.abs(gapPct - g) < 0.05 ? " active" : ""}`}
                        onClick={() => {
                          setGapPct(g);
                          setGapTouched(true);
                        }}
                      >
                        {g > 0 ? `+${g.toFixed(1).replace(".", ",")}%` : `${g.toFixed(1).replace(".", ",")}%`}
                      </button>
                    ))}
                  </div>
                </div>

                {renderStreakCard(`Serie / Streak im ${data.ticker}`)}
              </div>

              {/* 4 Core KPI Cards */}
              <div className="noise-kpi-grid">
                <article className="noise-kpi">
                  <span className="noise-kpi-label">Gap-Close-Chance (Intraday)</span>
                  <strong className={`mono ${evaluation.gapStats.gapFillProb >= 60 ? "negative" : "positive"}`}>
                    {evaluation.gapStats.sampleSize ? fmtPct(evaluation.gapStats.gapFillProb) : "—"}
                  </strong>
                  <small>
                    Band: {evaluation.gapStats.bandLabel} (n = {evaluation.gapStats.sampleSize})
                  </small>
                  <small>
                    Kompletter Fade (Close vs. Vortag):{" "}
                    <b className="mono">{fmtPct(evaluation.gapStats.fullFadeProb)}</b>
                  </small>
                </article>

                <article className="noise-kpi">
                  <span className="noise-kpi-label">Follow-Through (Open → Close)</span>
                  <strong className={`mono ${evaluation.gapStats.continuationProb >= 55 ? "positive" : "negative"}`}>
                    {evaluation.gapStats.sampleSize ? fmtPct(evaluation.gapStats.continuationProb) : "—"}
                  </strong>
                  <small>
                    Ø Open→Close: <b className="mono">{fmtSigned2(evaluation.gapStats.avgOpenToClosePct)}</b> · Median:{" "}
                    <b className="mono">{fmtSigned2(evaluation.gapStats.medianOpenToClosePct)}</b>
                  </small>
                  <small>
                    Ø MFE / MAE: <b className="mono">+{evaluation.gapStats.avgMfePct.toFixed(2).replace(".", ",")}%</b>{" "}
                    / <b className="mono">−{evaluation.gapStats.avgMaePct.toFixed(2).replace(".", ",")}%</b>
                  </small>
                </article>

                <article className="noise-kpi">
                  <span className="noise-kpi-label">{evaluation.streakPrimary.label}</span>
                  <div className="noise-split-bar" aria-label="Grüner vs. Roter Close Wahrscheinlichkeit">
                    <div
                      className="noise-split-green"
                      style={{ width: `${evaluation.streakPrimary.greenCloseProb}%` }}
                    />
                    <div
                      className="noise-split-red"
                      style={{ width: `${evaluation.streakPrimary.redCloseProb}%` }}
                    />
                  </div>
                  <div className="noise-split-legend mono">
                    <span className="positive">Grün {fmtPct(evaluation.streakPrimary.greenCloseProb)}</span>
                    <span className="negative">Rot {fmtPct(evaluation.streakPrimary.redCloseProb)}</span>
                  </div>
                  <small>
                    Grüne Kerze (C&gt;O): <b className="mono">{fmtPct(evaluation.streakPrimary.greenIntradayProb)}</b> ·
                    Ø 1T: <b className="mono">{fmtSigned2(evaluation.streakPrimary.avgNextDayPct)}</b>
                  </small>
                  <small>
                    Ø 5T Folgerendite: <b className="mono">{fmtSigned2(evaluation.streakPrimary.fwd5dAvgPct)}</b> (n ={" "}
                    {evaluation.streakPrimary.sampleSize})
                  </small>
                </article>

                <article className="noise-kpi">
                  <span className="noise-kpi-label">Gap-Stretch &amp; Volatilität</span>
                  <strong className="mono">
                    {evaluation.gapStats.gapToAtrRatio.toFixed(2).replace(".", ",")}× ATR14
                  </strong>
                  <small>
                    Z-Score: <b className="mono">{evaluation.gapStats.gapZScore.toFixed(2).replace(".", ",")} σ</b> ·
                    Perzentil: <b className="mono">{evaluation.gapStats.gapPercentile.toFixed(0)}.</b>
                  </small>
                  <small>
                    Aktuelle ATR14: <b className="mono">{data.live.currentAtr14Pct.toFixed(2).replace(".", ",")} %</b> ·
                    3T Ø: <b className="mono">{fmtSigned2(evaluation.gapStats.fwd3dAvgPct)}</b>
                  </small>
                </article>
              </div>

              {/* Streak x Premarket Gap Combination Insight */}
              <div className="noise-combo-card">
                <div className="noise-combo-title">
                  <strong>
                    Kombi-Statistik: Nach ≥ {evaluation.combo.effectiveStreakDays}{" "}
                    {evaluation.combo.streakDirection === "red" ? "roten" : "grünen"}{" "}
                    {streakBasis === "candle" ? "Kerzen" : "Tagen"} + Premarket-Gap
                  </strong>
                  {evaluation.combo.usedFallbackThreshold ? (
                    <span className="noise-meta-chip">
                      Auf ≥ {evaluation.combo.effectiveStreakDays}T erweitert für Stichprobe
                    </span>
                  ) : null}
                </div>
                <div className="noise-combo-grid">
                  <div className="noise-combo-branch">
                    <div className="noise-combo-branch-head positive">
                      <TrendingUp size={15} />
                      <span>Premarket-Pump (Up-Gap ≥ +0,2 %)</span>
                      <em className="mono">n = {evaluation.combo.upGap.sampleSize}</em>
                    </div>
                    {evaluation.combo.upGap.sampleSize > 0 ? (
                      <p>
                        Gap-Close: <b className="mono">{fmtPct(evaluation.combo.upGap.gapFillProb)}</b> · Grüner Tag:{" "}
                        <b className="mono">{fmtPct(evaluation.combo.upGap.greenDayProb)}</b> · Grüne Kerze (vs Open):{" "}
                        <b className="mono">{fmtPct(evaluation.combo.upGap.greenIntradayProb)}</b> · Ø Open→Close:{" "}
                        <b className="mono">{fmtSigned2(evaluation.combo.upGap.avgOpenToClosePct)}</b>
                      </p>
                    ) : (
                      <p className="muted">Keine historischen Tage mit dieser Kombination im Zeitraum.</p>
                    )}
                  </div>

                  <div className="noise-combo-branch">
                    <div className="noise-combo-branch-head negative">
                      <TrendingDown size={15} />
                      <span>Premarket-Drop (Down-Gap ≤ −0,2 %)</span>
                      <em className="mono">n = {evaluation.combo.downGap.sampleSize}</em>
                    </div>
                    {evaluation.combo.downGap.sampleSize > 0 ? (
                      <p>
                        Gap-Close: <b className="mono">{fmtPct(evaluation.combo.downGap.gapFillProb)}</b> · Grüner Tag:{" "}
                        <b className="mono">{fmtPct(evaluation.combo.downGap.greenDayProb)}</b> · Grüne Kerze (vs Open):{" "}
                        <b className="mono">{fmtPct(evaluation.combo.downGap.greenIntradayProb)}</b> · Ø Open→Close:{" "}
                        <b className="mono">{fmtSigned2(evaluation.combo.downGap.avgOpenToClosePct)}</b>
                      </p>
                    ) : (
                      <p className="muted">Keine historischen Tage mit dieser Kombination im Zeitraum.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Detail Tabs */}
              <div className="noise-detail-tabs" role="tablist" aria-label="NoiseMeter Detailtabellen">
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === "gaps"}
                  className={detailTab === "gaps" ? "active" : ""}
                  onClick={() => setDetailTab("gaps")}
                >
                  <BarChart3 size={14} /> Gap-Matrix
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === "streaks"}
                  className={detailTab === "streaks" ? "active" : ""}
                  onClick={() => setDetailTab("streaks")}
                >
                  <Activity size={14} /> Streak-Tabelle &amp; Wochentage
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === "analogues"}
                  className={detailTab === "analogues" ? "active" : ""}
                  onClick={() => setDetailTab("analogues")}
                >
                  <Calendar size={14} /> Historische Analogien ({evaluation.analogues.length})
                </button>
              </div>

              {detailTab === "gaps" ? (
                <div className="noise-table-wrap">
                  <table className="noise-table">
                    <thead>
                      <tr>
                        <th>Gap-Größe</th>
                        <th>n</th>
                        <th>Gap-Close</th>
                        <th>Full Fade</th>
                        <th>Grün (vs Open)</th>
                        <th>Grün (vs Vortag)</th>
                        <th>Ø Open→Close</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evaluation.gapBuckets.map((row) => (
                        <tr
                          key={row.id}
                          className={row.active ? "active-row" : ""}
                          onClick={() => {
                            const target =
                              row.id === "lt-2"
                                ? -2.5
                                : row.id === "gt-2"
                                  ? 2.5
                                  : Math.round(((row.min + row.max) / 2) * 10) / 10;
                            setGapPct(target);
                            setGapTouched(true);
                          }}
                        >
                          <td>{row.label}</td>
                          <td className="mono">{row.sampleSize}</td>
                          <td className="mono">{row.sampleSize ? fmtPct(row.gapFillProb) : "—"}</td>
                          <td className="mono">{row.sampleSize ? fmtPct(row.fullFadeProb) : "—"}</td>
                          <td className="mono">{row.sampleSize ? fmtPct(row.greenIntradayProb) : "—"}</td>
                          <td className="mono">{row.sampleSize ? fmtPct(row.greenDayProb) : "—"}</td>
                          <td className={`mono ${row.avgOpenToClosePct >= 0 ? "positive" : "negative"}`}>
                            {row.sampleSize ? fmtSigned2(row.avgOpenToClosePct) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {detailTab === "streaks" ? (
                <div className="noise-streaks-layout">
                  <div className="noise-streak-tables">
                    <div className="noise-table-wrap">
                      <h4>Nach roten {streakBasis === "candle" ? "Kerzen" : "Tagen"} in Folge</h4>
                      <table className="noise-table">
                        <thead>
                          <tr>
                            <th>Serie</th>
                            <th>n</th>
                            <th>Grün %</th>
                            <th>Rot %</th>
                            <th>Ø 1T</th>
                            <th>Ø 5T</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evaluation.redStreaks.map((row) => (
                            <tr
                              key={`red-${row.days}`}
                              className={
                                streakDirection === "red" &&
                                (streakDays === row.days ||
                                  (row.mode === "atLeast" && streakDays >= row.days))
                                  ? "active-row"
                                  : ""
                              }
                              onClick={() => applyStreakRow(row)}
                            >
                              <td>{row.mode === "atLeast" ? `≥ ${row.days} rot` : `${row.days} rot`}</td>
                              <td className="mono">{row.sampleSize}</td>
                              <td className="mono positive">
                                {row.sampleSize ? fmtPct(row.greenCloseProb) : "—"}
                              </td>
                              <td className="mono negative">
                                {row.sampleSize ? fmtPct(row.redCloseProb) : "—"}
                              </td>
                              <td className={`mono ${row.avgNextDayPct >= 0 ? "positive" : "negative"}`}>
                                {row.sampleSize ? fmtSigned2(row.avgNextDayPct) : "—"}
                              </td>
                              <td className={`mono ${(row.fwd5dAvgPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                                {fmtSigned2(row.fwd5dAvgPct)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="noise-table-wrap">
                      <h4>Nach grünen {streakBasis === "candle" ? "Kerzen" : "Tagen"} in Folge</h4>
                      <table className="noise-table">
                        <thead>
                          <tr>
                            <th>Serie</th>
                            <th>n</th>
                            <th>Grün %</th>
                            <th>Rot %</th>
                            <th>Ø 1T</th>
                            <th>Ø 5T</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evaluation.greenStreaks.map((row) => (
                            <tr
                              key={`green-${row.days}`}
                              className={
                                streakDirection === "green" &&
                                (streakDays === row.days ||
                                  (row.mode === "atLeast" && streakDays >= row.days))
                                  ? "active-row"
                                  : ""
                              }
                              onClick={() => applyStreakRow(row)}
                            >
                              <td>{row.mode === "atLeast" ? `≥ ${row.days} grün` : `${row.days} grün`}</td>
                              <td className="mono">{row.sampleSize}</td>
                              <td className="mono positive">
                                {row.sampleSize ? fmtPct(row.greenCloseProb) : "—"}
                              </td>
                              <td className="mono negative">
                                {row.sampleSize ? fmtPct(row.redCloseProb) : "—"}
                              </td>
                              <td className={`mono ${row.avgNextDayPct >= 0 ? "positive" : "negative"}`}>
                                {row.sampleSize ? fmtSigned2(row.avgNextDayPct) : "—"}
                              </td>
                              <td className={`mono ${(row.fwd5dAvgPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                                {fmtSigned2(row.fwd5dAvgPct)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="noise-weekday-strip" aria-label="Wochentags-Statistik">
                    {evaluation.weekdays.map((wd) => (
                      <div
                        key={wd.weekday}
                        className={`noise-weekday-card${wd.weekday === data.live.nextWeekday ? " active" : ""}`}
                      >
                        <strong>{wd.label}</strong>
                        <span
                          className={`mono ${
                            wd.greenDayProb >= 52 ? "positive" : wd.greenDayProb <= 48 ? "negative" : ""
                          }`}
                        >
                          {fmtPct(wd.greenDayProb)} grün
                        </span>
                        <small className="mono">Ø {fmtSigned2(wd.avgReturnPct)}</small>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {detailTab === "analogues" ? (
                <div className="noise-table-wrap">
                  <table className="noise-table">
                    <thead>
                      <tr>
                        <th>Datum</th>
                        <th>Gap</th>
                        <th>Open→Close</th>
                        <th>Tag</th>
                        <th>Vorserie</th>
                        <th>Gap-Close</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evaluation.analogues.length ? (
                        evaluation.analogues.map((row) => (
                          <tr key={row.session}>
                            <td className="mono">{row.session}</td>
                            <td className={`mono ${row.gapPct >= 0 ? "positive" : "negative"}`}>
                              {fmtSigned2(row.gapPct)}
                            </td>
                            <td className={`mono ${row.openToClosePct >= 0 ? "positive" : "negative"}`}>
                              {fmtSigned2(row.openToClosePct)}
                            </td>
                            <td className={`mono ${row.closeToClosePct >= 0 ? "positive" : "negative"}`}>
                              {fmtSigned2(row.closeToClosePct)}
                            </td>
                            <td className="mono">
                              {row.priorStreak === 0
                                ? "0"
                                : row.priorStreak > 0
                                  ? `+${row.priorStreak} grün`
                                  : `${Math.abs(row.priorStreak)} rot`}
                            </td>
                            <td>
                              <span className={`noise-tag ${row.gapFilled ? "filled" : "open"}`}>
                                {row.gapFilled ? (row.fullFade ? "Full Fade" : "Gefüllt") : "Offen"}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="muted">
                            Keine historischen Analogien für dieses Band vorhanden.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="noise-disclaimer">
            Empirische Auswertung historischer Tagesdaten ({data.ticker}, {data.totalDays} Handelstage). Keine
            Anlageberatung — historische Wahrscheinlichkeiten garantieren keine zukünftigen Ergebnisse.
          </p>
        </>
      ) : null}
    </section>
  );
}
