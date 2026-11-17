"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Plus, Check } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
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
import { displayTicker, registerSymbolInfo, symbolInfo, yahooSymbol, iexSymbol, sipSymbol, IEX_TICKER, type InstrumentType } from "@/lib/symbolId";
import { useAlpacaStore } from "@/stores/useAlpacaStore";
import { hyperliquidCatalog } from "@/hooks/useHyperliquidCatalog";
import type { HyperliquidAsset } from "@/lib/market/hyperliquid";
import { yahooSearch } from "@/lib/market/yahooClient";
import type { AssetCategory, MarketSymbol } from "@/types/trading";
import { Modal, AssetBadge } from "./ui";

interface Row {
  symbol: string;
  base: string;
  name: string;
  venue: string;
  quote: string;
}

export function SymbolSearch() {
  const [equityFeed, setEquityFeed] = useState<"yahoo" | "iex" | "sip">("yahoo");
  const open = useChartStore((s) => s.searchOpen),
    target = useChartStore((s) => s.searchTarget);
  const feed = equityFeed === "sip" && target === "watchlist" ? "yahoo" : equityFeed;
  const alpaca = (market: MarketTab) => feed !== "yahoo" && (market === "stock" || market === "etf");
  const equitySymbol = feed === "sip" ? sipSymbol : iexSymbol;
  const equityVenue = feed === "sip" ? "SIP · Alpaca · delayed" : "IEX · Alpaca";
  const watchSymbols = useWatchlistStore((state) => open && target === "watchlist"
    ? state.lists.find((list) => list.id === state.activeId)?.symbols
    : undefined);
  const [query, setQuery] = useState(""),
    [debounced, setDebounced] = useState(""),
    [category, setCategory] = useState<AssetCategory>("All"),
    [market, setMarket] = useState<MarketTab>("crypto"),
    [catalog, setCatalog] = useState<MarketSymbol[]>(SYMBOLS),
    [remote, setRemote] = useState<Row[]>([]),
    [exchange, setExchange] = useState("all"),
    [dex, setDex] = useState("all"),
    [perps, setPerps] = useState<HyperliquidAsset[]>([]),
    [perpsError, setPerpsError] = useState(""),
    [loading, setLoading] = useState(false);
  const close = useCallback(
    () => useChartStore.getState().set({ searchOpen: false }),
    [],
  );
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(timer);
  }, [open, query]);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setDebounced("");
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
  }, [open]);
  // Hyperliquid perpetuals: one catalog request, filtered locally.
  useEffect(() => {
    if (!open || market !== "perps") return;
    let cancelled = false;
    setLoading(true);
    setPerpsError("");
    void hyperliquidCatalog()
      .then((assets) => !cancelled && setPerps(assets))
      .catch((error) => !cancelled && setPerpsError(error instanceof Error ? error.message : String(error)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, market]);
  // Stocks, ETFs, indices and forex come from Yahoo Finance search, or curated suggestions.
  useEffect(() => {
    if (!open || market === "crypto" || market === "perps") return;
    const wanted: InstrumentType = TYPE_FOR_TAB[market];
    const listed =
      market === "stock" || market === "etf"
        ? exchange === "all"
          ? POPULAR[market]
          : exchange === "us"
            ? POPULAR[market]
            : (POPULAR_BY_EXCHANGE[exchange] ?? [])
        : POPULAR[market];
    const popular = listed.map((p) => ({
      symbol: yahooSymbol(p.ticker),
      base: displayTicker(yahooSymbol(p.ticker)),
      name: p.name,
      venue: p.exchange,
      quote: p.currency,
    }));
    if (!debounced.trim()) {
      setRemote(popular);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void yahooSearch(debounced)
      .then((hits) => {
        if (cancelled) return;
        setRemote(
          hits
            .filter((h) => h.type === wanted || (wanted === "stock" && h.type === "other"))
            .filter((h) => exchange === "all" || (market !== "stock" && market !== "etf") || exchangeOfTicker(h.symbol).id === exchange)
            .map((h) => ({
              symbol: yahooSymbol(h.symbol),
              base: displayTicker(yahooSymbol(h.symbol)),
              name: h.name,
              venue: h.exchange,
              quote: exchangeOfTicker(h.symbol).currency,
            })),
        );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, market, debounced, exchange]);
  const perpRows = useMemo<Row[]>(() => {
    const text = debounced.trim().toLowerCase();
    return perps
      .filter((a) => dex === "all" || (dex === "main" ? a.dex === "" : a.dex === dex))
      .filter((a) => !text || `${a.coin} ${a.name} ${a.dexName}`.toLowerCase().includes(text))
      .slice(0, 150)
      .map((a) => ({
        symbol: a.symbol,
        base: a.name,
        name: `${a.name} perpetual · up to ${a.maxLeverage}x`,
        venue: a.dex ? `Hyperliquid · ${a.dexName}` : "Hyperliquid",
        quote: "USD",
      }));
  }, [perps, dex, debounced]);
  const dexes = useMemo(() => [...new Map(perps.filter((a) => a.dex).map((a) => [a.dex, a.dexName])).entries()], [perps]);
  const crypto = useMemo<Row[]>(
    () =>
      catalog
        .filter(
          (s) =>
            (category === "All" || s.category === category) &&
            `${s.symbol} ${s.name}`
              .toLowerCase()
              .includes(debounced.toLowerCase()),
        )
        .slice(0, 60)
        .map((s) => ({ symbol: s.symbol, base: s.base, name: s.name, venue: "crypto · Binance", quote: "USDT" })),
    [catalog, category, debounced],
  );
  const equityRows = alpaca(market) ? remote.filter(row => IEX_TICKER.test(row.base) && row.quote === "USD").map(row => ({ ...row, symbol: equitySymbol(row.base), venue: equityVenue })) : remote;
  const direct = alpaca(market) && IEX_TICKER.test(debounced.trim().toUpperCase()) ? { symbol: equitySymbol(debounced), base: debounced.trim().toUpperCase(), name: "US ticker · availability requires provider confirmation", venue: equityVenue, quote: "USD" } : null;
  const krakenRows: Row[] = category === "All" ? ["BTC", "ETH", "SOL"]
    .map(base => ({ symbol: `KRK:${base}/USD`, base, name: `${base} / USD`, venue: "crypto · Kraken", quote: "USD" }))
    .filter(row => `${row.symbol} ${row.venue}`.toLowerCase().includes(debounced.toLowerCase())) : [];
  const results = market === "crypto" ? [...crypto, ...krakenRows] : market === "perps" ? perpRows : direct && !equityRows.some(row => row.symbol === direct.symbol) ? [direct, ...equityRows] : equityRows;
  const choose = (row: Row) => {
    if (alpaca(market) && row.name !== direct?.name) registerSymbolInfo({ symbol: row.symbol, name: row.name, exchange: equityVenue, currency: "USD", type: market === "etf" ? "etf" : "stock", delayed: feed === "sip", timezone: "America/New_York" });
    if (row.symbol.startsWith("YF:") && !symbolInfo(row.symbol)) {
      const wanted = market === "crypto" || market === "perps" ? "stock" : TYPE_FOR_TAB[market];
      registerSymbolInfo({
        symbol: row.symbol,
        name: row.name,
        exchange: row.venue,
        currency: row.quote || "USD",
        type: wanted,
        delayed: wanted === "stock" || wanted === "etf" || wanted === "index",
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
  if (!open) return null;
  return (
    <Modal
      title={
        target === "watchlist" ? "Add symbols to watchlist" : "Symbol search"
      }
      onClose={close}
      className="search-modal"
    >
      <div className="search-field">
        <Search size={19} />
        <input
          aria-label="Search symbols"
          placeholder={market === "crypto" || market === "perps" ? "Search symbol or asset name" : "Search by name or ticker"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) choose(results[0]);
          }}
        />
        <kbd>↵</kbd>
      </div>
      <div className="filter-tabs market-tabs" role="tablist" aria-label="Market">
        {MARKET_TABS.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={market === m.id}
            className={market === m.id ? "active" : ""}
            onClick={() => setMarket(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {market === "perps" ? (
        <div className="filter-tabs" role="group" aria-label="Hyperliquid markets">
          {([["all", "All"], ["main", "Crypto perps"], ...dexes] as [string, string][]).map(([id, label]) => (
            <button key={id} className={dex === id ? "active" : ""} onClick={() => setDex(id)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {market === "stock" || market === "etf" ? (
        <div className="exchange-select">
          <label>Data source<select aria-label="Equity data source" value={feed} onChange={event => { setEquityFeed(event.target.value as typeof equityFeed); setExchange("all"); }}><option value="yahoo">Yahoo Finance · delayed</option><option value="iex">Alpaca · IEX only</option>{target === "chart" && <option value="sip">Alpaca · delayed SIP history</option>}</select></label>
          {alpaca(market) ? <button className="button" onClick={() => { close(); useAlpacaStore.setState({ open: true }); }}>Alpaca connection…</button> :
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
        <span>{market === "crypto" ? "BINANCE / KRAKEN · SPOT" : market === "perps" ? "HYPERLIQUID · PERPETUAL" : alpaca(market) ? `${equityVenue.toUpperCase()} · ALPACA KEY REQUIRED` : "YAHOO FINANCE · DELAYED"}</span>
      </div>
      <div className="search-results">
        {results.map((s) => (
          <button
            className="symbol-result"
            key={s.symbol}
            onClick={() => choose(s)}
          >
            <AssetBadge symbol={s.symbol} />
            <span className="asset-copy">
              <strong>
                {s.base}
                {s.quote ? <span className="muted">{s.quote}</span> : null}
              </strong>
              <small>{s.name}</small>
            </span>
            <span className="result-exchange">{s.venue}</span>
            <SearchQuote symbol={s.symbol} />
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
            {perpsError && market === "perps" ? perpsError : loading ? "Searching…" : `No symbols match “${debounced}”.`}
          </div>
        ) : null}
      </div>
      <div className="modal-footnote">
        {loading
          ? "Searching…"
          : market === "crypto"
            ? `${catalog.length} USDT pairs · public exchange data`
            : market === "perps"
              ? `${perps.length} perpetual markets on Hyperliquid, including stocks, commodities and indices from builder dexes · real time, free`
              : alpaca(market) ? feed === "sip" ? "Consolidated US stock history with a 16-minute cutoff. Alpaca credentials are required." : "Real-time IEX trades and minute bars. Account key required in Market data connections. 30-symbol stream limit." : "Stocks, ETFs, indices and forex come from Yahoo Finance and are typically delayed 15 minutes for US exchanges."}
      </div>
    </Modal>
  );
}

function SearchQuote({ symbol }: { symbol: string }) {
  const price = useChartStore((state) => state.quotes[symbol]?.price);
  return price === undefined ? null : <span className="mono">{formatPrice(price)}</span>;
}
