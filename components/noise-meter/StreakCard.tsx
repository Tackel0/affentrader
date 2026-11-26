"use client";
import { Activity } from "lucide-react";
import type {
  NoiseDataset,
  NoiseEvaluation,
  NoiseStreakBasis,
} from "@/lib/terminal/noiseMeter";
import { fmtShortDate, fmtSigned2, QUICK_STREAKS } from "./constants";

export interface StreakCardProps {
  titleLabel: string;
  dataset: NoiseDataset | null;
  evaluation: NoiseEvaluation;
  streakBasis: NoiseStreakBasis;
  streakDirection: "red" | "green";
  streakDays: number;
  streakTouched: boolean;
  activeLiveStreak: { direction: "red" | "green"; count: number };
  liveCloseStreak: { direction: "red" | "green"; count: number };
  liveCandleStreak: { direction: "red" | "green"; count: number };
  onResetLive: () => void;
  onSelectDirection: (dir: "red" | "green") => void;
  onSwitchBasis: (basis: NoiseStreakBasis) => void;
  onSelectDays: (days: number) => void;
}

export function StreakCard({
  titleLabel,
  dataset,
  evaluation,
  streakBasis,
  streakDirection,
  streakDays,
  streakTouched,
  activeLiveStreak,
  liveCloseStreak,
  liveCandleStreak,
  onResetLive,
  onSelectDirection,
  onSwitchBasis,
  onSelectDays,
}: StreakCardProps) {
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
            onClick={onResetLive}
          >
            Aktuell ({activeLiveStreak.count}{" "}
            {activeLiveStreak.direction === "red" ? "rot" : "grün"})
          </button>
          <button
            type="button"
            className={`noise-mini-btn dir-red${streakDirection === "red" ? " active" : ""}`}
            aria-pressed={streakDirection === "red"}
            onClick={() => onSelectDirection("red")}
          >
            Rot
          </button>
          <button
            type="button"
            className={`noise-mini-btn dir-green${streakDirection === "green" ? " active" : ""}`}
            aria-pressed={streakDirection === "green"}
            onClick={() => onSelectDirection("green")}
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
          onClick={() => onSwitchBasis("close")}
        >
          Close (vs Vortag): {liveCloseStreak.count}{" "}
          {liveCloseStreak.direction === "red" ? "rot" : "grün"}
        </button>
        <button
          type="button"
          className={`noise-mini-btn${streakBasis === "candle" ? " active" : ""}`}
          aria-pressed={streakBasis === "candle"}
          title="Nur Kerzenkörper (Close vs. Open — bei Up-Gap kann ein grüner Tag eine rote Kerze sein)"
          onClick={() => onSwitchBasis("candle")}
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
            onClick={() => onSelectDays(d)}
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
}
