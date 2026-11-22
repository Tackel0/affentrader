"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { hyperliquidCatalog } from "@/hooks/useHyperliquidCatalog";
import { useUsCloseReference } from "@/hooks/useUsCloseReference";
import { heatColor, squarify, type HeatItem, type HeatRect } from "@/lib/heatmap";
import { formatVolume } from "@/lib/symbols";
import { isSymbolId, symbolLabel } from "@/lib/symbolId";
import { wireObject } from "@/lib/market/marketWire";
import { changeSinceUsClose, formatUsCloseAnchor } from "@/lib/market/usMarketClose";

type Source = "binance" | "hl-crypto" | "hl-markets" | "us-sectors" | "de-sectors" | "uk-sectors";
type ChangeMode = "default" | "us-close";

type SectorHeatItem = HeatItem & {
  sector?: string;
  price?: number;
  usCloseChange?: number;
};

interface HeatmapSnapshot {
  source: Source;
  items: SectorHeatItem[];
  error: string;
  busy: boolean;
}
const EMPTY_ITEMS: SectorHeatItem[] = [];
const failed = "Heatmap data is unavailable.";
const numeric = (value: unknown) => typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;

const SOURCES: { id: Source; label: string; note: string }[] = [
  { id: "binance", label: "Binance Spot", note: "USDT pairs · 24h quote vol" },
  { id: "hl-crypto", label: "HL Perps", note: "Hyperliquid perps · 24h notional" },
  { id: "hl-markets", label: "HL TradFi", note: "Builder perps · 24h notional" },
  { id: "us-sectors", label: "US Sectors", note: "US GICS · MCap ($B)" },
  { id: "de-sectors", label: "DE Xetra", note: "Xetra / DAX · MCap (B)" },
  { id: "uk-sectors", label: "UK LSE", note: "London / FTSE · MCap (B)" },
];

/** Pegged assets would dominate the map without telling anything about the market. */
const STABLES = new Set(["USDC", "FDUSD", "TUSD", "USDP", "BUSD", "DAI", "USDE", "USD1", "EUR", "EURI", "AEUR", "XUSD", "PAXG", "XAUT"]);

async function load(source: Source, signal: AbortSignal): Promise<SectorHeatItem[]> {
  if (source === "us-sectors" || source === "de-sectors" || source === "uk-sectors") {
    const market = source === "us-sectors" ? "us" : source === "de-sectors" ? "xetra" : "lse";
    const response = await fetch(`/api/stock-heatmap?market=${encodeURIComponent(market)}`, {
      signal,
    });
    const body = wireObject(await response.json().catch(() => null));
    if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Stock sector heatmap unavailable.");
    if (!Array.isArray(body?.rows)) throw new Error("Stock sector heatmap returned invalid data.");
    return body.rows.flatMap((raw): SectorHeatItem[] => {
      const row = wireObject(raw);
      if (!row || !isSymbolId(row.symbol) || typeof row.ticker !== "string" || !row.ticker) return [];
      const size = numeric(row.marketCapBn), change = numeric(row.changePct);
      const price = numeric(row.price);
      const usCloseRaw = numeric(row.changeSinceUsClosePct);
      if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(change)) return [];
      return [{
        symbol: row.symbol,
        label: row.ticker,
        size,
        change,
        price: Number.isFinite(price) && price > 0 ? price : undefined,
        usCloseChange: Number.isFinite(usCloseRaw) ? usCloseRaw : change,
        sector: typeof row.sector === "string" ? row.sector : undefined,
      }];
    });
  }
  if (source === "binance") {
    const response = await fetch("/api/market?resource=ticker/24hr", { signal });
    if (!response.ok) throw new Error("Binance quotes are unavailable.");
    const rows: unknown = await response.json().catch(() => null);
    if (!Array.isArray(rows)) throw new Error("Binance heatmap returned invalid data.");
    return rows.flatMap((raw): SectorHeatItem[] => {
      const row = wireObject(raw);
      const symbol = row?.symbol;
      if (!row || !isSymbolId(symbol) || !symbol.endsWith("USDT") || /(UP|DOWN|BULL|BEAR)USDT$/.test(symbol)) return [];
      const label = symbol.slice(0, -4);
      const size = numeric(row.quoteVolume), change = numeric(row.priceChangePercent), price = numeric(row.lastPrice);
      if (!label || STABLES.has(label) || !Number.isFinite(size) || size <= 0 || !Number.isFinite(change)) return [];
      return [{ symbol, label, size, change, price: Number.isFinite(price) && price > 0 ? price : undefined }];
    })
      .sort((a, b) => b.size - a.size)
      .slice(0, 60);
  }
  const assets = await hyperliquidCatalog();
  if (!Array.isArray(assets)) throw new Error("Hyperliquid heatmap returned invalid data.");
  return assets
    .filter((a) => a && isSymbolId(a.symbol) && typeof a.name === "string" && typeof a.dex === "string" &&
      (source === "hl-crypto" ? a.dex === "" : a.dex !== ""))
    .map((a) => ({
      symbol: a.symbol,
      label: a.name,
      size: a.volume,
      price: a.mark > 0 ? a.mark : undefined,
      change: a.previousDay > 0 ? ((a.mark - a.previousDay) / a.previousDay) * 100 : 0,
    }))
    .filter((a) => Number.isFinite(a.size) && a.size > 0 && Number.isFinite(a.change))
    .sort((a, b) => b.size - a.size)
    .slice(0, 60);
}

/** Treemap of the busiest markets: area is 24h volume or market cap, colour is 24h or since-US-close change. */
export function HeatmapPanel({ onSelectSymbol }: { onSelectSymbol?: (symbol: string) => void } = {}) {
  const [source, setSource] = useState<Source>("binance");
  const [changeMode, setChangeMode] = useState<ChangeMode>("default");
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [snapshot, setSnapshot] = useState<HeatmapSnapshot>({ source, items: EMPTY_ITEMS, error: "", busy: true });
  const [hoverSymbol, setHover] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const host = useRef<HTMLDivElement>(null);
  const refresh = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    setSectorFilter("all");
    setHover(null);
    let pending: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const release = () => {
      const controller = pending;
      pending = undefined;
      clearTimeout(timeout);
      timeout = undefined;
      return controller;
    };
    const fetchSnapshot = () => {
      if (!active || pending) return;
      const controller = new AbortController();
      pending = controller;
      setSnapshot(current => current.source === source ? { ...current, busy: true }
        : { source, items: EMPTY_ITEMS, error: "", busy: true });
      const finish = (items: SectorHeatItem[] | null, error: string) => {
        if (pending !== controller) return;
        release();
        setSnapshot(current => ({ source, items: items ?? current.items, error, busy: false }));
      };
      timeout = setTimeout(() => {
        finish(null, "Heatmap request timed out. Try refreshing.");
        controller.abort();
      }, 15_000);
      void load(source, controller.signal).then(items => finish(items, ""), error => {
        finish(null, error instanceof Error ? error.message || failed : failed);
      });
    };
    refresh.current = fetchSnapshot;
    fetchSnapshot();
    const timer = setInterval(fetchSnapshot, 20_000);
    return () => {
      active = false;
      refresh.current = undefined;
      clearInterval(timer);
      release()?.abort();
    };
  }, [source]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let frame: number | undefined;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = el;
      setSize(current => current.width === width && current.height === height ? current : { width, height });
    };
    const observer = new ResizeObserver(() => {
      frame ??= requestAnimationFrame(() => { frame = undefined; measure(); });
    });
    observer.observe(el);
    measure();
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);

  const { items, error, busy } = snapshot.source === source ? snapshot : { items: EMPTY_ITEMS, error: "", busy: true };
  const isStockSectors = source === "us-sectors" || source === "de-sectors" || source === "uk-sectors";
  const needsUsCloseBatch = changeMode === "us-close" && !isStockSectors;
  const batchSymbols = useMemo(
    () => (needsUsCloseBatch ? items.map((item) => item.symbol) : []),
    [needsUsCloseBatch, items],
  );
  const usClose = useUsCloseReference(batchSymbols, needsUsCloseBatch);

  const displayItems = useMemo<SectorHeatItem[]>(() => {
    if (changeMode !== "us-close") return items;
    return items.map((item) => {
      if (isStockSectors && typeof item.usCloseChange === "number" && Number.isFinite(item.usCloseChange)) {
        return { ...item, change: item.usCloseChange };
      }
      const refPrice = usClose.prices[item.symbol];
      const moved = changeSinceUsClose(item.price, refPrice);
      if (moved) return { ...item, change: moved.changePercent };
      return { ...item, change: NaN };
    });
  }, [changeMode, items, isStockSectors, usClose.prices]);

  const sectors = useMemo(
    () => [...new Set(displayItems.map((item) => item.sector).filter((s): s is string => Boolean(s)))].sort(),
    [displayItems],
  );
  const selectedSector = sectors.includes(sectorFilter) ? sectorFilter : "all";
  const visibleItems = useMemo(
    () => (selectedSector === "all" ? displayItems : displayItems.filter((item) => item.sector === selectedSector)),
    [displayItems, selectedSector],
  );
  const rects = useMemo(() => squarify(visibleItems, size.width, size.height), [visibleItems, size]);
  const hover = visibleItems.find(item => item.symbol === hoverSymbol);
  const choose = useCallback((symbol: string) => {
    if (onSelectSymbol) onSelectSymbol(symbol);
    else useChartStore.getState().set({ symbol });
  }, [onSelectSymbol]);
  const note = SOURCES.find((s) => s.id === source)!.note;
  const usCloseLabel = formatUsCloseAnchor(usClose.closeMs);
  const statusChip = busy || (needsUsCloseBatch && usClose.loading)
    ? "SYNCING HEATMAP"
    : changeMode === "us-close"
      ? `Seit ${usCloseLabel}`
      : note;
  const formatHeatPct = (value: number) => (Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—");
  return (
    <div className="heatmap-panel">
      <div className="heatmap-bar" style={{ flexWrap: "wrap" }}>
        {SOURCES.map((s) => (
          <button key={s.id} className={source === s.id ? "active" : ""} aria-pressed={source === s.id} title={s.note} onClick={() => setSource(s.id)}>
            {s.label}
          </button>
        ))}
        <span className="heatmap-mode-group" role="group" aria-label="Change reference">
          <button
            type="button"
            className={changeMode === "default" ? "active" : ""}
            aria-pressed={changeMode === "default"}
            onClick={() => setChangeMode("default")}
          >
            24h / Tag
          </button>
          <button
            type="button"
            className={changeMode === "us-close" ? "active" : ""}
            aria-pressed={changeMode === "us-close"}
            title={`Veränderung seit ${usCloseLabel}`}
            onClick={() => setChangeMode("us-close")}
          >
            Seit US-Close
          </button>
        </span>
        {sectors.length > 0 && (
          <select
            aria-label="Filter GICS sector"
            value={selectedSector}
            onChange={(e) => setSectorFilter(e.target.value)}
            style={{ fontSize: 11, height: 24, padding: "2px 6px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 1 }}
          >
            <option value="all">All Sectors ({sectors.length})</option>
            {sectors.map((sec) => (
              <option key={sec} value={sec}>
                {sec}
              </option>
            ))}
          </select>
        )}
        <span className="flex-1" />
        <span className="terminal-telemetry-chip mono">{statusChip}</span>
        <button className="icon-button" aria-label="Refresh heatmap" onClick={() => refresh.current?.()} disabled={busy}>
          <RefreshCw size={13} className={busy ? "spin" : ""} />
        </button>
      </div>
      {error && items.length > 0 ? <p className="heatmap-status" role="status">{error} Showing the last available data.</p> : null}
      <div className="heatmap-body" ref={host}>
        <HeatmapTiles rects={rects} isStockSectors={isStockSectors} changeSuffix={changeMode === "us-close" ? ` (${usCloseLabel})` : ""} onHover={setHover} onSelect={choose} />
        {!rects.length ? <p className="heat-empty" role="status">{(items.length === 0 && error) || (busy ? "Loading markets…" : "No data.")}</p> : null}
        {hover ? (
          <div className="heat-hover mono">
            {symbolLabel(hover.symbol)}
            {hover.sector ? ` (${hover.sector})` : ""} · {formatHeatPct(hover.change)}
            {changeMode === "us-close" ? ` (${usCloseLabel})` : ""} · {isStockSectors ? `MCap ${hover.size.toFixed(1)}B` : `vol ${formatVolume(hover.size)}`}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const HeatmapTiles = memo(function HeatmapTiles({ rects, isStockSectors, changeSuffix, onHover, onSelect }: {
  rects: HeatRect<SectorHeatItem>[];
  isStockSectors: boolean;
  changeSuffix: string;
  onHover: (symbol: string | null) => void;
  onSelect: (symbol: string) => void;
}) {
  return rects.map(({ item, x, y, width, height }) => {
    const pct = Number.isFinite(item.change) ? `${item.change >= 0 ? "+" : ""}${item.change.toFixed(2)}%` : "—";
    return (
      <button
        key={item.symbol}
        className="heat-tile"
        style={{ left: x, top: y, width: Math.max(0, width - 1), height: Math.max(0, height - 1), background: heatColor(item.change) }}
        title={`${symbolLabel(item.symbol)}${item.sector ? ` · ${item.sector}` : ""} · ${pct}${changeSuffix} · ${isStockSectors ? `MCap $${item.size.toFixed(1)}B` : `volume ${formatVolume(item.size)}`}`}
        onMouseEnter={() => onHover(item.symbol)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(item.symbol)}
        onBlur={() => onHover(null)}
        onClick={() => onSelect(item.symbol)}
      >
        {width > 34 && height > 22 ? (
          <>
            <strong>{item.label}</strong>
            {height > 38 ? <span className="mono">{pct}</span> : null}
          </>
        ) : null}
      </button>
    );
  });
});
