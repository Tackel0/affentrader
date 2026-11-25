"use client";
import { memo, useMemo, useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { usePortfolioStore } from "@/stores/usePortfolioStore";
import { computeHoldings, csvToLots, lotsToCsv, maxSellableAt, valuePortfolio, type Holding, type ValuedHolding } from "@/lib/portfolio";
import { formatPrice, getSymbol } from "@/lib/symbols";
import { downloadFile } from "@/lib/files";
import { isSymbolId } from "@/lib/symbolId";
import type { Quote } from "@/types/trading";
import { AssetBadge } from "./ui";

const fmt = (value: number, digits = 2) =>
  value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (value: number) => `${value >= 0 ? "+" : ""}${fmt(value)}`;
const tone = (value: number) => (value > 0 ? "positive" : value < 0 ? "negative" : "");
const PALETTE = ["#2962ff", "#f7b955", "#089981", "#f23645", "#9c27b0", "#00bcd4", "#ff7043", "#8bc34a", "#e91e63", "#787b86"];

export function Donut({ holdings }: { holdings: ValuedHolding[] }) {
  const slices = holdings.slice(0, 9);
  const rest = holdings.slice(9).reduce((s, h) => s + h.weight, 0);
  const parts = [...slices.map((h) => ({ label: h.symbol.replace(/USDT$/, ""), weight: h.weight })), ...(rest > 0.05 ? [{ label: "Other", weight: rest }] : [])];
  let angle = -Math.PI / 2;
  const radius = 42;
  const inner = 26;
  if (!parts.length) return <div className="equity-empty">No holdings.</div>;
  return (
    <div className="donut">
      <svg viewBox="-50 -50 100 100" role="img" aria-label="Allocation">
        {parts.map((part, i) => {
          const sweep = (part.weight / 100) * Math.PI * 2;
          const end = angle + sweep;
          const large = sweep > Math.PI ? 1 : 0;
          const point = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
          const path =
            parts.length === 1
              ? `M0,${-radius} A${radius},${radius} 0 1 1 0,${radius} A${radius},${radius} 0 1 1 0,${-radius} M0,${-inner} A${inner},${inner} 0 1 0 0,${inner} A${inner},${inner} 0 1 0 0,${-inner}`
              : `M${point(radius, angle)} A${radius},${radius} 0 ${large} 1 ${point(radius, end)} L${point(inner, end)} A${inner},${inner} 0 ${large} 0 ${point(inner, angle)} Z`;
          angle = end;
          return <path key={part.label} d={path} fill={PALETTE[i % PALETTE.length]} fillRule="evenodd" />;
        })}
      </svg>
      <ul>
        {parts.map((part, i) => (
          <li key={part.label}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} />
            {part.label}
            <span className="mono">{part.weight.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PortfolioValuation = memo(function PortfolioValuation({ holdings }: { holdings: Holding[] }) {
  const selectValue = useMemo(() => {
    const heldSymbols = holdings.filter(holding => holding.quantity > 0).map(holding => holding.symbol);
    let previousQuotes: Record<string, Quote> | undefined;
    let summary: ReturnType<typeof valuePortfolio> | undefined;
    return ({ quotes }: { quotes: Record<string, Quote> }) => {
      if (summary && quotes === previousQuotes) return summary;
      const changed = heldSymbols.some(symbol => {
        const current = quotes[symbol], previous = previousQuotes?.[symbol];
        return !Object.is(current?.price, previous?.price) || !Object.is(current?.changePercent, previous?.changePercent);
      });
      previousQuotes = quotes;
      if (!summary || changed) summary = valuePortfolio(holdings, quotes);
      return summary;
    };
  }, [holdings]);
  const summary = useChartStore(selectValue);
  return (
    <>
      <div className="metrics-grid">
        <div className="metric"><span>Value</span><strong className="mono">{fmt(summary.value)} USDT</strong></div>
        <div className="metric"><span>Invested</span><strong className="mono">{fmt(summary.invested)}</strong></div>
        <div className="metric"><span>Unrealized</span><strong className={`mono ${tone(summary.unrealized)}`}>{signed(summary.unrealized)} ({signed(summary.returnPercent)}%)</strong></div>
        <div className="metric"><span>Realized</span><strong className={`mono ${tone(summary.realized)}`}>{signed(summary.realized)}</strong></div>
        <div className="metric"><span>Fees</span><strong className="mono">{fmt(summary.fees)}</strong></div>
      </div>
      <div className="portfolio-grid">
        <div className="table-scroll">
          {summary.holdings.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Qty</th>
                  <th>Avg cost</th>
                  <th>Last</th>
                  <th>Value</th>
                  <th>Unrealized</th>
                  <th>Day</th>
                  <th>Weight</th>
                </tr>
              </thead>
              <tbody>
                {summary.holdings.map((h) => (
                  <tr key={h.symbol}>
                    <td>
                      <button className="link-button" onClick={() => useChartStore.getState().set({ symbol: h.symbol })}>
                        <AssetBadge symbol={h.symbol} /> {getSymbol(h.symbol).base}
                      </button>
                    </td>
                    <td className="mono">{h.quantity}</td>
                    <td className="mono">{formatPrice(h.avgCost)}</td>
                    <td className="mono">{h.price === null ? "—" : formatPrice(h.price)}</td>
                    <td className="mono">{fmt(h.value)}</td>
                    <td className={`mono ${tone(h.unrealized)}`}>{signed(h.unrealized)} ({signed(h.returnPercent)}%)</td>
                    <td className={`mono ${tone(h.dayChangePercent ?? 0)}`}>{h.dayChangePercent === null ? "—" : `${signed(h.dayChangePercent)}%`}</td>
                    <td className="mono">{h.weight.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-table">Record your first transaction to start tracking this portfolio.</div>
          )}
        </div>
        <Donut holdings={summary.holdings} />
      </div>
    </>
  );
});

function LotPriceInput({ symbol, value, onChange }: { symbol: string; value: string; onChange: (value: string) => void }) {
  const price = useChartStore(state => state.quotes[symbol]?.price);
  return <input aria-label="Price" type="number" step="any" min={0}
    placeholder={price === undefined ? "Price" : `Price (${formatPrice(price)})`} value={value}
    onChange={event => onChange(event.target.value)} />;
}

export function PortfolioPanel() {
  const store = usePortfolioStore();
  const portfolio = store.portfolios.find((p) => p.id === store.activeId) ?? store.portfolios[0];
  const holdings = useMemo(() => computeHoldings(portfolio.lots), [portfolio.lots]);
  const recentLots = useMemo(() => [...portfolio.lots].sort((a, b) => b.time - a.time).slice(0, 200), [portfolio.lots]);
  const [form, setForm] = useState({ symbol: "BTCUSDT", side: "buy" as "buy" | "sell", quantity: "", price: "", fee: "0", date: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const symbol = form.symbol.trim().toUpperCase();
    const quantity = Number(form.quantity);
    const price = Number(form.price || useChartStore.getState().quotes[symbol]?.price);
    if (!isSymbolId(symbol)) return setError("Enter a valid symbol.");
    if (!(quantity > 0)) return setError("Quantity must be positive.");
    if (!(price >= 0)) return setError("Enter a price (or wait for a live quote).");
    const lotTime = Date.parse(form.date) || Date.now();
    const sellable = maxSellableAt(portfolio.lots, symbol, lotTime);
    if (form.side === "sell" && quantity > sellable + 1e-9) return setError(`You only hold ${sellable} ${symbol} available on ${form.date}.`);
    store.addLot({ symbol, side: form.side, quantity, price, fee: Math.max(0, Number(form.fee) || 0), time: lotTime });
    setError("");
    setForm({ ...form, quantity: "", price: "" });
  };
  return (
    <div className="portfolio-panel">
      <aside className="portfolio-sidebar">
        <div className="popover-label">Portfolios</div>
        {store.portfolios.map((p) => (
          <button key={p.id} className={p.id === portfolio.id ? "active" : ""} onClick={() => store.select(p.id)}>
            {p.name}
            <small>{p.lots.length}</small>
          </button>
        ))}
        <button
          className="link-button"
          onClick={() => {
            const name = window.prompt("Portfolio name", "New portfolio");
            if (name) store.create(name);
          }}
        >
          + New portfolio
        </button>
        <button
          className="link-button"
          onClick={() => {
            const name = window.prompt("Rename portfolio", portfolio.name);
            if (name) store.rename(portfolio.id, name);
          }}
        >
          Rename
        </button>
        {store.portfolios.length > 1 ? (
          <button
            className="link-button"
            onClick={() => window.confirm(`Delete ${portfolio.name} and its transactions?`) && store.remove(portfolio.id)}
          >
            Delete
          </button>
        ) : null}
      </aside>
      <div className="portfolio-main">
        <PortfolioValuation holdings={holdings} />
        <form className="lot-form" onSubmit={submit}>
          <select aria-label="Side" value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as "buy" | "sell" })}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <input aria-label="Symbol" value={form.symbol} maxLength={24} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} />
          <input aria-label="Quantity" type="number" step="any" min={0} placeholder="Quantity" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          <LotPriceInput symbol={form.symbol} value={form.price} onChange={(price) => setForm({ ...form, price })} />
          <input aria-label="Fee" type="number" step="any" min={0} placeholder="Fee" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
          <input aria-label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <button className="button primary small">
            <Plus size={12} /> Add
          </button>
          <button type="button" className="button small" onClick={() => file.current?.click()}>
            <Upload size={12} /> Import CSV
          </button>
          <button
            type="button"
            className="button small"
            disabled={!portfolio.lots.length}
            onClick={() => downloadFile(`${portfolio.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}.csv`, lotsToCsv(portfolio.lots), "text/csv")}
          >
            <Download size={12} /> Export
          </button>
          <input
            hidden
            ref={file}
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f && f.size < 3_000_000) {
                const parsed = csvToLots(await f.text());
                store.addLots(parsed.lots);
                useChartStore
                  .getState()
                  .toast("Transactions imported", `${parsed.lots.length} added${parsed.errors.length ? ` · ${parsed.errors.length} skipped` : ""}`, parsed.lots.length ? "success" : "error");
              }
              e.target.value = "";
            }}
          />
          {error ? <span className="error-message">{error}</span> : null}
        </form>
        {portfolio.lots.length ? (
          <details className="lot-list">
            <summary>{portfolio.lots.length} transactions</summary>
            <table className="data-table">
              <tbody>
                {recentLots.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{new Date(l.time).toLocaleDateString()}</td>
                    <td className={l.side === "buy" ? "positive" : "negative"}>{l.side}</td>
                    <td>{l.symbol}</td>
                    <td className="mono">{l.quantity}</td>
                    <td className="mono">@ {formatPrice(l.price)}</td>
                    <td>
                      <button className="icon-button" aria-label="Delete transaction" onClick={() => store.removeLot(l.id)}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
      </div>
    </div>
  );
}
