"use client";
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BarChart3, Calendar, Gauge, History, RefreshCw, SlidersHorizontal, Sparkles, Target, TrendingDown, TrendingUp } from "lucide-react";
import { isYahooTicker } from "@/lib/symbolId";
import {
  buildNoiseDataset,
  evaluateNextDayForecast,
  evaluateNoiseScenario,
  evaluatePatternStudy,
  suggestLivePattern,
  type NoiseApiPayload,
  type NoiseStreakBasis,
  type NoiseVerdictTone,
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
const QUICK_STREAKS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const HISTORY_RANGES: ReadonlyArray<{ value: 5 | 10 | 15 | "max"; label: string }> = [
  { value: 5, label: "5J" },
  { value: 10, label: "10J" },
  { value: 15, label: "15J" },
  { value: "max", label: "Max" },
];

const PATTERN_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  prev: ReturnRule;
  day0: ReturnRule;
}> = [
  { id: "m5-p5", label: "−5 % → +5 %", prev: { op: "lte", thresholdPct: -5 }, day0: { op: "gte", thresholdPct: 5 } },
  { id: "m3-p3", label: "−3 % → +3 %", prev: { op: "lte", thresholdPct: -3 }, day0: { op: "gte", thresholdPct: 3 } },
  { id: "p3-m3", label: "+3 % → −3 %", prev: { op: "gte", thresholdPct: 3 }, day0: { op: "lte", thresholdPct: -3 } },
  { id: "2xm3", label: "2× ≤ −3 %", prev: { op: "lte", thresholdPct: -3 }, day0: { op: "lte", thresholdPct: -3 } },
  { id: "day-m5", label: "Tag ≤ −5 %", prev: { op: "any", thresholdPct: -3 }, day0: { op: "lte", thresholdPct: -5 } },
  { id: "day-p5", label: "Tag ≥ +5 %", prev: { op: "any", thresholdPct: -3 }, day0: { op: "gte", thresholdPct: 5 } },
];

type DetailTab = "gaps" | "streaks" | "analogues";

function fmtPct(v: number | null | undefined, signed = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = signed ? (v > 0 ? "+" : v < 0 ? "−" : "") : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1).replace(".", ",")} %`;
}

function fmtSigned2(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(2).replace(".", ",")} %`;
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

function NoiseGauge({ score, tone }: { score: number; tone: NoiseVerdictTone }) {
  const clamped = Math.max(0, Math.min(100, score));
  // Semi-circle arc from 180deg (left) to 0deg (right), radius 66, center (80, 78)
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
  const [data, setData] = useState<NoiseApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);

  // Interactive scenario controls (defaults to live premarket gap + live candle streak, editable for What-If)
  const [gapPct, setGapPct] = useState<number>(1.0);
  const [gapTouched, setGapTouched] = useState(false);
  const [todayMovePct, setTodayMovePct] = useState<number>(0);
  const [todayMoveTouched, setTodayMoveTouched] = useState(false);
  const [useExtraFactors, setUseExtraFactors] = useState<boolean>(true);
  const [streakBasis, setStreakBasis] = useState<NoiseStreakBasis>("candle");
  const [streakDirection, setStreakDirection] = useState<"red" | "green">("red");
  const [streakDays, setStreakDays] = useState<number>(3);
  const [streakTouched, setStreakTouched] = useState(false);
  const [prevDayRule, setPrevDayRule] = useState<ReturnRule>({ op: "lte", thresholdPct: -5 });
  const [day0Rule, setDay0Rule] = useState<ReturnRule>({ op: "gte", thresholdPct: 5 });
  const [patternRegime, setPatternRegime] = useState<"all" | "bear" | "bull">("all");
  const [patternTouched, setPatternTouched] = useState(false);
  const [showAllPatternMatches, setShowAllPatternMatches] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("gaps");

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
        const body = (await res.json()) as NoiseApiPayload & { error?: string };
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (controller.signal.aborted) return;
        setData(body);
        const computed = buildNoiseDataset(body.bars);
        if (!gapTouched) {
          setGapPct(body.live.liveGapPct);
        }
        if (!todayMoveTouched) {
          setTodayMovePct(body.live.liveTodayReturnPct ?? body.live.liveGapPct);
        }
        if (!streakTouched) {
          const liveStreak =
            streakBasis === "candle"
              ? (body.live.currentCandleStreak ?? computed.currentCandleStreak)
              : body.live.currentStreak;
          setStreakDirection(liveStreak.direction);
          setStreakDays(Math.max(1, liveStreak.count || 1));
        }
        if (!patternTouched) {
          const suggested = suggestLivePattern(
            computed,
            body.live.liveTodayReturnPct ?? body.live.liveGapPct,
          );
          setPrevDayRule(suggested.prevDayRule);
          setDay0Rule(suggested.day0Rule);
          setPatternRegime("all");
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "NoiseMeter-Daten konnten nicht geladen werden.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, years, reloadNonce]);

  const dataset = useMemo(() => (data ? buildNoiseDataset(data.bars) : null), [data]);

  const liveCloseStreak = dataset?.currentStreak ?? data?.live.currentStreak ?? { direction: "red" as const, count: 1 };
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

  const nextDayForecast = useMemo(() => {
    if (!dataset) return null;
    return evaluateNextDayForecast(dataset, {
      priorStreakDays: streakDays,
      priorStreakDirection: streakDirection,
      streakBasis,
      todayMovePct,
      useExtraFactors,
    });
  }, [dataset, streakDays, streakDirection, streakBasis, todayMovePct, useExtraFactors]);

  const liveTodayReturn = data ? (data.live.liveTodayReturnPct ?? data.live.liveGapPct) : 0;

  const patternStudy = useMemo(() => {
    if (!dataset || !data) return null;
    return evaluatePatternStudy(dataset, {
      ticker: data.ticker,
      prevDayRule,
      day0Rule,
      regimeFilter: patternRegime,
    });
  }, [dataset, data, prevDayRule, day0Rule, patternRegime]);

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

  const applyLivePattern = () => {
    if (!dataset) return;
    const suggested = suggestLivePattern(dataset, liveTodayReturn);
    setPrevDayRule(suggested.prevDayRule);
    setDay0Rule(suggested.day0Rule);
    setPatternRegime("all");
    setPatternTouched(false);
    setShowAllPatternMatches(false);
  };

  const updateRuleOp = (which: "prev" | "day0", op: ReturnRuleOp) => {
    const updater = which === "prev" ? setPrevDayRule : setDay0Rule;
    updater((cur) => {
      let nextVal = cur.thresholdPct;
      if (op === "lte" && nextVal > 0) nextVal = -Math.abs(nextVal || 3);
      if (op === "gte" && nextVal < 0) nextVal = Math.abs(nextVal || 3);
      if (op === "lte" && nextVal === 0) nextVal = -3;
      if (op === "gte" && nextVal === 0) nextVal = 3;
      return { op, thresholdPct: nextVal };
    });
    setPatternTouched(true);
    setShowAllPatternMatches(false);
  };

  return (
    <section className="noise-meter-panel" aria-label="NoiseMeter Statistik">
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
                      {sourceLabel(data.live.priceSource)}: <strong className="mono">{fmtSigned2(data.live.liveGapPct)}</strong>
                    </span>
                    <span className="noise-meta-chip">
                      {data.totalDays.toLocaleString("de-DE")} Tage ({data.bars[0]?.session.slice(0, 4)}–{data.asOf.slice(0, 4)})
                    </span>
                  </div>
                </div>
              </div>

              <p className="noise-verdict-sub">{evaluation.verdictSubtitle}</p>

              <ul className="noise-insights">
                {evaluation.insights.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Historischer Muster-Scanner (OddStats-Analyse: Schock-Sequenzen, Bärenmarkt-Quote & Weg bis zum Tief) */}
          {patternStudy ? (
            <section className="noise-pattern-card" aria-label="Historischer Muster-Scanner">
              <div className="noise-pattern-head">
                <div className="noise-t1-title-group">
                  <h4>
                    <History size={15} /> Historischer Muster-Scanner
                  </h4>
                  <span className="noise-t1-scenario-badge">{patternStudy.ruleDescription}</span>
                </div>
                <span className="noise-meta-chip">
                  <strong className="mono">{patternStudy.sampleSize}×</strong> seit {patternStudy.firstYear} ({patternStudy.totalDays.toLocaleString("de-DE")} Tage)
                </span>
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

              {/* Pattern Presets */}
              <div className="noise-quick-row noise-pattern-presets" role="group" aria-label="Muster-Vorlagen">
                <button
                  type="button"
                  className={`noise-mini-btn${!patternTouched ? " active" : ""}`}
                  onClick={applyLivePattern}
                >
                  Live-Muster
                </button>
                {PATTERN_PRESETS.map((preset) => {
                  const isActive =
                    prevDayRule.op === preset.prev.op &&
                    day0Rule.op === preset.day0.op &&
                    (prevDayRule.op === "any" || Math.abs(prevDayRule.thresholdPct - preset.prev.thresholdPct) < 0.05) &&
                    (day0Rule.op === "any" || Math.abs(day0Rule.thresholdPct - preset.day0.thresholdPct) < 0.05);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`noise-mini-btn${isActive ? " active" : ""}`}
                      onClick={() => {
                        setPrevDayRule(preset.prev);
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

              {/* Interactive Rule Builder: Tag -1 -> Tag 0 + Regime */}
              <div className="noise-pattern-builder">
                <div className="noise-pattern-rule">
                  <span className="noise-pattern-rule-label">Tag −1 (Vortag)</span>
                  <div className="noise-pattern-rule-controls">
                    <div className="noise-pattern-ops" role="group" aria-label="Tag minus 1 Bedingung">
                      {(["lte", "gte", "any"] as const).map((op) => (
                        <button
                          key={op}
                          type="button"
                          className={`noise-mini-btn${prevDayRule.op === op ? " active" : ""}`}
                          aria-pressed={prevDayRule.op === op}
                          onClick={() => updateRuleOp("prev", op)}
                        >
                          {op === "lte" ? "≤" : op === "gte" ? "≥" : "Egal"}
                        </button>
                      ))}
                    </div>
                    {prevDayRule.op !== "any" ? (
                      <div className="noise-pattern-num">
                        <input
                          type="number"
                          step="0.5"
                          min="-30"
                          max="30"
                          aria-label="Tag minus 1 Schwelle Prozent"
                          value={prevDayRule.thresholdPct}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setPrevDayRule((cur) => ({ ...cur, thresholdPct: Number.isFinite(val) ? val : 0 }));
                            setPatternTouched(true);
                          }}
                        />
                        <span>%</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="noise-pattern-rule">
                  <span className="noise-pattern-rule-label">Tag 0 (Folgetag / Heute)</span>
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
                          {op === "gte" ? "≥" : op === "lte" ? "≤" : "Egal"}
                        </button>
                      ))}
                    </div>
                    {day0Rule.op !== "any" ? (
                      <div className="noise-pattern-num">
                        <input
                          type="number"
                          step="0.5"
                          min="-30"
                          max="30"
                          aria-label="Tag 0 Schwelle Prozent"
                          value={day0Rule.thresholdPct}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setDay0Rule((cur) => ({ ...cur, thresholdPct: Number.isFinite(val) ? val : 0 }));
                            setPatternTouched(true);
                          }}
                        />
                        <span>%</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="noise-pattern-rule">
                  <span className="noise-pattern-rule-label">Marktregime</span>
                  <div className="noise-pattern-ops" role="group" aria-label="Marktregime Filter">
                    {([
                      ["all", "Alle"],
                      ["bear", "Bärenmarkt"],
                      ["bull", "Bullenmarkt"],
                    ] as const).map(([val, label]) => (
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
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 4 OddStats KPI Cards */}
              {patternStudy.sampleSize > 0 ? (
                <>
                  <div className="noise-t1-metrics">
                    <div className="noise-t1-metric">
                      <span>Treffer seit {patternStudy.firstYear}</span>
                      <strong className="mono">{patternStudy.sampleSize}×</strong>
                      <small>
                        Aus {patternStudy.totalDays.toLocaleString("de-DE")} Handelstagen
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
                      <strong className="mono negative">
                        {patternStudy.minFurtherDropPct !== null && patternStudy.droppedFurtherRate === 100
                          ? `min. ${fmtPct(patternStudy.minFurtherDropPct, true)}`
                          : fmtPct(patternStudy.medianFurtherDropPct, true)}
                      </strong>
                      <small>
                        Median: <b className="mono">{fmtPct(patternStudy.medianFurtherDropPct, true)}</b> · Worst:{" "}
                        <b className="mono">{fmtPct(patternStudy.worstFurtherDropPct, true)}</b>
                      </small>
                    </div>
                    <div className="noise-t1-metric">
                      <span>Tiefer geschlossen danach</span>
                      <strong className={`mono ${patternStudy.droppedFurtherRate >= 70 ? "negative" : "positive"}`}>
                        {fmtPct(patternStudy.droppedFurtherRate)}
                      </strong>
                      <small>
                        ≥ 5 % tiefer: <b className="mono">{fmtPct(patternStudy.droppedAtLeast5PctRate)}</b> · Median{" "}
                        <b className="mono">{patternStudy.medianDaysToBottom ?? "—"}T</b> bis Tief
                      </small>
                    </div>
                  </div>

                  {/* Forward Returns Matrix (T+1 through 1Y) */}
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
                              {h.sampleSize ? fmtPct(h.winRate) : "—"}
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

                  {/* Complete Historical Occurrences Table */}
                  <div className="noise-table-wrap noise-t1-twins">
                    <div className="noise-pattern-table-head">
                      <h4>Alle historischen Treffer ({patternStudy.matches.length})</h4>
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
                    <table className="noise-table">
                      <thead>
                        <tr>
                          <th>Datum (Tag 0)</th>
                          <th>Tag −1</th>
                          <th>Tag 0</th>
                          <th>Regime</th>
                          <th>Morgen T+1</th>
                          <th>1M</th>
                          <th>3M</th>
                          <th>Drop bis Tief</th>
                          <th>Tage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(showAllPatternMatches
                          ? patternStudy.matches
                          : patternStudy.matches.slice(0, 15)
                        ).map((m) => (
                          <tr key={m.session}>
                            <td className="mono">{m.session}</td>
                            <td className={`mono ${(m.prevDayPct ?? 0) >= 0 ? "positive" : "negative"}`}>
                              {fmtSigned2(m.prevDayPct)}
                            </td>
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
                            <td className="mono negative">
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

          {/* Morgen-Wahrscheinlichkeit (T+1 Multi-Factor Scenario Forecast) */}
          {nextDayForecast ? (
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
                    {nextDayForecast.edgeVsBasePct > 0 ? "+" : nextDayForecast.edgeVsBasePct < 0 ? "−" : ""}
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

              {/* Heutiger Tages-Move (%) Interactive Control */}
              <div className="noise-t1-control">
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
                      }}
                    >
                      Live ({fmtPct(liveTodayReturn, true)})
                    </button>
                    <input
                      id="noise-today-move-input"
                      type="number"
                      step="0.1"
                      min="-25"
                      max="25"
                      aria-label="Heutiger Tages-Move Prozent"
                      value={Number.isFinite(todayMovePct) ? todayMovePct : 0}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setTodayMovePct(Number.isFinite(val) ? val : 0);
                        setTodayMoveTouched(true);
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
                      {m > 0 ? `+${m.toFixed(1).replace(".", ",")}%` : `−${Math.abs(m).toFixed(1).replace(".", ",")}%`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Projected Context & Outcome Strip */}
              <div className="noise-t1-metrics">
                <div className="noise-t1-metric">
                  <span>Ø Morgen (T+1)</span>
                  <strong className={`mono ${nextDayForecast.avgNextDayPct >= 0 ? "positive" : "negative"}`}>
                    {fmtSigned2(nextDayForecast.avgNextDayPct)}
                  </strong>
                  <small>Median: <b className="mono">{fmtSigned2(nextDayForecast.medianNextDayPct)}</b></small>
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
                      {nextDayForecast.projected.moveAtrRatio > 0 ? "+" : nextDayForecast.projected.moveAtrRatio < 0 ? "−" : ""}
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
                        <b className={`mono ${f.edgeVsBasePct > 0 ? "positive" : f.edgeVsBasePct < 0 ? "negative" : ""}`}>
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
                  <input
                    id="noise-gap-input"
                    type="number"
                    step="0.1"
                    min="-20"
                    max="20"
                    aria-label="Premarket Gap Prozent"
                    value={Number.isFinite(gapPct) ? gapPct : 0}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setGapPct(Number.isFinite(val) ? val : 0);
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

            <div className="noise-sim-card">
              <div className="noise-sim-head">
                <span>
                  <Activity size={14} /> Serie / Streak im {data.ticker}
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
                  className={`noise-mini-btn${streakBasis === "candle" ? " active" : ""}`}
                  aria-pressed={streakBasis === "candle"}
                  title="Tageskerzen-Farbe im Chart (Close vs. Open)"
                  onClick={() => switchStreakBasis("candle")}
                >
                  Kerzen (C vs O): {liveCandleStreak.count} {liveCandleStreak.direction === "red" ? "rot" : "grün"}
                </button>
                <button
                  type="button"
                  className={`noise-mini-btn${streakBasis === "close" ? " active" : ""}`}
                  aria-pressed={streakBasis === "close"}
                  title="Schlusskurs gegenüber Vortags-Close (Close vs. PrevClose)"
                  onClick={() => switchStreakBasis("close")}
                >
                  Close (vs Vortag): {liveCloseStreak.count} {liveCloseStreak.direction === "red" ? "rot" : "grün"}
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
                          {primaryDelta > 0 ? `+${primaryDelta.toFixed(1).replace(".", ",")}` : `${primaryDelta.toFixed(1).replace(".", ",")}`}%
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
                Kompletter Fade (Close vs. Vortag): <b className="mono">{fmtPct(evaluation.gapStats.fullFadeProb)}</b>
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
                Ø MFE / MAE: <b className="mono">+{evaluation.gapStats.avgMfePct.toFixed(2).replace(".", ",")}%</b> /{" "}
                <b className="mono">−{evaluation.gapStats.avgMaePct.toFixed(2).replace(".", ",")}%</b>
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
                Grüne Kerze (C&gt;O): <b className="mono">{fmtPct(evaluation.streakPrimary.greenIntradayProb)}</b> · Ø 1T:{" "}
                <b className="mono">{fmtSigned2(evaluation.streakPrimary.avgNextDayPct)}</b>
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
                Aktuelle ATR14: <b className="mono">{data.live.currentAtr14Pct.toFixed(2).replace(".", ",")} %</b> · 3T Ø:{" "}
                <b className="mono">{fmtSigned2(evaluation.gapStats.fwd3dAvgPct)}</b>
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
                <span className="noise-meta-chip">Auf ≥ {evaluation.combo.effectiveStreakDays}T erweitert für Stichprobe</span>
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
                            (streakDays === row.days || (row.mode === "atLeast" && streakDays >= row.days))
                              ? "active-row"
                              : ""
                          }
                          onClick={() => applyStreakRow(row)}
                        >
                          <td>{row.mode === "atLeast" ? `≥ ${row.days} rot` : `${row.days} rot`}</td>
                          <td className="mono">{row.sampleSize}</td>
                          <td className="mono positive">{row.sampleSize ? fmtPct(row.greenCloseProb) : "—"}</td>
                          <td className="mono negative">{row.sampleSize ? fmtPct(row.redCloseProb) : "—"}</td>
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
                            (streakDays === row.days || (row.mode === "atLeast" && streakDays >= row.days))
                              ? "active-row"
                              : ""
                          }
                          onClick={() => applyStreakRow(row)}
                        >
                          <td>{row.mode === "atLeast" ? `≥ ${row.days} grün` : `${row.days} grün`}</td>
                          <td className="mono">{row.sampleSize}</td>
                          <td className="mono positive">{row.sampleSize ? fmtPct(row.greenCloseProb) : "—"}</td>
                          <td className="mono negative">{row.sampleSize ? fmtPct(row.redCloseProb) : "—"}</td>
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
                    <span className={`mono ${wd.greenDayProb >= 52 ? "positive" : wd.greenDayProb <= 48 ? "negative" : ""}`}>
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
                        <td className={`mono ${row.gapPct >= 0 ? "positive" : "negative"}`}>{fmtSigned2(row.gapPct)}</td>
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

          <p className="noise-disclaimer">
            Empirische Auswertung historischer Tagesdaten ({data.ticker}, {data.totalDays} Handelstage). Keine Anlageberatung — historische Wahrscheinlichkeiten garantieren keine zukünftigen Ergebnisse.
          </p>
        </>
      ) : null}
    </section>
  );
}
