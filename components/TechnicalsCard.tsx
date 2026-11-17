"use client";
import { useMemo, useState } from "react";
import { useChartStore } from "@/stores/useChartStore";
import { verdictOf, type RatingEntry, type Verdict } from "@/lib/ta/rating";
import { chartRating } from "@/lib/ta/chartRating";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { intervalLabel } from "@/lib/market/intervals";

const LABELS: Verdict[] = ["strong sell", "sell", "neutral", "buy", "strong buy"];

/** Needle angle in degrees across the half circle: −90 is full sell, +90 full buy. */
export function needleAngle(score: number): number {
  return Math.max(-1, Math.min(1, score)) * 90;
}

function Gauge({ score, verdict, title }: { score: number; verdict: Verdict; title: string }) {
  const angle = needleAngle(score);
  const tone = verdict.includes("buy") ? "positive" : verdict.includes("sell") ? "negative" : "";
  return (
    <figure className="gauge" aria-label={`${title}: ${verdict}`}>
      <svg viewBox="0 0 120 70" role="img">
        {[0, 1, 2, 3, 4].map((i) => {
          const from = Math.PI + (i * Math.PI) / 5;
          const to = Math.PI + ((i + 1) * Math.PI) / 5 - 0.05;
          const point = (a: number) => `${60 + 48 * Math.cos(a)},${62 + 48 * Math.sin(a)}`;
          const active = LABELS[i] === verdict;
          return (
            <path
              key={i}
              d={`M ${point(from)} A 48 48 0 0 1 ${point(to)}`}
              className={`gauge-arc ${i < 2 ? "sell" : i > 2 ? "buy" : "neutral"} ${active ? "active" : ""}`}
            />
          );
        })}
        <g transform={`rotate(${angle} 60 62)`} className="gauge-needle">
          <line x1="60" y1="62" x2="60" y2="22" />
          <circle cx="60" cy="62" r="3" />
        </g>
      </svg>
      <figcaption>
        <span>{title}</span>
        <strong className={tone}>{verdict}</strong>
      </figcaption>
    </figure>
  );
}

function Votes({ entries }: { entries: RatingEntry[] }) {
  return (
    <table className="votes">
      <tbody>
        {entries.map((e) => (
          <tr key={e.name}>
            <td>{e.name}</td>
            <td className="mono">{Math.abs(e.value) >= 100 ? e.value.toFixed(0) : e.value.toPrecision(5)}</td>
            <td className={e.vote === "buy" ? "positive" : e.vote === "sell" ? "negative" : "muted"}>{e.vote}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Summary of eleven oscillators and moving averages for the charted symbol and interval. */
export function TechnicalsCard() {
  const candles = useChartStore((s) => s.candles);
  const timeframe = useChartStore((s) => s.timeframe);
  const symbol = useChartStore(s => s.symbol);
  const recovery = useChartStore(s => s.candleRecoveries[`${s.symbol}:${s.timeframe}`]);
  const error = useChartStore(s => s.chartError);
  const replayActive = useWorkspaceStore(s => s.replay.active);
  const cursorTime = useWorkspaceStore(s => s.replay.cursorTime);
  const [open, setOpen] = useState(false);
  const view = useMemo(() => chartRating(candles, { replayActive, cursorTime, recovering: !!recovery, error }),
    [candles, symbol, timeframe, replayActive, cursorTime, recovery, error]);
  const rating = view.rating;
  return (
    <section className="technicals" aria-label="Technicals">
      <header>
        <strong>Technicals</strong>
        <span className="muted">{view.replay ? "Replay · " : ""}{intervalLabel(timeframe)}</span>
      </header>
      {rating ? (
        <>
          <div className="gauges">
            <Gauge title="Oscillators" score={rating.oscillatorScore} verdict={verdictOf(rating.oscillatorScore)} />
            <Gauge title="Summary" score={rating.score} verdict={rating.verdict} />
            <Gauge title="Moving averages" score={rating.maScore} verdict={verdictOf(rating.maScore)} />
          </div>
          <div className="vote-counts">
            <span className="negative">Sell {rating.counts.sell}</span>
            <span className="muted">Neutral {rating.counts.neutral}</span>
            <span className="positive">Buy {rating.counts.buy}</span>
          </div>
          <button className="link-button" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide indicators" : "Show indicators"}
          </button>
          {open ? (
            <>
              <h4>Oscillators</h4>
              <Votes entries={rating.oscillators} />
              <h4>Moving averages</h4>
              <Votes entries={rating.movingAverages} />
            </>
          ) : null}
          <p className="form-help" title={view.asOf === null ? undefined : `Latest evaluated bar: ${new Date(view.asOf).toISOString()}`}>
            {view.replay ? "Computed only from bars revealed in Replay." : "Computed from the loaded candles with standard indicator rules."} Not investment advice.
          </p>
        </>
      ) : (
        <p className="form-help" role="status">{view.status === "recovering" ? "Waiting for uninterrupted candle history."
          : view.status === "error" ? "Technicals unavailable while chart history has an error."
          : view.status === "replay-waiting" ? "Waiting for the Replay cursor."
          : view.replay ? "Needs at least 60 revealed Replay candles." : "Needs at least 60 loaded candles."}</p>
      )}
    </section>
  );
}
