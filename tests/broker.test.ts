import { describe, expect, it } from "vitest";
import {
  accountStats,
  cancelAll,
  cancelOrder,
  closePosition,
  createAccount,
  equityOf,
  markToMarket,
  placeOrder,
  positionOf,
  processBar,
  processPrice,
  type Account,
  type NewOrder,
} from "@/lib/trading/broker";

const base = () => createAccount({ initialBalance: 10_000, feeRate: 0, slippageBps: 0 });
const buy = (account: Account, patch: Partial<NewOrder> = {}, prices = { BTCUSDT: 100 }, time = 1) =>
  placeOrder(account, { symbol: "BTCUSDT", side: "buy", type: "market", quantity: 10, ...patch }, prices, time);

describe("market orders and positions", () => {
  it("keeps protective orders working when a close is rejected for a missing quote",()=>{
    const opened=buy(base(),{takeProfit:110,stopLoss:90}).account,closed=closePosition(opened,"BTCUSDT",{},2)!;expect(closed.order.status).toBe("rejected");expect(closed.account.orders.filter(o=>o.status==="working")).toHaveLength(2);expect(closed.account.positions).toHaveLength(1);
  });
  it("rejects nonfinite prices and serializes rejected numeric inputs without NaN or Infinity",()=>{
    const a=buy(base(),{type:"limit",price:Infinity}),b=buy(base(),{quantity:NaN});expect(a.order.status).toBe("rejected");expect(b.order.status).toBe("rejected");expect(a.order.price).toBeUndefined();expect(b.order.quantity).toBe(0);expect(JSON.parse(JSON.stringify(b.account)).orders[0].quantity).toBe(0);
  });
  it("fills at the market, updates cash and opens a long", () => {
    const { account, order, fills } = buy(base());
    expect(order.status).toBe("filled");
    expect(fills).toHaveLength(1);
    expect(account.cash).toBe(9000);
    expect(positionOf(account, "BTCUSDT")).toMatchObject({ quantity: 10, avgPrice: 100 });
    expect(equityOf(account, { BTCUSDT: 110 })).toBe(10_100);
  });
  it("applies fees and adverse slippage", () => {
    const account = createAccount({ initialBalance: 10_000, feeRate: 0.001, slippageBps: 10 });
    const { fills } = buy(account);
    expect(fills[0].price).toBeCloseTo(100.1, 8);
    expect(fills[0].fee).toBeCloseTo(10 * 100.1 * 0.001, 8);
    const sell = placeOrder(buy(account).account, { symbol: "BTCUSDT", side: "sell", type: "market", quantity: 10 }, { BTCUSDT: 100 }, 2);
    expect(sell.fills[0].price).toBeCloseTo(99.9, 8);
  });
  it("averages up, books profit when reducing and flips through zero", () => {
    let account = buy(base()).account;
    account = buy(account, {}, { BTCUSDT: 120 }, 2).account;
    expect(positionOf(account, "BTCUSDT")).toMatchObject({ quantity: 20, avgPrice: 110 });
    const reduce = placeOrder(account, { symbol: "BTCUSDT", side: "sell", type: "market", quantity: 5 }, { BTCUSDT: 130 }, 3);
    expect(reduce.fills[0].realizedPnl).toBeCloseTo(100, 8);
    const flip = placeOrder(reduce.account, { symbol: "BTCUSDT", side: "sell", type: "market", quantity: 25 }, { BTCUSDT: 130 }, 4);
    expect(positionOf(flip.account, "BTCUSDT")).toMatchObject({ quantity: -10, avgPrice: 130 });
  });
  it("rejects bad orders and anything beyond buying power", () => {
    expect(buy(base(), { quantity: 0 }).order.status).toBe("rejected");
    expect(buy(base(), { quantity: 1000 }).order).toMatchObject({ status: "rejected", reason: "Insufficient buying power." });
    expect(buy(base(), { type: "limit" }).order.reason).toMatch(/limit price/);
    expect(buy(base(), {}, {} as never).order.reason).toMatch(/market price/);
    expect(buy(base(), { takeProfit: 90 }).order.reason).toMatch(/Take profit/);
    expect(buy(base(), { reduceOnly: true }).order.reason).toMatch(/Reduce-only/);
    const leveraged = createAccount({ initialBalance: 10_000, feeRate: 0, slippageBps: 0, leverage: 5 });
    expect(buy(leveraged, { quantity: 400 }).order.status).toBe("filled");
  });
});

describe("resting orders", () => {
  it("fills limits when price reaches them and gives price improvement", () => {
    const placed = buy(base(), { type: "limit", price: 95 });
    expect(placed.order.status).toBe("working");
    expect(processPrice(placed.account, "BTCUSDT", 96, 2).fills).toHaveLength(0);
    const hit = processPrice(placed.account, "BTCUSDT", 94, 3);
    expect(hit.fills[0].price).toBe(95);
    expect(hit.account.cash).toBe(10_000 - 950);
    const marketable = buy(base(), { type: "limit", price: 105 });
    expect(marketable.order.status).toBe("filled");
    expect(marketable.fills[0].price).toBe(100);
  });
  it("triggers stops and stop-limits", () => {
    const stop = buy(base(), { type: "stop", stopPrice: 105 });
    expect(stop.order.status).toBe("working");
    expect(processPrice(stop.account, "BTCUSDT", 104, 2).fills).toHaveLength(0);
    expect(processPrice(stop.account, "BTCUSDT", 106, 3).fills[0].price).toBe(106);
    const stopLimit = buy(base(), { type: "stop_limit", stopPrice: 105, price: 106 });
    const triggered = processPrice(stopLimit.account, "BTCUSDT", 107, 2);
    expect(triggered.fills).toHaveLength(0);
    expect(triggered.account.orders[0].triggered).toBe(true);
    expect(processPrice(triggered.account, "BTCUSDT", 105.5, 3).fills[0].price).toBe(106);
  });
  it("cancels single orders and all orders for a symbol", () => {
    const a = buy(base(), { type: "limit", price: 90 });
    const b = buy(a.account, { type: "limit", price: 80 });
    expect(cancelOrder(b.account, a.order.id).orders.map((o) => o.status)).toEqual(["canceled", "working"]);
    expect(cancelAll(b.account, "BTCUSDT").orders.every((o) => o.status === "canceled")).toBe(true);
  });
});

describe("brackets and OCO", () => {
  const entry = () => buy(base(), { takeProfit: 110, stopLoss: 95 });
  it("creates linked exits that cancel each other", () => {
    const { account } = entry();
    const exits = account.orders.filter((o) => o.reduceOnly);
    expect(exits).toHaveLength(2);
    expect(exits[0].oco).toBe(exits[1].oco);
    const target = processPrice(account, "BTCUSDT", 111, 2);
    expect(target.fills[0].realizedPnl).toBeCloseTo(100, 8);
    expect(positionOf(target.account, "BTCUSDT")).toBeUndefined();
    expect(target.account.orders.filter((o) => o.status === "working")).toHaveLength(0);
  });
  it("stops out and cancels the target", () => {
    const stopped = processPrice(entry().account, "BTCUSDT", 94, 2);
    expect(stopped.fills[0].realizedPnl).toBeCloseTo(-60, 8);
    expect(stopped.account.orders.find((o) => o.type === "limit" && o.reduceOnly)?.status).toBe("canceled");
  });
  it("lets the intrabar path decide when a bar spans both levels", () => {
    const up = processBar(entry().account, "BTCUSDT", { time: 5, open: 100, high: 112, low: 90, close: 100 });
    expect(up.fills.at(-1)!.price).toBeCloseTo(110, 8);
    const down = processBar(entry().account, "BTCUSDT", { time: 5, open: 100, high: 112, low: 90, close: 99 });
    expect(down.fills.at(-1)!.price).toBeCloseTo(95, 8);
  });
  it("fills an entry and its bracket inside the same replayed bar", () => {
    const pending = buy(base(), { type: "limit", price: 95, takeProfit: 105 });
    const result = processBar(pending.account, "BTCUSDT", { time: 9, open: 100, high: 106, low: 94, close: 99 });
    expect(result.fills.map((f) => f.side)).toEqual(["buy", "sell"]);
    expect(positionOf(result.account, "BTCUSDT")).toBeUndefined();
  });
});

describe("closing and statistics", () => {
  it("closes a position at market and cancels its working orders", () => {
    const opened = buy(base(), { takeProfit: 150 }).account;
    const closed = closePosition(opened, "BTCUSDT", { BTCUSDT: 120 }, 5)!;
    expect(positionOf(closed.account, "BTCUSDT")).toBeUndefined();
    expect(closed.account.cash).toBe(10_200);
    expect(closed.account.orders.filter((o) => o.status === "working")).toHaveLength(0);
    expect(closePosition(base(), "BTCUSDT", {}, 1)).toBeNull();
  });
  it("reports win rate, profit factor, drawdown and return", () => {
    let account = base();
    account = markToMarket(account, { BTCUSDT: 100 }, 0);
    account = buy(account).account;
    account = placeOrder(account, { symbol: "BTCUSDT", side: "sell", type: "market", quantity: 10 }, { BTCUSDT: 120 }, 2).account;
    account = markToMarket(account, { BTCUSDT: 120 }, 120_000);
    account = buy(account).account;
    account = markToMarket(account, { BTCUSDT: 80 }, 240_000);
    account = placeOrder(account, { symbol: "BTCUSDT", side: "sell", type: "market", quantity: 10 }, { BTCUSDT: 80 }, 3).account;
    const stats = accountStats(account, { BTCUSDT: 80 });
    expect(stats.trades).toBe(2);
    expect(stats.winRate).toBe(50);
    expect(stats.profitFactor).toBeCloseTo(200 / 200, 8);
    expect(stats.equity).toBeCloseTo(10_000, 8);
    expect(stats.maxDrawdown).toBeGreaterThan(0);
    expect(stats.returnPercent).toBeCloseTo(0, 8);
  });
  it("does not mutate the account it was given", () => {
    const original = base();
    const snapshot = JSON.stringify(original);
    buy(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
