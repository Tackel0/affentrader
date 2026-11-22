"use client";
import { useEffect, useRef, useState } from "react";
import { IEX_TICKER } from "@/lib/symbolId";
import { optionsFlowTicker } from "@/lib/market/optionsFlow";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { formatPrice } from "@/lib/symbols";
import type { InsiderFilingSummary } from "@/lib/screener/opportunities";

const secArchive = /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d{18}\/\d{10}-\d{2}-\d{6}-index\.htm$/;
interface Filings {
  ticker: string;
  source: string;
  observedAt: number;
  verified: boolean;
  filings: InsiderFilingSummary[];
}

export function InsiderResearch({ initialTicker }: { initialTicker: string }) {
  const [ticker, setTicker] = useState(initialTicker);
  const [result, setResult] = useState<Filings | null>(null);
  const [sort, setSort] = useState("date");
  const [minimum, setMinimum] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const symbols = useWatchlistStore(state => state.lists.find(list => list.id === state.activeId)?.symbols);
  const watched = (symbols ?? []).flatMap(symbol => {
    const ticker = optionsFlowTicker(symbol);
    return ticker ? [ticker] : [];
  });
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => setTicker(initialTicker), [initialTicker]);
  const load = async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch(`/api/terminal-insiders?${new URLSearchParams({ ticker })}`, { signal: controller.signal });
      const payload = await response.json() as Filings & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Insider-Meldungen nicht verfügbar.");
      if (!controller.signal.aborted) setResult(payload);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Insider-Meldungen nicht verfügbar.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const filtered = (result?.filings ?? []).filter(row => row.valueUsd >= minimum)
    .sort((a, b) => sort === "value" ? b.valueUsd - a.valueUsd : (b.filedAt ?? "").localeCompare(a.filedAt ?? ""));
  return <section className="terminal-research-list" aria-label="Insider-Recherche">
    <form className="screener-toolbar" onSubmit={event => { event.preventDefault(); void load(); }}>
      <label>US-Aktie <input value={ticker} maxLength={15} onChange={event => setTicker(event.target.value.toUpperCase())} placeholder="AAPL" /></label>
      {!!watched.length && <label>Watchlist <select value="" onChange={event => setTicker(event.target.value)}>
        <option value="" disabled>Aktie auswählen</option>
        {[...new Set(watched)].map(value => <option key={value}>{value}</option>)}
      </select></label>}
      <button type="submit" className="button primary" disabled={!IEX_TICKER.test(ticker) || loading}>Meldungen laden</button>
    </form>
    <div className="screener-toolbar">
      <label>Min. Volumen <select value={minimum} onChange={event => setMinimum(Number(event.target.value))}>
        <option value={0}>Alle</option>
        {[25000, 100000, 500000, 1000000].map(value => <option key={value} value={value}>{value.toLocaleString("de-DE")} USD</option>)}
      </select></label>
      <label>Sortieren <select value={sort} onChange={event => setSort(event.target.value)}>
        <option value="date">Veröffentlichung</option><option value="value">Volumen</option>
      </select></label>
    </div>
    <p className="form-help">Bis zu acht gemeldete Aktienkäufe aus bis zu zwölf SEC-Form-4-Dokumenten der letzten 90 Tage.</p>
    {loading && <p role="status">SEC-Meldungen werden geprüft…</p>}
    {error && <p className="negative" role="alert">{error}</p>}
    {result && <p role="status"><strong>{result.ticker} · {result.source}</strong> · {filtered.length} Käufe · Abgerufen {new Date(result.observedAt).toLocaleString("de-DE")}</p>}
    {result && !filtered.length && <p className="form-help">{result.verified ? "Im geprüften Bereich passen keine verifizierten Käufe zu den Filtern." : "Für diese Aktie steht derzeit keine verifizierte Transaktionsliste zur Verfügung."}</p>}
    <div className="terminal-research-cards">
      {filtered.map((row, index) => <article className="terminal-research-card" key={`${row.sourceUrl}-${row.insider}-${index}`}>
        <header><strong>{row.insider}</strong><span>{formatPrice(row.valueUsd)} USD</span></header>
        <p>{row.role} · {row.shares.toLocaleString("de-DE")} Aktien</p>
        <p className="form-help">Transaktion {row.transactionDate ?? "—"} · Veröffentlichung {row.filedAt ?? "—"}</p>
        {row.sourceUrl && secArchive.test(row.sourceUrl) && <a className="button small" href={row.sourceUrl} target="_blank" rel="noreferrer">SEC-Originalmeldung</a>}
      </article>)}
    </div>
  </section>;
}
