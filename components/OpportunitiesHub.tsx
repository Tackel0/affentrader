"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  categoryLabel,
  opportunitiesToCsv,
  mergeOpportunityGroups,
  opportunityEntryDistance,
  opportunityEntryState,
  opportunityPlan,
  opportunityShareSize,
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
const RESULTS_PAGE_SIZE = 16;

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
  const [sortBy, setSortBy] = useState<"score" | "rr" | "rs" | "upside" | "entry">("score");
  const [result, setResult] = useState<OpportunityScanResult | null>(null);
  const [query, setQuery] = useState("");
  const [entryFilter, setEntryFilter] = useState("all");
  const [minReward, setMinReward] = useState(0);
  const [maxEntryDistance, setMaxEntryDistance] = useState(0);
  const [requireFilings, setRequireFilings] = useState(false);
  const [riskBudget, setRiskBudget] = useState("");
  const [resultPage, setResultPage] = useState(0);
  const [scanKey, setScanKey] = useState("");
  const [stopped, setStopped] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
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

  const contextKey = (targetMarket: string, targetScope: typeof scope, tickers: string[]) =>
    JSON.stringify([targetMarket, targetScope, targetScope === "watchlist" ? watchlist?.id : null, targetScope === "watchlist" ? tickers : []]);
  const currentKey = contextKey(market, scope, watchTickers);
  const canContinue = !!result && scanKey === currentKey && (result.page ?? 0) + 1 < (result.pages ?? 1);

  const runScan = async (targetMarket = market, targetScope = scope, full = true, resume = false) => {
    abortRef.current?.abort();
    const tickers = getWatchTickersForMarket(targetMarket);
    const custom = targetScope === "watchlist";
    const watchPages = Math.ceil(tickers.length / STOCK_BASE_PAGE_SIZE);
    const key = contextKey(targetMarket, targetScope, tickers);
    let combined = resume && scanKey === key ? result : null;
    const controller = new AbortController();
    abortRef.current = controller;
    setScanKey(key);
    if (!combined) {
      setResult(null);
      setSelectedId(null);
      setResultPage(0);
    }
    setStopped(false);
    setError("");
    if (custom && !watchPages) {
      setLoading(false);
      setError("Die aktive Watchlist enthält keine Aktien für diesen Markt.");
      return;
    }
    setLoading(true);
    try {
      for (let page = combined ? (combined.page ?? 0) + 1 : 0; !combined || page < (combined.pages ?? 1); page++) {
        const start = page * STOCK_BASE_PAGE_SIZE;
        const response = await (custom
          ? fetch("/api/terminal-opportunities", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ market: targetMarket, tickers: tickers.slice(start, start + STOCK_BASE_PAGE_SIZE) }),
              signal: controller.signal,
            })
          : fetch(`/api/terminal-opportunities?${new URLSearchParams({ market: targetMarket, page: String(page) })}`, {
              signal: controller.signal,
            }));
        const body = (await response.json()) as OpportunityScanResult & { error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error ?? "Scan vorübergehend nicht verfügbar.");
        const normalized: OpportunityScanResult = {
          ...body,
          market: body.market ?? targetMarket,
          benchmark: body.benchmark ?? STOCK_BASE_MARKETS.find(item => item.id === targetMarket)?.benchmarkLabel ?? "Index",
          benchmarkSession: body.benchmarkSession ?? "—",
          generatedAt: Number.isFinite(body.generatedAt) ? body.generatedAt : Date.now(),
          evaluated: Number.isFinite(body.evaluated) ? body.evaluated : 0,
          universe: Number.isFinite(body.universe) ? body.universe : 0,
          opportunities: Array.isArray(body.opportunities) ? body.opportunities : [],
          unavailable: Array.isArray(body.unavailable) ? body.unavailable : [],
          dataSources: Array.isArray(body.dataSources) ? body.dataSources : [],
          page: custom ? page : body.page ?? page,
          pages: custom ? watchPages : body.pages ?? 1,
          totalUniverse: custom ? tickers.length : body.totalUniverse,
        };
        combined = mergeOpportunityGroups(combined, normalized);
        setResult(combined);
        if (!full) break;
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Scan vorübergehend nicht verfügbar.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    void runScan(market, scope, false);
    return () => abortRef.current?.abort();
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("de-DE");
    const list = (result?.opportunities ?? []).filter(item => {
      if (term && ![item.ticker, item.name, item.sector].some(text => text?.toLocaleLowerCase("de-DE").includes(term))) return false;
      if (entryFilter !== "all" && opportunityEntryState(item.levels) !== entryFilter) return false;
      if (minReward > 0 && (opportunityPlan(item.levels)?.reward ?? 0) < minReward) return false;
      if (maxEntryDistance > 0 && (opportunityEntryDistance(item.levels) ?? Infinity) > maxEntryDistance) return false;
      if (requireFilings && !item.fundamentals?.recentInsiderFilings?.length) return false;
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (subTypeFilter !== "all" && item.subType !== subTypeFilter) return false;
      if (item.score < minScore) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      const rrA = opportunityPlan(a.levels)?.reward ?? -Infinity;
      const rrB = opportunityPlan(b.levels)?.reward ?? -Infinity;
      if (sortBy === "entry") return (opportunityEntryDistance(a.levels) ?? Infinity) - (opportunityEntryDistance(b.levels) ?? Infinity) || b.score - a.score;
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
  }, [result, query, entryFilter, minReward, maxEntryDistance, requireFilings, categoryFilter, subTypeFilter, minScore, sortBy]);

  useEffect(() => setResultPage(0), [query, entryFilter, minReward, maxEntryDistance, requireFilings, categoryFilter, subTypeFilter, minScore, sortBy]);
  const resultPages = Math.max(1, Math.ceil(filtered.length / RESULTS_PAGE_SIZE));
  const visibleResultPage = Math.min(resultPage, resultPages - 1);
  const pageRows = filtered.slice(visibleResultPage * RESULTS_PAGE_SIZE, (visibleResultPage + 1) * RESULTS_PAGE_SIZE);
  const selected = useMemo(
    () => filtered.find(item => item.id === selectedId) ?? filtered[visibleResultPage * RESULTS_PAGE_SIZE] ?? null,
    [filtered, selectedId, visibleResultPage],
  );

  useEffect(() => {
    setFlowNotice("");
    if (selected && onSelectOpportunity) {
      onSelectOpportunity(selected, selected.fundamentals);
    }
  }, [selected]);
  useEffect(() => setRiskBudget(""), [selected?.id, selected?.currency]);

  const selectRow = (row: TradeOpportunity) => {
    setSelectedId(row.id);
    const detail = detailRef.current;
    const narrow = resultsRef.current?.parentElement?.clientWidth;
    if (detail && narrow && narrow <= 760) {
      detail.focus({ preventScroll: true });
      detail.scrollIntoView?.({ block: "start" });
    }
  };

  const benchmarkTicker = STOCK_BASE_MARKETS.find(m => m.id === (result?.market ?? market))?.benchmark;

  const plan = selected && opportunityPlan(selected.levels);
  const size = plan && riskBudget.trim() ? opportunityShareSize(plan, Number(riskBudget)) : null;
  const setupState = selected ? opportunityEntryState(selected.levels) : "invalid";
  const canPrepare = !!plan && setupState !== "invalid" && setupState !== "target" &&
    scanKey === currentKey && (!riskBudget.trim() || size !== null);
  const stateLabels = {
    zone: "In Einstiegszone",
    below: "Unter Einstiegszone",
    above: "Über Einstiegszone",
    invalid: "Stop erreicht / ungültig",
    target: "Ziel 1 erreicht",
  } as const;

  return (
    <div className="screener-view opportunities-hub" aria-label="Multi-Strategy Trade-Möglichkeiten Scanner">
      <header className="opportunity-controls">
        <div className="opportunity-scan-controls">
          <label>Markt<select aria-label="Opportunity market" value={market} onChange={event => {
            setMarket(event.target.value);
            void runScan(event.target.value, scope, false);
          }}>
            {STOCK_BASE_MARKETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></label>
          <label>Universum<select aria-label="Opportunity universe" value={scope} onChange={event => {
            const next = event.target.value as typeof scope;
            setScope(next);
            void runScan(market, next, false);
          }}>
            <option value="curated">Aktienuniversum</option>
            <option value="watchlist">Watchlist ({watchTickers.length})</option>
          </select></label>
          {loading ? <button className="button" type="button" onClick={() => {
            abortRef.current?.abort();
            setLoading(false);
            setStopped(true);
          }}>Scan stoppen</button> : <button className="button primary" type="button"
            disabled={scope === "watchlist" && !watchTickers.length}
            onClick={() => void runScan(market, scope, true, canContinue)}>
            {canContinue ? "Gesamtscan fortsetzen" : "Scan Trade-Möglichkeiten"}
          </button>}
          {!loading && canContinue && <button className="button" type="button" onClick={() => void runScan(market, scope)}>Neu scannen</button>}
        </div>
        <div className="opportunity-filters">
          <label className="opportunity-search">Treffersuche<input type="search" value={query} placeholder="Ticker, Name oder Sektor" onChange={event => setQuery(event.target.value)} /></label>
          <label>Schlusskurs<select value={entryFilter} onChange={event => setEntryFilter(event.target.value)}>
            <option value="all">Alle Kurslagen</option>
            {Object.entries(stateLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>Sortieren<select value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)}>
            <option value="score">Setup-Score</option><option value="rr">CRV am Einstieg</option>
            <option value="rs">Relative Stärke</option><option value="entry">Nähe zum Einstieg</option><option value="upside">Abstand zu Ziel 1</option>
          </select></label>
          <details className="opportunity-advanced">
            <summary>Weitere Filter</summary>
            <div className="opportunity-filters">
              <label>Kategorie<select aria-label="Strategy category" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value as typeof categoryFilter)}>
                <option value="all">Alle Kategorien</option><option value="structural-bottom">A · Struktur</option>
                <option value="value-garp">B · Value/GARP</option><option value="high-conviction">C · VCP/Insider</option>
              </select></label>
              <label>Setup<select aria-label="Setup subtype" value={subTypeFilter} onChange={event => setSubTypeFilter(event.target.value as typeof subTypeFilter)}>
                <option value="all">Alle Muster</option>
                {Object.entries(SUBTYPE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select></label>
              <label>Min. Score<select value={minScore} onChange={event => setMinScore(Number(event.target.value))}>
                <option value={0}>Alle</option>
                {[50, 55, 60, 65, 70, 75, 80, 85, 90].map(score => <option key={score} value={score}>{score}</option>)}
              </select></label>
              <label>Min. CRV<select value={minReward} onChange={event => setMinReward(Number(event.target.value))}>
                <option value={0}>Alle</option>
                {[1.5, 2, 2.5, 3, 4].map(reward => <option key={reward} value={reward}>{reward} R</option>)}
              </select></label>
              <label>Max. Einstiegsabstand<select value={maxEntryDistance} onChange={event => setMaxEntryDistance(Number(event.target.value))}>
                <option value={0}>Alle</option>
                {[1, 2, 3, 5].map(distance => <option key={distance} value={distance}>{distance} %</option>)}
              </select></label>
              <label>Insider-Meldungen<select value={requireFilings ? "with" : "all"} onChange={event => setRequireFilings(event.target.value === "with")}>
                <option value="all">Alle</option><option value="with">Mit Einzelmeldungen</option>
              </select></label>
            </div>
          </details>
        </div>
      </header>

      <div className="opportunity-progress">
        <p role="status">
          {result ? <>
            <strong>{filtered.length} von {result.opportunities.length} Setups</strong> · {result.evaluated}/{result.totalUniverse ?? result.universe} Aktien ausgewertet
            {(result.pages ?? 1) > 1 && <> · <span>Gruppe {(result.page ?? 0) + 1} von {result.pages}</span></>}
            <span className="opportunity-data-date"> · {result.benchmark} bis {result.benchmarkSession} · Tagesdaten</span>
          </> : loading ? "Erste Gruppe wird geprüft…" : "Long-Setups auf abgeschlossenen Tageskerzen"}
          {loading && result && " · Weitere Gruppen werden geprüft…"}
          {stopped && " · Angehalten"}
        </p>
        {result && <button type="button" className="button small" disabled={!filtered.length} onClick={() =>
          downloadFile(`affenterminal-opportunities-${result.market}-${result.benchmarkSession}.csv`, opportunitiesToCsv(filtered, result, true), "text/csv;charset=utf-8")
        }>CSV</button>}
      </div>
      {error && <p className="error-message screener-error" role="alert">{error}</p>}
      {result && scanKey !== currentKey && <p className="form-help" role="status">Die Watchlist hat sich geändert. Starte einen neuen Scan für die aktuelle Auswahl.</p>}
      {result && <details className="opportunity-coverage">
        <summary>Datenbasis · {result.unavailable.length} ohne auswertbare Daten</summary>
        <p>{result.dataSources.join(" · ") || "Datenquellen nicht übermittelt"}{result.excluded ? ` · ${result.excluded} Nicht-Aktien ausgeschlossen` : ""}</p>
        <ul>{result.unavailable.map(({ symbol, reason }) => <li key={symbol}>{symbol} · {reason}</li>)}</ul>
      </details>}

      <div className="opportunity-workspace">
        <section ref={resultsRef} tabIndex={-1} className="opportunity-results" aria-label="Scan-Ergebnisse">
          {!!filtered.length && <table className="data-table" aria-label="Trade-Möglichkeiten Trefferliste">
            <thead><tr><th scope="col">Aktie &amp; Setup</th><th scope="col">Kurslage</th><th scope="col">Score</th><th scope="col">CRV</th><th scope="col" className="opportunity-wide-cell">RS</th></tr></thead>
            <tbody>{pageRows.map(row => {
              const isSelected = selected?.id === row.id;
              const state = opportunityEntryState(row.levels);
              return <tr key={row.id} className={isSelected ? "selected-row" : undefined} onClick={() => selectRow(row)}>
                <td><button type="button" className="button opportunity-row-button" aria-pressed={isSelected} aria-label={`${row.ticker} · ${row.setupLabel}`}
                  onClick={event => { event.stopPropagation(); selectRow(row); }} title={`${row.name} · ${row.sector}`}>
                  <strong>{row.ticker}</strong><small>{row.setupLabel}</small>
                </button></td>
                <td><span className={`opportunity-entry-state ${state === "zone" ? "positive" : state === "invalid" ? "negative" : ""}`}>{stateLabels[state]}</span><small className="mono">{formatPrice(row.levels.lastClose)} {row.currency}</small></td>
                <td className="mono">{row.score}</td>
                <td className="mono">{fixed(opportunityPlan(row.levels)?.reward, 1)} R</td>
                <td className="mono opportunity-wide-cell">{pct(row.technicals.relativeStrengthPct)}</td>
              </tr>;
            })}</tbody>
          </table>}
          {resultPages > 1 && <nav className="opportunity-pagination" aria-label="Trefferseiten">
            <button type="button" className="button small" disabled={visibleResultPage === 0} onClick={() => { setSelectedId(null); setResultPage(visibleResultPage - 1); }}>Zurück</button>
            <span>Seite {visibleResultPage + 1} von {resultPages}</span>
            <button type="button" className="button small" disabled={visibleResultPage + 1 === resultPages} onClick={() => { setSelectedId(null); setResultPage(visibleResultPage + 1); }}>Weiter</button>
          </nav>}
          {!loading && result && !filtered.length && <p className="form-help">
            {result.opportunities.length ? "Keine Treffer für diese Filter." : result.evaluated
              ? "Die geprüften Aktien liefern aktuell keine Setups." : "Der Scan hat keine auswertbaren Aktiendaten erhalten."}
          </p>}
        </section>

      {selected && (
        <section ref={detailRef} tabIndex={-1} className="stock-base-evidence opportunity-detail" aria-label="Ausgewähltes Trade-Setup im Detail">
          <button className="button small opportunity-back" type="button" onClick={() => {
            resultsRef.current?.focus({ preventScroll: true });
            resultsRef.current?.scrollIntoView?.({ block: "start" });
          }}>Zur Trefferliste</button>
          <header className="opportunity-detail-heading">
            <div><h3>{selected.ticker} <span>{selected.name}</span></h3><p>{selected.setupLabel} · {categoryLabel(selected.category)}</p>
              <p>Schluss {formatPrice(selected.levels.lastClose)} {selected.currency} · {stateLabels[setupState]}</p></div>
            <div><strong>{selected.score}/100</strong><small>{selected.session} · Long</small></div>
          </header>
          {plan && <section className="opportunity-risk" aria-label="Risikoplan">
            <dl>
              <div><dt>Limit-Mitte</dt><dd className="mono">{formatPrice(plan.entry)} {selected.currency}</dd></div>
              <div><dt>Stop</dt><dd className="mono negative">{formatPrice(plan.stop)}</dd></div>
              <div><dt>Ziel 1 / Ziel 2</dt><dd className="mono positive">{formatPrice(plan.target1)} / {formatPrice(plan.target2)}</dd></div>
              <div><dt>CRV bis Ziel 1</dt><dd className="mono">{fixed(plan.reward, 2)} R</dd></div>
            </dl>
            <label>Risikobudget ({selected.currency})<input type="number" inputMode="decimal" min="0" step="any" placeholder="Optional" value={riskBudget}
              onChange={event => setRiskBudget(event.target.value)} /></label>
            {size && <p role="status"><strong>{size.quantity} Aktien</strong> · Einsatz {formatPrice(size.capital)} · Stop-Risiko {formatPrice(size.risk)} {selected.currency}</p>}
            {riskBudget.trim() && !size && <p className="form-help" role="status">Das Budget muss das Stop-Risiko mindestens einer Aktie abdecken.</p>}
            <p className="form-help">Bruttorechnung zum Limit. Gebühren, Slippage und Kurslücken können den tatsächlichen Verlust verändern.</p>
          </section>}
          {(setupState === "invalid" || setupState === "target") &&
            <p className="form-help">Ein Paper-Entwurf steht für aktive Setups mit gültigem Stop und Ziel zur Verfügung.</p>}
          <div className="screener-toolbar">
            <button
              type="button"
              className="button small primary"
              onClick={() => {
                const action = { symbol: selected.symbol, timeframe: "1D" } as const;
                useChartStore.getState().set(action);
                broadcastWorkspaceAction(action);
              }}
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
              disabled={!canPrepare}
              onClick={() => {
                if (!plan || !canPrepare) return;
                const { entry: entryMid, target1: tp1, target2: tp2, stop: sl } = plan;
                const currentQty = usePaperStore.getState().ticket.quantity;
                const qty = size?.quantity ?? (Number.isFinite(currentQty) && currentQty > 0 ? currentQty : 0.01);
                const leg1Qty = size ? Math.floor(qty / 2) : Number((qty / 2).toPrecision(8));
                const leg2Qty = qty - leg1Qty;
                const hasTwoTargets = tp2 > tp1 && leg1Qty >= 1e-12 && leg2Qty >= 1e-12;
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
                        stopLoss: sl,
                        takeProfit: tp1,
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
                  title: "Paper-Bracket vorbereitet",
                  message: hasTwoTargets
                    ? `${selected.ticker}: Limit ${formatPrice(entryMid)} · Stop ${formatPrice(sl)} · TP1 (${leg1Qty} Stk.) ${formatPrice(tp1)} · TP2 (${leg2Qty} Stk.) ${formatPrice(tp2)}`
                    : `${selected.ticker}: Limit ${formatPrice(entryMid)} · Stop ${formatPrice(sl)} · TP ${formatPrice(tp1)}`,
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
              Bracket-Order vorbereiten (Paper)
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
            <strong>Auslöser und Bestätigung</strong>
            <ul className="form-help">
              {(selected.whySetup ?? []).map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </div>

          <dl aria-label="Setup-Indikatoren und Fundamentaldaten">
            <div>
              <dt>Relative Stärke vs. {result?.benchmark ?? "Index"}</dt>
              <dd className="mono">{pct(selected.technicals.relativeStrengthPct)}</dd>
            </div>
            <div>
              <dt>Forward-KGV / FCF-Rendite</dt>
              <dd className="mono">{fixed(selected.fundamentals?.forwardPe, 1)}× / {fixed(selected.fundamentals?.fcfYieldPct, 1)}%</dd>
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

          <details className="opportunity-insider">
            <summary>Insider-Meldungen {selected.fundamentals?.recentInsiderFilings?.length ? `· ${selected.fundamentals.recentInsiderFilings.length}` : ""}</summary>
            {selected.fundamentals?.recentInsiderFilings?.length ? <ul>
              {selected.fundamentals.recentInsiderFilings.map((filing, index) => <li key={`${filing.date}-${filing.insider}-${index}`}>
                <strong>{filing.date} · {filing.insider}</strong><small>{filing.role} · {filing.form} · {filing.shares.toLocaleString("de-DE")} Aktien · {formatPrice(filing.valueUsd)} USD</small>
              </li>)}
            </ul> : <p className="form-help">Für dieses Setup liegen im Scan keine einzelnen Insider-Meldungen vor.</p>}
            {!!selected.fundamentals?.dataSources?.length && <p className="form-help">{selected.fundamentals.dataSources.join(" · ")}</p>}
          </details>
          <details>
            <summary>Setup-Score · {selected.score}/100 Punkte</summary>
            <p className="form-help">Punkte aus erfüllten Kriterien des jeweiligen Setup-Modells.</p>
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
    </div>
  );
}
