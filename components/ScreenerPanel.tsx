"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Play, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useScreenerStore } from "@/stores/useScreenerStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import {
  applyFilters,
  BUILT_IN_PRESETS,
  SCREENER_FIELDS,
  type FilterOp,
  type ScreenerFilter,
  type ScreenerRow,
} from "@/lib/screener/technical";
import { passesPineFilters, type PineFilter, type PineScreenRow } from "@/lib/screener/pine";
import type { PineScreenResponse } from "@/workers/pinescreener.worker";
import { marketService } from "@/lib/market/service";
import { csvEscape } from "@/lib/watchlist";
import { downloadFile } from "@/lib/files";
import { formatPrice, formatVolume, getSymbol } from "@/lib/symbols";
import { QUICK_INTERVALS, isTickInterval } from "@/lib/market/intervals";
import { STARTER_SCRIPT } from "@/lib/indicators/scripts";
import { STOCK_UNIVERSE_IDS } from "@/lib/stockUniverse";
import { STOCK_EXCHANGES } from "@/lib/markets";
import { AssetBadge } from "./ui";
import { StockBaseScanner } from "./StockBaseScanner";
import { OpportunitiesHub } from "./OpportunitiesHub";

interface ScreenerResponse {
  rows: ScreenerRow[];
  timeframe: string | null;
  universe: number;
  generatedAt: number;
  failed: string[];
  error?: string;
}

async function loadScreener(timeframe: string | null, limit: number, market = "binance", signal?: AbortSignal): Promise<ScreenerResponse> {
  const params = new URLSearchParams({ limit: String(limit), market });
  if (timeframe) params.set("timeframe", timeframe);
  const response = await fetch(`/api/screener?${params}`, { signal });
  const body = (await response.json()) as ScreenerResponse;
  if (!response.ok) throw new Error(body.error ?? "Screener unavailable");
  return body;
}

const fieldOf = (key: string) => SCREENER_FIELDS.find((f) => f.key === key);
const openSymbol = (symbol: string) => useChartStore.getState().set({ symbol });
const toneClass = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "" : v > 0 ? "positive" : v < 0 ? "negative" : "");

function format(key: string, value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (key === "price") return formatPrice(value);
  if (key === "quoteVolume" || key === "volume") return formatVolume(value);
  const digits = fieldOf(key)?.digits ?? 2;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: Math.min(digits, 2) });
}

function RatingCell({ row }: { row: ScreenerRow }) {
  if (row.rating === undefined) return <span>—</span>;
  const label = row.ratingLabel ?? "";
  return <span className={`rating ${row.rating > 0.1 ? "positive" : row.rating < -0.1 ? "negative" : ""}`}>{label}</span>;
}

function ScreenerView() {
  const s = useScreenerStore();
  const watch = useWatchlistStore();
  const [data, setData] = useState<ScreenerResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "quoteVolume", dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const controller = useRef<AbortController | null>(null);
  const run = useCallback(() => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError("");
    loadScreener(s.timeframe === "quotes" ? null : s.timeframe, s.limit, s.market, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
  }, [s.timeframe, s.limit, s.market]);
  useEffect(() => {
    run();
    return () => controller.current?.abort();
  }, [run]);
  const rows = useMemo(() => {
    const filtered = applyFilters(data?.rows ?? [], s.filters);
    return [...filtered].sort((a, b) => {
      const av = a[sort.key as keyof ScreenerRow];
      const bv = b[sort.key as keyof ScreenerRow];
      if (sort.key === "symbol") return sort.dir * a.symbol.localeCompare(b.symbol);
      if (typeof av !== "number" || !Number.isFinite(av)) return 1;
      if (typeof bv !== "number" || !Number.isFinite(bv)) return -1;
      return sort.dir * (av - bv);
    });
  }, [data, s.filters, sort]);
  const technical = s.timeframe !== "quotes";
  const available = SCREENER_FIELDS.filter((f) => technical || !f.technical);
  const columns = s.columns.filter((c) => available.some((f) => f.key === c) || c === "rating");
  const setFilter = (id: string, patch: Partial<ScreenerFilter>) =>
    s.set({ filters: s.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const exportCsv = () => {
    const keys = ["symbol", ...columns, ...(columns.includes("rating") ? [] : [])];
    const lines = [keys.join(",")];
    for (const row of rows)
      lines.push(keys.map((k) => csvEscape(k === "symbol" ? row.symbol : (row[k as keyof ScreenerRow] as string | number | undefined) ?? "")).join(","));
    downloadFile("screener.csv", lines.join("\r\n"), "text/csv");
  };
  return (
    <div className="screener-view">
      <div className="screener-toolbar">
        <label>
          Market
          <select aria-label="Screener market" value={s.market} onChange={(e) => s.set({ market: e.target.value })}>
            <optgroup label="Crypto and futures">
              <option value="binance">Crypto · Binance spot</option>
              <option value="hyperliquid">Crypto · Hyperliquid perps</option>
              <option value="hyperliquid-markets">Stocks & commodities · Hyperliquid</option>
            </optgroup>
            <optgroup label="Stocks · Yahoo Finance (delayed)">
              {STOCK_UNIVERSE_IDS.map((id) => (
                <option key={id} value={`stocks:${id}`}>
                  {STOCK_EXCHANGES.find((e) => e.id === id)?.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          Interval
          <select value={s.timeframe} onChange={(e) => s.set({ timeframe: e.target.value })}>
            <option value="quotes">24h quotes only</option>
            {QUICK_INTERVALS.filter((i) => !isTickInterval(i) && !i.endsWith("s")).map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label>
          Universe
          <select value={s.limit} onChange={(e) => s.set({ limit: Number(e.target.value) })}>
            {[40, 80, 150].map((n) => (
              <option key={n} value={n}>
                Top {n} by turnover
              </option>
            ))}
          </select>
        </label>
        <label>
          Preset
          <select
            value=""
            onChange={(e) => {
              const preset = [...BUILT_IN_PRESETS, ...s.presets].find((p) => p.id === e.target.value);
              if (preset)
                s.set({
                  timeframe: preset.timeframe,
                  filters: preset.filters.map((f) => ({ ...f, id: crypto.randomUUID() })),
                });
            }}
          >
            <option value="">Load preset…</option>
            {BUILT_IN_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {s.presets.map((p) => (
              <option key={p.id} value={p.id}>
                ★ {p.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button small" onClick={run} disabled={loading}>
          <RefreshCw size={12} className={loading ? "spin" : ""} /> {loading ? "Scanning…" : "Refresh"}
        </button>
        <button
          className="button small"
          onClick={() => {
            const name = window.prompt("Preset name", "My screen");
            if (name) s.savePreset(name);
          }}
        >
          <Save size={12} /> Save preset
        </button>
        <button className="button small" disabled={!rows.length} onClick={exportCsv}>
          <Download size={12} /> CSV
        </button>
        <span className="flex-1" />
        <span className="screener-count">
          {rows.length} of {data?.universe ?? 0}
          {data?.failed.length ? ` · ${data.failed.length} without candles` : ""}
        </span>
      </div>
      <div className="filter-rows">
        {s.filters.map((f) => (
          <div className="filter-row" key={f.id}>
            <select
              aria-label="Filter field"
              value={String(f.field)}
              onChange={(e) => setFilter(f.id, { field: e.target.value as keyof ScreenerRow })}
            >
              {available.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
            <select aria-label="Operator" value={f.op} onChange={(e) => setFilter(f.id, { op: e.target.value as FilterOp })}>
              {[">", "<", ">=", "<=", "=", "between"].map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
            <input aria-label="Value" type="number" step="any" value={f.value} onChange={(e) => setFilter(f.id, { value: Number(e.target.value) })} />
            {f.op === "between" ? (
              <input aria-label="Upper value" type="number" step="any" value={f.value2 ?? f.value} onChange={(e) => setFilter(f.id, { value2: Number(e.target.value) })} />
            ) : null}
            <button className="icon-button" aria-label="Remove filter" onClick={() => s.set({ filters: s.filters.filter((x) => x.id !== f.id) })}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          className="button small"
          onClick={() => s.set({ filters: [...s.filters, { id: crypto.randomUUID(), field: technical ? "rsi" : "change24h", op: ">", value: 0 }] })}
        >
          <Plus size={12} /> Add filter
        </button>
        <details className="column-picker">
          <summary>Columns</summary>
          <div>
            {available.map((f) => (
              <label key={f.key}>
                <input
                  type="checkbox"
                  checked={s.columns.includes(String(f.key))}
                  onChange={(e) =>
                    s.set({
                      columns: e.target.checked ? [...s.columns, String(f.key)] : s.columns.filter((c) => c !== f.key),
                    })
                  }
                />
                {f.label}
              </label>
            ))}
          </div>
        </details>
        {s.presets.length ? (
          <span className="preset-chips">
            {s.presets.map((p) => (
              <button key={p.id} className="chip" title="Delete preset" onClick={() => s.removePreset(p.id)}>
                ★ {p.name} ×
              </button>
            ))}
          </span>
        ) : null}
      </div>
      {selected.size ? (
        <div className="selection-bar">
          <strong>{selected.size} selected</strong>
          <button
            className="link-button"
            onClick={() => {
              const added = watch.addSymbols([...selected]);
              useChartStore.getState().toast("Added to watchlist", `${added} new symbols`, "success");
              setSelected(new Set());
            }}
          >
            Add to watchlist
          </button>
          <button className="link-button" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : null}
      {error ? <p className="error-message screener-error">{error}</p> : null}
      <div className="table-scroll">
        <table className="data-table screener-table">
          <thead>
            <tr>
              <th />
              <th onClick={() => setSort({ key: "symbol", dir: sort.key === "symbol" ? (-sort.dir as 1 | -1) : 1 })}>Symbol</th>
              {columns.map((c) => (
                <th key={c} onClick={() => setSort({ key: c, dir: sort.key === c ? (-sort.dir as 1 | -1) : -1 })}>
                  {fieldOf(c)?.label ?? c}
                  {sort.key === c ? (sort.dir === -1 ? " ▼" : " ▲") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.symbol}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.symbol}`}
                    checked={selected.has(row.symbol)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(row.symbol);
                      else next.delete(row.symbol);
                      setSelected(next);
                    }}
                  />
                </td>
                <td>
                  <button className="link-button" onClick={() => openSymbol(row.symbol)}>
                    <AssetBadge symbol={row.symbol} /> {getSymbol(row.symbol).base}
                  </button>
                </td>
                {columns.map((c) =>
                  c === "rating" ? (
                    <td key={c}>
                      <RatingCell row={row} />
                    </td>
                  ) : (
                    <td key={c} className={`mono ${["change24h", "change1", "change5", "change20", "ema20", "ema50", "ema200", "macdPercent"].includes(c) ? toneClass(row[c as keyof ScreenerRow] as number) : ""}`}>
                      {format(c, row[c as keyof ScreenerRow])}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !loading ? <div className="empty-table">No symbols match these filters.</div> : null}
      </div>
    </div>
  );
}

function HotlistView() {
  const [data, setData] = useState<ScreenerResponse | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () =>
      loadScreener(null, 150)
        .then((r) => alive && setData(r))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const rows = data?.rows ?? [];
  const lists: { title: string; sort: (a: ScreenerRow, b: ScreenerRow) => number; value: (r: ScreenerRow) => string; tone?: (r: ScreenerRow) => number }[] = [
    { title: "Top gainers", sort: (a, b) => b.change24h - a.change24h, value: (r) => `${r.change24h >= 0 ? "+" : ""}${r.change24h.toFixed(2)}%`, tone: (r) => r.change24h },
    { title: "Top losers", sort: (a, b) => a.change24h - b.change24h, value: (r) => `${r.change24h.toFixed(2)}%`, tone: (r) => r.change24h },
    { title: "Most active", sort: (a, b) => b.quoteVolume - a.quoteVolume, value: (r) => `${formatVolume(r.quoteVolume)} USDT` },
    { title: "Most volatile", sort: (a, b) => (b.high24h - b.low24h) / b.price - (a.high24h - a.low24h) / a.price, value: (r) => `${(((r.high24h - r.low24h) / r.price) * 100).toFixed(1)}% range` },
    { title: "Near 24h high", sort: (a, b) => b.rangePosition - a.rangePosition, value: (r) => `${r.rangePosition.toFixed(0)}% of range` },
    { title: "Near 24h low", sort: (a, b) => a.rangePosition - b.rangePosition, value: (r) => `${r.rangePosition.toFixed(0)}% of range` },
    { title: "Most trades", sort: (a, b) => b.trades - a.trades, value: (r) => `${formatVolume(r.trades)} trades` },
  ];
  return (
    <div className="hotlists">
      {error ? <p className="error-message screener-error">{error}</p> : null}
      {lists.map((list) => (
        <section key={list.title}>
          <h4>{list.title}</h4>
          {[...rows]
            .sort(list.sort)
            .slice(0, 10)
            .map((row) => (
              <button key={row.symbol} onClick={() => openSymbol(row.symbol)}>
                <AssetBadge symbol={row.symbol} />
                <span>{getSymbol(row.symbol).base}</span>
                <span className="mono">{formatPrice(row.price)}</span>
                <span className={`mono ${list.tone ? toneClass(list.tone(row)) : ""}`}>{list.value(row)}</span>
              </button>
            ))}
        </section>
      ))}
      {!rows.length && !error ? <div className="empty-table">Loading market lists…</div> : null}
    </div>
  );
}

function PineScreenerView() {
  const draft = useChartStore((s) => s.pineDraft);
  const libraries = useChartStore((s) => s.pineLibraries);
  const lists = useWatchlistStore((s) => s.lists);
  const [source, setSource] = useState(draft?.source ?? STARTER_SCRIPT);
  const [universe, setUniverse] = useState("top40");
  const [timeframe, setTimeframe] = useState("1h");
  const [rows, setRows] = useState<PineScreenRow[]>([]);
  const [filters, setFilters] = useState<PineFilter[]>([]);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const worker = useRef<Worker | null>(null);
  const cancel = useRef(false);
  useEffect(
    () => () => {
      cancel.current = true;
      worker.current?.terminate();
    },
    [],
  );
  const columns = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r.values)))], [rows]);
  const visible = useMemo(() => rows.filter((r) => !r.error && passesPineFilters(r, filters)), [rows, filters]);
  const run = async () => {
    cancel.current = false;
    worker.current?.terminate();
    const w = new Worker(new URL("../workers/pinescreener.worker.ts", import.meta.url));
    worker.current = w;
    setRunning(true);
    setRows([]);
    try {
      let symbols: string[];
      if (universe === "top40") symbols = (await loadScreener(null, 40)).rows.map((r) => r.symbol);
      else symbols = (lists.find((l) => l.id === universe)?.symbols ?? []).filter((x) => !x.startsWith("###")).slice(0, 60);
      let done = 0;
      for (const symbol of symbols) {
        if (cancel.current) break;
        setStatus(`Running ${symbol} · ${done}/${symbols.length}`);
        let row: PineScreenRow;
        try {
          const bars = await marketService.fetchBars(symbol, timeframe, 300);
          const response = await new Promise<PineScreenResponse>((resolve, reject) => {
            const id = crypto.randomUUID();
            w.onmessage = (event: MessageEvent<PineScreenResponse>) => event.data.id === id && resolve(event.data);
            w.onerror = (event) => reject(new Error(event.message));
            w.postMessage({ id, symbol, timeframe, source, libraries, bars });
          });
          row = { symbol, values: response.values, error: response.error, price: bars.at(-1)?.close };
        } catch (error) {
          row = { symbol, values: {}, error: error instanceof Error ? error.message : String(error) };
        }
        done++;
        setRows((previous) => [...previous, row]);
        // A script that fails to compile fails for every symbol; stop early.
        if (row.error && done === 1) {
          setStatus(`Script error: ${row.error}`);
          break;
        }
      }
      if (!cancel.current) setStatus((current) => (current.startsWith("Script error") ? current : `Done · ${done} symbols`));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      w.terminate();
      setRunning(false);
    }
  };
  return (
    <div className="screener-view pine-screener">
      <div className="screener-toolbar">
        <label>
          Symbols
          <select value={universe} onChange={(e) => setUniverse(e.target.value)}>
            <option value="top40">Top 40 by turnover</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Interval
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            {QUICK_INTERVALS.filter((i) => !isTickInterval(i) && !i.endsWith("s")).map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <button className="button primary small" onClick={running ? () => (cancel.current = true) : run}>
          <Play size={12} /> {running ? "Stop" : "Run script"}
        </button>
        <button className="button small" onClick={() => setSource(useChartStore.getState().pineDraft?.source ?? source)}>
          Use Pine editor script
        </button>
        <span className="screener-count">{status}</span>
      </div>
      <textarea className="pine-source" aria-label="Pine script to screen with" spellCheck={false} value={source} onChange={(e) => setSource(e.target.value)} />
      <div className="filter-rows">
        {filters.map((f, i) => (
          <div className="filter-row" key={i}>
            <select aria-label="Plot" value={f.column} onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))}>
              {columns.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select aria-label="Operator" value={f.op} onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, op: e.target.value as PineFilter["op"] } : x)))}>
              {[">", "<", ">=", "<=", "="].map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
            <input aria-label="Value" type="number" step="any" value={f.value} onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))} />
            <button className="icon-button" aria-label="Remove filter" onClick={() => setFilters(filters.filter((_, j) => j !== i))}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button className="button small" disabled={!columns.length} onClick={() => setFilters([...filters, { column: columns[0], op: ">", value: 0 }])}>
          <Plus size={12} /> Add filter on a plot
        </button>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Last</th>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.symbol}>
                <td>
                  <button className="link-button" onClick={() => openSymbol(row.symbol)}>
                    {getSymbol(row.symbol).base}
                  </button>
                </td>
                <td className="mono">{row.price ? formatPrice(row.price) : "—"}</td>
                {columns.map((c) => (
                  <td key={c} className="mono">
                    {row.values[c] === null || row.values[c] === undefined ? "—" : Number(row.values[c]).toLocaleString("en-US", { maximumFractionDigits: 4 })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.filter((r) => r.error).length ? (
          <p className="form-help">{rows.filter((r) => r.error).length} symbols failed: {rows.find((r) => r.error)?.error}</p>
        ) : null}
      </div>
    </div>
  );
}

export function ScreenerPanel() {
  const [tab, setTab] = useState<"screener" | "opportunities" | "stock-base" | "hotlists" | "pine">("screener");
  return (
    <div className="screener-panel">
      <div className="panel-tabs">
        {(
          [
            ["screener", "Crypto screener"],
            ["opportunities", "Trade-Möglichkeiten"],
            ["stock-base", "Stock bases"],
            ["hotlists", "Hotlists"],
            ["pine", "Pine screener"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "opportunities" ? <OpportunitiesHub /> : tab === "stock-base" ? <StockBaseScanner /> : tab === "screener" ? <ScreenerView /> : tab === "hotlists" ? <HotlistView /> : <PineScreenerView />}
    </div>
  );
}
