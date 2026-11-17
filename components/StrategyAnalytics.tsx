"use client";
import { useMemo, useState } from "react";
import { Save, ScanSearch, Trash2 } from "lucide-react";
import type { StrategyReport } from "@/types/strategy";
import {
  bestIndex,
  extendedMetrics,
  summarizeReport,
  type ComparisonKey,
  type SavedReport,
} from "@/lib/strategy/analysis";
import {
  auditTrades,
  lowerInterval,
  type AuditSummary,
} from "@/lib/strategy/audit";
import { marketService } from "@/lib/market/service";
import { MAX_COMPARED, useReportStore } from "@/stores/useReportStore";
import { useChartStore } from "@/stores/useChartStore";
import { intervalMs } from "@/lib/market/intervals";
import { strategyCurrency } from "@/lib/strategy/data";

const fmt = (value: number | null, digits = 2, suffix = "") =>
  value === null || !Number.isFinite(value)
    ? "—"
    : `${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
const signed = (value: number | null, digits = 2, suffix = "") =>
  value === null || !Number.isFinite(value)
    ? "—"
    : `${value > 0 ? "+" : ""}${fmt(value, digits, suffix)}`;
const tone = (value: number | null) =>
  value === null ? "" : value > 0 ? "positive" : value < 0 ? "negative" : "";
const COLORS = ["#2962ff", "#f7b955", "#089981", "#f23645"];

function duration(ms: number | null): string {
  if (ms === null) return "—";
  const hours = ms / 3_600_000;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

function Metric({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={`mono ${className}`}>{value}</strong>
    </div>
  );
}

function MonthlyTable({
  monthly,
}: {
  monthly: { month: string; returnPercent: number }[];
}) {
  const years = [...new Set(monthly.map((m) => m.month.slice(0, 4)))];
  const max = Math.max(1, ...monthly.map((m) => Math.abs(m.returnPercent)));
  return (
    <table className="data-table monthly-table">
      <thead>
        <tr>
          <th>Year</th>
          {["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map(
            (m, i) => (
              <th key={i}>{m}</th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {years.map((year) => (
          <tr key={year}>
            <td>{year}</td>
            {Array.from({ length: 12 }, (_, i) => {
              const entry = monthly.find(
                (m) => m.month === `${year}-${String(i + 1).padStart(2, "0")}`,
              );
              const alpha = entry
                ? Math.min(0.85, Math.abs(entry.returnPercent) / max)
                : 0;
              return (
                <td
                  key={i}
                  className="mono"
                  title={entry ? `${entry.returnPercent.toFixed(2)}%` : ""}
                  style={
                    entry
                      ? {
                          background: `${entry.returnPercent >= 0 ? "#089981" : "#f23645"}${Math.round(
                            alpha * 255,
                          )
                            .toString(16)
                            .padStart(2, "0")}`,
                        }
                      : undefined
                  }
                >
                  {entry ? entry.returnPercent.toFixed(1) : ""}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Histogram({
  bins,
}: {
  bins: { from: number; to: number; count: number }[];
}) {
  if (!bins.length) return null;
  const max = Math.max(...bins.map((b) => b.count));
  return (
    <svg
      className="histogram"
      viewBox="0 0 300 90"
      role="img"
      aria-label="Distribution of trade returns"
    >
      {bins.map((b, i) => {
        const w = 300 / bins.length;
        const h = (b.count / max) * 66;
        return (
          <g key={i}>
            <rect
              x={i * w + 1}
              y={72 - h}
              width={w - 2}
              height={h}
              fill={(b.from + b.to) / 2 >= 0 ? "#089981" : "#f23645"}
              opacity={0.85}
            >
              <title>{`${b.from.toFixed(2)}% to ${b.to.toFixed(2)}%: ${b.count}`}</title>
            </rect>
            {i % 3 === 0 ? (
              <text
                x={i * w + w / 2}
                y={86}
                fontSize={8}
                textAnchor="middle"
                fill="currentColor"
                opacity={0.65}
              >
                {b.from.toFixed(1)}%
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function AuditPanel({ report }: { report: StrategyReport }) {
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState("");
  const interval = lowerInterval(report.market.timeframe);
  const run = async () => {
    setState("running");
    setMessage("");
    try {
      const result = await auditTrades(
        report,
        async (from, to) => {
          const lower = lowerInterval(report.market.timeframe)!;
          const count = Math.min(
            1500,
            Math.ceil((to - from) / intervalMs(lower)) + 2,
          );
          const bars = await marketService.fetchBars(
            report.market.symbol,
            lower,
            count,
            to,
          );
          return bars.filter((b) => b.time >= from && b.time < to);
        },
        { limit: 60 },
      );
      setSummary(result);
      setState("idle");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setState("error");
    }
  };
  return (
    <div className="audit-panel">
      <div className="screener-toolbar">
        <strong>Intrabar audit</strong>
        <span className="screener-count">
          {interval
            ? `Checks the newest 60 closed trades against ${interval} candles`
            : "Already at the finest interval"}
        </span>
        <span className="flex-1" />
        <button
          className="button small"
          disabled={!interval || state === "running"}
          onClick={run}
        >
          <ScanSearch size={12} />{" "}
          {state === "running" ? "Auditing…" : "Run audit"}
        </button>
      </div>
      {message ? (
        <p className="error-message screener-error">{message}</p>
      ) : null}
      {summary ? (
        <div className="metrics-grid">
          <Metric label="Trades audited" value={String(summary.audited)} />
          <Metric
            label="Entries confirmed"
            value={`${summary.entriesVerified} / ${summary.audited}`}
            className={
              summary.entriesVerified === summary.audited
                ? "positive"
                : "negative"
            }
          />
          <Metric
            label="Exits confirmed"
            value={`${summary.exitsVerified} / ${summary.results.filter((r) => r.exitTouched !== null).length}`}
          />
          <Metric
            label="Unverified fills"
            value={String(summary.unverified.length)}
            className={summary.unverified.length ? "negative" : "positive"}
          />
          <Metric
            label="Avg adverse move"
            value={fmt(
              summary.results
                .filter((r) => r.adverse !== null)
                .reduce((a, r) => a + r.adverse!, 0) /
                Math.max(
                  1,
                  summary.results.filter((r) => r.adverse !== null).length,
                ),
              4,
            )}
          />
          <Metric
            label="Avg favorable move"
            value={fmt(
              summary.results
                .filter((r) => r.favorable !== null)
                .reduce((a, r) => a + r.favorable!, 0) /
                Math.max(
                  1,
                  summary.results.filter((r) => r.favorable !== null).length,
                ),
              4,
            )}
          />
        </div>
      ) : null}
      {summary?.unverified.length ? (
        <p className="form-help">
          Trades whose fill price never traded inside its bar at{" "}
          {summary.interval} resolution:{" "}
          {summary.unverified
            .map((id) => `#${report.trades.findIndex((t) => t.id === id) + 1}`)
            .join(", ")}
          .
        </p>
      ) : null}
    </div>
  );
}

export function AnalyticsView({ report }: { report: StrategyReport }) {
  const m = useMemo(() => extendedMetrics(report), [report]);
  const save = useReportStore((s) => s.save);
  return (
    <div className="analytics-view">
      <div className="screener-toolbar">
        <span className="screener-count">
          Computed from the equity curve and closed trades of this run
        </span>
        <span className="flex-1" />
        <button
          className="button small"
          onClick={() => {
            const name = window.prompt(
              "Name this report for comparison",
              report.name,
            );
            if (name !== null) {
              save(summarizeReport(report, name));
              useChartStore
                .getState()
                .toast(
                  "Report saved",
                  "Open “Compare reports” to line it up against others.",
                  "success",
                );
            }
          }}
        >
          <Save size={12} /> Save for comparison
        </button>
      </div>
      <div className="metrics-grid">
        <Metric
          label="CAGR"
          value={signed(m.cagr, 2, "%")}
          className={tone(m.cagr)}
        />
        <Metric label="Volatility (ann.)" value={fmt(m.volatility, 2, "%")} />
        <Metric label="Sharpe (ann.)" value={fmt(m.sharpe, 2)} />
        <Metric label="Sortino (ann.)" value={fmt(m.sortino, 2)} />
        <Metric label="Calmar" value={fmt(m.calmar, 2)} />
        <Metric label="Recovery factor" value={fmt(m.recoveryFactor, 2)} />
        <Metric
          label="Expectancy / trade"
          value={`${signed(m.expectancy)} ${strategyCurrency(report.market)}`}
          className={tone(m.expectancy)}
        />
        <Metric label="Payoff ratio" value={fmt(m.payoffRatio, 2)} />
        <Metric
          label="Kelly fraction"
          value={fmt(m.kelly, 1, "%")}
          className={tone(m.kelly)}
        />
        <Metric label="Exposure" value={fmt(m.exposure, 1, "%")} />
        <Metric label="Avg trade duration" value={duration(m.averageTradeMs)} />
        <Metric
          label="Longest drawdown"
          value={`${m.longestDrawdownBars} bars · ${duration(m.longestDrawdownMs)}`}
        />
        <Metric label="Max win streak" value={String(m.maxConsecutiveWins)} />
        <Metric
          label="Max loss streak"
          value={String(m.maxConsecutiveLosses)}
        />
        <Metric
          label="Best / worst trade"
          value={`${signed(m.bestTradePercent, 2, "%")} / ${signed(m.worstTradePercent, 2, "%")}`}
        />
        <Metric
          label="Buy & hold"
          value={signed(m.buyHoldPercent, 2, "%")}
          className={tone(m.buyHoldPercent)}
        />
        <Metric
          label="Alpha vs buy & hold"
          value={signed(m.alphaPercent, 2, " pts")}
          className={tone(m.alphaPercent)}
        />
        <Metric
          label="Avg run-up / drawdown"
          value={`${fmt(m.averageRunup)} / ${fmt(m.averageDrawdown)}`}
        />
      </div>
      <div className="analytics-grid">
        <div>
          <div className="popover-label">Monthly returns (%)</div>
          <MonthlyTable monthly={m.monthly} />
        </div>
        <div>
          <div className="popover-label">Trade return distribution</div>
          <Histogram bins={m.distribution} />
        </div>
      </div>
      <AuditPanel report={report} />
    </div>
  );
}

const ROWS: {
  key: ComparisonKey;
  label: string;
  format: (r: SavedReport) => string;
}[] = [
  {
    key: "netProfitPercent",
    label: "Net profit",
    format: (r) =>
      `${signed(r.netProfitPercent, 2, "%")} (${signed(r.netProfit)})`,
  },
  {
    key: "maxDrawdownPercent",
    label: "Max drawdown",
    format: (r) => fmt(r.maxDrawdownPercent, 2, "%"),
  },
  { key: "trades", label: "Trades", format: (r) => String(r.trades) },
  { key: "winRate", label: "Win rate", format: (r) => fmt(r.winRate, 1, "%") },
  {
    key: "profitFactor",
    label: "Profit factor",
    format: (r) => fmt(r.profitFactor, 2),
  },
  { key: "sharpe", label: "Sharpe", format: (r) => fmt(r.sharpe, 2) },
  { key: "sortino", label: "Sortino", format: (r) => fmt(r.sortino, 2) },
  { key: "calmar", label: "Calmar", format: (r) => fmt(r.calmar, 2) },
];

function CurveCompare({ reports }: { reports: SavedReport[] }) {
  const series = reports.map((r) =>
    r.curve.map(
      ([t, e]) =>
        [t, ((e - r.initialCapital) / r.initialCapital) * 100] as const,
    ),
  );
  const values = series.flat().map(([, v]) => v);
  if (!values.length) return null;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const t0 = Math.min(...series.flat().map(([t]) => t));
  const t1 = Math.max(...series.flat().map(([t]) => t));
  const width = 560;
  const height = 150;
  const x = (t: number) =>
    34 + ((t - t0) / Math.max(1, t1 - t0)) * (width - 44);
  const y = (v: number) =>
    height - 14 - ((v - min) / Math.max(1e-9, max - min)) * (height - 28);
  return (
    <svg
      className="yield-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Equity comparison"
    >
      <line
        x1={34}
        x2={width - 10}
        y1={y(0)}
        y2={y(0)}
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeDasharray="4 4"
      />
      {[min, 0, max].map((v, i) => (
        <text
          key={i}
          x={2}
          y={y(v) + 3}
          fontSize={9}
          fill="currentColor"
          opacity={0.65}
        >
          {v.toFixed(0)}%
        </text>
      ))}
      {series.map((s, i) => (
        <path
          key={reports[i].id}
          d={s
            .map(
              ([t, v], j) =>
                `${j ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`,
            )
            .join(" ")}
          fill="none"
          stroke={COLORS[i % COLORS.length]}
          strokeWidth={1.8}
        />
      ))}
    </svg>
  );
}

export function CompareView() {
  const { saved, selected, toggle, remove, rename } = useReportStore();
  const chosen = selected
    .map((id) => saved.find((r) => r.id === id))
    .filter((r): r is SavedReport => Boolean(r));
  return (
    <div className="analytics-view">
      {!saved.length ? (
        <div className="empty-table">
          Save a finished backtest from the Analytics tab; saved reports can
          then be compared here, side by side.
        </div>
      ) : (
        <>
          <div className="saved-reports">
            {saved.map((r) => (
              <label
                key={r.id}
                className={selected.includes(r.id) ? "chosen" : ""}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  disabled={
                    !selected.includes(r.id) && selected.length >= MAX_COMPARED
                  }
                  onChange={() => toggle(r.id)}
                />
                <span>
                  <strong>{r.name}</strong>
                  <small>
                    {r.symbol} · {r.timeframe} ·{" "}
                    {new Date(r.firstTime).toISOString().slice(0, 10)} →{" "}
                    {new Date(r.lastTime).toISOString().slice(0, 10)}
                    {r.source === "simulation" ? " · SYNTHETIC" : ""}
                    {r.magnifier?.enabled ? ` · Magnifier ${r.magnifier.timeframe} (${r.magnifier.coveredBars} covered, ${r.magnifier.fallbackBars} fallback)` : " · Parent OHLC"}
                  </small>
                </span>
                <button
                  type="button"
                  className="link-button"
                  onClick={(e) => {
                    e.preventDefault();
                    const name = window.prompt("Rename report", r.name);
                    if (name) rename(r.id, name);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Delete ${r.name}`}
                  onClick={(e) => (e.preventDefault(), remove(r.id))}
                >
                  <Trash2 size={12} />
                </button>
              </label>
            ))}
          </div>
          {chosen.length >= 2 ? (
            <>
              <CurveCompare reports={chosen} />
              <table className="data-table compare-table">
                <thead>
                  <tr>
                    <th />
                    {chosen.map((r, i) => (
                      <th
                        key={r.id}
                        style={{ color: COLORS[i % COLORS.length] }}
                      >
                        {r.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => {
                    const best = bestIndex(chosen, row.key);
                    return (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        {chosen.map((r, i) => (
                          <td
                            key={r.id}
                            className={`mono ${i === best ? "best-cell" : ""}`}
                          >
                            {row.format(r)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {new Set(chosen.map((r) => `${r.symbol}:${r.timeframe}`)).size >
              1 ? (
                <p className="form-help">
                  These reports cover different markets or intervals; compare
                  returns with care.
                </p>
              ) : null}
              {new Set(chosen.map((r) => r.currency ?? "USDT")).size > 1 ? (
                <p className="form-help">
                  Reports use different account currencies. Percentage
                  comparisons are shown without currency conversion.
                </p>
              ) : null}
            </>
          ) : (
            <div className="empty-table">
              Tick two to {MAX_COMPARED} reports to compare them.
            </div>
          )}
        </>
      )}
    </div>
  );
}
