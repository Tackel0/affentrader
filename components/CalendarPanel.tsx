"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  DividendEvent,
  EarningsEvent,
  EconomicEvent,
  Impact,
  YieldCurve,
} from "@/lib/server/feeds";
import type { GlobalMacroPulse } from "@/lib/server/macroAndSentimentSources";
import { useChartStore } from "@/stores/useChartStore";

async function feed<T>(query: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/feeds?${query}`, { signal });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Feed unavailable");
  return body as T;
}

function useFeed<T>(query: string): { data: T | null; error: string; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: "", loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: "" }));
    feed<T>(query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, error: "", loading: false });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false });
      });
    return () => {
      controller.abort();
    };
  }, [query]);
  return state;
}

const IMPACT_COLOR: Record<Impact, string> = { high: "#f23645", medium: "#ff9800", low: "#fdd835", holiday: "#787b86" };

export function countdown(time: number, now = Date.now()): string {
  const diff = time - now;
  if (diff <= 0) return "released";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `in ${hours} h ${minutes % 60} min` : `in ${Math.floor(hours / 24)} d`;
}

function EconomicView() {
  const [week, setWeek] = useState<"this" | "next">("this");
  const [impact, setImpact] = useState<Impact | "all">("all");
  const [country, setCountry] = useState("all");
  const { data, error, loading } = useFeed<{ events: EconomicEvent[] }>(`kind=economic&week=${week}`);
  const events = data?.events ?? [];
  const countries = useMemo(() => [...new Set(events.map((e) => e.country))].sort(), [events]);
  const shown = events.filter((e) => (impact === "all" || e.impact === impact) && (country === "all" || e.country === country));
  const days = new Map<string, EconomicEvent[]>();
  for (const e of shown) {
    const day = new Date(e.time).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  return (
    <div className="calendar-view">
      <div className="screener-toolbar">
        <div className="segmented">
          <button className={week === "this" ? "active" : ""} onClick={() => setWeek("this")}>This week</button>
          <button className={week === "next" ? "active" : ""} onClick={() => setWeek("next")}>Next week</button>
        </div>
        <label>
          Impact
          <select value={impact} onChange={(e) => setImpact(e.target.value as Impact | "all")}>
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="holiday">Holidays</option>
          </select>
        </label>
        <label>
          Currency
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="all">All</option>
            {countries.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <span className="terminal-telemetry-chip mono">
          {loading ? "SYNCING ECONOMIC…" : `${shown.length} EVENTS · LOCAL TZ`}
        </span>
      </div>
      {error ? <p className="error-message screener-error">{error}</p> : null}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th />
              <th>Cur.</th>
              <th>Event</th>
              <th>Actual</th>
              <th>Forecast</th>
              <th>Previous</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...days].map(([day, rows]) => [
              <tr key={day} className="day-row">
                <td colSpan={8}>{day}</td>
              </tr>,
              ...rows.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{new Date(e.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                  <td>
                    <i className="impact-dot" style={{ background: IMPACT_COLOR[e.impact] }} title={`${e.impact} impact`} />
                  </td>
                  <td className="mono">{e.country}</td>
                  <td>{e.title}</td>
                  <td className="mono">{e.actual || "—"}</td>
                  <td className="mono">{e.forecast || "—"}</td>
                  <td className="mono">{e.previous || "—"}</td>
                  <td className="muted mono">{countdown(e.time)}</td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
        {loading && !events.length ? <div className="empty-table">Loading economic calendar…</div> : null}
        {!shown.length && !loading && !error ? <div className="empty-table">No events match.</div> : null}
      </div>
    </div>
  );
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function CorporateView({ kind }: { kind: "earnings" | "dividends" }) {
  const [date, setDate] = useState(isoDay(new Date()));
  const { data, error, loading } = useFeed<{ events: (EarningsEvent & DividendEvent)[] }>(`kind=${kind}&date=${date}`);
  const move = (days: number) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    setDate(isoDay(d));
  };
  const events = data?.events ?? [];
  return (
    <div className="calendar-view">
      <div className="screener-toolbar">
        <button className="icon-button" aria-label="Previous day" onClick={() => move(-1)}>
          <ChevronLeft size={16} />
        </button>
        <input type="date" aria-label="Date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="icon-button" aria-label="Next day" onClick={() => move(1)}>
          <ChevronRight size={16} />
        </button>
        <button className="button small" onClick={() => setDate(isoDay(new Date()))}>
          Today
        </button>
        <span className="terminal-telemetry-chip mono">
          {loading ? `SYNCING ${kind.toUpperCase()}…` : `${events.length} ${kind.toUpperCase()} · NASDAQ FEED`}
        </span>
      </div>
      {error ? <p className="error-message screener-error">{error}</p> : null}
      <div className="table-scroll">
        {kind === "earnings" ? (
          <table className="data-table">
            <thead>
              <tr><th>Symbol</th><th>Company</th><th>Session</th><th>EPS Est.</th><th>Prior EPS</th><th>MCap</th><th>Quarter</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.symbol}>
                  <td className="mono"><strong>{e.symbol}</strong></td>
                  <td>{e.name}</td>
                  <td className="mono">{e.time}</td>
                  <td className="mono">{e.epsForecast || "—"}</td>
                  <td className="mono">{e.lastYearEps || "—"}</td>
                  <td className="mono">{e.marketCap || "—"}</td>
                  <td className="mono">{e.fiscalQuarter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Symbol</th><th>Company</th><th>Ex-Date</th><th>Pay Date</th><th>Amount</th><th>Annual</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.symbol}>
                  <td className="mono"><strong>{e.symbol}</strong></td>
                  <td>{e.name}</td>
                  <td className="mono">{e.exDate}</td>
                  <td className="mono">{e.payment}</td>
                  <td className="mono">${e.amount.toFixed(4)}</td>
                  <td className="mono">{e.yield}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {loading && !events.length ? <div className="empty-table">Loading {kind} schedule…</div> : null}
        {!events.length && !loading && !error ? <div className="empty-table">Nothing scheduled for this date.</div> : null}
      </div>
    </div>
  );
}

export function YieldChart({ curve, previous }: { curve: YieldCurve; previous?: YieldCurve }) {
  const labels = Object.keys(curve.values);
  const points = labels.map((l, i) => ({ label: l, value: curve.values[l], previous: previous?.values[l] ?? null, i }));
  const values = points.flatMap((p) => [p.value, p.previous]).filter((v): v is number => v !== null);
  if (!values.length) return null;
  const min = Math.min(...values) - 0.1;
  const max = Math.max(...values) + 0.1;
  const width = 560;
  const height = 150;
  const x = (i: number) => 30 + (i / (labels.length - 1)) * (width - 50);
  const y = (v: number) => height - 22 - ((v - min) / (max - min)) * (height - 40);
  const path = (key: "value" | "previous") =>
    points
      .filter((p) => p[key] !== null)
      .map((p, i) => `${i ? "L" : "M"}${x(p.i).toFixed(1)},${y(p[key]!).toFixed(1)}`)
      .join(" ");
  return (
    <svg className="yield-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Treasury yield curve">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={30} x2={width - 20} y1={y(min + (max - min) * t)} y2={y(min + (max - min) * t)} stroke="currentColor" strokeOpacity={0.12} />
          <text x={2} y={y(min + (max - min) * t) + 3} fontSize={9} fill="currentColor" opacity={0.6} style={{ fontFamily: "var(--font-mono, monospace)" }}>
            {(min + (max - min) * t).toFixed(2)}
          </text>
        </g>
      ))}
      {previous ? <path d={path("previous")} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeDasharray="4 3" /> : null}
      <path d={path("value")} fill="none" stroke="var(--cyan, #00e5ff)" strokeWidth={1.75} />
      {points.map((p) => (
        <g key={p.label}>
          {p.value !== null ? <circle cx={x(p.i)} cy={y(p.value)} r={2.5} fill="var(--cyan, #00e5ff)" /> : null}
          <text x={x(p.i)} y={height - 6} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.7} style={{ fontFamily: "var(--font-mono, monospace)" }}>
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function YieldsView() {
  const { data, error, loading } = useFeed<{ curves: YieldCurve[] }>("kind=yields");
  const curves = data?.curves ?? [];
  const latest = curves.at(-1);
  const previous = curves.at(-2);
  const week = curves.at(-6);
  const spread = (c?: YieldCurve) => (c?.values["10Y"] != null && c.values["2Y"] != null ? c.values["10Y"] - c.values["2Y"] : null);
  const s = spread(latest);
  return (
    <div className="calendar-view yields">
      <div className="screener-toolbar">
        <span className="terminal-telemetry-chip mono">
          {loading ? "SYNCING TREASURY CURVE…" : latest ? `US TREASURY PAR CURVE · ${latest.date} · TREASURY.GOV` : "US TREASURY CURVE"}
        </span>
      </div>
      {error ? <p className="error-message screener-error">{error}</p> : null}
      {loading && !latest ? <div className="empty-table">Loading US Treasury yield curve…</div> : null}
      {!loading && !latest && !error ? <div className="empty-table">No yield curve snapshots available.</div> : null}
      {latest ? (
        <div className="yields-body">
          <div style={{ minWidth: 0 }}>
            <YieldChart curve={latest} previous={previous} />
            <p className="muted mono" style={{ margin: "4px 0 8px", fontSize: 10 }}>Solid: latest · dashed: prior session</p>
            <div className="metrics-grid">
              <div className="metric">
                <span>10Y − 2Y Spread</span>
                <strong className={`mono ${s !== null && s < 0 ? "negative" : "positive"}`}>
                  {s === null ? "—" : `${s >= 0 ? "+" : ""}${(s * 100).toFixed(0)} bp`}
                </strong>
              </div>
              <div className="metric">
                <span>Curve Shape</span>
                <strong className="mono">{s === null ? "—" : s < 0 ? "Inverted" : s < 0.25 ? "Flat" : "Normal"}</strong>
              </div>
            </div>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>Tenor</th><th>Yield %</th><th>1D</th><th>1W</th></tr>
              </thead>
              <tbody>
                {Object.keys(latest.values).map((tenor) => {
                  const v = latest.values[tenor];
                  const d1 = v !== null && previous?.values[tenor] != null ? (v - previous.values[tenor]!) * 100 : null;
                  const d5 = v !== null && week?.values[tenor] != null ? (v - week.values[tenor]!) * 100 : null;
                  const tone = (n: number | null) => (n === null ? "" : n > 0 ? "positive" : n < 0 ? "negative" : "");
                  return (
                    <tr key={tenor}>
                      <td className="mono">{tenor}</td>
                      <td className="mono">{v === null ? "—" : v.toFixed(2)}</td>
                      <td className={`mono ${tone(d1)}`}>{d1 === null ? "—" : `${d1 >= 0 ? "+" : ""}${d1.toFixed(0)} bp`}</td>
                      <td className={`mono ${tone(d5)}`}>{d5 === null ? "—" : `${d5 >= 0 ? "+" : ""}${d5.toFixed(0)} bp`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MacroSentimentView() {
  const { data, error, loading } = useFeed<GlobalMacroPulse>("kind=macro");
  return (
    <div className="calendar-view">
      <div className="screener-toolbar">
        <span className="terminal-telemetry-chip mono">
          {loading ? "SYNCING MACRO PULSE…" : "FRED MACRO · FEAR & GREED · CROSS-ASSET"}
        </span>
      </div>
      {error ? <p className="error-message screener-error">{error}</p> : null}
      {loading && !data ? <div className="empty-table">Loading FRED macro &amp; cross-asset pulse…</div> : null}
      {!loading && !data && !error ? <div className="empty-table">Macro feed unavailable.</div> : null}
      {data?.fearGreed ? (
        <div className="metrics-grid" style={{ marginBottom: 8 }}>
          <div className="metric">
            <span>Crypto Fear &amp; Greed</span>
            <strong className={`mono ${data.fearGreed.value >= 55 ? "positive" : data.fearGreed.value <= 35 ? "negative" : ""}`}>
              {data.fearGreed.value}/100 ({data.fearGreed.classification})
            </strong>
          </div>
          {data.fred.map((pt) => (
            <div className="metric" key={pt.id}>
              <span>{pt.label} ({pt.date})</span>
              <strong className="mono">
                {pt.unit === "$" ? `$${pt.value.toFixed(2)}` : `${pt.value.toFixed(2)} ${pt.unit}`}
              </strong>
            </div>
          ))}
        </div>
      ) : null}
      {data?.crossAssets?.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Asset</th><th>Symbol</th><th>Last</th><th>1D %</th><th /></tr>
            </thead>
            <tbody>
              {data.crossAssets.map((a) => (
                <tr key={a.symbol}>
                  <td>{a.label}</td>
                  <td className="mono">{a.symbol.replace(/^YF:/, "")}</td>
                  <td className="mono">{a.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                  <td className={`mono ${a.changePct >= 0 ? "positive" : "negative"}`}>
                    {a.changePct >= 0 ? "+" : ""}{a.changePct.toFixed(2)}%
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button small"
                      onClick={() => useChartStore.getState().set({ symbol: a.symbol, timeframe: "1D" })}
                    >
                      Chart
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function CalendarPanel() {
  const [tab, setTab] = useState<"economic" | "earnings" | "dividends" | "yields" | "macro">("economic");
  return (
    <div className="screener-panel">
      <div className="panel-tabs">
        {(
          [
            ["economic", "Economic"],
            ["earnings", "Earnings"],
            ["dividends", "Dividends"],
            ["yields", "Treasury yields"],
            ["macro", "FRED & Macro"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "economic" ? <EconomicView /> : tab === "earnings" ? <CorporateView kind="earnings" /> : tab === "dividends" ? <CorporateView kind="dividends" /> : tab === "yields" ? <YieldsView /> : <MacroSentimentView />}
    </div>
  );
}
