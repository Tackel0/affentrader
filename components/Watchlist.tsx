"use client";
import {currentPriceAlertDraft} from "@/lib/alerts/priceDraft";
import { TechnicalsCard } from "./TechnicalsCard";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ChevronDown,
  Plus,
  MoreHorizontal,
  X,
  ArrowUpRight,
  ArrowDownRight,
  Pencil,
  Trash2,
  ListPlus,
  Flag,
  Copy,
  Upload,
  Download,
  Columns3,
  Search,
  ArrowDownUp,
  Heading,
} from "lucide-react";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { useChartStore } from "@/stores/useChartStore";
import { getSymbol, formatPrice, formatVolume, describeSymbol } from "@/lib/symbols";
import { quotePriceLabel } from "@/lib/market/hyperliquidQuotes";
import {
  COLUMN_LABELS,
  FLAG_COLORS,
  FLAG_ORDER,
  isSection,
  MAX_LIST_SYMBOLS,
  sectionName,
  serializeWatchlist,
  sortEntries,
  watchlistCsv,
  type SortSpec,
  type WatchColumn,
} from "@/lib/watchlist";
import { downloadFile } from "@/lib/files";
import type { Quote, WatchFlag } from "@/types/trading";
import { AssetBadge, IconButton, Modal, Sparkline } from "./ui";
import { useDismiss } from "./WorkspaceMenus";
import { baseVolume, notionalVolume, periodLabel, quoteRange, rangeDescription } from "@/lib/market/quoteMetrics";
import { useQuoteRanges } from "@/hooks/useQuoteRanges";

const DESKTOP_ROW = 30;
const TOUCH_ROW = 40;
const MAX_VIEW = 396;
const EMPTY_FLAGS: Record<string, WatchFlag> = {};
const EMPTY_QUOTES: Record<string, Quote> = {};
const openSymbol = (symbol: string) => useChartStore.getState().set({ symbol });
const COLUMN_WIDTH: Record<WatchColumn, number> = {
  last: 74,
  change: 58,
  changePercent: 58,
  high: 78,
  low: 78,
  volume: 70,
  quoteVolume: 76,
  range: 64,
  trend: 54,
};

function Cell({ column, quote }: { column: WatchColumn; quote?: Quote }) {
  if (!quote) return <span className="watch-cell muted">—</span>;
  const range = quoteRange(quote), volume = baseVolume(quote), notional = notionalVolume(quote);
  switch (column) {
    case "last":
      return (
        <span
          key={quote.time}
          className={`watch-cell mono ${quote.price !== quote.previous ? (quote.price > quote.previous ? "pulse-up" : "pulse-down") : ""}`}
        >
          {formatPrice(quote.price)}
          {quote.priceBasis === "mid" || quote.priceBasis === "mark" ? <small className="quote-price-basis">{quote.priceBasis}</small> : null}
        </span>
      );
    case "change":
      if (!Number.isFinite(quote.change)) return <span className="watch-cell muted">—</span>;
      return (
        <span className={`watch-cell mono ${quote.change >= 0 ? "positive" : "negative"}`}>
          {quote.change >= 0 ? "+" : ""}
          {formatPrice(quote.change)}
        </span>
      );
    case "changePercent":
      if (!Number.isFinite(quote.changePercent)) return <span className="watch-cell muted">—</span>;
      return (
        <span className={`watch-cell mono ${quote.changePercent >= 0 ? "positive" : "negative"}`}>
          {quote.changePercent >= 0 ? "+" : ""}
          {quote.changePercent.toFixed(2)}%
        </span>
      );
    case "high":
      return <span className="watch-cell mono" title={rangeDescription(quote)}>{range.high === null ? "—" : formatPrice(range.high)}</span>;
    case "low":
      return <span className="watch-cell mono" title={rangeDescription(quote)}>{range.low === null ? "—" : formatPrice(range.low)}</span>;
    case "volume":
      return <span className="watch-cell mono" title={`${periodLabel(quote.metrics?.volume.period)} base volume`}>{volume === null ? "—" : formatVolume(volume)}</span>;
    case "quoteVolume":
      return <span className="watch-cell mono" title={`${periodLabel(quote.metrics?.volume.period)} turnover (${quote.metrics?.volume.currency ?? ""})`}>{notional === null ? "—" : formatVolume(notional)}</span>;
    case "range": {
      if (range.high === null || range.low === null) return <span className="watch-cell muted" title={rangeDescription(quote)}>—</span>;
      const pct = range.high > range.low ? ((quote.price - range.low) / (range.high - range.low)) * 100 : 50;
      return (
        <span className="watch-cell range-cell" title={`${pct.toFixed(0)}% · ${rangeDescription(quote)}`}>
          <i style={{ left: `${Math.max(0, Math.min(100, pct))}%` }} />
        </span>
      );
    }
    case "trend":
      return (
        <span className="watch-cell">
          <Sparkline values={quote.history} positive={quote.changePercent >= 0} width={46} height={17} />
        </span>
      );
  }
}

interface RowProps {
  symbol: string;
  columns: WatchColumn[];
  rowHeight: number;
  flag?: WatchFlag;
  active: boolean;
  selected: boolean;
  draggable: boolean;
  onSelect: (symbol: string, event: React.MouseEvent) => void;
  onOpen: (symbol: string) => void;
  onFlag: (symbol: string, anchor: HTMLElement) => void;
  onRemove: (symbol: string) => void;
  onDrop: (from: string, to: string) => void;
}

const SymbolRow = memo(function SymbolRow({
  symbol,
  columns,
  rowHeight,
  flag,
  active,
  selected,
  draggable,
  onSelect,
  onOpen,
  onFlag,
  onRemove,
  onDrop,
}: RowProps) {
  const quote = useChartStore((s) => s.quotes[symbol]);
  const asset = getSymbol(symbol);
  return (
    <div
      className={`watchlist-row dynamic ${active ? "selected" : ""} ${selected ? "multi" : ""}`}
      style={{ gridTemplateColumns: `minmax(76px,1fr) ${columns.map((c) => `${COLUMN_WIDTH[c]}px`).join(" ")}`, height: rowHeight }}
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", symbol)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(e.dataTransfer.getData("text/plain"), symbol);
      }}
    >
      <div className="watchlist-instrument">
        <button
          type="button"
          className="watchlist-flag"
          aria-label={flag ? `Flag: ${flag}` : "Set flag"}
          onClick={(e) => onFlag(symbol, e.currentTarget)}
        ><span className="flag-dot" aria-hidden="true" style={flag ? { background: FLAG_COLORS[flag], borderColor: FLAG_COLORS[flag] } : undefined} /></button>
        <button
          className="watchlist-asset"
          onClick={(e) => (e.ctrlKey || e.metaKey || e.shiftKey ? onSelect(symbol, e) : onOpen(symbol))}
        >
          <AssetBadge symbol={symbol} />
          <span>
            <strong>{asset.base}</strong>
            <small>{describeSymbol(symbol).quote}</small>
          </span>
        </button>
      </div>
      {columns.map((c) => (
        <button key={c} className="watch-cell-button" tabIndex={-1} title={c === "last" && quote ? `${quotePriceLabel(quote)} · ${new Date(quote.time).toISOString()}` : undefined} onClick={() => onOpen(symbol)}>
          <Cell column={c} quote={quote} />
        </button>
      ))}
      <button className="row-remove" aria-label={`Remove ${asset.base}`} title="Remove symbol" onClick={() => onRemove(symbol)}>
        <X size={11} />
      </button>
    </div>
  );
});

function ListMenu({ onImport, onRename, onCreate }: { onImport: () => void; onRename: () => void; onCreate: () => void }) {
  const store = useWatchlistStore();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const active = store.lists.find((l) => l.id === store.activeId) ?? store.lists[0];
  const slug = active.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const close = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };
  return (
    <div ref={ref} className="watchlist-more">
      <IconButton label="Watchlist options" onClick={() => setOpen(!open)}>
        <MoreHorizontal size={18} />
      </IconButton>
      {open ? (
        <div className="dropdown watchlist-more-menu">
          <button onClick={close(onCreate)}>
            <ListPlus size={14} />
            Create watchlist
          </button>
          <button onClick={close(onRename)}>
            <Pencil size={14} />
            Rename watchlist
          </button>
          <button onClick={close(() => store.duplicate(active.id))}>
            <Copy size={14} />
            Make a copy
          </button>
          <button
            disabled={store.lists.length < 2}
            onClick={close(() => store.remove(active.id))}
          >
            <Trash2 size={14} />
            Delete watchlist
          </button>
          <button onClick={close(() => store.clear(active.id))}>
            <X size={14} />
            Clear list
          </button>
          <hr />
          <button onClick={close(() => store.addSection(`Section ${active.symbols.filter(isSection).length + 1}`))}>
            <Heading size={14} />
            Add section
          </button>
          <button onClick={close(onImport)}>
            <Upload size={14} />
            Import list…
          </button>
          <button
            onClick={close(() =>
              downloadFile(`${slug}.txt`, serializeWatchlist(active.symbols), "text/plain"),
            )}
          >
            <Download size={14} />
            Export as text
          </button>
          <button
            onClick={close(() =>
              downloadFile(`${slug}.csv`, watchlistCsv(active.symbols, useChartStore.getState().quotes, active.flags), "text/csv"),
            )}
          >
            <Download size={14} />
            Export as CSV
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ColumnMenu() {
  const columns = useWatchlistStore((s) => s.columns);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="watchlist-more">
      <IconButton label="Choose columns" onClick={() => setOpen(!open)}>
        <Columns3 size={16} />
      </IconButton>
      {open ? (
        <div className="dropdown watchlist-more-menu">
          <div className="popover-label">Columns</div>
          {(Object.keys(COLUMN_LABELS) as WatchColumn[]).map((c) => (
            <label key={c} className="sync-option">
              <span>{COLUMN_LABELS[c]}</span>
              <input
                type="checkbox"
                checked={columns.includes(c)}
                onChange={(e) =>
                  useWatchlistStore
                    .getState()
                    .setColumns(
                      e.target.checked
                        ? (Object.keys(COLUMN_LABELS) as WatchColumn[]).filter((x) => x === c || columns.includes(x))
                        : columns.filter((x) => x !== c),
                    )
                }
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"append" | "replace" | "new">("append");
  const [name, setName] = useState("Imported list");
  const [result, setResult] = useState("");
  const file = useRef<HTMLInputElement>(null);
  return (
    <Modal title="Import watchlist" onClose={onClose} className="small-modal">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const outcome = useWatchlistStore.getState().importText(text, { mode, name });
          useChartStore
            .getState()
            .toast(
              "Watchlist imported",
              `${outcome.added} symbols${outcome.rejected.length ? ` · ${outcome.rejected.length} not recognized` : ""}${outcome.truncated ? ` · limited to ${MAX_LIST_SYMBOLS}` : ""}`,
              outcome.added ? "success" : "error",
            );
          setResult(outcome.rejected.slice(0, 8).join(", "));
          if (outcome.added) onClose();
        }}
      >
        <div className="form-body">
          <label>
            Symbols (one per line, comma or space separated; a CSV with a symbol column also works)
            <textarea
              aria-label="Symbols to import"
              rows={8}
              value={text}
              placeholder={"BTCUSDT\nETHUSDT\n###Layer 1\nSOL, AVAX, DOT"}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="import-actions">
            <button type="button" className="button small" onClick={() => file.current?.click()}>
              <Upload size={12} /> Choose file
            </button>
            <input
              hidden
              ref={file}
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f && f.size < 2_000_000) setText(await f.text());
                e.target.value = "";
              }}
            />
          </div>
          <label>
            Add to
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="append">End of this watchlist</option>
              <option value="replace">Replace this watchlist</option>
              <option value="new">A new watchlist</option>
            </select>
          </label>
          {mode === "new" ? (
            <label>
              New watchlist name
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </label>
          ) : null}
          {result ? <p className="error-message">Not recognized: {result}</p> : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={!text.trim()}>
            Import
          </button>
        </div>
      </form>
    </Modal>
  );
}

const SymbolDetail = memo(function SymbolDetail({ symbol }: { symbol: string }) {
  const quote = useChartStore((s) => s.quotes[symbol]);
  const asset = getSymbol(symbol), about = describeSymbol(symbol);
  const up = (quote?.changePercent ?? 0) >= 0;
  const range = quoteRange(quote), volume = baseVolume(quote), notional = notionalVolume(quote);
  const rangePeriod = periodLabel(quote?.metrics?.range.period), volumePeriod = periodLabel(quote?.metrics?.volume.period);
  return (
    <div className="symbol-detail">
      <div className="detail-title">
        <AssetBadge symbol={symbol} size="large" />
        <div>
          <h2>{asset.name}</h2>
          <p>
            {about.crypto ? `${asset.base} / TetherUS` : asset.base}{" "}
            <span>· {about.venue}</span>
          </p>
        </div>
      </div>
      <div className="detail-price mono">
        {quote ? formatPrice(quote.price) : "—"}
        <small>{about.quote}</small>
      </div>
      {quote?.priceBasis && <div className="detail-price-basis muted" title={new Date(quote.time).toISOString()}>{quotePriceLabel(quote)} · {new Date(quote.time).toISOString().slice(11, 19)} UTC</div>}
      <div className={`detail-change ${up ? "positive" : "negative"}`}>
        {quote?.priceBasis && <span className="sr-only">{quotePriceLabel(quote)}</span>}
        {up ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
        <span className="mono">
          {quote && Number.isFinite(quote.changePercent)
            ? `${up ? "+" : ""}${formatPrice(quote.change)} (${up ? "+" : ""}${quote.changePercent.toFixed(2)}%)`
            : quote ? "Waiting for provider change reference" : "Waiting for quotes"}
        </span>
        <small>{volumePeriod}</small>
      </div>
      <div className="detail-chart">
        <Sparkline values={quote?.history ?? []} positive={up} width={266} height={64} />
      </div>
      <TechnicalsCard />
      <div className="detail-metrics">
        <span>
          {rangePeriod} high
          <strong className="mono" title={rangeDescription(quote)}>{range.high === null ? "—" : formatPrice(range.high)}</strong>
        </span>
        <span>
          {rangePeriod} low
          <strong className="mono" title={rangeDescription(quote)}>{range.low === null ? "—" : formatPrice(range.low)}</strong>
        </span>
        <span>
          {volumePeriod} volume
          <strong className="mono">
            {volume !== null ? `${formatVolume(volume)} ${asset.base}` : "—"}
          </strong>
        </span>
        <span>
          {volumePeriod} turnover<strong className="mono" title={quote?.metrics ? `Reported as of ${new Date(quote.metrics.volume.asOf).toISOString()}` : "Unavailable"}>{notional === null ? "—" : `${formatVolume(notional)} ${quote?.metrics?.volume.currency ?? ""}`}</strong>
        </span>
      </div>
      <div className="range-track" title={rangeDescription(quote)} style={{ opacity: range.high === null ? 0.3 : 1 }}>
        <i
          style={{
            left: `${quote && range.high !== null && range.low !== null && range.high !== range.low ? Math.max(0, Math.min(100, ((quote.price - range.low) / (range.high - range.low)) * 100)) : 50}%`,
          }}
        />
      </div>
      <div className="range-label">
        <span>{rangePeriod} low</span>
        <span>{rangePeriod} high</span>
      </div>
      <button
        className="detail-alert"
        onClick={() =>
          useChartStore.getState().set({ alertDraft: currentPriceAlertDraft() })
        }
      >
        Create price alert
        <Plus size={15} />
      </button>
      <div className="data-disclosure">
        <span className={`status-dot ${quote?.simulated ? "amber" : ""}`} />
        {quote?.simulated
          ? "Simulated market data"
          : about.delayed
            ? "Delayed public data"
            : "Public exchange data"}
        <span>{about.quote}</span>
      </div>
    </div>
  );
});

export function Watchlist() {
  const store = useWatchlistStore();
  const symbol = useChartStore((s) => s.symbol);
  const [menu, setMenu] = useState(false),
    [form, setForm] = useState<"create" | "rename" | "import" | null>(null),
    [name, setName] = useState(""),
    [filter, setFilter] = useState(""),
    [flagFilter, setFlagFilter] = useState<WatchFlag | null>(null),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [scroll, setScroll] = useState(0),
    [rowHeight, setRowHeight] = useState(DESKTOP_ROW),
    [flagMenu, setFlagMenu] = useState<{ symbol: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 768px), (pointer: coarse)");
    const syncRowHeight = () => setRowHeight(query.matches ? TOUCH_ROW : DESKTOP_ROW);
    syncRowHeight();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", syncRowHeight);
      return () => query.removeEventListener("change", syncRowHeight);
    }
    query.addListener(syncRowHeight);
    return () => query.removeListener(syncRowHeight);
  }, []);
  const flagRef = useDismiss(flagMenu !== null, () => setFlagMenu(null));
  const active = store.lists.find((l) => l.id === store.activeId) ?? store.lists[0];
  const flags = active.flags ?? EMPTY_FLAGS;
  const columns = store.columns;
  const matched = useMemo(() => {
    const needle = filter.trim().toUpperCase();
    const filtering = needle || flagFilter;
    const base = filtering ? active.symbols.filter((e) => !isSection(e)) : active.symbols;
    return base.filter(
      (e) =>
        isSection(e) ||
        ((!needle || e.includes(needle) || getSymbol(e).name.toUpperCase().includes(needle)) &&
          (!flagFilter || flags[e] === flagFilter)),
    );
  }, [active.symbols, flags, filter, flagFilter]);
  const sort = store.sort;
  const selectEntries = useMemo(() => {
    if (!sort || sort.column === "symbol" || sort.column === "flag") {
      const entries = sortEntries(matched, EMPTY_QUOTES, sort, flags);
      return () => entries;
    }
    let previousQuotes: Record<string, Quote> | undefined;
    let entries = matched;
    return ({ quotes }: { quotes: Record<string, Quote> }) => {
      if (quotes === previousQuotes) return entries;
      if (!previousQuotes || matched.some((entry) => quotes[entry] !== previousQuotes?.[entry])) {
        entries = sortEntries(matched, quotes, sort, flags);
      }
      previousQuotes = quotes;
      return entries;
    };
  }, [matched, sort, flags]);
  const entries = useChartStore(useShallow(selectEntries));
  const count = active.symbols.filter((e) => !isSection(e)).length;
  const viewHeight = Math.min(entries.length * rowHeight, MAX_VIEW);
  const first = Math.max(0, Math.floor(scroll / rowHeight) - 4);
  const last = Math.min(entries.length, Math.ceil((scroll + viewHeight) / rowHeight) + 4);
  const visibleQuoteKey = entries.slice(first, last).filter(entry => entry.startsWith("HL:")).join(",");
  useEffect(() => {
    useChartStore.getState().set({ visibleWatchSymbols: visibleQuoteKey ? visibleQuoteKey.split(",") : [] });
    return () => useChartStore.getState().set({ visibleWatchSymbols: [] });
  }, [visibleQuoteKey]);
  useQuoteRanges([symbol, ...(columns.some(c => ["high", "low", "range"].includes(c)) || ["high", "low", "range"].includes(store.sort?.column ?? "") ? entries.slice(first, last).filter(e => !isSection(e)) : [])]);
  const gridColumns = `minmax(76px,1fr) ${columns.map((c) => `${COLUMN_WIDTH[c]}px`).join(" ")}`;
  const toggleSort = (column: SortSpec["column"]) => {
    const current = store.sort;
    if (!current || current.column !== column) return store.setSort({ column, direction: "desc" });
    if (current.direction === "desc") return store.setSort({ column, direction: "asc" });
    store.setSort(null);
  };
  const arrow = (column: SortSpec["column"]) =>
    store.sort?.column === column ? (store.sort.direction === "desc" ? " ▼" : " ▲") : "";
  const select = useCallback((target: string, event: React.MouseEvent) => {
    const { shiftKey } = event;
    setSelected((current) => {
      const next = new Set(current);
      if (shiftKey && current.size) {
        const symbols = entries.filter((e) => !isSection(e));
        const anchor = symbols.indexOf([...current].at(-1)!);
        const to = symbols.indexOf(target);
        for (const s of symbols.slice(Math.min(anchor, to), Math.max(anchor, to) + 1)) next.add(s);
      } else if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  }, [entries]);
  const showFlag = useCallback((symbol: string, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    setFlagMenu({ symbol, x: rect.left, y: rect.bottom + 4 });
  }, []);
  const reorder = useCallback((from: string, to: string) => {
    if (from !== to) useWatchlistStore.getState().reorder(from, to);
  }, []);
  const others = store.lists.filter((l) => l.id !== active.id);
  return (
    <>
      <div className="panel-heading">
        <div className="watchlist-select">
          <button onClick={() => setMenu(!menu)}>
            {active.name}
            <ChevronDown size={14} />
          </button>
          {menu ? (
            <div className="dropdown watchlist-menu">
              {store.lists.map((l) => (
                <button
                  key={l.id}
                  className={l.id === active.id ? "selected" : ""}
                  onClick={() => {
                    store.select(l.id);
                    setMenu(false);
                    setSelected(new Set());
                  }}
                >
                  {l.name}
                  <span>{l.symbols.filter((e) => !isSection(e)).length}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center">
          <IconButton
            label="Add symbol"
            onClick={() => useChartStore.getState().set({ searchOpen: true, searchTarget: "watchlist" })}
          >
            <Plus size={18} />
          </IconButton>
          <ColumnMenu />
          <ListMenu
            onImport={() => setForm("import")}
            onRename={() => {
              setName(active.name);
              setForm("rename");
            }}
            onCreate={() => {
              setName("");
              setForm("create");
            }}
          />
        </div>
      </div>
      {count > 12 || filter || flagFilter ? (
        <div className="watchlist-filter">
          <Search size={13} />
          <input
            aria-label="Filter watchlist"
            placeholder={`Filter ${count} symbols`}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setScroll(0);
            }}
          />
          <div className="flag-filter" role="group" aria-label="Filter by flag">
            {FLAG_ORDER.map((f) => (
              <button
                key={f}
                aria-pressed={flagFilter === f}
                className={flagFilter === f ? "active" : ""}
                style={{ background: FLAG_COLORS[f] }}
                title={`Show ${f} flagged`}
                onClick={() => setFlagFilter(flagFilter === f ? null : f)}
              />
            ))}
          </div>
        </div>
      ) : null}
      <div className="watchlist-columns dynamic" style={{ gridTemplateColumns: gridColumns }}>
        <button onClick={() => toggleSort("symbol")}>
          Symbol{arrow("symbol")}
          <ArrowDownUp size={9} className="sort-hint" />
        </button>
        {columns.map((c) => (
          <button key={c} onClick={() => toggleSort(c)}>
            {COLUMN_LABELS[c]}
            {arrow(c)}
          </button>
        ))}
      </div>
      {selected.size ? (
        <div className="selection-bar">
          <strong>{selected.size} selected</strong>
          {others.length ? (
            <select
              aria-label="Move or copy to list"
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                const [mode, id] = e.target.value.split(":");
                store.moveSymbols([...selected], id, mode === "copy");
                setSelected(new Set());
                e.target.value = "";
              }}
            >
              <option value="">Move or copy to…</option>
              {others.map((l) => (
                <option key={`m${l.id}`} value={`move:${l.id}`}>
                  Move to {l.name}
                </option>
              ))}
              {others.map((l) => (
                <option key={`c${l.id}`} value={`copy:${l.id}`}>
                  Copy to {l.name}
                </option>
              ))}
            </select>
          ) : null}
          <button
            className="link-button"
            onClick={() => {
              for (const s of selected) store.removeSymbol(s);
              setSelected(new Set());
            }}
          >
            Remove
          </button>
          <button className="link-button" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : null}
      <div
        className="watchlist-rows virtual"
        style={{ height: viewHeight || undefined, overflowY: entries.length * rowHeight > MAX_VIEW ? "auto" : "visible" }}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      >
        <div style={{ height: entries.length * rowHeight, position: "relative" }}>
          {entries.slice(first, last).map((entry, i) =>
            isSection(entry) ? (
              <div
                key={`section-${first + i}-${entry}`}
                className="watchlist-section"
                style={{ position: "absolute", top: (first + i) * rowHeight, height: rowHeight, left: 0, right: 0 }}
              >
                {sectionName(entry)}
                <button
                  aria-label={`Remove section ${sectionName(entry)}`}
                  onClick={() => store.removeSymbol(entry)}
                >
                  <X size={11} />
                </button>
              </div>
            ) : (
              <div key={entry} style={{ position: "absolute", top: (first + i) * rowHeight, left: 0, right: 0 }}>
                <SymbolRow
                  symbol={entry}
                  columns={columns}
                  rowHeight={rowHeight}
                  flag={flags[entry]}
                  active={symbol === entry}
                  selected={selected.has(entry)}
                  draggable={!store.sort && !filter && !flagFilter}
                  onSelect={select}
                  onOpen={openSymbol}
                  onFlag={showFlag}
                  onRemove={store.removeSymbol}
                  onDrop={reorder}
                />
              </div>
            ),
          )}
        </div>
        {!entries.length ? (
          <div className="empty-state">
            <ListPlus size={28} />
            <p>{filter || flagFilter ? "No symbols match." : "Your next opportunity starts here."}</p>
            {!filter && !flagFilter ? (
              <button
                className="text-accent"
                onClick={() => useChartStore.getState().set({ searchOpen: true, searchTarget: "watchlist" })}
              >
                Add your first symbol
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <button
        className="add-symbol-row"
        onClick={() => useChartStore.getState().set({ searchOpen: true, searchTarget: "watchlist" })}
      >
        <Plus size={14} />
        Add symbol
        <small className="list-count">
          {count}/{MAX_LIST_SYMBOLS}
        </small>
      </button>
      {flagMenu ? (
        <div ref={flagRef} className="flag-menu" style={{ left: Math.max(8, flagMenu.x - 8), top: flagMenu.y }}>
          {FLAG_ORDER.map((f) => (
            <button
              key={f}
              aria-label={`Flag ${f}`}
              style={{ background: FLAG_COLORS[f] }}
              onClick={() => {
                store.setFlag(flagMenu.symbol, flags[flagMenu.symbol] === f ? null : f);
                setFlagMenu(null);
              }}
            />
          ))}
          <button
            aria-label="Remove flag"
            className="no-flag"
            onClick={() => {
              store.setFlag(flagMenu.symbol, null);
              setFlagMenu(null);
            }}
          >
            <Flag size={11} />
          </button>
        </div>
      ) : null}
      <SymbolDetail symbol={symbol} />
      {form === "import" ? <ImportDialog onClose={() => setForm(null)} /> : null}
      {form === "create" || form === "rename" ? (
        <Modal
          title={form === "create" ? "Create watchlist" : "Rename watchlist"}
          onClose={() => setForm(null)}
          className="small-modal"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (form === "create") store.create(name);
              else store.rename(active.id, name);
              setForm(null);
            }}
          >
            <div className="form-body">
              <label>
                Watchlist name
                <input
                  aria-label="Watchlist name"
                  value={name}
                  maxLength={40}
                  required
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="button primary">
                {form === "create" ? "Create watchlist" : "Save name"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
