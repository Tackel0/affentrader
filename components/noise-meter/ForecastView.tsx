"use client";
import type { ReactNode } from "react";
import { SlidersHorizontal, Target, TrendingUp, Zap } from "lucide-react";
import type {
  NextDayForecast,
  NoiseApiPayload,
  NoiseDataset,
  NoiseStreakBasis,
} from "@/lib/terminal/noiseMeter";
import {
  fmtPct,
  fmtPct2,
  fmtPrice,
  fmtShortDate,
  fmtSigned2,
  liveMoveShortLabel,
  QUICK_TODAY_MOVES,
} from "./constants";
import { NumericPctInput } from "./NumericPctInput";

export interface ForecastViewProps {
  data: NoiseApiPayload;
  dataset: NoiseDataset | null;
  nextDayForecast: NextDayForecast;
  useExtraFactors: boolean;
  onToggleExtraFactors: () => void;
  streakCard: ReactNode;
  streakDays: number;
  streakDirection: "red" | "green";
  streakBasis: NoiseStreakBasis;
  todayMovePct: number;
  todayMoveTouched: boolean;
  useLastCompletedAsToday: boolean;
  liveTodayReturn: number;
  onResetLiveTodayMove: () => void;
  onSelectLastCompletedClose: (val: number) => void;
  onChangeTodayMove: (val: number, resetLastCompleted?: boolean) => void;
}

export function ForecastView({
  data,
  dataset,
  nextDayForecast,
  useExtraFactors,
  onToggleExtraFactors,
  streakCard,
  streakDays,
  streakDirection,
  streakBasis,
  todayMovePct,
  todayMoveTouched,
  useLastCompletedAsToday,
  liveTodayReturn,
  onResetLiveTodayMove,
  onSelectLastCompletedClose,
  onChangeTodayMove,
}: ForecastViewProps) {
  const vol = nextDayForecast.expectedVolatility ?? null;

  return (
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
            onClick={onToggleExtraFactors}
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
        {streakCard}

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
                onClick={onResetLiveTodayMove}
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
                  onClick={() => onSelectLastCompletedClose(dataset.lastDayReturnPct!)}
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
                onChange={(val) => onChangeTodayMove(val, true)}
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
            onChange={(e) => onChangeTodayMove(Number(e.target.value), true)}
          />
          <div className="noise-quick-row">
            {QUICK_TODAY_MOVES.map((m) => (
              <button
                key={m}
                type="button"
                className={`noise-mini-btn${Math.abs(todayMovePct - m) < 0.05 ? " active" : ""}`}
                onClick={() => onChangeTodayMove(m, true)}
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
  );
}
