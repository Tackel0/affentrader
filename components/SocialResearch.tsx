"use client";

import { useEffect, useMemo, useState } from "react";
import { tickerOf } from "@/lib/symbolId";
import { normalizeSocialTicker, SOCIAL_SOURCE_LABELS, SOCIAL_TRACK_LIMIT, validSocialToken, type SocialResult, type SocialSourceStatus, type SocialWindow } from "@/lib/terminal/social";
import { useWatchlistStore } from "@/stores/useWatchlistStore";

let sessionXToken = "";
const states: Record<SocialSourceStatus["state"], string> = {
  ok: "Abgerufen", partial: "Teilabdeckung", unavailable: "Nicht verfügbar", "needs-access": "API-Zugang nötig", "rate-limited": "Abfragelimit erreicht",
};

export function SocialResearch({ activeTicker, requestedTicker }: { activeTicker: string; requestedTicker?: string }) {
  const [input, setInput] = useState(requestedTicker ?? "");
  const [selection, setSelection] = useState({ ticker: normalizeSocialTicker(requestedTicker), hours: 24 as SocialWindow });
  const [result, setResult] = useState<SocialResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<"all" | "reddit" | "x">("all");
  const [draftToken, setDraftToken] = useState("");
  const [hasToken, setHasToken] = useState(() => Boolean(sessionXToken));
  const [refreshNonce, setRefreshNonce] = useState(0);
  const watched = useWatchlistStore(state => state.lists.find(list => list.id === state.activeId)?.symbols);
  const tracked = useMemo(() => [...new Set((watched ?? []).filter(symbol => /^(?:YF|IEX|SIP):/.test(symbol))
    .map(symbol => normalizeSocialTicker(tickerOf(symbol))).filter((ticker): ticker is string => ticker !== null))]
    .slice(0, SOCIAL_TRACK_LIMIT).join(","), [watched]);

  useEffect(() => {
    const ticker = normalizeSocialTicker(requestedTicker);
    setInput(ticker ?? "");
    setSelection(current => current.ticker === ticker ? current : { ...current, ticker });
  }, [requestedTicker]);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError("");
    setLoading(true);
    async function load() {
      try {
        const response = await fetch("/api/terminal-social", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ ...selection, tracked: tracked ? tracked.split(",") : [], xToken: sessionXToken || undefined }),
        });
        const payload = (await response.json().catch(() => null)) as (SocialResult & { error?: string }) | null;
        if (!response.ok || !payload || !Array.isArray(payload.sources) || !Array.isArray(payload.trends) || !Array.isArray(payload.posts)) {
          throw new Error(payload?.error ?? "Social-Recherche nicht verfügbar.");
        }
        if (!controller.signal.aborted) setResult(payload);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Social-Recherche nicht verfügbar.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [selection, tracked, refreshNonce]);

  const search = (ticker: string | null, hours = selection.hours) => {
    setInput(ticker ?? "");
    setSelection({ ticker, hours });
  };
  const current = normalizeSocialTicker(activeTicker);
  const validInput = normalizeSocialTicker(input);
  const posts = result?.posts.filter(post => provider === "all" || (provider === "x") === (post.source === "x")) ?? [];
  const covered = result?.sources.filter(source => source.state === "ok" || source.state === "partial") ?? [];
  const hasReddit = covered.some(source => source.source !== "x"), hasX = covered.some(source => source.source === "x");
  return <section className="terminal-research-list terminal-social" aria-label="Social-Recherche">
    <form className="screener-toolbar" onSubmit={event => { event.preventDefault(); if (validInput || !input.trim()) search(validInput); }}>
      <label>Ticker <input type="search" value={input} onChange={event => setInput(event.target.value.toUpperCase())} maxLength={16} placeholder="z. B. NVDA" /></label>
      <label>Zeitraum <select value={selection.hours} onChange={event => search(selection.ticker, Number(event.target.value) as SocialWindow)}>
        <option value={24}>24 Stunden</option><option value={72}>72 Stunden</option>
      </select></label>
      <button type="submit" className="button primary" disabled={loading || (!!input.trim() && !validInput)}>Suchen</button>
      <button type="button" className="button" disabled={loading} onClick={() => setRefreshNonce(n => n + 1)}>Aktualisieren</button>
      {selection.ticker && <button type="button" className="button" onClick={() => search(null)}>Top-Liste</button>}
      {!selection.ticker && current && <button type="button" className="button" onClick={() => search(current)}>{current} suchen</button>}
    </form>

    {loading && <p role="status">Öffentliche Diskussionen werden abgerufen…</p>}
    {error && (
      <div role="alert" className="negative">
        <span>{error}</span>{" "}
        <button type="button" className="link-button" onClick={() => setRefreshNonce(n => n + 1)} disabled={loading}>
          Erneut versuchen
        </button>
      </div>
    )}
    {result && <ul className="social-source-status" aria-label="Datenquellen">{result.sources.map(source => <li key={source.source}>
      <strong>{SOCIAL_SOURCE_LABELS[source.source]}</strong><span>{states[source.state]}{source.samples > 0 ? ` · ${source.samples} geprüft` : ""}
        {source.fetchedAt ? ` · ${new Date(source.fetchedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
    </li>)}</ul>}
    <details className="social-access">
      <summary>X-Zugang{hasToken ? " · verbunden für diesen Tab" : ""}</summary>
      <form className="screener-toolbar" onSubmit={event => {
        event.preventDefault();
        const token = draftToken.trim();
        if (!validSocialToken(token)) return;
        sessionXToken = token;
        setHasToken(true);
        setDraftToken("");
        search(selection.ticker);
      }}>
        <label>API-Bearer-Token <input type="password" autoComplete="off" maxLength={512} value={draftToken} onChange={event => setDraftToken(event.target.value)} /></label>
        <button type="submit" className="button" disabled={!validSocialToken(draftToken.trim())}>X verbinden</button>
        {hasToken && <button type="button" className="button" onClick={() => { sessionXToken = ""; setHasToken(false); search(selection.ticker); }}>X-Zugang entfernen</button>}
        <a className="button" href={`https://x.com/search?${new URLSearchParams({ q: selection.ticker ? `$${selection.ticker}` : "WallStreetBets Aktien", f: "live" })}`} target="_blank" rel="noreferrer">X-Suche öffnen</a>
      </form>
      <p className="form-help">Der Zugang bleibt bis zum Neuladen in diesem Tab. X benötigt Zugriff auf die Recent Search API.</p>
    </details>

    {result && <>
      <h3>{result.ticker ? `Erwähnungen für ${result.ticker}` : "Meistdiskutierte Ticker"}</h3>
      <p className="form-help">Letzte {result.hours} Stunden · Auswertung {new Date(result.asOf).toLocaleString("de-DE")} · Ein Treffer je Beitrag und Ticker.</p>
      {!result.trends.length && <p role="status">{covered.length ? "In den verfügbaren Beiträgen gab es keine passenden Ticker-Erwähnungen." : "Die Quellen liefern aktuell keine auswertbaren Beiträge."}</p>}
      {!!result.trends.length && <table className="data-table social-trends" aria-label="Rangliste der Ticker-Erwähnungen">
        <thead><tr><th scope="col">Ticker</th><th scope="col">Gesamt</th><th scope="col">Reddit</th><th scope="col">X</th></tr></thead>
        <tbody>{result.trends.map(row => <tr key={row.ticker}>
          <td><button type="button" className="button small mono" onClick={() => search(row.ticker)}>{row.ticker}</button></td>
          <td>{row.count}</td><td>{hasReddit ? row.reddit : "—"}</td><td>{hasX ? row.x : "—"}</td>
        </tr>)}</tbody>
      </table>}
      {!!result.posts.length && <>
        <div className="screener-toolbar"><label>Originalbeiträge <select value={provider} onChange={event => setProvider(event.target.value as typeof provider)}>
          <option value="all">Alle Quellen</option><option value="reddit">Reddit</option><option value="x">X</option>
        </select></label></div>
        {!posts.length && <p className="form-help">Für diese Quelle sind in der Stichprobe keine Beiträge vorhanden.</p>}
        <div className="terminal-research-cards">
          {posts.map(post => <article className="terminal-research-card" key={`${post.source}:${post.id}`}>
            <header><strong>{SOCIAL_SOURCE_LABELS[post.source]}</strong><time dateTime={new Date(post.at).toISOString()}>{new Date(post.at).toLocaleString("de-DE")}</time></header>
            {post.title && <p><strong>{post.title}</strong></p>}
            {post.text && <p>{post.text}</p>}
            <p className="form-help mono">{post.tickers.map(ticker => `$${ticker}`).join(" · ")}</p>
            <a className="button small" href={post.url} target="_blank" rel="noreferrer">Original öffnen</a>
          </article>)}
        </div>
      </>}
    </>}
  </section>;
}
