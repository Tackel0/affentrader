"use client";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import type { NewsItem } from "@/lib/server/feeds";
import { getSymbol } from "@/lib/symbols";

export function timeAgo(time: number, now = Date.now()): string {
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function NewsPanel() {
  const symbol = useChartStore((s) => s.symbol);
  const watch = useWatchlistStore((s) => s.lists.find((l) => l.id === s.activeId)?.symbols ?? []);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"all" | "symbol" | "watchlist">("all");
  const [feedKind, setFeedKind] = useState<"all" | "equities" | "crypto">("all");
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetch(`/api/feeds?kind=news&scope=${feedKind}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          items?: NewsItem[];
          failed?: string[];
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "News unavailable");
        if (alive) {
          setItems(body.items ?? []);
          setFailed(body.failed ?? []);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tick, feedKind]);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 5 * 60_000);
    return () => clearInterval(timer);
  }, []);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((n) => {
      const syms = Array.isArray(n.symbols) ? n.symbols : [];
      if (scope === "symbol" && !syms.includes(symbol)) return false;
      if (scope === "watchlist" && !syms.some((s) => watch.includes(s))) return false;
      return !needle || `${n.title ?? ""} ${n.summary ?? ""}`.toLowerCase().includes(needle);
    });
  }, [items, scope, symbol, watch, query]);
  return (
    <div className="news-panel">
      <div className="screener-toolbar" style={{ gap: 4 }}>
        <div className="segmented">
          {(
            [
              ["all", "All"],
              ["equities", "Equities"],
              ["crypto", "Crypto"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} style={{ whiteSpace: "nowrap" }} className={feedKind === id ? "active" : ""} onClick={() => setFeedKind(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="segmented">
          {(
            [
              ["all", "All News"],
              ["symbol", `${getSymbol(symbol).base} Only`],
              ["watchlist", "Watchlist"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} style={{ whiteSpace: "nowrap" }} className={scope === id ? "active" : ""} onClick={() => setScope(id)}>
              {label}
            </button>
          ))}
        </div>
        <input aria-label="Search news" placeholder="Filter…" value={query} style={{ minWidth: 90, flex: "1 1 110px" }} onChange={(e) => setQuery(e.target.value)} />
        <button className="button small" onClick={() => setTick((t) => t + 1)} disabled={loading}>
          <RefreshCw size={12} className={loading ? "spin" : ""} /> Refresh
        </button>
        <span className="terminal-telemetry-chip mono">
          {loading ? "SYNCING NEWS" : `${shown.length} ITEMS${failed.length ? ` · ${failed.join(", ")} DOWN` : ""}`}
        </span>
      </div>
      {error ? <p className="error-message screener-error">{error}</p> : null}
      <div className="news-list">
        {loading && !shown.length && !error ? <div className="empty-table">Loading news feeds…</div> : null}
        {shown.map((n) => {
          const syms = Array.isArray(n.symbols) ? n.symbols : [];
          const publishedTs = Number.isFinite(n.published)
            ? n.published
            : Date.parse((n as NewsItem & { publishedAt?: string }).publishedAt ?? "");
          return (
            <article key={n.id}>
              <a href={n.link} target="_blank" rel="noopener noreferrer">
                {n.title}
                <ExternalLink size={11} />
              </a>
              {n.summary ? <p>{n.summary}</p> : null}
              <footer>
                <span className="mono" style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{n.source}</span>
                {Number.isFinite(publishedTs) ? <span className="mono">{timeAgo(publishedTs)}</span> : null}
                {syms.slice(0, 4).map((s) => (
                  <button key={s} className="chip" onClick={() => useChartStore.getState().set({ symbol: s })}>
                    {getSymbol(s).base}
                  </button>
                ))}
              </footer>
            </article>
          );
        })}
        {!shown.length && !loading && !error ? <div className="empty-table">No stories match.</div> : null}
      </div>
    </div>
  );
}
