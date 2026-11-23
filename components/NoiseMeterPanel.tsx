"use client";
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BarChart3, Calendar, Gauge, RefreshCw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { isYahooTicker } from "@/lib/symbolId";
import {
  buildNoiseDataset,
  evaluateNoiseScenario,
  type NoiseApiPayload,
  type NoiseStreakBasis,
  type NoiseVerdictTone,
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
const QUICK_STREAKS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

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
  const [years, setYears] = useState<5 | 10 | 15>(10);
  const [data, setData] = useState<NoiseApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);

  // Interactive scenario controls (defaults to live premarket gap + live candle streak, editable for What-If)
  const [gapPct, setGapPct] = useState<number>(1.0);
  const [gapTouched, setGapTouched] = useState(false);
  const [streakBasis, setStreakBasis] = useState<NoiseStreakBasis>("candle");
  const [streakDirection, setStreakDirection] = useState<"red" | "green">("red");
  const [streakDays, setStreakDays] = useState<number>(3);
  const [streakTouched, setStreakTouched] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("gaps");

  useEffect(() => {
    const clean = initialTicker.replace(/^YF:/i, "").trim().toUpperCase();
    if (clean && isYahooTicker(clean) && clean !== ticker) {
      setTicker(clean);
      setInput(clean);
      setGapTouched(false);
      setStreakTouched(false);
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
        if (!streakTouched) {
          const liveStreak =
            streakBasis === "candle"
              ? (body.live.currentCandleStreak ?? computed.currentCandleStreak)
              : body.live.currentStreak;
          setStreakDirection(liveStreak.direction);
          setStreakDays(Math.max(1, liveStreak.count || 1));
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
    setStreakTouched(false);
    onTickerSelect?.(clean);
  };

  const applyStreakRow = (row: StreakStats) => {
    setStreakDirection(row.direction);
    setStreakDays(row.days);
    setStreakTouched(true);
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
          {([5, 10, 15] as const).map((y) => (
            <button
              key={y}
              type="button"
              className={`button small${years === y ? " primary" : ""}`}
              aria-pressed={years === y}
              onClick={() => setYears(y)}
            >
              {y}J
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
          <span>Lade {years}-Jahres-Statistik für {ticker}…</span>
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
