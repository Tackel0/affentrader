"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSetupJournal } from "@/stores/useSetupJournal";
import { useChartStore } from "@/stores/useChartStore";
import { useAlertStore } from "@/stores/useAlertStore";
import { editAlerts } from "@/lib/alerts/browserOwnership";
import { SETUP_ENTRY_SESSIONS, SETUP_OUTCOME_SESSIONS, setupAlertRules, setupRuleIds, summarizeSetupHistory, type SetupOutcome, type SetupRecord } from "@/lib/screener/setupJournal";
import { opportunityEntryDistance, opportunityReadiness, setupReadinessLabels } from "@/lib/screener/opportunities";
import type { YahooQuote } from "@/lib/market/yahoo";
import { formatPrice } from "@/lib/symbols";
import { isYahooTicker } from "@/lib/symbolId";
import { COMPACT_WORKSPACE_QUERY } from "@/lib/chart/bottomPanelResize";
import { AssetBadge } from "./ui";

const outcomeLabels: Record<SetupOutcome, string> = {
  waiting: "Limit offen bis", entered: "Nach Einstieg offen bis", target: "Ziel 1 erreicht", stopped: "Stop erreicht",
  invalid: "Vor Einstieg invalidiert", ambiguous: "Reihenfolge innerhalb des Tages unbekannt",
  expired: "Limit abgelaufen", "data-gap": "Kursdaten lückenhaft",
};

export const setupChartHref = (id: string) => `/?${new URLSearchParams({ setup: id })}`;

export function showSetupChart(setup: SetupRecord) {
  useSetupJournal.getState().show(setup.id);
  useChartStore.getState().set({ symbol: setup.symbol, timeframe: "1D",
    ...(window.matchMedia(COMPACT_WORKSPACE_QUERY).matches ? { bottomOpen: false } : {}) });
}

export function SetupResearch({ externalWindow }: { externalWindow: boolean }) {
  const { records, track } = useSetupJournal();
  const rules = useAlertStore(state => state.rules);
  const events = useAlertStore(state => state.events);
  const [history, setHistory] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [marketQuotes, setMarketQuotes] = useState<Record<string,YahooQuote>>({});
  const [notice, setNotice] = useState("");
  const [pastTicker, setPastTicker] = useState("");
  const [reconstructing, setReconstructing] = useState(false);
  const [replay, setReplay] = useState<{ ticker: string; sessions: number; stats: ReturnType<typeof summarizeSetupHistory> } | null>(null);
  const pastRequest = useRef<AbortController | null>(null);
  useEffect(() => () => pastRequest.current?.abort(), []);
  const selectedRows = useMemo(() => records.filter(row => (history || row.tracked) &&
    `${row.ticker} ${row.name}`.toLowerCase().includes(query.trim().toLowerCase())), [records, history, query]);
  const trackedSymbols = useMemo(() => history ? [] : [...new Set(selectedRows.map(row => row.symbol))], [history, selectedRows]);
  const watchKey = useMemo(() => history ? "" : [...new Set(records.filter(row => row.tracked).map(row => row.ticker))].sort().join(","), [history, records]);
  useEffect(() => {
    if (!watchKey) return;
    let pending: AbortController | undefined;
    const poll = async () => {
      if (document.hidden || pending) return;
      const controller = new AbortController();
      pending = controller;
      try {
        const tickers = watchKey.split(",");
        const groups = Array.from({ length: Math.ceil(tickers.length / 20) }, (_, i) => tickers.slice(i * 20, i * 20 + 20));
        const batches = await Promise.allSettled(groups.map(async group => {
          const search = new URLSearchParams({ kind: "spark", symbols: group.join(",") });
          const response = await fetch(`/api/yahoo?${search}`, { signal: controller.signal });
          if (!response.ok) throw new Error("Kursdaten fehlen.");
          const payload = (await response.json().catch(() => null)) as { quotes?: Record<string, YahooQuote> } | null;
          return payload?.quotes ?? {};
        }));
        if (!controller.signal.aborted) setMarketQuotes(Object.assign({}, ...batches.flatMap(batch => batch.status === "fulfilled" ? [batch.value] : [])));
      } finally { if (pending === controller) pending = undefined; }
    };
    void poll();
    const timer = setInterval(poll, 60_000);
    document.addEventListener("visibilitychange", poll);
    return () => { clearInterval(timer); pending?.abort(); document.removeEventListener("visibilitychange", poll); };
  }, [watchKey]);

  const quotes = useChartStore(useShallow(state => Object.fromEntries(trackedSymbols.map(symbol => [symbol, state.quotes[symbol]]))));
  const sorted = useMemo(() => {
    const now = Date.now();
    return selectedRows.map(row => {
      const workspaceQuote = quotes[row.symbol], fetched = marketQuotes[row.ticker];
      const latest = workspaceQuote && !workspaceQuote.simulated && workspaceQuote.time >= (fetched?.time ?? 0) ? workspaceQuote : fetched;
      const quote = latest && Number.isFinite(latest.price) && latest.price > 0 && Number.isSafeInteger(latest.time) && latest.time > 0 && latest.time <= now + 60_000 ? latest : undefined;
      const levels = quote && !history ? { ...row.levels, lastClose: quote.price } : row.levels;
      return { row, quote, state: opportunityReadiness(levels).status, distance: opportunityEntryDistance(levels) };
    }).sort((a, b) => history
      ? b.row.session.localeCompare(a.row.session) || b.row.observedAt - a.row.observedAt || b.row.score - a.row.score
      : (a.distance ?? Infinity) - (b.distance ?? Infinity) || b.row.score - a.row.score);
  }, [selectedRows, marketQuotes, quotes, history]);
  const lastPage = Math.max(0, Math.ceil(sorted.length / 20) - 1);
  const currentPage = Math.min(lastPage, page);
  const toggleAlerts = async (row: SetupRecord) => {
    const ids = setupRuleIds(row.id);
    try {
      const enabled = await editAlerts(store => {
        if (store.rules.some(rule => ids.some(id => rule.id === id) && rule.status === "active")) {
          for (const id of ids) store.removeRule(id);
          return false;
        }
        for (const rule of setupAlertRules(row, Date.now())) { store.removeRule(rule.id); store.addRule(rule); }
        return true;
      });
      setNotice(enabled ? `${row.ticker} · Einstieg und Stop als Browser-Alerts aktiviert.` : `${row.ticker} · Setup-Alerts entfernt.`);
    } catch {
      setNotice("Die Setup-Alerts konnten nicht gespeichert werden.");
    }
  };
  const updateTracking = async (row: SetupRecord) => {
    try {
      if (row.tracked) await editAlerts(store => {
        for (const id of setupRuleIds(row.id)) if (store.rules.some(rule => rule.id === id && rule.status === "active"))
          store.updateRule(id, { status: "paused" });
      });
      track(row.id, !row.tracked);
    } catch { setNotice("Die Setup-Watchlist konnte nicht aktualisiert werden."); }
  };
  const reconstruct = async () => {
    pastRequest.current?.abort();
    const controller = new AbortController();
    pastRequest.current = controller;
    setReconstructing(true);
    setReplay(null);
    try {
      const response = await fetch(`/api/terminal-setups?${new URLSearchParams({ ticker: pastTicker })}`, { signal: controller.signal });
      const data = (await response.json().catch(() => null)) as { records?: SetupRecord[]; sessions: number; error?: string } | null;
      if (!response.ok || !data?.records) throw new Error(data?.error ?? "Historische Signale fehlen.");
      if (controller.signal.aborted) return;
      useSetupJournal.getState().importHistory(data.records);
      setQuery(pastTicker); setPage(0);
      setReplay({ ticker: pastTicker, sessions: data.sessions, stats: summarizeSetupHistory(data.records) });
      setNotice("");
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Historische Signale fehlen.");
    } finally { if (!controller.signal.aborted) setReconstructing(false); }
  };
  return <section className="terminal-research-list" aria-label="Setup-Watchlist und Historie">
    <div className="screener-toolbar">
      <button type="button" className="button" aria-pressed={!history} onClick={() => { setHistory(false); setPage(0); }}>Setup-Watchlist</button>
      <button type="button" className="button" aria-pressed={history} onClick={() => { setHistory(true); setPage(0); }}>Signal-Historie</button>
      <label>Aktie <input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
    </div>
    <p className="form-help">{history ? "Beobachtete Scans behalten ihre ursprünglichen Niveaus. Die Rekonstruktion verwendet nur bis dahin verfügbare Tageskerzen und technische Kriterien." : "Sortiert nach Abstand zur Einstiegszone. Aktienkurse können verzögert sein. Browser-Alerts benötigen einen geöffneten Chart-Workspace."}</p>
    {history && <form className="screener-toolbar" onSubmit={event => { event.preventDefault(); void reconstruct(); }}>
      <label>Historischer Ticker <input value={pastTicker} maxLength={20} onChange={event => setPastTicker(event.target.value.trim().toUpperCase())} placeholder="AAPL" /></label>
      <button className="button small" type="submit" disabled={!isYahooTicker(pastTicker) || reconstructing}>Vergangene Signale laden</button>
    </form>}
    {notice && <p role="status">{notice}</p>}
    {history && replay && <div className="terminal-research-card" role="status">
      <header><strong>{replay.ticker} · {replay.sessions} Sitzungen</strong></header>
      <p>Ziel 1 {replay.stats.target} · Stops {replay.stats.stopped} · Offen {replay.stats.open} · Ohne Einstieg {replay.stats.unfilled} · Uneindeutig {replay.stats.uncertain}</p>
      <p className="form-help">Technische Signale mit planbarem Einstieg. Limit an der Zonenmitte ab der Folgesitzung für {SETUP_ENTRY_SESSIONS} Sitzungen. Auswertung bis {SETUP_OUTCOME_SESSIONS} Sitzungen nach dem Signal.</p>
      {!!replay.stats.byPattern.length && <details>
        <summary>Nach Setup-Typ</summary>
        <ul>{replay.stats.byPattern.map(([label, sample]) => <li key={label}>{label} · {sample.total} Signale · {sample.target} Ziel 1 · {sample.stopped} Stops</li>)}</ul>
      </details>}
    </div>}
    {!sorted.length && <p className="form-help">{history ? "Das Archiv füllt sich mit Treffern aus Trade-Möglichkeiten." : "Übernimm ein Setup aus dem Scanner in die Watchlist."}</p>}
    <div className="terminal-research-cards">
      {sorted.slice(currentPage * 20, (currentPage + 1) * 20).map(({ row, quote, state, distance }) => {
        const ids = setupRuleIds(row.id);
        const active = rules.some(rule => ids.some(id => rule.id === id) && rule.status === "active");
        const filled = events.find(event => event.ruleId === ids[0]);
        const stopped = events.find(event => event.ruleId === ids[1]);
        return <article key={row.id} className="terminal-research-card">
          <header><strong className="asset-inline"><AssetBadge symbol={row.symbol} size="xs" />{row.ticker} · {row.label}</strong><span>{row.score}/100</span></header>
          <p className="form-help">Signal {row.session} · {row.currency}{row.reconstructed ? " · technisch rekonstruiert" : ` · Scan ${new Date(row.observedAt).toLocaleString("de-DE")}`}</p>
          {!history && <p>{stopped ? "Stop gemeldet" : setupReadinessLabels[state]}{distance !== null && !stopped ? ` · ${distance.toFixed(2)} % zur Zone` : ""}{filled && !stopped ? " · Einstieg gemeldet" : ""}</p>}
          <p className="mono">Zone {row.levels.entryZone.map(price => formatPrice(price)).join("–")} · Stop {formatPrice(row.levels.invalidation)} · Ziele {formatPrice(row.levels.target1)} / {formatPrice(row.levels.target2)}</p>
          {!history && <small className="form-help">{quote ? `Kurs ${formatPrice(quote.price)} · ${new Date(quote.time).toLocaleString("de-DE")}` : `Tagesschluss ${formatPrice(row.levels.lastClose)} · ${row.session}`}</small>}
          {history && (filled || stopped) && <p className="form-help">{filled ? `Einstieg gemeldet ${new Date(filled.time).toLocaleString("de-DE")}` : ""}{filled && stopped ? " · " : ""}{stopped ? `Stop gemeldet ${new Date(stopped.time).toLocaleString("de-DE")}` : ""}</p>}
          {history && row.outcome && <p className="form-help">{outcomeLabels[row.outcome.status]} · {row.outcome.session}</p>}
          <div className="screener-toolbar">
            {externalWindow
              ? <a className="button small" href={setupChartHref(row.id)} target="_blank" rel="noopener noreferrer">Niveaus im Chart</a>
              : <button type="button" className="button small" onClick={() => showSetupChart(row)}>Niveaus im Chart</button>}
            {!row.reconstructed && <button type="button" className="button small" onClick={() => void updateTracking(row)}>{row.tracked ? "Aus Watchlist" : "Übernehmen"}</button>}
            {row.tracked && !stopped && <button type="button" className="button small" onClick={() => void toggleAlerts(row)}>{active ? "Alerts ausschalten" : "Alerts aktivieren"}</button>}
          </div>
        </article>;
      })}
    </div>
    {lastPage > 0 && <div className="opportunity-pagination">
      <button className="button small" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Zurück</button>
      <span>Seite {currentPage + 1} von {lastPage + 1}</span>
      <button className="button small" type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Weiter</button>
    </div>}
  </section>;
}
