"use client";
import { symbolLabel, providerOf } from "@/lib/symbolId";
import { describeSymbol } from "@/lib/symbols";
import { useMemo, useRef, useState } from "react";
import {
  Play,
  Square,
  Settings2,
  Code2,
  FileDown,
  Upload,
  SlidersHorizontal,
  BarChart3,
} from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useStrategyStore } from "@/stores/useStrategyStore";
import { cancelStrategy, startStrategy } from "@/lib/strategy/client";
import { STRATEGY_EXAMPLES } from "@/lib/strategy/scripts";
import { strategyEquityCSV, strategyTradesCSV } from "@/lib/strategy/report";
import { validateStrategySettings } from "@/lib/strategy/settings";
import type {
  EquityPoint,
  StrategyReport,
  StrategySettings,
  TradeStatistics,
} from "@/types/strategy";
import { IconButton, Modal } from "./ui";
import { downloadFile } from "@/lib/files";
import { AnalyticsView, CompareView } from "./StrategyAnalytics";
import { strategyCurrency, strategyVenue } from "@/lib/strategy/data";
import { StrategyPresetBenchmark } from "./StrategyPresetBenchmark";

const num = (n: number | null, digits = 2) =>
  n === null || Number.isNaN(n)
    ? "—"
    : n === Infinity
      ? "∞"
      : Number.isFinite(n)
        ? n.toLocaleString("en-US", {
            maximumFractionDigits: digits,
            minimumFractionDigits: digits,
          })
        : "—";
const signed = (n: number, digits = 2) =>
  `${n > 0 ? "+" : ""}${num(n, digits)}`;
const date = (time: number) =>
  new Date(time).toISOString().replace("T", " ").slice(0, 19);
export function StrategyTester() {
  const state = useStrategyStore(),
    document = state.document,
    report = state.report;
  const symbol = useChartStore((s) => s.symbol),
    timeframe = useChartStore((s) => s.timeframe);
  const [tab, setTab] = useState<
      | "overview"
      | "performance"
      | "analytics"
      | "compare"
      | "trades"
      | "properties"
    >("overview"),
    [modal, setModal] = useState<"source" | "settings" | "inputs" | null>(null),
    [tradeFilter, setTradeFilter] = useState("all"),
    [page, setPage] = useState(0);
  const file = useRef<HTMLInputElement>(null),
    busy = state.status === "loading" || state.status === "running";
  const stale =
    report &&
    (JSON.stringify(report.document) !== JSON.stringify(document) ||
      report.market.symbol !== symbol ||
      report.market.timeframe !== timeframe);
  const currency = report
    ? strategyCurrency(report.market)
    : providerOf(symbol) === "hyperliquid"
      ? "USDC"
      : describeSymbol(symbol).quote || "quote currency";
  const trades =
    report?.trades.filter(
      (t) =>
        tradeFilter === "all" ||
        (tradeFilter === "open" ? t.open : t.side === tradeFilter),
    ) ?? [];
  const pageCount = Math.max(1, Math.ceil(trades.length / 100)),
    currentPage = Math.min(page, pageCount - 1);
  return (
    <div className="strategy-tester">
      <div className="strategy-toolbar">
        <BarChart3 size={16} />
        <select
          aria-label="Strategy example"
          value={
            Object.keys(STRATEGY_EXAMPLES).find(
              (n) => STRATEGY_EXAMPLES[n] === document.source,
            ) ?? "custom"
          }
          onChange={(e) => {
            if (e.target.value === "custom") return;
            state.edit({
              name: e.target.value,
              source: STRATEGY_EXAMPLES[e.target.value],
              inputs: {},
            });
            state.set({ inputSchema: [] });
          }}
        >
          {Object.keys(STRATEGY_EXAMPLES).map((name) => (
            <option key={name}>{name}</option>
          ))}
          <option value="custom">Custom strategy</option>
        </select>
        <IconButton
          label="Strategy source code"
          onClick={() => setModal("source")}
        >
          <Code2 size={15} />
        </IconButton>
        <IconButton
          label="Strategy inputs"
          onClick={() => {
            setModal("inputs");
            void startStrategy(true);
          }}
          disabled={busy}
        >
          <SlidersHorizontal size={15} />
        </IconButton>
        <IconButton
          label="Strategy properties"
          onClick={() => setModal("settings")}
        >
          <Settings2 size={15} />
        </IconButton>
        <span className="strategy-market">
          {symbolLabel(symbol)} · {timeframe}
        </span>
        <span className="flex-1" />
        {report ? (
          <select
            aria-label="Export strategy report"
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value,
                prefix = `${report.market.symbol}-${report.market.timeframe}-strategy`;
              if (value === "trades")
                downloadFile(
                  `${prefix}-trades.csv`,
                  strategyTradesCSV(report),
                  "text/csv;charset=utf-8",
                );
              if (value === "equity")
                downloadFile(
                  `${prefix}-equity.csv`,
                  strategyEquityCSV(report),
                  "text/csv;charset=utf-8",
                );
              if (value === "json")
                downloadFile(
                  `${prefix}-report.json`,
                  JSON.stringify(
                    report,
                    (_, v) => (v === Infinity ? "Infinity" : v),
                    2,
                  ),
                );
              e.target.value = "";
            }}
          >
            <option value="">Export report</option>
            <option value="trades">Trades CSV</option>
            <option value="equity">Equity CSV</option>
            <option value="json">Complete report JSON</option>
          </select>
        ) : null}
        {busy ? (
          <button className="button small" onClick={cancelStrategy}>
            <Square size={12} />
            Cancel
          </button>
        ) : (
          <button
            className="button primary small"
            onClick={() => void startStrategy()}
          >
            <Play size={12} />
            Run backtest
          </button>
        )}
      </div>
      <div className="strategy-result-header">
        <strong>{report?.name ?? document.name}</strong>
        <span>
          {report
            ? `${report.market.symbol} · ${report.market.timeframe} · ${report.barCount.toLocaleString()} bars`
            : "Pine strategy · historical execution"}
        </span>
        {report?.source === "simulation" ? (
          <b className="strategy-synthetic">SYNTHETIC DATA</b>
        ) : report ? (
          <span className="strategy-source">
            {strategyVenue(report.market)} OHLCV
          </span>
        ) : null}
        {stale ? (
          <b className="strategy-stale">Settings changed · run again</b>
        ) : null}
        {report?.magnifier?.enabled ? (
          <span className="strategy-source">
            Bar magnifier · {report.magnifier.timeframe} · {report.magnifier.coveredBars.toLocaleString()} / {report.barCount.toLocaleString()} covered
            {report.magnifier.fallbackBars ? ` · ${report.magnifier.fallbackBars.toLocaleString()} OHLC fallback` : ""}
          </span>
        ) : null}
        {busy ? (
          <span className="strategy-progress" role="status">
            {state.progress}
          </span>
        ) : null}
      </div>
      <StrategyPresetBenchmark symbol={symbol} timeframe={timeframe} settings={document.settings} disabled={busy} />
      {state.error ? (
        <div className="strategy-error" role="alert">
          {state.error}
        </div>
      ) : null}
      {report ? (
        <>
          <div
            className="strategy-tabs"
            role="tablist"
            aria-label="Strategy results"
          >
            {(
              [
                ["overview", "Overview"],
                ["performance", "Performance summary"],
                ["analytics", "Analytics"],
                ["compare", "Compare reports"],
                ["trades", "List of trades"],
                ["properties", "Properties"],
              ] as const
            ).map(([id, title]) => (
              <button
                role="tab"
                aria-selected={tab === id}
                key={id}
                onClick={() => setTab(id)}
              >
                {title}
              </button>
            ))}
            <span className="flex-1" />
            <span>
              {date(report.firstTime).slice(0, 16)} —{" "}
              {date(report.lastTime).slice(0, 16)} UTC
            </span>
          </div>
          <div className="strategy-results" role="tabpanel">
            {tab === "overview" ? (
              <>
                <div className="strategy-metrics">
                  <Metric
                    label="Net profit"
                    value={`${signed(report.netProfit)} ${currency}`}
                    sub={`${signed((report.netProfit / report.initialCapital) * 100)}%`}
                    tone={report.netProfit}
                  />
                  <Metric
                    label="Max equity drawdown"
                    value={`${num(report.maxDrawdown)} ${currency}`}
                    sub={`${num(report.maxDrawdownPercent)}% · intrabar`}
                  />
                  <Metric
                    label="Total trades"
                    value={String(report.all.count)}
                    sub={`${report.trades.filter((t) => t.open).length} open`}
                  />
                  <Metric
                    label="Profitable trades"
                    value={
                      report.all.winRate === null
                        ? "—"
                        : `${num(report.all.winRate)}%`
                    }
                    sub={`${report.all.wins} / ${report.all.count}`}
                  />
                  <Metric
                    label="Profit factor"
                    value={num(report.all.profitFactor, 3)}
                    sub="Closed trades after fees"
                  />
                </div>
                <EquityChart
                  points={report.equityCurve}
                  capital={report.initialCapital}
                  currency={currency}
                />
              </>
            ) : tab === "performance" ? (
              <Performance report={report} />
            ) : tab === "analytics" ? (
              <AnalyticsView report={report} />
            ) : tab === "compare" ? (
              <CompareView />
            ) : tab === "properties" ? (
              <ReportProperties report={report} />
            ) : (
              <>
                <div className="strategy-trade-controls">
                  <select
                    aria-label="Trade direction filter"
                    value={tradeFilter}
                    onChange={(e) => {
                      setTradeFilter(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="all">All trades</option>
                    <option value="long">Long trades</option>
                    <option value="short">Short trades</option>
                    <option value="open">Open positions</option>
                  </select>
                  <span>{trades.length} records</span>
                  <label className="trade-chart-toggle">
                    <input
                      type="checkbox"
                      checked={state.showOnChart}
                      onChange={(e) =>
                        state.set({ showOnChart: e.target.checked })
                      }
                    />
                    Show trades on chart
                  </label>
                  <span className="flex-1" />
                  <button
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {currentPage + 1} / {pageCount}
                  </span>
                  <button
                    disabled={currentPage + 1 >= pageCount}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </button>
                </div>
                <div className="strategy-table-scroll">
                  <table className="strategy-table">
                    <thead>
                      <tr>
                        <th>Trade</th>
                        <th>Side / size</th>
                        <th>Entry · UTC</th>
                        <th>Exit · UTC</th>
                        <th>Entry price</th>
                        <th>Exit price</th>
                        <th>Net P&amp;L · {currency}</th>
                        <th>Fees · {currency}</th>
                        <th>Run-up</th>
                        <th>Drawdown</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades
                        .slice(currentPage * 100, currentPage * 100 + 100)
                        .map((t, i) => (
                          <tr
                            key={t.id}
                            className={`trade-row ${state.focusTrade === t.id ? "focused" : ""}`}
                            title="Click to show this trade on the chart"
                            onClick={() => {
                              state.set({
                                focusTrade: t.id,
                                showOnChart: true,
                              });
                              const chart = useChartStore.getState();
                              if (
                                chart.symbol !== report.market.symbol ||
                                chart.timeframe !== report.market.timeframe
                              )
                                chart.set({
                                  symbol: report.market.symbol,
                                  timeframe: report.market.timeframe,
                                });
                              chart.set({
                                command: {
                                  id: Date.now(),
                                  kind: "goto",
                                  time: t.entryTime,
                                },
                              });
                            }}
                          >
                            <td>
                              {report.trades.indexOf(t) + 1}
                              <small>
                                {t.entryId} → {t.exitId || "Open"}
                              </small>
                            </td>
                            <td>
                              <b
                                className={
                                  t.side === "long" ? "positive" : "negative"
                                }
                              >
                                {t.side.toUpperCase()}
                              </b>
                              <small>{num(t.quantity, 8)}</small>
                            </td>
                            <td>{date(t.entryTime)}</td>
                            <td>
                              {t.exitTime === null
                                ? "Open position"
                                : date(t.exitTime)}
                            </td>
                            <td>{num(t.entryPrice, 6)}</td>
                            <td>{num(t.exitPrice, 6)}</td>
                            <td
                              className={
                                t.netProfit >= 0 ? "positive" : "negative"
                              }
                            >
                              {signed(t.netProfit)}
                              <small>
                                {t.open
                                  ? "Marked to last close"
                                  : `${signed((t.netProfit / (t.quantity * t.entryPrice * (t.pointValue ?? 1))) * 100)}%`}
                              </small>
                            </td>
                            <td>{num(t.commission, 4)}</td>
                            <td>{num(t.runup)}</td>
                            <td>{num(t.drawdown)}</td>
                          </tr>
                        ))}
                      {!trades.length ? (
                        <tr>
                          <td colSpan={10}>No trades in this selection.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
          {report.warnings.length ? (
            <details className="strategy-warnings">
              <summary>{report.warnings.length} data / runtime notices</summary>
              {report.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </details>
          ) : null}
        </>
      ) : (
        <div className="strategy-empty">
          <BarChart3 size={32} />
          <strong>Test your strategy</strong>
          <p>
            Choose a Pine strategy, set its inputs and properties, then run it
            on completed {symbol} candles.
          </p>
          <button className="button small" onClick={() => setModal("source")}>
            Open strategy source
          </button>
        </div>
      )}
      <div className="strategy-disclosure">
        {report ? `${state.progress} · ` : ""}PineTS broker emulator ·
        {report?.magnifier?.enabled ? `${report.magnifier.timeframe} intrabar fills` : "OHLCV fills"} · {currency} accounting · no exchange orders
      </div>
      {modal === "source" ? (
        <Modal
          title="Strategy source"
          className="strategy-source-modal"
          onClose={() => setModal(null)}
        >
          <div className="strategy-source-actions">
            <input
              aria-label="Strategy name"
              maxLength={100}
              value={document.name}
              onChange={(e) => state.edit({ name: e.target.value })}
            />
            <span className="flex-1" />
            <IconButton
              label="Import strategy file"
              onClick={() => file.current?.click()}
            >
              <Upload size={15} />
            </IconButton>
            <IconButton
              label="Download strategy source"
              onClick={() =>
                downloadFile(
                  `${document.name.replace(/[^a-z0-9-]/gi, "-")}.pine`,
                  document.source,
                  "text/plain",
                )
              }
            >
              <FileDown size={15} />
            </IconButton>
            <input
              hidden
              ref={file}
              type="file"
              accept=".pine,.txt"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  if (f.size > 500000) {
                    state.set({ error: "Strategy source exceeds 500 KB." });
                    return;
                  }
                  state.edit({
                    source: await f.text(),
                    name: f.name.replace(/\.[^.]+$/, "").slice(0, 100),
                    inputs: {},
                  });
                  state.set({ inputSchema: [] });
                }
                e.target.value = "";
              }}
            />
          </div>
          <textarea
            className="strategy-code"
            aria-label="Strategy Pine source"
            maxLength={500000}
            spellCheck={false}
            value={document.source}
            onChange={(e) => {
              state.edit({ source: e.target.value, inputs: {} });
              state.set({ inputSchema: [] });
            }}
          />
          <div className="strategy-modal-footer">
            <span>Pine v5 / v6 · strategy() declaration required</span>
            <button
              className="button small"
              onClick={() => {
                useChartStore.getState().set({
                  pineDraft: {
                    name: document.name,
                    source: document.source,
                    activeId: null,
                  },
                  bottomTab: "pine",
                  bottomOpen: true,
                });
                setModal(null);
              }}
            >
              Open in Pine editor
            </button>
            <button
              className="button primary small"
              onClick={() => setModal(null)}
            >
              Done
            </button>
          </div>
        </Modal>
      ) : null}
      {modal === "settings" ? (
        <StrategyProperties
          value={document.settings}
          onClose={() => setModal(null)}
          onSave={(settings) => {
            state.edit({ settings });
            setModal(null);
          }}
        />
      ) : null}
      {modal === "inputs" ? (
        <Modal title="Strategy inputs" onClose={() => setModal(null)}>
          <div className="strategy-inputs">
            {busy ? (
              <p role="status">{state.progress}</p>
            ) : state.error ? (
              <p className="negative">{state.error}</p>
            ) : !state.inputSchema.length ? (
              <p>This strategy declares no configurable inputs.</p>
            ) : (
              state.inputSchema.map((input) => {
                const key = input.id,
                  value =
                    document.inputs[key] ??
                    (input.defval as string | number | boolean);
                const set = (value: string | number | boolean) =>
                  state.edit({
                    inputs: {
                      ...useStrategyStore.getState().document.inputs,
                      [key]: value,
                    },
                  });
                return (
                  <label key={key} title={input.tooltip}>
                    <span>{input.title || input.name}</span>
                    {input.type === "bool" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) => set(e.target.checked)}
                      />
                    ) : input.options ? (
                      <select
                        value={String(value)}
                        onChange={(e) =>
                          set(
                            typeof input.defval === "number"
                              ? Number(e.target.value)
                              : e.target.value,
                          )
                        }
                      >
                        {input.options.map((v) => (
                          <option key={String(v)} value={String(v)}>
                            {String(v)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={
                          typeof input.defval === "number" ? "number" : "text"
                        }
                        value={String(value)}
                        min={input.minval}
                        max={input.maxval}
                        step={input.type === "int" ? 1 : (input.step ?? "any")}
                        onChange={(e) =>
                          set(
                            typeof input.defval === "number"
                              ? Number(e.target.value)
                              : e.target.value,
                          )
                        }
                      />
                    )}
                  </label>
                );
              })
            )}
          </div>
          <div className="strategy-modal-footer">
            <button
              className="button small"
              onClick={() => state.edit({ inputs: {} })}
            >
              Reset defaults
            </button>
            <span className="flex-1" />
            <button
              className="button primary small"
              onClick={() => setModal(null)}
            >
              Done
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: number;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong
        className={
          tone === undefined ? "" : tone >= 0 ? "positive" : "negative"
        }
      >
        {value}
      </strong>
      <small>{sub}</small>
    </div>
  );
}
function EquityChart({
  points,
  capital,
  currency,
}: {
  points: EquityPoint[];
  capital: number;
  currency: string;
}) {
  const [drawdown, setDrawdown] = useState(false),
    [benchmark, setBenchmark] = useState(false),
    [hover, setHover] = useState<number | null>(null);
  const selected = points[hover ?? points.length - 1];
  const geometry = useMemo(() => {
    const all = points.flatMap((p) =>
      drawdown ? [p.drawdown] : benchmark ? [p.equity, p.buyHold] : [p.equity],
    );
    let min = drawdown ? 0 : Math.min(capital, ...all),
      max = Math.max(drawdown ? 0 : capital, ...all);
    const padding = (max - min || capital * 0.01) * 0.08;
    if (!drawdown) min -= padding;
    max += padding;
    const x = (i: number) => 74 + (i / Math.max(1, points.length - 1)) * 916;
    const y = (v: number) =>
      drawdown
        ? 15 + (v / (max || 1)) * 142
        : 157 - ((v - min) / (max - min)) * 142;
    const path = (field: "equity" | "buyHold" | "drawdown") =>
      points
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[field]).toFixed(1)}`,
        )
        .join(" ");
    return {
      min,
      max,
      x,
      y,
      main: path(drawdown ? "drawdown" : "equity"),
      benchmark: path("buyHold"),
    };
  }, [points, capital, drawdown, benchmark]);
  return (
    <div className="strategy-equity">
      <div className="strategy-chart-legend">
        <button aria-pressed={!drawdown} onClick={() => setDrawdown(false)}>
          Equity
        </button>
        <button aria-pressed={drawdown} onClick={() => setDrawdown(true)}>
          Drawdown
        </button>
        {!drawdown ? (
          <label>
            <input
              type="checkbox"
              checked={benchmark}
              onChange={(e) => setBenchmark(e.target.checked)}
            />
            Buy &amp; hold from first open
          </label>
        ) : (
          <span>Bar-close drawdown</span>
        )}
        <span className="flex-1" />
        <strong>
          {num(drawdown ? selected.drawdown : selected.equity)} {currency}
        </strong>
        <span>{date(selected.time)} UTC</span>
      </div>
      <svg
        role="img"
        aria-label={
          drawdown
            ? "Strategy bar-close drawdown curve"
            : "Strategy equity curve"
        }
        viewBox="0 0 1000 180"
        preserveAspectRatio="none"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect(),
            x = ((e.clientX - r.left) / r.width) * 1000;
          setHover(
            Math.max(
              0,
              Math.min(
                points.length - 1,
                Math.round(((x - 74) / 916) * (points.length - 1)),
              ),
            ),
          );
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 1, 2, 3].map((i) => {
          const value = geometry.min + ((geometry.max - geometry.min) * i) / 3,
            y = geometry.y(value);
          return (
            <g key={i}>
              <line
                x1="74"
                x2="990"
                y1={y}
                y2={y}
                className="strategy-gridline"
              />
              <text x="67" y={y + 3} textAnchor="end">
                {num(value, 0)}
              </text>
            </g>
          );
        })}
        <path
          d={geometry.main}
          fill="none"
          stroke={drawdown ? "#f23645" : "#2962ff"}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        {benchmark && !drawdown ? (
          <path
            d={geometry.benchmark}
            fill="none"
            stroke="#f5a623"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {hover !== null ? (
          <line
            x1={geometry.x(hover)}
            x2={geometry.x(hover)}
            y1="10"
            y2="158"
            stroke="currentColor"
            opacity="0.4"
            strokeDasharray="3 3"
          />
        ) : null}
        <text x="74" y="176">
          {date(points[0].time).slice(0, 16)}
        </text>
        <text x="990" y="176" textAnchor="end">
          {date(points.at(-1)!.time).slice(0, 16)}
        </text>
      </svg>
    </div>
  );
}
function Performance({ report: r }: { report: StrategyReport }) {
  const rows: [string, keyof TradeStatistics, boolean?][] = [
    ["Closed net profit", "netProfit", true],
    ["Gross profit", "grossProfit", true],
    ["Gross loss", "grossLoss", true],
    ["Total closed trades", "count"],
    ["Winning trades", "wins"],
    ["Losing trades", "losses"],
    ["Breakeven trades", "even"],
    ["Percent profitable", "winRate"],
    ["Profit factor", "profitFactor"],
    ["Average trade", "averageTrade", true],
    ["Average winning trade", "averageWin", true],
    ["Average losing trade", "averageLoss", true],
    ["Largest winning trade", "largestWin", true],
    ["Largest losing trade", "largestLoss", true],
    ["Average bars in trade", "averageBars"],
    ["Commission on closed trades", "commission", true],
  ];
  return (
    <div className="strategy-table-scroll">
      <table className="strategy-table performance-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>All</th>
            <th>Long</th>
            <th>Short</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, key, money]) => (
            <tr key={key}>
              <td>
                {label}
                {money
                  ? ` · ${strategyCurrency(r.market)}`
                  : key === "winRate"
                    ? " · %"
                    : ""}
              </td>
              {[r.all, r.long, r.short].map((s, i) => (
                <td key={i}>
                  {num(
                    s[key],
                    ["count", "wins", "losses", "even"].includes(key) ? 0 : 2,
                  )}
                </td>
              ))}
            </tr>
          ))}
          {[
            ["Equity", r.equity],
            ["Open P&L", r.openProfit],
            ["Runtime net P&L including open entry fees", r.netProfit],
            ["Maximum intrabar equity drawdown", r.maxDrawdown],
            ["Buy & hold P&L from first bar open", r.buyHoldProfit],
            ["Sharpe ratio · runtime monthly returns", r.sharpe],
            ["Sortino ratio · runtime monthly returns", r.sortino],
          ].map(([label, value]) => (
            <tr key={String(label)}>
              <td>{String(label)}</td>
              <td>{num(value as number | null)}</td>
              <td>—</td>
              <td>—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ReportProperties({ report: r }: { report: StrategyReport }) {
  const s = r.document.settings;
  return (
    <div className="strategy-properties-report">
      <dl>
        {Object.entries({
          Symbol: `${describeSymbol(r.market.symbol).feed.toUpperCase().replace(" ", "")}:${symbolLabel(r.market.symbol)}`,
          Timeframe: r.market.timeframe,
          "Data source": r.source,
          "Initial capital": `${s.capital} ${strategyCurrency(r.market)}`,
          "Accounting currency": strategyCurrency(r.market),
          "Contract point value": r.market.pointValue ?? 1,
          "Tick rule": r.market.tickSource ?? "exchange",
          "Quantity step": `${r.market.quantityStep} (${r.market.quantitySource ?? "exchange"})`,
          Timezone: r.market.timezone ?? "Etc/UTC",
          "Order size": `${s.quantity} (${s.quantityType})`,
          Commission: `${s.commission} (${s.commissionType})`,
          Slippage: `${s.slippage} ticks · tick = ${r.market.tickSize}`,
          Pyramiding: s.pyramiding,
          "Margin long / short": `${s.marginLong}% / ${s.marginShort}%`,
          "Order execution": s.fillOnClose
            ? "Same closing tick"
            : "Next available tick",
          "Price model": "Standard exchange OHLCV",
          "Bar magnifier": r.magnifier?.enabled ? `On · ${r.magnifier.timeframe} OHLC paths` : "Off · four-price historical path",
          ...(r.magnifier?.enabled ? {
            "Intrabar source candles": r.magnifier.sourceBars,
            "Magnifier coverage": `${r.magnifier.coveredBars} / ${r.barCount} chart candles`,
            "Parent OHLC fallback": `${r.magnifier.fallbackBars} (${r.magnifier.incompleteBars} incomplete, ${r.magnifier.mismatchedBars} mismatched)`,
            "First magnified bar · UTC": r.magnifier.firstCoveredTime === null ? "None" : date(r.magnifier.firstCoveredTime),
            "Last magnified bar · UTC": r.magnifier.lastCoveredTime === null ? "None" : date(r.magnifier.lastCoveredTime),
          } : {}),
          "Completed candles": r.barCount,
          "First bar · UTC": date(r.firstTime),
          "Last bar · UTC": date(r.lastTime),
          Runtime: `${r.completedAt - r.startedAt} ms`,
          "Input overrides": JSON.stringify(r.document.inputs),
        }).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p>
        Calculations use the selected historical window, including indicator
        warm-up. Open positions remain marked to the last completed close.
        Historical order fills are hypothetical broker-emulator results. Market,
        stop, limit and stop-limit behavior is supplied by the installed PineTS
        runtime.
      </p>
    </div>
  );
}
function StrategyProperties({
  value,
  onClose,
  onSave,
}: {
  value: StrategySettings;
  onClose: () => void;
  onSave: (v: StrategySettings) => void;
}) {
  const [s, set] = useState({ ...value }),
    [error, setError] = useState("");
  const chartSymbol = useChartStore((state) => state.symbol);
  const number = (
    key: keyof StrategySettings,
    label: string,
    min: number,
    max: number,
    step: string | number = "any",
  ) => (
    <label>
      <span>{label}</span>
      <input
        type="number"
        value={String(s[key] ?? 0)}
        min={min}
        max={max}
        step={step}
        onChange={(e) => set({ ...s, [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <Modal
      title="Strategy properties"
      onClose={onClose}
      className="strategy-settings-modal"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            validateStrategySettings(s);
            onSave(s);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        <div className="strategy-inputs">
          <h3>Capital and order execution</h3>
          {number(
            "capital",
            `Initial capital · ${providerOf(chartSymbol) === "hyperliquid" ? "USDC" : describeSymbol(chartSymbol).quote || "quote currency"}`,
            1,
            1e12,
          )}
          <label>
            <span>Order size type</span>
            <select
              value={s.quantityType}
              onChange={(e) =>
                set({
                  ...s,
                  quantityType: e.target
                    .value as StrategySettings["quantityType"],
                })
              }
            >
              <option value="percent_of_equity">% of equity</option>
              <option value="fixed">Base asset units</option>
              <option value="cash">Cash · quote currency</option>
            </select>
          </label>
          {number("quantity", "Order size", 0.00000001, 1e12)}
          <label>
            <span>Commission type</span>
            <select
              value={s.commissionType}
              onChange={(e) =>
                set({
                  ...s,
                  commissionType: e.target
                    .value as StrategySettings["commissionType"],
                })
              }
            >
              <option value="percent">Percent</option>
              <option value="cash_per_order">Quote currency per order</option>
              <option value="cash_per_contract">
                Quote currency per contract
              </option>
            </select>
          </label>
          {number(
            "commission",
            "Commission",
            0,
            s.commissionType === "percent" ? 100 : 1e12,
          )}
          {number("slippage", "Slippage · ticks", 0, 100000, 1)}
          {number("pyramiding", "Pyramiding", 0, 100, 1)}
          {number("marginLong", "Margin long · %", 0, 100)}
          {number("marginShort", "Margin short · %", 0, 100)}
          {number("tickSize", "Tick size override · 0 = provider", 0, 1e12)}
          {number(
            "quantityStep",
            "Quantity step override · 0 = provider",
            0,
            1e12,
          )}
          {number(
            "pointValue",
            "Contract point value · 0 = automatic",
            0,
            1e12,
          )}
          <label>
            <span>Include extended market hours</span>
            <input
              type="checkbox"
              checked={s.extended ?? false}
              onChange={(e) => set({ ...s, extended: e.target.checked })}
            />
          </label>
          <label>
            <span>Dividend-adjusted prices · Yahoo</span>
            <input
              type="checkbox"
              checked={s.adjustDividends ?? false}
              onChange={(e) => set({ ...s, adjustDividends: e.target.checked })}
            />
          </label>
          <label>
            <span>Fill orders on closing tick</span>
            <input
              type="checkbox"
              checked={s.fillOnClose}
              onChange={(e) => set({ ...s, fillOnClose: e.target.checked })}
            />
          </label>
          <h3>Historical test window</h3>
          <label>
            <span>Use bar magnifier</span>
            <input type="checkbox" checked={s.useBarMagnifier ?? false}
              onChange={(e) => set({ ...s, useBarMagnifier: e.target.checked })} />
          </label>
          {s.useBarMagnifier ? <label>
            <span>Intrabar interval</span>
            <input aria-label="Intrabar interval" value={s.intrabarInterval ?? "auto"}
              onChange={(e) => set({ ...s, intrabarInterval: e.target.value })} />
            <small>auto, or a finer divisor such as 1m or 10s. Up to 200,000 source candles; exchange history required.</small>
          </label> : null}
          <label>
            <span>Price data</span>
            <select
              value={s.source}
              onChange={(e) =>
                set({
                  ...s,
                  source: e.target.value as StrategySettings["source"],
                })
              }
            >
              <option value="exchange">
                {describeSymbol(chartSymbol).feed} exchange history
              </option>
              <option value="simulation">Synthetic simulation</option>
            </select>
          </label>
          {number("bars", "Maximum bars", 100, 20000, 1)}
          <label>
            <span>Start · UTC (optional)</span>
            <input
              type="datetime-local"
              value={s.from}
              onChange={(e) => set({ ...s, from: e.target.value })}
            />
          </label>
          <label>
            <span>End · UTC (exclusive)</span>
            <input
              type="datetime-local"
              value={s.to}
              onChange={(e) => set({ ...s, to: e.target.value })}
            />
          </label>
          <p>
            Only completed standard OHLCV bars are used. Fees apply on entry and
            exit. Property values override the script declaration. The bar magnifier uses verified lower-candle coverage;
            incomplete or mismatched bars use the parent OHLC path and are counted in the report. No live orders are sent.
          </p>
          {error ? (
            <p className="negative" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="strategy-modal-footer">
          <button type="button" className="button small" onClick={onClose}>
            Cancel
          </button>
          <span className="flex-1" />
          <button className="button primary small" type="submit">
            Apply properties
          </button>
        </div>
      </form>
    </Modal>
  );
}
