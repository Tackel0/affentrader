"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Check, SlidersHorizontal, ArrowUp, ArrowDown, RotateCcw, X } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { SYMBOLS, formatPrice } from "@/lib/symbols";
import { loadSymbolCatalog } from "@/hooks/useSymbolCatalog";
import {
  exchangeOfTicker,
  MARKET_TABS,
  POPULAR,
  POPULAR_BY_EXCHANGE,
  STOCK_EXCHANGES,
  TYPE_FOR_TAB,
  type MarketTab,
} from "@/lib/markets";
import { bybitSymbol, displayTicker, isYahooTicker, registerSymbolInfo, symbolInfo, spotQuoteCurrency, tickerOf, yahooSymbol, iexSymbol, sipSymbol, IEX_TICKER } from "@/lib/symbolId";
import { useAlpacaStore } from "@/stores/useAlpacaStore";
import { hyperliquidCatalog } from "@/hooks/useHyperliquidCatalog";
import type { HyperliquidAsset } from "@/lib/market/hyperliquid";
import { yahooSearch } from "@/lib/market/yahooClient";
import { loadBybitCatalog } from "@/lib/market/bybitClient";
import { searchMarketSnapshots, type SearchMarketSnapshots } from "@/lib/market/searchMarketSnapshots";
import {
  DEFAULT_SEARCH_EXCHANGE_PRIORITY,
  rankedSearchRows,
  SEARCH_EXCHANGES,
  searchExchangeLabel,
  searchVenue,
  type SearchRow as Row,
} from "@/lib/market/symbolSearch";
import type { YahooSearchHit } from "@/lib/market/yahoo";
import type { AssetCategory, MarketSymbol } from "@/types/trading";
import { Modal, AssetBadge } from "./ui";

type SearchMarket = MarketTab | "all";
const SEARCH_TABS = [{ id: "all", label: "All markets" } as const, ...MARKET_TABS];
const STABLE_QUOTE = /(?:USDT|USDC)$/;
const DEFAULT_KRAKEN_PAIRS = ["BTC/USD", "ETH/USD", "SOL/USD"];
const BYBIT_PERPS = "bybit-linear";

function yahooRow(hit: YahooSearchHit): Row {
  return {
    symbol: yahooSymbol(hit.symbol),
    base: displayTicker(yahooSymbol(hit.symbol)),
    name: hit.name,
    venue: [hit.exchange, "Yahoo Finance"].filter(Boolean).join(" · "),
    quote: exchangeOfTicker(hit.symbol).currency,
    type: hit.type,
    realTime: false,
  };
}

export function SymbolSearch() {
  const open = useChartStore((s) => s.searchOpen);
  const target = useChartStore((s) => s.searchTarget);
  if (!open) return null;
  return <SymbolSearchModal target={target} />;
}

function SymbolSearchModal({ target }: { target: "chart" | "watchlist" }) {
  const [equityFeed, setEquityFeed] = useState<"yahoo" | "iex" | "sip">("yahoo");
  const [venueControlsOpen, setVenueControlsOpen] = useState(false);
  const searchPreferences = useWorkspaceStore((s) => s.searchPreferences);
  const enabledExchanges = useMemo(
    () => new Set(searchPreferences.enabledExchanges),
    [searchPreferences.enabledExchanges],
  );
  const alpacaEnabled = useAlpacaStore(state => state.enabled);
  const feed = equityFeed === "sip" && target === "watchlist" ? "yahoo" : equityFeed;
  const alpaca = useCallback((m: SearchMarket) => feed !== "yahoo" && (m === "stock" || m === "etf"), [feed]);
  const equitySymbol = feed === "sip" ? sipSymbol : iexSymbol;
  const equityVenue = feed === "sip" ? "SIP · Alpaca" : "IEX · Alpaca";
  const watchSymbols = useWatchlistStore((state) => target === "watchlist"
    ? state.lists.find((list) => list.id === state.activeId)?.symbols
    : undefined);
  const [query, setQuery] = useState(""),
    [debounced, setDebounced] = useState(""),
    [category, setCategory] = useState<AssetCategory>("All"),
    [market, setMarket] = useState<SearchMarket>("all"),
    [catalog, setCatalog] = useState<MarketSymbol[]>(SYMBOLS),
    [remote, setRemote] = useState<{ query: string; hits: YahooSearchHit[] }>({ query: "", hits: [] }),
    [exchange, setExchange] = useState("all"),
    [dex, setDex] = useState("all"),
    [perps, setPerps] = useState<HyperliquidAsset[]>([]),
    [snapshots, setSnapshots] = useState<SearchMarketSnapshots>(),
    [bybit, setBybit] = useState<Awaited<ReturnType<typeof loadBybitCatalog>>>([]),
    [bybitUnavailable, setBybitUnavailable] = useState(false),
    [perpsError, setPerpsError] = useState(""),
    [perpsRetry, setPerpsRetry] = useState(0),
    [bybitRetry, setBybitRetry] = useState(0),
    [activeIndex, setActiveIndex] = useState(0),
    [loading, setLoading] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const close = useCallback(
    () => useChartStore.getState().set({ searchOpen: false }),
    [],
  );
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadSymbolCatalog()
      .then((list) => {
        if (!cancelled) setCatalog(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const hasQuery = Boolean(debounced.trim());
  const needsPerps = enabledExchanges.has("hyperliquid") && (market === "perps" || (market === "all" && hasQuery));
  useEffect(() => {
    if (!needsPerps) return;
    let cancelled = false;
    setPerpsError("");
    void hyperliquidCatalog()
      .then(assets => { if (!cancelled) setPerps(assets); })
      .catch(() => { if (!cancelled) setPerpsError("Hyperliquid is temporarily unavailable."); });
    return () => { cancelled = true; };
  }, [needsPerps, perpsRetry]);
  const needsSnapshots = (enabledExchanges.has("binance") || enabledExchanges.has("kraken"))
    && hasQuery && (market === "all" || market === "crypto");
  useEffect(() => {
    if (!needsSnapshots) return;
    let cancelled = false;
    void searchMarketSnapshots().then(value => { if (!cancelled) setSnapshots(value); });
    return () => { cancelled = true; };
  }, [needsSnapshots]);
  const needsBybit = enabledExchanges.has("bybit") && (hasQuery && (market === "all" || market === "crypto") || market === "perps");
  useEffect(() => {
    if (!needsBybit) return;
    let cancelled = false;
    setBybitUnavailable(false);
    void loadBybitCatalog().then(value => {
      if (cancelled) return;
      setBybit(value);
      setBybitUnavailable(!value.length);
    });
    return () => { cancelled = true; };
  }, [needsBybit, bybitRetry]);

  const searchYahoo = (enabledExchanges.has("yahoo") || enabledExchanges.has("alpaca"))
    && market !== "crypto" && market !== "perps";
  useEffect(() => {
    const text = debounced.trim();
    if (!searchYahoo || !text) return;
    const abort = new AbortController();
    void yahooSearch(text, (input, init) => fetch(input, { ...init, signal: init?.signal
      ? AbortSignal.any([init.signal, abort.signal]) : abort.signal }))
      .then(hits => { if (!abort.signal.aborted) setRemote({ query: text, hits }); })
      .catch(() => { if (!abort.signal.aborted) setRemote({ query: text, hits: [] }); });
    return () => abort.abort();
  }, [searchYahoo, debounced]);

  const perpRows = useMemo<Row[]>(() => perps
    .filter(a => market !== "perps" || dex === "all" || (dex === "main" ? !a.dex : a.dex === dex))
    .map(a => ({
      symbol: a.symbol, base: a.name, name: `${a.name} perpetual`,
      venue: a.dex ? `Hyperliquid · ${a.dexName} · Perp` : "Hyperliquid · Perp",
      quote: "USD", type: "future", realTime: true, price: a.mark, turnover: a.volume,
    })), [perps, dex, market]);
  const dexes = useMemo(() => [...new Map(perps.filter(a => a.dex).map(a => [a.dex, a.dexName])).entries()], [perps]);
  const crypto = useMemo<Row[]>(() => catalog
    .filter(s => market !== "crypto" || category === "All" || s.category === category)
    .map(s => ({
      symbol: s.symbol, base: s.base, name: s.name, venue: "Binance · Spot", quote: "USDT",
      realTime: true, ...snapshots?.binance.get(s.symbol),
    })), [catalog, category, market, snapshots]);
  const krakenRows = useMemo<Row[]>(() => (market !== "crypto" || category === "All" ? [
    ...new Set([...DEFAULT_KRAKEN_PAIRS, ...(snapshots?.kraken.keys() ?? [])]),
  ].map(pair => {
    const [base, quote] = pair.split("/");
    return { symbol: `KRK:${pair}`, base, name: `${base} / ${quote}`, venue: "Kraken · Spot", quote,
      realTime: true, ...snapshots?.kraken.get(pair) };
  }) : []), [category, market, snapshots]);
  const bybitRows = useMemo<Row[]>(() => bybit
    .filter(({ category: kind }) => market === "all" || (market === "crypto" && kind === "spot" && category === "All")
      || (market === "perps" && kind === "linear" && (dex === "all" || dex === BYBIT_PERPS)))
    .map(({ ticker, category: kind }) => ({
      symbol: bybitSymbol(kind, ticker.pair), base: ticker.pair.replace(STABLE_QUOTE, ""),
      name: ticker.pair, venue: kind === "spot" ? "Bybit · Spot" : "Bybit · Perp",
      quote: spotQuoteCurrency(ticker.pair), type: kind === "spot" ? "crypto" : "future",
      price: ticker.price, turnover: ticker.turnover, realTime: true,
    })), [bybit, category, dex, market]);

  const listings = useMemo<Row[]>(() => {
    if (market === "crypto" || market === "perps") return [];
    const listings = market === "all" ? Object.entries(POPULAR).flatMap(([kind, rows]) =>
      rows.map(row => ({ ...row, type: TYPE_FOR_TAB[kind as keyof typeof TYPE_FOR_TAB] }))) :
      ((market === "stock" || market === "etf") && exchange !== "all" && exchange !== "us" ?
        POPULAR_BY_EXCHANGE[exchange] ?? [] : POPULAR[market])
        .map(row => ({ ...row, type: TYPE_FOR_TAB[market] }));
    const hits = remote.query === debounced.trim() ? remote.hits : [];
    return [
      ...listings.map(row => ({ ...yahooRow({ ...row, symbol: row.ticker }), quote: row.currency })),
      ...hits.filter(hit => isYahooTicker(hit.symbol)).map(yahooRow),
    ].filter(row => (market === "all" || row.type === TYPE_FOR_TAB[market] || (market === "stock" && row.type === "other"))
      && (market === "all" || exchange === "all" || (market !== "stock" && market !== "etf")
        || exchangeOfTicker(tickerOf(row.symbol)).id === exchange));
  }, [market, exchange, remote, debounced]);

  const equityRows = useMemo<Row[]>(() => (
    alpaca(market) || (market === "all" && alpacaEnabled)
      ? listings.filter(row => IEX_TICKER.test(row.base) && row.quote === "USD" && (row.type === "stock" || row.type === "etf"))
        .map(row => ({ ...row, symbol: market === "all" ? iexSymbol(row.base) : equitySymbol(row.base),
          venue: market === "all" ? "IEX · Alpaca" : equityVenue, realTime: market === "all" || feed === "iex" }))
      : []
  ), [alpaca, market, alpacaEnabled, listings, equitySymbol, equityVenue, feed]);
  const direct = useMemo<Row | null>(() => (
    alpaca(market) && IEX_TICKER.test(debounced.trim().toUpperCase()) ? {
      symbol: equitySymbol(debounced), base: debounced.trim().toUpperCase(),
      name: "US ticker · availability requires provider confirmation", venue: equityVenue, quote: "USD",
    } : null
  ), [alpaca, market, debounced, equitySymbol, equityVenue]);
  const results = useMemo(() => rankedSearchRows(
    market === "all" ? [...crypto, ...krakenRows, ...perpRows, ...bybitRows, ...listings, ...equityRows] :
    market === "crypto" ? [...crypto, ...krakenRows, ...bybitRows] :
    market === "perps" ? [...perpRows, ...bybitRows] :
    alpaca(market) ? [...(direct ? [direct] : []), ...equityRows] : listings,
    query.trim(),
    150,
    searchPreferences,
  ), [market, crypto, krakenRows, perpRows, bybitRows, listings, equityRows, alpaca, direct, query, searchPreferences]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, market, category, exchange, dex]);

  const clampedIndex = results.length ? Math.min(activeIndex, results.length - 1) : 0;

  const scrollResultIntoView = useCallback((index: number) => {
    const el = resultsRef.current?.children[index] as HTMLElement | undefined;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }, []);

  const allExchangesEnabled = searchPreferences.enabledExchanges.length === SEARCH_EXCHANGES.length;
  const activePriorityPreview = searchPreferences.exchangePriority
    .filter((id) => enabledExchanges.has(id))
    .slice(0, 3)
    .map((id) => searchExchangeLabel(id, true))
    .join(" → ");
  const isDefaultPriority = DEFAULT_SEARCH_EXCHANGE_PRIORITY.every(
    (id, index) => searchPreferences.exchangePriority[index] === id,
  );
  const searching = loading || (searchYahoo && hasQuery && remote.query !== debounced.trim());
  const choose = (row: Row) => {
    if ((row.symbol.startsWith("IEX:") || row.symbol.startsWith("SIP:")) && row.name !== direct?.name) registerSymbolInfo({ symbol: row.symbol, name: row.name, exchange: row.venue, currency: "USD", type: row.type ?? "stock", delayed: row.symbol.startsWith("SIP:"), timezone: "America/New_York" });
    if (row.symbol.startsWith("YF:") && !symbolInfo(row.symbol)) {
      const wanted = row.type ?? "stock";
      registerSymbolInfo({
        symbol: row.symbol,
        name: row.name,
        exchange: row.venue,
        currency: row.quote || "USD",
        type: wanted,
        delayed: !row.realTime,
      });
    }
    if (row.symbol.startsWith("HL:") && !symbolInfo(row.symbol))
      registerSymbolInfo({
        symbol: row.symbol,
        name: row.name,
        exchange: row.venue,
        currency: "USD",
        type: "future",
        delayed: false,
      });
    if (target === "watchlist") useWatchlistStore.getState().addSymbol(row.symbol);
    else {
      useChartStore.getState().set({ symbol: row.symbol });
      close();
    }
  };
  return (
    <Modal
      title={
        target === "watchlist" ? "Add symbols to watchlist" : "Symbol search"
      }
      onClose={close}
      className="search-modal"
      initialFocusSelector='input[aria-label="Search symbols"]'
    >
      <div className="search-field">
        <Search size={19} />
        <input
          aria-label="Search symbols"
          placeholder={market === "crypto" || market === "perps" ? "Search symbol or asset name" : "Search by name or ticker"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && results.length > 0) {
              e.preventDefault();
              const next = (clampedIndex + 1) % results.length;
              setActiveIndex(next);
              scrollResultIntoView(next);
            } else if (e.key === "ArrowUp" && results.length > 0) {
              e.preventDefault();
              const next = (clampedIndex - 1 + results.length) % results.length;
              setActiveIndex(next);
              scrollResultIntoView(next);
            } else if (e.key === "Enter" && query.trim() === debounced.trim() && results[clampedIndex]) {
              e.preventDefault();
              choose(results[clampedIndex]);
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setDebounced("");
            }}
          >
            <X size={14} />
          </button>
        ) : null}
        <kbd>↵</kbd>
      </div>
      <div className="filter-tabs market-tabs" role="tablist" aria-label="Market">
        {SEARCH_TABS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={market === m.id}
            className={market === m.id ? "active" : ""}
            onClick={() => setMarket(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="search-venue-bar">
        <button
          type="button"
          className={`search-venue-toggle${venueControlsOpen || !allExchangesEnabled || !isDefaultPriority ? " active" : ""}`}
          aria-expanded={venueControlsOpen}
          onClick={() => setVenueControlsOpen((v) => !v)}
        >
          <SlidersHorizontal size={14} />
          <span className="search-venue-summary">
            Börsen: {allExchangesEnabled ? "Alle" : `${searchPreferences.enabledExchanges.length}/${SEARCH_EXCHANGES.length}`}
            {activePriorityPreview ? ` · Priorität: ${activePriorityPreview}` : ""}
          </span>
        </button>
        {(!allExchangesEnabled || !isDefaultPriority) ? (
          <button
            type="button"
            className="search-venue-reset"
            aria-label="Börsenfilter und Priorität zurücksetzen"
            onClick={() => useWorkspaceStore.getState().resetSearchPreferences()}
          >
            <RotateCcw size={13} />
            <span>Standard</span>
          </button>
        ) : null}
      </div>
      {venueControlsOpen ? (
        <div className="search-venue-panel" role="region" aria-label="Börsenfilter und Priorität">
          <div className="search-venue-section">
            <div className="search-venue-heading">
              <span>Angezeigte Börsen</span>
              {!allExchangesEnabled ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    useWorkspaceStore.getState().setSearchPreferences({
                      enabledExchanges: [...DEFAULT_SEARCH_EXCHANGE_PRIORITY],
                    })
                  }
                >
                  Alle aktivieren
                </button>
              ) : null}
            </div>
            <div className="search-exchange-chips" role="group" aria-label="Börsen filtern">
              {SEARCH_EXCHANGES.map((ex) => {
                const active = enabledExchanges.has(ex.id);
                return (
                  <button
                    key={ex.id}
                    type="button"
                    aria-pressed={active}
                    className={`search-exchange-chip${active ? " active" : ""}`}
                    onClick={() => useWorkspaceStore.getState().toggleSearchExchange(ex.id)}
                  >
                    {ex.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="search-venue-section">
            <div className="search-venue-heading">
              <span>Priorität in Suchergebnissen</span>
              <span className="muted">1 = zuerst</span>
            </div>
            <ol className="search-priority-list" aria-label="Börsen-Priorität">
              {searchPreferences.exchangePriority.map((id, index) => {
                const active = enabledExchanges.has(id);
                const label = searchExchangeLabel(id);
                return (
                  <li key={id} className={`search-priority-item${active ? "" : " disabled"}`}>
                    <span className="search-priority-rank mono">{index + 1}.</span>
                    <span className="search-priority-name">{label}</span>
                    <div className="search-priority-actions">
                      <button
                        type="button"
                        aria-label={`${label} nach oben`}
                        disabled={index === 0}
                        onClick={() => useWorkspaceStore.getState().moveSearchExchange(id, "up")}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`${label} nach unten`}
                        disabled={index === searchPreferences.exchangePriority.length - 1}
                        onClick={() => useWorkspaceStore.getState().moveSearchExchange(id, "down")}
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      ) : null}
      {market === "perps" ? (
        <div className="filter-tabs" role="group" aria-label="Perpetual venues">
          {([["all", "All venues"], [BYBIT_PERPS, "Bybit"], ["main", "Hyperliquid"], ...dexes] as [string, string][]).map(([id, label]) => (
            <button key={id} type="button" className={dex === id ? "active" : ""} onClick={() => setDex(id)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {market === "stock" || market === "etf" ? (
        <div className="exchange-select">
          <label>Data source<select aria-label="Equity data source" value={feed} onChange={event => { setEquityFeed(event.target.value as typeof equityFeed); setExchange("all"); }}><option value="yahoo">Yahoo Finance · delayed</option><option value="iex">Alpaca · IEX only</option>{target === "chart" && <option value="sip">Alpaca · delayed SIP history</option>}</select></label>
          {alpaca(market) ? <button type="button" className="button" onClick={() => { close(); useAlpacaStore.setState({ open: true }); }}>Alpaca connection…</button> :
          <label>
            Exchange
            <select aria-label="Exchange" value={exchange} onChange={(e) => setExchange(e.target.value)}>
              <option value="all">All exchanges</option>
              {STOCK_EXCHANGES.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.label} {ex.suffix ? `(${ex.suffix})` : ""}
                </option>
              ))}
            </select>
          </label>
          }
        </div>
      ) : null}
      {market === "crypto" ? (
        <div className="filter-tabs">
          {(
            [
              "All",
              "Layer 1",
              "DeFi",
              "Meme",
              "Infrastructure",
            ] as AssetCategory[]
          ).map((c) => (
            <button
              key={c}
              type="button"
              className={category === c ? "active" : ""}
              onClick={() => setCategory(c)}
            >
              {c === "All" ? "All assets" : c}
            </button>
          ))}
        </div>
      ) : null}
      <div className="search-caption">
        <span>SYMBOL / NAME</span>
        <span>{market === "all" ? "SOURCE / 24H TURNOVER" : market === "crypto" ? "SPOT" : market === "perps" ? "PERPETUAL" : alpaca(market) ? `${equityVenue.toUpperCase()} · ALPACA KEY REQUIRED` : "YAHOO FINANCE · DELAYED"}</span>
      </div>
      <div className="search-results" ref={resultsRef}>
        {results.map((s, idx) => (
          <button
            type="button"
            className={`symbol-result${idx === clampedIndex ? " highlighted" : ""}`}
            data-active={idx === clampedIndex ? "true" : undefined}
            key={s.symbol}
            onMouseEnter={() => setActiveIndex(idx)}
            onClick={() => choose(s)}
          >
            <AssetBadge symbol={s.symbol} />
            <span className="asset-copy">
              <strong>
                {s.base}
                {s.quote ? <span className="muted">{s.quote}</span> : null}
              </strong>
              <small>{s.name}</small>
              <span className="result-exchange">{searchVenue(s)}</span>
            </span>
            <SearchQuote symbol={s.symbol} snapshot={s.price} />
            {target === "watchlist" ? (
              watchSymbols?.includes(s.symbol) ? (
                <Check size={16} className="positive" />
              ) : (
                <Plus size={16} />
              )
            ) : null}
          </button>
        ))}
        {!results.length ? (
          <div className="empty-state">
            {searchPreferences.enabledExchanges.length === 0 ? (
              <>
                <p>Keine Börsen im Filter aktiv.</p>
                <button
                  type="button"
                  className="button small"
                  onClick={() =>
                    useWorkspaceStore.getState().setSearchPreferences({
                      enabledExchanges: [...DEFAULT_SEARCH_EXCHANGE_PRIORITY],
                    })
                  }
                >
                  Alle Börsen aktivieren
                </button>
              </>
            ) : perpsError && market === "perps" ? (
              <>
                <span>{perpsError}</span>{" "}
                <button type="button" className="link-button" onClick={() => setPerpsRetry((n) => n + 1)}>
                  Retry
                </button>
              </>
            ) : searching ? "Searching…" : `No symbols match “${debounced}”.`}
          </div>
        ) : null}
      </div>
      <div className="modal-footnote">
        {searching
          ? "Searching…"
          : market === "all"
            ? "Exakte Treffer zuerst, sortiert nach deiner Börsen-Priorität und 24h-Umsatz."
            : market === "crypto"
            ? "Spot markets from Binance, Kraken and Bybit."
            : market === "perps"
              ? "Perpetual markets from Hyperliquid and Bybit. Equity perpetuals are separate from listed shares."
              : alpaca(market) ? feed === "sip" ? "Consolidated US stock history with a 16-minute cutoff. Alpaca credentials are required." : "Real-time IEX trades and minute bars. Account key required in Market data connections. 30-symbol stream limit." : "Stocks, ETFs, indices and forex come from Yahoo Finance and are typically delayed 15 minutes for US exchanges."}
        {needsBybit && bybitUnavailable ? (
          <span role="status">
            {" "}Bybit data is temporarily unavailable.{" "}
            <button type="button" className="link-button" onClick={() => setBybitRetry((n) => n + 1)}>
              Retry
            </button>
          </span>
        ) : null}
        {market === "all" && hasQuery && perpsError ? (
          <span role="status">
            {" "}{perpsError}{" "}
            <button type="button" className="link-button" onClick={() => setPerpsRetry((n) => n + 1)}>
              Retry
            </button>
          </span>
        ) : null}
      </div>
    </Modal>
  );
}

function SearchQuote({ symbol, snapshot }: { symbol: string; snapshot?: number }) {
  const price = useChartStore((state) => {
    const quote = state.quotes[symbol];
    return quote?.simulated ? undefined : quote?.price;
  }) ?? snapshot;
  return price === undefined ? null : <span className="mono">{formatPrice(price)}</span>;
}
