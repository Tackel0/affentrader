"use client";
import { useMemo, useState, type CSSProperties } from "react";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useDomPriceGrid } from "@/hooks/useDomPriceGrid";
import { domGridChoice } from "@/lib/orderflow/domPriceGrid";
import { bookTick, groupedLadderStep } from "@/lib/orderflow/depthLadder";
import { DOM_GROUPS, domGrouping } from "@/lib/orderflow/domPreferences";
import { domStyle } from "@/lib/orderflow/domStyle";
import { depthMetrics } from "@/lib/orderflow/depthMetrics";
import { PriceLevelMenu } from "./PriceLevelMenu";
import { BOOK_ROW_LIMITS, buildBookView, bookShare, bookDepthPaths, defaultBookView, type BookViewDepth, type BookViewSettings, type BookViewRow } from "@/lib/orderflow/bookView";

const number = (n: number) => n.toLocaleString("en-US", { maximumSignificantDigits: 12 });
const price = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 17 }).format;
type BookInspection = { side: "bid" | "ask"; price: number };
export function BookView({ book, symbol, base, quote, contextKey, live, lastTrade, onDrawLevel, onDrawArea, fixedTick, observedTop = book }: {
  book: BookViewDepth; symbol: string; base: string; quote: string; contextKey: string; live: boolean;
  lastTrade?: { price: number; direction: number | null };
  onDrawLevel?: (price: number, color: string) => void;
  onDrawArea?: (best: number, price: number, color: string) => void;
  fixedTick?: number;
  observedTop?: BookViewDepth & { bidVenues?: readonly string[]; askVenues?: readonly string[] };
}) {
  const preferences = useWorkspaceStore(s => s.domPreferences), settings = preferences.book ?? defaultBookView();
  const levels = settings.rows ?? 10;
  const [hover, setHover] = useState<BookInspection | null>(null);
  const [focused, setFocused] = useState<BookInspection | null>(null);
  const [observed] = useState(() => { try { return bookTick(book); } catch { return .01; } });
  const venue = useDomPriceGrid(symbol, contextKey, live);
  const bid = observedTop.bids[0]?.price, ask = observedTop.asks[0]?.price;
  const reference = bid !== undefined && ask !== undefined ? bid + (ask - bid) / 2 : bid ?? ask;
  const choice = fixedTick === undefined
    ? domGridChoice(symbol, venue, reference, observed)
    : { tick: fixedTick, source: "Coarsest verified venue increment" };
  const group = domGrouping(preferences, symbol), step = groupedLadderStep(choice.tick, group);
  const metrics = domStyle(preferences.zoom ?? 100, preferences.colors);
  const result = useMemo(() => {
    try { return { value: buildBookView(book, step, preferences.executionUnit, levels, fixedTick !== undefined), error: "" }; }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : "Book unavailable." }; }
  }, [book, step, preferences.executionUnit, levels, fixedTick]);
  const model = result.value, unit = preferences.executionUnit === "quote" ? quote : base;
  const paths = useMemo(() => model && settings.style !== "bars" ? {
    bid: bookDepthPaths(model.bids.map(row => bookShare(row, settings.bars, model)), "bid", metrics.row),
    ask: bookDepthPaths(model.asks.map(row => bookShare(row, settings.bars, model)), "ask", metrics.row),
  } : null, [model, settings.bars, settings.style, metrics.row]);
  const inspection = hover ?? focused;
  const inspected = inspection && model ? (inspection.side === "bid" ? model.bids : model.asks).find(r => r.price === inspection.price) : undefined;
  const update = (patch: Partial<BookViewSettings>) => useWorkspaceStore.getState().setDomPreferences({ book: { ...settings, ...patch } });
  const style = { "--book-bid": metrics.bid, "--book-ask": metrics.ask, "--book-row": `${metrics.row}px`, "--book-text": `${metrics.text}px`, "--book-head": `${metrics.head}px` } as CSSProperties;
  const side = (rows: BookViewRow[], direction: "bid" | "ask") => {
    const shape = paths?.[direction];
    const selected = inspected && inspection?.side === direction ? rows.findIndex(r => r.price === inspection.price) : -1;
    return <div className={`book-side book-${direction}`} role="rowgroup" aria-label={direction === "bid" ? "Bids" : "Asks"}>
      {shape && rows.length > 0 && <svg className="book-depth-shape" viewBox={`0 0 100 ${shape.height}`} preserveAspectRatio="none" aria-hidden="true">
        {settings.style !== "line" && <path d={shape.area} fill="currentColor" opacity=".16"/>}
        {settings.style !== "area" && <path d={shape.line} fill="none" stroke="currentColor" strokeWidth="1.25" opacity=".85" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>}
      </svg>}
      {(direction === "ask" ? [...rows].reverse() : rows).map((row, i) => {
        const index = direction === "ask" ? rows.length - i - 1 : i;
        const active = selected >= index;
        const color = direction === "bid" ? metrics.bid : metrics.ask;
        const best = direction === "bid" ? bid : ask;
        const draw = onDrawLevel ? () => onDrawLevel(row.price, color) : undefined;
        const drawArea = onDrawArea && best !== undefined && best !== row.price ? () => onDrawArea(best, row.price, color) : undefined;
        const priceLabel = price(row.price);
        const inspect = () => setHover({ side: direction, price: row.price });
        return <div role="row" tabIndex={0} key={row.price} className={`book-view-row${active ? " book-inspected" : ""}${selected === index ? " book-target" : ""}`}
          aria-label={`${direction === "bid" ? "Bid" : "Ask"} ${row.price}; size ${number(row.size)} ${unit}; total ${number(row.total)} ${unit}`}
          onPointerEnter={event => { if (event.pointerType !== "touch") inspect(); }} onClick={inspect}
          onFocus={() => { setHover(null); setFocused({ side: direction, price: row.price }); }}>
          {settings.style === "bars" && <span className="book-size-bar" style={{ width: `${100 * bookShare(row, settings.bars, model!)}%` }} aria-hidden="true"/>}
          <span role="cell" className="book-price" title={`${priceLabel} ${quote}`}>{draw ? <PriceLevelMenu price={row.price} draw={draw} drawArea={drawArea}>{actions => <button type="button" className="button small"
            aria-label={`Draw ${direction} level at ${priceLabel} ${quote}`}
            onClick={draw} {...actions}>{priceLabel}</button>}</PriceLevelMenu> : priceLabel}</span><span role="cell">{number(row.size)}</span><span role="cell" className="book-total">{number(row.total)}</span>
        </div>;
      })}
    </div>;
  };
  const top = model ? depthMetrics(observedTop, 1) : null;
  const overlap = fixedTick !== undefined && top !== null && top.spread <= 0;
  const venueName = (market: string) => market === `${base}${quote}` ? "Binance" : market.startsWith("KRK:") ? "Kraken" : market;
  return <div className="book-view" style={style}>
    <div className="book-controls">
      <label>Grouping<select aria-label="Book grouping" value={group} onChange={e => { setHover(null); useWorkspaceStore.getState().setDomGroup(symbol, Number(e.target.value)); }}>{DOM_GROUPS.map(g => <option key={g} value={g}>{g}× tick</option>)}</select></label>
      <label>Unit<select aria-label="Book size unit" value={preferences.executionUnit} onChange={e => useWorkspaceStore.getState().setDomPreferences({ executionUnit: e.target.value as "base" | "quote" })}><option value="base">{base}</option><option value="quote">{quote}</option></select></label>
      <label>Depth shows<select aria-label="Book depth shows" value={settings.bars} onChange={e => update({ bars: e.target.value as BookViewSettings["bars"] })}><option value="cumulative">Cumulative</option><option value="level">Per level</option></select></label>
      <label>Style<select aria-label="Book depth style" value={settings.style} onChange={e => update({ style: e.target.value as BookViewSettings["style"] })}><option value="bars">Bars</option><option value="area">Area</option><option value="outline">Area + line</option><option value="line">Line</option></select></label>
      <label>Rows per side<select aria-label="Book rows per side" value={levels} onChange={e => {
        const rows = BOOK_ROW_LIMITS.find(limit => String(limit) === e.target.value);
        if (rows !== undefined) { setHover(null); update({ rows }); }
      }}>{BOOK_ROW_LIMITS.map(n => <option key={n}>{n}</option>)}</select></label>
    </div>
    <p className="form-help">Grouping {number(step)} {quote} · {choice.source}{venue.error && ` · ${venue.error}`}</p>
    {result.error ? <p role="status">{result.error}</p> : model && <>
      <div role="table" aria-label="Book depth" onPointerLeave={event => { if (event.pointerType !== "touch") setHover(null); }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setHover(null); setFocused(null); } }} onKeyDown={event => {
        const { key, target } = event;
        if (!(target instanceof HTMLElement) || !target.classList.contains("book-view-row") || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
        const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(".book-view-row"));
        const index = rows.indexOf(target);
        const next = key === "Home" ? 0 : key === "End" ? rows.length - 1 : index + (key === "ArrowUp" ? -1 : 1);
        event.preventDefault();
        rows[next]?.focus();
      }}>
        <div role="row" className="book-view-head"><span role="columnheader">Price ({quote})</span><span role="columnheader">Size ({unit})</span><span role="columnheader">Total ({unit})</span></div>
        {side(model.asks, "ask")}
        <div className="book-midpoint" role="row" aria-label="Observed top of book">
          <span role="cell">Best bid <strong className="book-top-bid">{bid === undefined ? "—" : price(bid)}</strong>{observedTop.bidVenues && <small>{observedTop.bidVenues.map(venueName).join(" + ")}</small>}</span>
          <span role="cell">Midpoint <strong>{top ? number(top.midpoint) : "—"}</strong></span>
          <span role="cell">Best ask <strong className="book-top-ask">{ask === undefined ? "—" : price(ask)}</strong>{observedTop.askVenues && <small>{observedTop.askVenues.map(venueName).join(" + ")}</small>}</span>
        </div>
        <div className="book-top-spread" role="row"><span role="cell" aria-colspan={3}>{overlap ? "Cross-venue overlap" : "Spread"} <strong>{top ? `${number(top.spread)} ${quote} · ${number(top.spreadBps)} bps` : "—"}</strong></span></div>
        {overlap && <div className="book-top-spread" role="row"><span role="cell" aria-colspan={3}>Prices come from separate venue snapshots.</span></div>}
        {lastTrade && <div className="book-top-spread" role="row"><span role="cell" aria-colspan={3}>Last trade <strong>{number(lastTrade.price)} {quote}</strong> <span aria-label={lastTrade.direction === null ? "Direction unavailable" : lastTrade.direction > 0 ? "Up" : lastTrade.direction < 0 ? "Down" : "Unchanged"}>{lastTrade.direction === 1 ? "↑" : lastTrade.direction === -1 ? "↓" : "—"}</span></span></div>}
        {side(model.bids, "bid")}
      </div>
      <div className="book-inspection" role="status">{inspected ? <>{price(inspected.price)} {quote} · Avg {number(inspected.averagePrice)} {quote} · Sum {number(inspected.baseTotal)} {base}
        {inspected.contributions && <> · At this level {inspected.contributions.map(({ symbol: market, quantity }) =>
          `${venueName(market)} ${number(quantity)} ${base}`).join(" · ")}</>}
      </> : model.bids.length || model.asks.length ? <>Bid {(model.bidShare * 100).toFixed(1)}% · Ask {((1 - model.bidShare) * 100).toFixed(1)}% · visible base quantity</> : "No depth levels in this snapshot."}</div>
      <p className="form-help">Hover or focus a price row to inspect from the best level. Average uses grouped prices and observed quantities only; it is an estimate. Missing depth remains unknown. DOM colors, zoom, grouping and size unit are shared; waiting DOM sizes retain provider units.</p>
    </>}
  </div>;
}
