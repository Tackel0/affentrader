"use client";
import type { ReactNode } from "react";
import { Activity, BarChart3, Calendar, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import type {
  NoiseApiPayload,
  NoiseEvaluation,
  NoiseStreakBasis,
  StreakStats,
} from "@/lib/terminal/noiseMeter";
import { fmtPct, fmtSigned2, QUICK_GAPS, type DetailTab } from "./constants";
import { NumericPctInput } from "./NumericPctInput";

export interface GapsStreaksViewProps {
  data: NoiseApiPayload;
  evaluation: NoiseEvaluation;
  streakCard: ReactNode;
  gapPct: number;
  gapTouched: boolean;
  streakBasis: NoiseStreakBasis;
  streakDirection: "red" | "green";
  streakDays: number;
  detailTab: DetailTab;
  onResetLiveGap: () => void;
  onChangeGapPct: (val: number) => void;
  onChangeDetailTab: (tab: DetailTab) => void;
  onApplyStreakRow: (row: StreakStats) => void;
}

export function GapsStreaksView({
  data,
  evaluation,
  streakCard,
  gapPct,
  gapTouched,
  streakBasis,
  streakDirection,
  streakDays,
  detailTab,
  onResetLiveGap,
  onChangeGapPct,
  onChangeDetailTab,
  onApplyStreakRow,
}: GapsStreaksViewProps) {
  return (
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
                onClick={onResetLiveGap}
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
                onChange={onChangeGapPct}
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
            onChange={(e) => onChangeGapPct(Number(e.target.value))}
          />
          <div className="noise-quick-row">
            {QUICK_GAPS.map((g) => (
              <button
                key={g}
                type="button"
                className={`noise-mini-btn${Math.abs(gapPct - g) < 0.05 ? " active" : ""}`}
                onClick={() => onChangeGapPct(g)}
              >
                {g > 0 ? `+${g.toFixed(1).replace(".", ",")}%` : `${g.toFixed(1).replace(".", ",")}%`}
              </button>
            ))}
          </div>
        </div>

        {streakCard}
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
          onClick={() => onChangeDetailTab("gaps")}
        >
          <BarChart3 size={14} /> Gap-Matrix
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === "streaks"}
          className={detailTab === "streaks" ? "active" : ""}
          onClick={() => onChangeDetailTab("streaks")}
        >
          <Activity size={14} /> Streak-Tabelle &amp; Wochentage
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === "analogues"}
          className={detailTab === "analogues" ? "active" : ""}
          onClick={() => onChangeDetailTab("analogues")}
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
                    onChangeGapPct(target);
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
                      onClick={() => onApplyStreakRow(row)}
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
                      onClick={() => onApplyStreakRow(row)}
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
  );
}
