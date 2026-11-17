"use client";
import { symbolLabel } from "@/lib/symbolId";
import { useMemo, useState } from "react";
import {usePaperQuote,usePaperMarkPrices} from "@/hooks/usePaperQuotes";
import {OrderModification} from "./OrderModification";
import {OrderExitLevelsDialog} from "./OrderExitLevelsDialog";
import {OrderPresetControls} from "./OrderPresets";
import {PositionActions} from "./PositionActions";
import { X } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { activeAccount, usePaperStore, type Ticket } from "@/stores/usePaperStore";
import {paperCommands} from "@/lib/trading/paperCommands";
import {PaperExecutionStatus} from "./PaperExecutionStatus";
import {paperSourceLabel} from "@/lib/trading/executionSource";
import {
  accountStats,
  buyingPower,
  unrealizedPnl,
  type Account,
  type Order,
} from "@/lib/trading/broker";
import { formatPrice, formatVolume, getSymbol } from "@/lib/symbols";

const fmt = (value: number, digits = 2) =>
  Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";
const signed = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${fmt(value, digits)}`;
const tone = (value: number) => (value > 0 ? "positive" : value < 0 ? "negative" : "");

export function EquityChart({
  points,
  height = 90,
  initial,
}: {
  points: { time: number; equity: number }[];
  height?: number;
  initial?: number;
}) {
  if (points.length < 2)
    return <div className="equity-empty">Equity curve appears after the first trades.</div>;
  const values = points.map((p) => p.equity);
  const min = Math.min(...values, initial ?? Infinity);
  const max = Math.max(...values, initial ?? -Infinity);
  const span = max - min || 1;
  const width = 400;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(" ");
  const up = values.at(-1)! >= (initial ?? values[0]);
  return (
    <svg className="equity-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Equity curve">
      {initial !== undefined ? (
        <line x1={0} x2={width} y1={y(initial)} y2={y(initial)} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="4 4" />
      ) : null}
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={up ? "#08998122" : "#f2364522"} />
      <path d={d} fill="none" stroke={up ? "#089981" : "#f23645"} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function OrderTicket() {
  const symbol = useChartStore((s) => s.symbol);
  const ticket = usePaperStore((s) => s.ticket);
  const prices = usePaperStore(s=>s.prices);
  const marks=usePaperMarkPrices();
  const priceSource=usePaperStore(s=>s.mode==="replay"?s.replaySource:s.liveSources[symbol]);
  const mode = usePaperStore((s) => s.mode);
  const account = usePaperStore((s) => activeAccount(s));
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy,setBusy]=useState(false);
  const [levelsOpen,setLevelsOpen]=useState(false),contextEpoch=usePaperStore(s=>s.contextEpoch);
  const price = prices[symbol];
  const book=usePaperQuote(symbol),execution=book?(ticket.side==="buy"?book.ask:book.bid):price;
  const set = (patch: Partial<Ticket>) => usePaperStore.getState().setTicket(patch);
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const reference = ticket.type === "market" ? execution : (ticket.price ?? ticket.stopPrice ?? price);
  const notional = reference ? reference * ticket.quantity : 0;
  const fee = notional * account.feeRate;
  const power = price ? buyingPower(account, marks) : 0;
  const asset = getSymbol(symbol);
  const submit = async(side: Ticket["side"]) => {
    if(busy)return;setBusy(true);setMessage(null);
    try{
    const result = await paperCommands.place({
      symbol,
      side,
      type: ticket.type,
      quantity: ticket.quantity,
      price: ticket.price,
      stopPrice: ticket.stopPrice,
      takeProfit: ticket.takeProfit,
      stopLoss: ticket.stopLoss,
      exitLevels:ticket.exitLevels,
      reduceOnly: ticket.reduceOnly,
    });
    if(!result)return;
    setMessage({
      ok: result.ok,
      text: result.ok
        ? result.order.status === "filled"
          ? `${side === "buy" ? "Bought" : "Sold"} ${result.order.quantity} ${asset.base} at ${formatPrice(result.order.fillPrice ?? 0)}`
          : `${side === "buy" ? "Buy" : "Sell"} ${ticket.type.replace("_", " ")} order working`
        : (result.order.reason ?? "Order rejected."),
    });
    }finally{setBusy(false);}
  };
  const needsLimit = ticket.type === "limit" || ticket.type === "stop_limit";
  const needsStop = ticket.type === "stop" || ticket.type === "stop_limit";
  return (
    <form
      className="order-ticket"
      aria-label={mode==="replay"?"Replay order ticket":"Paper order ticket"}
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if(e.target!==e.currentTarget)return;
        void submit(ticket.side);
      }}
    >
      <div className="ticket-heading">
        <strong>{symbolLabel(symbol)}</strong>
        <span className="mono">{price ? formatPrice(price) : "—"}</span>
        <span className={`mode-badge ${mode}`}>{mode === "replay" ? "REPLAY ACCOUNT" : "PAPER"}</span>
      </div>
      <span className={`paper-source ${priceSource??"unknown"}`} data-testid="paper-price-source">{priceSource?paperSourceLabel(priceSource):"Quote source unavailable"}</span>
      <OrderPresetControls/>
      <div className="segmented" role="group" aria-label="Order side">
        <button type="button" className={ticket.side === "sell" ? "sell active" : "sell"} onClick={() => set({ side: "sell" })}>
          Sell{book?<span className="mono"> {formatPrice(book.bid)}</span>:null}
        </button>
        <button type="button" className={ticket.side === "buy" ? "buy active" : "buy"} onClick={() => set({ side: "buy" })}>
          Buy{book?<span className="mono"> {formatPrice(book.ask)}</span>:null}
        </button>
      </div>
      <p className="form-help" data-testid="paper-execution-model">{book?`Bid / Ask · spread ${formatPrice(book.ask-book.bid)}`:mode==="replay"?"Historical bar-price model":"Last-price model · no fresh matching order book"}</p>
      <label>
        Order type
        <select aria-label="Order type" value={ticket.type} onChange={(e) => set({ type: e.target.value as Ticket["type"] })}>
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
          <option value="stop_limit">Stop limit</option>
        </select>
      </label>
      <label>
        Quantity ({asset.base})
        <input
          type="number"
          aria-label={`Quantity (${asset.base})`}
          min={0}
          step="any"
          value={ticket.quantity}
          onChange={(e) => set({ quantity: Number(e.target.value) })}
        />
      </label>
      <div className="quick-sizes">
        {[0.1, 0.25, 0.5, 1].map((fraction) => (
          <button
            key={fraction}
            type="button"
            disabled={!price}
            onClick={() => price && set({ quantity: Number(((power * fraction) / price).toPrecision(4)) })}
          >
            {fraction * 100}%
          </button>
        ))}
      </div>
      {needsStop ? (
        <label>
          Stop price
          <input aria-label="Stop price" type="number" step="any" min={0} value={ticket.stopPrice ?? ""} placeholder={price ? String(price) : ""} onChange={(e) => set({ stopPrice: num(e.target.value) })} />
        </label>
      ) : null}
      {needsLimit ? (
        <label>
          Limit price
          <input aria-label="Limit price" type="number" step="any" min={0} value={ticket.price ?? ""} placeholder={price ? String(price) : ""} onChange={(e) => set({ price: num(e.target.value) })} />
        </label>
      ) : null}
      {!ticket.exitLevels?.length?<div className="form-grid">
        <label>
          Take profit
          <input aria-label="Take profit" type="number" step="any" min={0} value={ticket.takeProfit ?? ""} onChange={(e) => set({ takeProfit: num(e.target.value) })} />
        </label>
        <label>
          Stop loss
          <input aria-label="Stop loss" type="number" step="any" min={0} value={ticket.stopLoss ?? ""} onChange={(e) => set({ stopLoss: num(e.target.value) })} />
        </label>
      </div>:null}
      <button type="button" className="button" disabled={busy||ticket.reduceOnly} onClick={()=>setLevelsOpen(true)}>{ticket.exitLevels?.length?`Edit ${ticket.exitLevels.length} exit levels`:"Configure exit levels"}</button>
      {levelsOpen?<OrderExitLevelsDialog symbol={symbol} quantity={ticket.quantity} levels={ticket.exitLevels} contextKey={JSON.stringify([symbol,mode,contextEpoch,ticket])} onClose={()=>setLevelsOpen(false)} onApply={exitLevels=>{set({exitLevels,...(exitLevels?.length?{takeProfit:undefined,stopLoss:undefined}:{})});setLevelsOpen(false);}}/>:null}
      <label className="check">
        <input type="checkbox" checked={ticket.reduceOnly} onChange={(e) => set({ reduceOnly: e.target.checked,...(e.target.checked?{exitLevels:undefined,takeProfit:undefined,stopLoss:undefined}:{}) })} />
        Reduce only
      </label>
      <p className="ticket-estimate mono">
        Notional {fmt(notional)} · fee {fmt(fee, 4)} · power {fmt(power, 0)} USDT
      </p>
      <button className={`button primary submit-${ticket.side}`} type="submit" disabled={busy}>
        {ticket.side === "buy" ? "Buy" : "Sell"} {asset.base}
        {ticket.type === "market" ? " at market" : ""}
      </button>
      {message ? <p className={message.ok ? "ticket-ok" : "error-message"}>{message.text}</p> : null}
    </form>
  );
}

function PositionsTable({ account }: { account: Account }) {
  const prices = usePaperMarkPrices();
  if (!account.positions.length) return <div className="empty-table">No open positions.</div>;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Side</th>
          <th>Qty</th>
          <th>Avg price</th>
          <th>Exit mark</th>
          <th>Unrealized</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {account.positions.map((p) => {
          const last = prices[p.symbol] ?? p.avgPrice;
          const pnl = unrealizedPnl(p, last);
          const pct = p.avgPrice ? (pnl / (Math.abs(p.quantity) * p.avgPrice)) * 100 : 0;
          return (
            <tr key={p.symbol}>
              <td>
                <button className="link-button" onClick={() => useChartStore.getState().set({ symbol: p.symbol })}>
                  {symbolLabel(p.symbol)}
                </button>
              </td>
              <td className={p.quantity > 0 ? "positive" : "negative"}>{p.quantity > 0 ? "Long" : "Short"}</td>
              <td className="mono">{formatVolume(Math.abs(p.quantity))}</td>
              <td className="mono">{formatPrice(p.avgPrice)}</td>
              <td className="mono">{formatPrice(last)}</td>
              <td className={`mono ${tone(pnl)}`}>
                {signed(pnl)} ({signed(pct)}%)
              </td>
              <td>
                <PositionActions symbol={p.symbol}/>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OrdersTable({ orders, working }: { orders: Order[]; working: boolean }) {
  const [editing,setEditing]=useState<Order|null>(null);
  const rows = orders.filter((o) => (working ? o.status === "working" : o.status !== "working")).slice(-100).reverse();
  if (!rows.length&&!editing) return <div className="empty-table">{working ? "No working orders." : "No order history."}</div>;
  return (
    <>
    <table className="data-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Symbol</th>
          <th>Side</th>
          <th>Type</th>
          <th>Qty</th>
          <th>Price</th>
          <th>Status</th>
          <th>Source</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.id}>
            <td className="mono">{new Date(o.createdAt).toLocaleTimeString()}</td>
            <td>{symbolLabel(o.symbol)}</td>
            <td className={o.side === "buy" ? "positive" : "negative"}>{o.side}</td>
            <td>{o.type.replace("_", " ")}{o.reduceOnly ? " · reduce" : ""}</td>
            <td className="mono">{o.quantity}</td>
            <td className="mono">
              {o.status === "filled" && o.fillPrice
                ? formatPrice(o.fillPrice)
                : formatPrice(o.price ?? o.stopPrice ?? 0)}
            </td>
            <td title={o.reason}>{o.status}</td>
            <td className={`paper-source ${(o.status==="filled"?o.fillSource:o.createdSource)??"unknown"}`}>{paperSourceLabel(o.status==="filled"?o.fillSource:o.createdSource)}</td>
            <td>
              {o.status === "working" ? (<><button type="button" className="button small" aria-label={`Modify order ${o.id}`} onClick={()=>setEditing({...o})}>Modify</button>
                <button className="icon-button" aria-label={`Cancel order ${o.id}`} onClick={() => void paperCommands.cancel(o.id)}>
                  <X size={13} />
                </button></>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    {editing?<OrderModification order={editing} onClose={()=>setEditing(null)}/>:null}
    </>
  );
}

function FillsTable({ account }: { account: Account }) {
  const rows = account.fills.slice(-200).reverse();
  if (!rows.length) return <div className="empty-table">No trades yet.</div>;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Symbol</th>
          <th>Side</th>
          <th>Qty</th>
          <th>Price</th>
          <th>Fee</th>
          <th>Realized</th>
          <th>Price basis</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id}>
            <td className="mono">{new Date(f.time).toLocaleString()}</td>
            <td>{symbolLabel(f.symbol)}</td>
            <td className={f.side === "buy" ? "positive" : "negative"}>{f.side}</td>
            <td className="mono">{f.quantity}</td>
            <td className="mono">{formatPrice(f.price)}</td>
            <td className="mono">{fmt(f.fee, 4)}</td>
            <td className={`mono ${tone(f.realizedPnl)}`}>{f.realizedPnl ? signed(f.realizedPnl) : "—"}</td>
            <td>{f.priceBasis==="bid"?"Bid":f.priceBasis==="ask"?"Ask":f.priceBasis==="limit"?"Limit":f.priceBasis==="last"?"Last / bar":"Not recorded"}</td>
            <td className={`paper-source ${f.source??"unknown"}`}>{paperSourceLabel(f.source)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AccountView({ account }: { account: Account }) {
  const prices = usePaperMarkPrices();
  const stats = useMemo(() => accountStats(account, prices), [account, prices]);
  const [draft, setDraft] = useState({
    initialBalance: account.initialBalance,
    leverage: account.leverage,
    feeRate: account.feeRate * 100,
    slippageBps: account.slippageBps,
  });
  const metric = (label: string, value: string, className = "") => (
    <div className="metric">
      <span>{label}</span>
      <strong className={`mono ${className}`}>{value}</strong>
    </div>
  );
  return (
    <div className="account-view">
      <div className="metrics-grid">
        {metric("Equity", `${fmt(stats.equity)} USDT`)}
        {metric("Cash", fmt(stats.cash))}
        {metric("Unrealized P&L", signed(stats.unrealized), tone(stats.unrealized))}
        {metric("Realized P&L", signed(stats.realized), tone(stats.realized))}
        {metric("Return", `${signed(stats.returnPercent)}%`, tone(stats.returnPercent))}
        {metric("Margin used", fmt(stats.margin))}
        {metric("Win rate", stats.winRate === null ? "—" : `${stats.winRate.toFixed(0)}%`)}
        {metric("Profit factor", stats.profitFactor === null ? "—" : Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞")}
        {metric("Max drawdown", `${stats.maxDrawdown.toFixed(2)}%`)}
        {metric("Fees paid", fmt(stats.fees, 4))}
      </div>
      <EquityChart points={account.equity} initial={account.initialBalance} />
      <form
        className="account-settings"
        onSubmit={(e) => {
          e.preventDefault();
          if (!window.confirm("Resetting clears every position, order and trade of this account. Continue?")) return;
          void paperCommands.reset({
            initialBalance: Math.max(1, draft.initialBalance),
            leverage: Math.max(1, Math.min(100, draft.leverage)),
            feeRate: Math.max(0, draft.feeRate) / 100,
            slippageBps: Math.max(0, draft.slippageBps),
          });
        }}
      >
        <label>
          Starting balance
          <input type="number" min={1} value={draft.initialBalance} onChange={(e) => setDraft({ ...draft, initialBalance: Number(e.target.value) })} />
        </label>
        <label>
          Leverage ×
          <input type="number" min={1} max={100} value={draft.leverage} onChange={(e) => setDraft({ ...draft, leverage: Number(e.target.value) })} />
        </label>
        <label>
          Fee %
          <input type="number" min={0} step="any" value={draft.feeRate} onChange={(e) => setDraft({ ...draft, feeRate: Number(e.target.value) })} />
        </label>
        <label>
          Slippage (bps)
          <input type="number" min={0} step="any" value={draft.slippageBps} onChange={(e) => setDraft({ ...draft, slippageBps: Number(e.target.value) })} />
        </label>
        <button className="button small">Reset account</button>
      </form>
    </div>
  );
}

export function TradingPanel() {
  const account = usePaperStore((s) => activeAccount(s));
  const mode = usePaperStore((s) => s.mode);
  const [tab, setTab] = useState<"positions" | "orders" | "history" | "trades" | "account">("positions");
  const working = account.orders.filter((o) => o.status === "working").length;
  return (
    <div className="trading-panel">
      <OrderTicket />
      <div className="trading-tables">
        <div className="panel-tabs">
          {(
            [
              ["positions", `Positions${account.positions.length ? ` (${account.positions.length})` : ""}`],
              ["orders", `Orders${working ? ` (${working})` : ""}`],
              ["history", "Order history"],
              ["trades", "Trades"],
              ["account", "Account"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
          <span className="flex-1" />
          {mode === "replay" ? <span className="mode-badge replay">Replay account</span> : null}
          {account.positions.length || working ? (
            <button className="link-button" onClick={() => void paperCommands.cancelAll()}>
              Cancel all orders
            </button>
          ) : null}
        </div>
        <PaperExecutionStatus replay={mode==="replay"}/>
        <div className="table-scroll">
          {tab === "positions" ? <PositionsTable account={account} /> : null}
          {tab === "orders" ? <OrdersTable orders={account.orders} working /> : null}
          {tab === "history" ? <OrdersTable orders={account.orders} working={false} /> : null}
          {tab === "trades" ? <FillsTable account={account} /> : null}
          {tab === "account" ? <AccountView key={mode} account={account} /> : null}
        </div>
      </div>
    </div>
  );
}
