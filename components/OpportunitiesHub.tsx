"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  categoryLabel,
  opportunitiesToCsv,
  SUBTYPE_LABELS,
  type FundamentalSnapshot,
  type OpportunityCategory,
  type OpportunityScanResult,
  type OpportunitySubType,
  type TradeOpportunity,
} from "@/lib/screener/opportunities";
import { STOCK_BASE_MARKETS, STOCK_BASE_PAGE_SIZE } from "@/lib/screener/stockBase";
import { exchangeOfTicker } from "@/lib/markets";
import { isYahooTicker } from "@/lib/symbolId";
import { formatPrice } from "@/lib/symbols";
import { downloadFile } from "@/lib/files";
import { useChartStore } from "@/stores/useChartStore";
import { usePaperStore } from "@/stores/usePaperStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { hyperliquidCatalog } from "@/hooks/useHyperliquidCatalog";
import { buildMissingOrderflowIndicators, resolveOrderflowTarget } from "@/lib/orderflow/equityOrderflow";
import { broadcastWorkspaceAction } from "@/hooks/useWindowLink";

const pct = (n: number | null | undefined) => (Number.isFinite(n) ? `${n! >= 0 ? "+" : ""}${n!.toFixed(1)}%` : "—");
const distPct = (target: number, current: number) =>
  Number.isFinite(target) && Number.isFinite(current) && current > 0 ? ((target - current) / current) * 100 : NaN;
const fixed = (n: number | null | undefined, digits = 2) => (Number.isFinite(n) ? n!.toFixed(digits) : "—");

function OpportunityMiniChart({ opportunity }: { opportunity: TradeOpportunity }) {
  const bars = opportunity.chart;
  if (!bars.length) return null;
  const { entryZone, invalidation, target1, target2 } = opportunity.levels;
  const structure = opportunity.structure;
  const allPrices = [
    ...bars.flatMap(b => [b.high, b.low]),
    entryZone[0],
    entryZone[1],
    invalidation,
    target1,
    target2,
    ...(structure ? [structure.neckline] : []),
  ];
  const low = Math.min(...allPrices) * 0.992;
  const high = Math.max(...allPrices) * 1.008;
  const span = Math.max(0.01, high - low);
  const width = 620;
  const height = 175;
  const y = (price: number) => 14 + ((high - price) / span) * (height - 32);
  const step = (width - 70) / Math.max(1, bars.length);

  const entryTopY = y(entryZone[1]);
  const entryBotY = y(entryZone[0]);

  return (
    <figure className="stock-base-chart" aria-label={`Setup chart for ${opportunity.ticker}`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${opportunity.ticker} key levels chart`}>
        {/* Entry Zone Band */}
        <rect
          x={48}
          width={width - 58}
          y={Math.min(entryTopY, entryBotY)}
          height={Math.max(3, Math.abs(entryBotY - entryTopY))}
          fill="#2962ff"
          opacity={0.16}
        />
        {/* Target 1 */}
        <line x1={48} x2={width - 10} y1={y(target1)} y2={y(target1)} stroke="#26a69a" strokeDasharray="4 3" strokeWidth={1.3} />
        <text x={6} y={Math.max(11, Math.min(height - 6, y(target1) + 3))} fontSize={9.5} fill="#26a69a">
          T1 {formatPrice(target1)}
        </text>
        <line x1={48} x2={width - 10} y1={y(target2)} y2={y(target2)} stroke="#26a69a" strokeDasharray="8 4" strokeWidth={1.3} />
        <text x={width - 10} y={y(target2) - 4} textAnchor="end" fontSize={9.5} fill="#26a69a">
          T2 {formatPrice(target2)}
        </text>
        {/* Upper edge of the entry zone */}
        <line x1={48} x2={width - 10} y1={y(entryZone[1])} y2={y(entryZone[1])} stroke="#ff9e00" strokeDasharray="2 2" strokeWidth={1} />
        <text x={6} y={Math.max(11, Math.min(height - 6, y(entryZone[1]) + 3))} fontSize={9.5} fill="#ff9e00">
          Entry
        </text>
        {/* Invalidation / Stop */}
        <line x1={48} x2={width - 10} y1={y(invalidation)} y2={y(invalidation)} stroke="#ef5350" strokeDasharray="4 3" strokeWidth={1.3} />
        <text x={6} y={Math.max(11, Math.min(height - 6, y(invalidation) + 3))} fontSize={9.5} fill="#ef5350">
          Stop {formatPrice(invalidation)}
        </text>
        {structure && <line aria-hidden="true" x1={48} x2={width - 10} y1={y(structure.neckline)} y2={y(structure.neckline)} stroke="currentColor" opacity={0.65} strokeDasharray="5 4" />}

        {bars.map((bar, i) => {
          const cx = 52 + i * step + step * 0.5;
          const up = bar.close >= bar.open;
          const color = up ? "#26a69a" : "#ef5350";
          const bodyTop = y(Math.max(bar.open, bar.close));
          const bodyBot = y(Math.min(bar.open, bar.close));
          const pivot = bar.session === structure?.firstLow.session ? "1" : bar.session === structure?.retest.session ? "2" : null;
          return (
            <g key={bar.session}>
              <line x1={cx} x2={cx} y1={y(bar.high)} y2={y(bar.low)} stroke={color} strokeWidth={1} />
              <rect
                x={cx - Math.max(1.5, step * 0.28)}
                width={Math.max(3, step * 0.56)}
                y={bodyTop}
                height={Math.max(1.5, bodyBot - bodyTop)}
                fill={color}
              />
              {pivot && <text x={cx} y={y(bar.low) + 12} fill="currentColor" textAnchor="middle" fontSize={11}>{pivot}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="form-help">
        Entry-Zone: <strong>{formatPrice(entryZone[0])} – {formatPrice(entryZone[1])} {opportunity.currency}</strong> ·
        Invalidierung/Stop: <strong className="negative">{formatPrice(invalidation)}</strong> ({pct(distPct(invalidation, opportunity.levels.lastClose))}) ·
        Ziel 1: <strong className="positive">{formatPrice(target1)}</strong> ({pct(distPct(target1, opportunity.levels.lastClose))}) ·
        Ziel 2: <strong className="positive">{formatPrice(target2)}</strong> ({pct(distPct(target2, opportunity.levels.lastClose))}) ·
        CRV (R:R): <strong>{fixed(opportunity.levels.riskReward, 2)}R</strong>
        {structure && <div>1 Erstes Tief {formatPrice(structure.firstLow.price)} ({structure.firstLow.session}) · 2 Retest {formatPrice(structure.retest.price)} ({structure.retest.session}) · Gestrichelt: Zwischenhoch {formatPrice(structure.neckline)}</div>}
      </figcaption>
    </figure>
  );
}

export function OpportunitiesHub({
  onSelectOpportunity,
  onCompare,
}: {
  onSelectOpportunity?: (opportunity: TradeOpportunity, fundamentals: FundamentalSnapshot | null) => void;
  onCompare?: (ticker: string, benchmark: string, session: string) => void;
} = {}) {
  const [market, setMarket] = useState("us");
  const [scope, setScope] = useState<"curated" | "watchlist">("curated");
  const [categoryFilter, setCategoryFilter] = useState<"all" | OpportunityCategory>("all");
  const [subTypeFilter, setSubTypeFilter] = useState<"all" | OpportunitySubType>("all");
  const [minScore, setMinScore] = useState(55);
  const [sortBy, setSortBy] = useState<"score" | "rr" | "rs" | "upside">("score");
  const [result, setResult] = useState<OpportunityScanResult | null>(null);
  const [requestedPage, setRequestedPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [flowNotice, setFlowNotice] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const watchlist = useWatchlistStore(s => s.lists.find(l => l.id === s.activeId));
  const getWatchTickersForMarket = (targetMarket: string) => [
    ...new Set(
      (watchlist?.symbols ?? []).flatMap(symbol => {
        if (!symbol.startsWith("YF:")) return [];
        const t = symbol.slice(3);
        return isYahooTicker(t) && exchangeOfTicker(t).id === targetMarket ? [t] : [];
      }),
    ),
  ];
  const watchTickers = useMemo(() => getWatchTickersForMarket(market), [watchlist, market]);

  const runScan = async (targetMarket = market, targetScope = scope, targetPage = 0) => {
    abortRef.current?.abort();
    const targetWatchTickers = getWatchTickersForMarket(targetMarket);
    const watchPages = Math.ceil(targetWatchTickers.length / STOCK_BASE_PAGE_SIZE);
    const page = targetScope === "watchlist" && targetPage >= watchPages ? 0 : targetPage;
    setRequestedPage(page);
    if (targetScope === "watchlist" && !targetWatchTickers.length) {
      setLoading(false);
      setResult(null);
      setSelectedId(null);
      setError("Keine Watchlist-Ticker für diesen Markt in der aktiven Watchlist vorhanden.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    setResult(null);
    setSelectedId(null);
    try {
      const response = await (targetScope === "watchlist"
        ? fetch("/api/terminal-opportunities", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ market: targetMarket, tickers: targetWatchTickers.slice(page * STOCK_BASE_PAGE_SIZE, (page + 1) * STOCK_BASE_PAGE_SIZE) }),
            signal: controller.signal,
          })
        : fetch(`/api/terminal-opportunities?${new URLSearchParams({ market: targetMarket, page: String(page) })}`, {
            signal: controller.signal,
          }));
      const body = (await response.json()) as OpportunityScanResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Opportunity scan unavailable.");
      if (!controller.signal.aborted) {
        const normalized: OpportunityScanResult = {
          ...body,
          benchmark: body.benchmark ?? STOCK_BASE_MARKETS.find(m => m.id === (body.market ?? targetMarket))?.benchmark ?? "Index",
          benchmarkSession: body.benchmarkSession ?? "—",
          evaluated: Number.isFinite(body.evaluated) ? body.evaluated : 0,
          universe: Number.isFinite(body.universe) ? body.universe : 0,
          opportunities: Array.isArray(body.opportunities) ? body.opportunities : [],
          unavailable: Array.isArray(body.unavailable) ? body.unavailable : [],
          dataSources: Array.isArray(body.dataSources) ? body.dataSources : [],
          ...(targetScope === "watchlist" ? { page, pages: watchPages } : {}),
        };
        setResult(normalized);
        const first = normalized.opportunities[0] ?? null;
        setSelectedId(first?.id ?? null);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Opportunity scan unavailable.");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    void runScan(market, scope);
    return () => abortRef.current?.abort();
  }, []);

  const filtered = useMemo(() => {
    const list = (result?.opportunities ?? []).filter(item => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (subTypeFilter !== "all" && item.subType !== subTypeFilter) return false;
      if (item.score < minScore) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      const rrA = Number.isFinite(a.levels.riskReward) ? a.levels.riskReward : -Infinity;
      const rrB = Number.isFinite(b.levels.riskReward) ? b.levels.riskReward : -Infinity;
      if (sortBy === "rr") return rrB - rrA || b.score - a.score;
      if (sortBy === "rs") {
        const rsA = Number.isFinite(a.technicals.relativeStrengthPct) ? a.technicals.relativeStrengthPct : -Infinity;
        const rsB = Number.isFinite(b.technicals.relativeStrengthPct) ? b.technicals.relativeStrengthPct : -Infinity;
        return rsB - rsA || b.score - a.score;
      }
      if (sortBy === "upside") {
        const rawA = distPct(a.levels.target1, a.levels.lastClose);
        const rawB = distPct(b.levels.target1, b.levels.lastClose);
        const upA = Number.isFinite(rawA) ? rawA : -Infinity;
        const upB = Number.isFinite(rawB) ? rawB : -Infinity;
        return upB - upA || b.score - a.score;
      }
      return b.score - a.score || rrB - rrA;
    });
  }, [result, categoryFilter, subTypeFilter, minScore, sortBy]);

  const selected = useMemo(
    () => filtered.find(item => item.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  useEffect(() => {
    setFlowNotice("");
    if (selected && onSelectOpportunity) {
      onSelectOpportunity(selected, selected.fundamentals);
    }
  }, [selected?.id]);

  const selectRow = (row: TradeOpportunity) => {
    setSelectedId(row.id);
    useChartStore.getState().set({ symbol: row.symbol, timeframe: "1D" });
    onSelectOpportunity?.(row, row.fundamentals);
  };

  const benchmarkTicker = STOCK_BASE_MARKETS.find(m => m.id === (result?.market ?? market))?.benchmark;

  const inlineLabelStyle = { flexDirection: "row", alignItems: "center", gap: 4 } as const;

  return (
    <div className="screener-view opportunities-hub" aria-label="Multi-Strategy Trade-Möglichkeiten Scanner">
      <div className="screener-toolbar" style={{ gap: "4px 6px", padding: "3px 6px" }}>
        <label style={inlineLabelStyle}>
          Markt
          <select
            aria-label="Opportunity market"
            value={market}
            onChange={e => {
              const nextMarket = e.target.value;
              setMarket(nextMarket);
              void runScan(nextMarket, scope);
            }}
          >
            {STOCK_BASE_MARKETS.map(m => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label style={inlineLabelStyle}>
          Universum
          <select
            aria-label="Opportunity universe"
            value={scope}
            onChange={e => {
              const nextScope = e.target.value as "curated" | "watchlist";
              setScope(nextScope);
              void runScan(market, nextScope);
            }}
          >
            <option value="curated">Curated</option>
            <option value="watchlist">Watchlist ({watchTickers.length})</option>
          </select>
        </label>
        <label style={inlineLabelStyle}>
          Kategorie
          <select
            aria-label="Strategy category"
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value as "all" | OpportunityCategory)}
          >
            <option value="all">All Categories</option>
            <option value="structural-bottom">Cat A · Bottom</option>
            <option value="value-garp">Cat B · Value/GARP</option>
            <option value="high-conviction">Cat C · VCP/Insider</option>
          </select>
        </label>
        <label style={inlineLabelStyle}>
          Setup
          <select
            aria-label="Setup subtype"
            value={subTypeFilter}
            onChange={e => setSubTypeFilter(e.target.value as "all" | OpportunitySubType)}
          >
            <option value="all">All Patterns</option>
            {Object.entries(SUBTYPE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label style={inlineLabelStyle}>
          <span className="mono">Min {minScore}</span>
          <input
            type="range"
            min={50}
            max={90}
            step={5}
            value={minScore}
            style={{ width: 60, height: 18, padding: 0 }}
            onChange={e => setMinScore(Number(e.target.value))}
          />
        </label>
        <label style={inlineLabelStyle}>
          Sort
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
            <option value="score">Score (0–100)</option>
            <option value="rr">R:R</option>
            <option value="rs">Rel. Strength</option>
            <option value="upside">Target 1 Upside</option>
          </select>
        </label>
        <button
          type="button"
          className="button small primary"
          disabled={loading || (scope === "watchlist" && !watchTickers.length)}
          onClick={() => void runScan(market, scope, requestedPage)}
        >
          {loading ? "Scanne Setups…" : error && requestedPage > 0 ? `Gruppe ${requestedPage + 1} erneut scannen` : "Scan Trade-Möglichkeiten"}
        </button>
        <button
          type="button"
          className="button small"
          title="Export CSV"
          disabled={!result || !filtered.length}
          onClick={() => result &&
            downloadFile(
              `affenterminal-opportunities-${result.market}-${result.benchmarkSession}-group-${(result.page ?? 0) + 1}.csv`,
              opportunitiesToCsv(filtered, result),
              "text/csv;charset=utf-8",
            )
          }
        >
          CSV
        </button>
      </div>

      {!result && (
        <div className="terminal-telemetry-chip" role="status">
          <span className="mono">STRATEGY:</span> Multi-Factor Alpha · Wyckoff Structure · Value/GARP · VCP &amp; SEC Form 4 Insider Clusters
        </div>
      )}

      {loading && (
        <p className="form-help" role="status" style={{ margin: "2px 0" }}>
          Scanning market structure, volume divergence, relative strength &amp; SEC Form 4 filings…
        </p>
      )}
      {error && <p className="error-message screener-error" role="alert">{error}</p>}

      {result && (
        <div className="screener-toolbar" style={{ gap: "3px 6px", padding: "3px 6px" }}>
          <span className="screener-count mono" role="status">
            <strong>{result.benchmark ?? benchmarkTicker ?? "Index"}</strong> ({result.benchmarkSession ?? "—"}) · {result.evaluated ?? 0}/{result.universe ?? 0} ·{" "}
            <strong>{filtered.length}</strong> Trade-Setups aktiv{result.excluded ? ` · ${result.excluded} ex-eq` : ""}
            {Array.isArray(result.dataSources) && result.dataSources.length ? ` · ${result.dataSources.join(" + ")}` : ""}
          </span>
          {(result.pages ?? 1) > 1 && <>
            <button type="button" className="button small" disabled={!result.page} onClick={() => void runScan(market, scope, (result.page ?? 0) - 1)}>Vorherige Gruppe</button>
            <span className="mono">Gruppe {(result.page ?? 0) + 1} von {result.pages}</span>
            <button type="button" className="button small" disabled={(result.page ?? 0) + 1 >= result.pages!} onClick={() => void runScan(market, scope, (result.page ?? 0) + 1)}>Nächste Gruppe</button>
          </>}
        </div>
      )}
      {!!result?.unavailable?.length && <details className="form-help">
        <summary>{result.unavailable.length} Symbole ohne auswertbare Daten</summary>
        <ul>{result.unavailable.map(({ symbol, reason }) => <li key={symbol}>{symbol} · {reason}</li>)}</ul>
      </details>}

      {!!filtered.length && (
        <div className="stock-base-results table-scroll">
          <table className="data-table" aria-label="Trade-Möglichkeiten Trefferliste">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Kategorie</th>
                <th>Setup-Muster</th>
                <th>Score</th>
                <th>Kurs</th>
                <th>Entry-Zone</th>
                <th>Stop / Invalidierung</th>
                <th>Ziel 1 / Ziel 2</th>
                <th>CRV (R:R)</th>
                <th>RS vs. {result?.benchmark ?? "Index"}</th>
                <th>KGV / FCF-Yield</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => {
                const isSelected = selected?.id === row.id;
                const stopDist = distPct(row.levels.invalidation, row.levels.lastClose);
                const t1Dist = distPct(row.levels.target1, row.levels.lastClose);
                return (
                  <tr
                    key={row.id}
                    className={isSelected ? "selected-row" : undefined}
                    onClick={() => selectRow(row)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <button
                        type="button"
                        className="button small"
                        aria-pressed={isSelected}
                        onClick={e => {
                          e.stopPropagation();
                          selectRow(row);
                        }}
                        title={`${row.name} (${row.sector})`}
                      >
                        <strong>{row.ticker}</strong>
                      </button>{" "}
                      <small className="muted">{row.sector}</small>
                    </td>
                    <td>{categoryLabel(row.category)}</td>
                    <td>{row.setupLabel}</td>
                    <td className="mono">
                      <strong className={row.score >= 78 ? "positive" : ""}>{row.score}/100</strong>
                    </td>
                    <td className="mono">
                      {formatPrice(row.levels.lastClose)} {row.currency}
                    </td>
                    <td className="mono">
                      {formatPrice(row.levels.entryZone[0])} – {formatPrice(row.levels.entryZone[1])}
                    </td>
                    <td className="mono negative">
                      {formatPrice(row.levels.invalidation)} ({pct(stopDist)})
                    </td>
                    <td className="mono positive">
                      {formatPrice(row.levels.target1)} ({pct(t1Dist)}) / {formatPrice(row.levels.target2)}
                    </td>
                    <td className="mono">
                      <strong>{fixed(row.levels.riskReward, 2)}R</strong>
                    </td>
                    <td className={`mono ${row.technicals.relativeStrengthPct >= 0 ? "positive" : "negative"}`}>
                      {pct(row.technicals.relativeStrengthPct)}
                    </td>
                    <td className="mono">
                      {Number.isFinite(row.fundamentals?.forwardPe) && row.fundamentals!.forwardPe! > 0
                        ? `${fixed(row.fundamentals?.forwardPe, 1)}×`
                        : "—"}{" "}
                      /{" "}
                      {Number.isFinite(row.fundamentals?.fcfYieldPct) && row.fundamentals!.fcfYieldPct !== 0
                        ? `${fixed(row.fundamentals?.fcfYieldPct, 1)}%`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && result && !filtered.length && (
        <p className="form-help">Keine Trade-Möglichkeiten für diese Filterkombination gefunden. Reduziere den Mindest-Score oder wähle „Alle 3 Setup-Kategorien“.</p>
      )}

      {selected && (
        <section className="stock-base-evidence" aria-label="Ausgewähltes Trade-Setup im Detail">
          <div className="screener-toolbar">
            <strong>
              {selected.ticker} · {selected.name} · {selected.setupLabel} · Score {selected.score}/100
            </strong>
            <button
              type="button"
              className="button small primary"
              onClick={() => useChartStore.getState().set({ symbol: selected.symbol, timeframe: "1D" })}
            >
              In Haupt-Chart laden ({selected.ticker})
            </button>
            <button
              type="button"
              className="button small"
              onClick={async () => {
                const hlAssets = await hyperliquidCatalog().catch(() => []);
                const target = resolveOrderflowTarget(selected.symbol, hlAssets);
                const store = useChartStore.getState();
                const extras = buildMissingOrderflowIndicators(store.indicators, target.studies);
                const toastPayload = target.notice
                  ? {
                      title: target.mappedFrom ? "Orderflow-Proxy aktiv" : "Orderflow Hinweis",
                      message: target.notice,
                      tone: "success" as const,
                    }
                  : undefined;
                store.set({
                  symbol: target.symbol,
                  timeframe: "15m",
                  chartType: target.chartType,
                  bottomOpen: true,
                  bottomTab: "orderflow",
                  ...(extras.length ? { indicators: [...store.indicators, ...extras] } : {}),
                });
                broadcastWorkspaceAction({
                  symbol: target.symbol,
                  timeframe: "15m",
                  chartType: target.chartType,
                  bottomOpen: true,
                  bottomTab: "orderflow",
                  addIndicators: target.studies,
                  ...(toastPayload ? { toast: toastPayload } : {}),
                });
                if (toastPayload) {
                  setFlowNotice(toastPayload.message);
                  useChartStore.getState().toast(toastPayload.title, toastPayload.message, toastPayload.tone);
                } else {
                  setFlowNotice("");
                }
              }}
            >
              Footprint & Orderflow
            </button>
            <button
              type="button"
              className="button small"
              onClick={() => {
                const rawMid = (selected.levels.entryZone[0] + selected.levels.entryZone[1]) / 2;
                const entryMid =
                  Number.isFinite(rawMid) && rawMid > 0
                    ? rawMid >= 1
                      ? Math.round(rawMid * 100) / 100
                      : Number(rawMid.toPrecision(6))
                    : selected.levels.lastClose;
                const currentQty = usePaperStore.getState().ticket.quantity;
                const qty = Number.isFinite(currentQty) && currentQty > 0 ? currentQty : 0.01;
                const tp1 = selected.levels.target1;
                const tp2 = selected.levels.target2;
                const sl = selected.levels.invalidation;
                const leg1Qty = Number((qty / 2).toPrecision(8));
                const leg2Qty = qty - leg1Qty;
                const validTp1 = Number.isFinite(tp1) && tp1 > entryMid;
                const validSl = Number.isFinite(sl) && sl > 0 && sl < entryMid;
                const hasTwoTargets =
                  validTp1 &&
                  Number.isFinite(tp2) &&
                  tp2 > tp1 &&
                  validSl &&
                  leg1Qty >= 1e-12 &&
                  leg2Qty >= 1e-12;
                usePaperStore.getState().setTicket(
                  hasTwoTargets
                    ? {
                        side: "buy",
                        type: "limit",
                        quantity: qty,
                        price: entryMid,
                        stopLoss: undefined,
                        takeProfit: undefined,
                        exitLevels: [
                          { quantity: leg1Qty, takeProfit: tp1, stopLoss: sl },
                          { quantity: leg2Qty, takeProfit: tp2, stopLoss: sl },
                        ],
                        reduceOnly: false,
                      }
                    : {
                        side: "buy",
                        type: "limit",
                        quantity: qty,
                        price: entryMid,
                        stopLoss: validSl ? sl : undefined,
                        takeProfit: validTp1 ? tp1 : undefined,
                        exitLevels: undefined,
                        reduceOnly: false,
                      },
                );
                useChartStore.getState().set({
                  symbol: selected.symbol,
                  timeframe: "1D",
                  bottomOpen: true,
                  bottomTab: "trading",
                });
                const toastPayload = {
                  title: hasTwoTargets || validSl || validTp1 ? "Bracket-Order vorbereitet" : "Limit-Order vorbereitet",
                  message: hasTwoTargets
                    ? `${selected.ticker}: Limit ${formatPrice(entryMid)} · Stop ${formatPrice(sl)} · TP1 (50%) ${formatPrice(tp1)} · TP2 (50%) ${formatPrice(tp2)}`
                    : `${selected.ticker}: Limit ${formatPrice(entryMid)}${validSl ? ` · Stop ${formatPrice(sl)}` : ""}${validTp1 ? ` · TP ${formatPrice(tp1)}` : ""}`,
                  tone: "success" as const,
                };
                broadcastWorkspaceAction({
                  symbol: selected.symbol,
                  timeframe: "1D",
                  bottomOpen: true,
                  bottomTab: "trading",
                  toast: toastPayload,
                });
                useChartStore.getState().toast(toastPayload.title, toastPayload.message, toastPayload.tone);
              }}
            >
              Bracket-Order vorbereiten
            </button>
            {watchlist && (
              <button
                type="button"
                className="button small"
                disabled={watchlist.symbols.includes(selected.symbol)}
                onClick={() => {
                  const added = useWatchlistStore.getState().addSymbols([selected.symbol], watchlist.id);
                  if (added) {
                    useChartStore.getState().toast("Zur Watchlist hinzugefügt", `${selected.ticker} in ${watchlist.name} gespeichert.`, "success");
                  }
                }}
              >
                {watchlist.symbols.includes(selected.symbol) ? `In ${watchlist.name}` : `+ Watchlist (${watchlist.name})`}
              </button>
            )}
            {onCompare && benchmarkTicker && (
              <button
                type="button"
                className="button small"
                onClick={() => onCompare(selected.ticker, benchmarkTicker, selected.session)}
              >
                Relative Stärke vs. {result?.benchmark ?? "Benchmark"}
              </button>
            )}
          </div>

          {flowNotice && (
            <p className="form-help" role="status">
              {flowNotice}
            </p>
          )}

          <OpportunityMiniChart opportunity={selected} />

          <div>
            <strong>Warum ist das ein Setup? (Evidenz & Begründung)</strong>
            <ul className="form-help">
              {(selected.whySetup ?? []).map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </div>

          <dl aria-label="Setup Key-Levels und Indikatoren">
            <div>
              <dt>Entry-Zone</dt>
              <dd className="mono">
                {formatPrice(selected.levels.entryZone[0])} – {formatPrice(selected.levels.entryZone[1])} {selected.currency}
              </dd>
            </div>
            <div>
              <dt>Invalidierung / Stop-Loss</dt>
              <dd className="mono negative">
                {formatPrice(selected.levels.invalidation)} {selected.currency} ({pct(distPct(selected.levels.invalidation, selected.levels.lastClose))})
              </dd>
            </div>
            <div>
              <dt>Kursziel 1 / Kursziel 2</dt>
              <dd className="mono positive">
                T1: {formatPrice(selected.levels.target1)} ({pct(distPct(selected.levels.target1, selected.levels.lastClose))}) · T2: {formatPrice(selected.levels.target2)}
              </dd>
            </div>
            <div>
              <dt>Chance-Risiko-Verhältnis (CRV)</dt>
              <dd className="mono">
                <strong>{fixed(selected.levels.riskReward, 2)} : 1</strong>
              </dd>
            </div>
            <div>
              <dt>EMA 20 / EMA 50 / 20d-VWAP</dt>
              <dd className="mono">
                {formatPrice(selected.technicals.ema20)} ({pct(selected.technicals.ema20DistPct)}) ·{" "}
                {formatPrice(selected.technicals.ema50)} ({pct(selected.technicals.ema50DistPct)}) ·{" "}
                VWAP {formatPrice(selected.technicals.vwap20)}
              </dd>
            </div>
            <div>
              <dt>Volumen Dry-Up & Up/Down-Ratio</dt>
              <dd className="mono">
                Dry-Up {fixed(Number.isFinite(selected.technicals.volumeDryUpRatio) ? selected.technicals.volumeDryUpRatio * 100 : undefined, 0)}% · Up/Down {fixed(selected.technicals.upDownVolumeRatio, 2)}× · RVOL {fixed(selected.technicals.rvol20, 2)}×
              </dd>
            </div>
            <div>
              <dt>OBV / A-D Akkumulation & RSI(14)</dt>
              <dd className="mono">
                OBV-Div: {selected.technicals.obvDivergence ? "Ja (Bullisch)" : "Neutral"} · A/D-Div:{" "}
                {selected.technicals.adDivergence ? "Ja (Bullisch)" : "Neutral"} · RSI {fixed(selected.technicals.rsi14, 1)}
              </dd>
            </div>
            <div>
              <dt>VCP-Kontraktionen & Bollinger-Bandbreite</dt>
              <dd className="mono">
                {selected.technicals.vcpContractions} Wellen · BB-Width {fixed(selected.technicals.bbBandwidthPct, 1)}% ({fixed(selected.technicals.bbSqueezePercentile, 0)}. Perzentil)
              </dd>
            </div>
          </dl>

          <details>
            <summary>Setup-Score Aufschlüsselung · {selected.score}/100 Punkte</summary>
            <dl>
              {Object.entries(selected.scoreBreakdown ?? {}).map(([label, pts]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className="mono">+{pts}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      )}
    </div>
  );
}
