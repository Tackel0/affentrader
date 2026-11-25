/**
 * Paper-trading engine. Pure functions over an `Account` value: orders are
 * placed, matched against live prices or replayed bars, positions are marked
 * to market and every change returns a new account. No network, no globals,
 * which keeps it deterministic and unit-testable.
 */
import {validExecutionQuote,type ExecutableQuote} from "./quotes";
import {validateExitLevels,type ExitLevel} from "./exitLevels";
import { isSymbolId } from "@/lib/symbolId";
import type {PaperExecutionSource} from "./executionSource";
export type Side = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type OrderStatus = "working" | "filled" | "canceled" | "rejected";

export interface Order {
  exitLevels?:ExitLevel[];
  revision?:number;
  modifiedAt?:number;
  modifiedSource?:PaperExecutionSource;
  createdSource?:PaperExecutionSource;
  fillSource?:PaperExecutionSource;
  id: string;
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: number;
  /** Limit price (limit and stop-limit orders). */
  price?: number;
  /** Trigger price (stop and stop-limit orders). */
  stopPrice?: number;
  /** A stop-limit order whose stop has been hit and now rests as a limit. */
  triggered?: boolean;
  reduceOnly: boolean;
  /** Bracket levels created when this order fills. */
  takeProfit?: number;
  stopLoss?: number;
  /** Orders sharing a group cancel each other when one fills (OCO). */
  oco?: string;
  status: OrderStatus;
  createdAt: number;
  filledAt?: number;
  fillPrice?: number;
  reason?: string;
  note?: string;
}

export interface Position {
  symbol: string;
  /** Positive when long, negative when short. */
  quantity: number;
  avgPrice: number;
  openedAt: number;
  /** Profit already booked by partially closing this position. */
  realizedPnl: number;
}

export type FillPriceBasis = "bid" | "ask" | "last" | "limit";
export interface Fill {
  priceBasis?:FillPriceBasis;
  source?:PaperExecutionSource;
  id: string;
  orderId: string;
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  fee: number;
  time: number;
  /** Realized profit of the part of this fill that reduced a position. */
  realizedPnl: number;
  position: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface Account {
  initialBalance: number;
  cash: number;
  /** Maker/taker fee as a fraction of notional. */
  feeRate: number;
  /** Adverse price move applied to market and stop fills, in basis points. */
  slippageBps: number;
  /** Buying power multiplier over equity. */
  leverage: number;
  positions: Position[];
  orders: Order[];
  fills: Fill[];
  equity: EquityPoint[];
  seq: number;
}

export const DEFAULT_ACCOUNT: Account = {
  initialBalance: 100_000,
  cash: 100_000,
  feeRate: 0.001,
  slippageBps: 1,
  leverage: 1,
  positions: [],
  orders: [],
  fills: [],
  equity: [],
  seq: 0,
};

export function createAccount(patch: Partial<Account> = {}): Account {
  const base = { ...structuredClone(DEFAULT_ACCOUNT), ...patch };
  return { ...base, cash: patch.cash ?? patch.initialBalance ?? base.initialBalance };
}

export type Prices = Record<string, number>;

export interface NewOrder {
  exitLevels?:ExitLevel[];
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  reduceOnly?: boolean;
  takeProfit?: number;
  stopLoss?: number;
  note?: string;
}

const EPSILON = 1e-12;
const nextId = (account: Account, prefix: string) => `${prefix}-${++account.seq}`;

export function positionOf(account: Account, symbol: string): Position | undefined {
  return account.positions.find((p) => p.symbol === symbol);
}

export function unrealizedPnl(position: Position, price: number): number {
  return (price - position.avgPrice) * position.quantity;
}

export function equityOf(account: Account, prices: Prices): number {
  return (
    account.cash +
    account.positions.reduce(
      (sum, p) => sum + p.quantity * (prices[p.symbol] ?? p.avgPrice),
      0,
    )
  );
}

/** Margin used: notional of all positions divided by leverage. */
export function marginUsed(account: Account, prices: Prices): number {
  return (
    account.positions.reduce(
      (sum, p) => sum + Math.abs(p.quantity) * (prices[p.symbol] ?? p.avgPrice),
      0,
    ) / account.leverage
  );
}

export function buyingPower(account: Account, prices: Prices): number {
  return Math.max(0, equityOf(account, prices) * account.leverage - marginUsed(account, prices) * account.leverage);
}

export interface Placement {
  account: Account;
  order: Order;
  fills: Fill[];
}
export interface OrderPatch {quantity?:number;price?:number|null;stopPrice?:number|null;takeProfit?:number|null;stopLoss?:number|null;exitLevels?:ExitLevel[]|null}
export interface Amendment {account:Account;order?:Order;ok:boolean;error?:string;fills:Fill[]}

/** Amend a working order in place; rejected amendments never replace protection or append a new order. */
export function amendOrder(source:Account,id:string,patch:OrderPatch,expectedRevision:number,prices:Prices,time:number,executionSource?:PaperExecutionSource,quote?:ExecutableQuote):Amendment {
  const original=source.orders.find(order=>order.id===id),fail=(error:string):Amendment=>({account:source,order:original,ok:false,error,fills:[]});
  if(!original||original.status!=="working"||original.type==="market")return fail("This order is no longer working. Close the editor and review the account.");
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==(original.revision??0))return fail("This order changed. Close the editor and reopen its latest version.");
  if(!Number.isFinite(time)||time<Math.max(original.createdAt,original.modifiedAt??original.createdAt))return fail("The order clock changed. Review the account before editing.");
  if(!patch||typeof patch!=="object"||Array.isArray(patch)||Object.keys(patch).some(key=>!["quantity","price","stopPrice","takeProfit","stopLoss","exitLevels"].includes(key)))return fail("Unsupported order fields.");
  if(original.triggered&&patch.stopPrice!==undefined&&patch.stopPrice!==original.stopPrice)return fail("This stop-limit already triggered. Only its limit price and quantity can be changed.");
  const candidate={...original};
  if(patch.exitLevels!==undefined){if(patch.exitLevels===null||Array.isArray(patch.exitLevels)&&patch.exitLevels.length===0)delete candidate.exitLevels;else candidate.exitLevels=patch.exitLevels;}
  for(const key of ["quantity","price","stopPrice","takeProfit","stopLoss"] as const){const value=patch[key];if(value===undefined)continue;if(value===null){if(key==="quantity")return fail("Quantity must be positive.");delete candidate[key];}else candidate[key]=value;}
  const problem=validate(source,candidate,prices[original.symbol]);if(problem)return fail(problem);
  if(candidate.type==="limit"&&candidate.stopPrice!==undefined||candidate.type==="stop"&&candidate.price!==undefined)return fail("The order type does not support this price field.");
  if(candidate.reduceOnly){const position=positionOf(source,candidate.symbol)!;if(candidate.quantity>Math.abs(position.quantity)+EPSILON)return fail("Reduce-only quantity exceeds the remaining position.");if(candidate.takeProfit!==undefined||candidate.stopLoss!==undefined)return fail("Protective exit orders cannot create another bracket.");}
  const reference=candidate.price??candidate.stopPrice!;
  if(exceedsBuyingPower(source,candidate,reference,prices))return fail("Insufficient buying power for the modified order.");
  const changed=(["quantity","price","stopPrice","takeProfit","stopLoss"] as const).some(key=>candidate[key]!==original[key])||JSON.stringify(candidate.exitLevels??null)!==JSON.stringify(original.exitLevels??null);
  if(!changed)return {account:source,order:original,ok:true,fills:[]};
  if(!Number.isSafeInteger((original.revision??0)+1))return fail("This order reached its modification limit.");
  const account=structuredClone(source),order=account.orders.find(order=>order.id===id)!;
  Object.assign(order,candidate,{revision:(original.revision??0)+1,modifiedAt:time,modifiedSource:executionSource});
  if(candidate.exitLevels?.length)order.exitLevels=structuredClone(candidate.exitLevels);else delete order.exitLevels;
  for(const key of ["price","stopPrice","takeProfit","stopLoss"] as const)if(candidate[key]===undefined)delete order[key];
  if(order.oco&&order.reduceOnly&&order.quantity!==original.quantity){for(const sibling of account.orders){if(sibling.id===id||sibling.oco!==order.oco||!sibling.reduceOnly||sibling.symbol!==order.symbol||sibling.status!=="working")continue;if(!Number.isSafeInteger((sibling.revision??0)+1))return fail("A paired order reached its modification limit.");Object.assign(sibling,{quantity:order.quantity,revision:(sibling.revision??0)+1,modifiedAt:time,modifiedSource:executionSource});}}
  const last=prices[order.symbol];
  const result=Number.isFinite(last)&&last>0?processPrice(account,order.symbol,last,time,true,true,time,executionSource,quote,id):{account,fills:[]};
  const before=positionOf(source,order.symbol)?.quantity??0,after=positionOf(result.account,order.symbol)?.quantity??0;
  if(result.fills.length&&after!==0&&(Math.abs(after)>Math.abs(before)||Math.sign(after)!==Math.sign(before))){
    const book=validExecutionQuote(quote,time)&&((executionSource==="market"&&!quote.simulated)||(executionSource==="simulation"&&quote.simulated))?quote:undefined;
    const marks={...prices,[order.symbol]:book?(after>0?book.bid:book.ask):last},margin=marginUsed(result.account,marks),equity=equityOf(result.account,marks);
    if(!Number.isFinite(margin)||!Number.isFinite(equity)||margin>equity+EPSILON)return fail("Insufficient buying power at the current executable price.");
  }
  return {account:result.account,order:result.account.orders.find(order=>order.id===id),ok:true,fills:result.fills};
}

function validate(account: Account, input: NewOrder, price: number | undefined): string | null {
  if (!(input.quantity > 0) || !Number.isFinite(input.quantity)) return "Quantity must be positive.";
  if (!isSymbolId(input.symbol)) return "Invalid symbol.";
  if(input.exitLevels!==undefined){const error=validateExitLevels(input.exitLevels,input.quantity);if(error)return error;}
  if(input.exitLevels?.length){
    if(input.reduceOnly)return "Reduce-only exits cannot create another bracket.";
    if(input.takeProfit!==undefined||input.stopLoss!==undefined)return "Choose regular brackets or exit levels, not both.";
    const reference=input.type==="market"?price:input.price??input.stopPrice;
    if(reference&&input.exitLevels.some(l=>l.takeProfit!==null&&(input.side==="buy"?l.takeProfit<=reference:l.takeProfit>=reference)||l.stopLoss!==null&&(input.side==="buy"?l.stopLoss>=reference:l.stopLoss<=reference)))return "Exit prices must be on the correct sides of the entry reference.";
  }
  if([input.price,input.stopPrice,input.takeProfit,input.stopLoss].some(value=>value!==undefined&&(!Number.isFinite(value)||value<=0)))return "Order prices must be positive finite numbers.";
  if (
    (input.type === "limit" && input.stopPrice !== undefined) ||
    (input.type === "stop" && input.price !== undefined) ||
    (input.type === "market" && (input.price !== undefined || input.stopPrice !== undefined))
  )
    return "The order type does not support this price field.";
  if ((input.type === "limit" || input.type === "stop_limit") && !(input.price! > 0))
    return "A limit price is required.";
  if ((input.type === "stop" || input.type === "stop_limit") && !(input.stopPrice! > 0))
    return "A stop price is required.";
  if (input.type === "market" && !(price && price > 0)) return "No market price is available yet.";
  if (input.takeProfit !== undefined || input.stopLoss !== undefined) {
    const reference = input.type === "market" ? price : (input.price ?? input.stopPrice);
    if (reference) {
      if (input.takeProfit !== undefined && (input.side === "buy" ? input.takeProfit <= reference : input.takeProfit >= reference))
        return "Take profit must be on the profitable side of the entry.";
      if (input.stopLoss !== undefined && (input.side === "buy" ? input.stopLoss >= reference : input.stopLoss <= reference))
        return "Stop loss must be on the losing side of the entry.";
    }
  }
  if (input.reduceOnly) {
    const position = positionOf(account, input.symbol);
    if (!position || Math.sign(position.quantity) === (input.side === "buy" ? 1 : -1))
      return "Reduce-only orders must oppose an open position.";
  }
  return null;
}

/** Margin check for an order that increases exposure. */
function exceedsBuyingPower(
  account: Account,
  input: NewOrder,
  price: number,
  prices: Prices,
): boolean {
  const position = positionOf(account, input.symbol);
  const signed = input.side === "buy" ? input.quantity : -input.quantity;
  const current = position?.quantity ?? 0;
  const after = current + signed;
  const increase = Math.max(0, Math.abs(after) - Math.abs(current));
  if (increase === 0) return false;
  const required = (increase * price) / account.leverage + increase * price * account.feeRate;
  const equity = equityOf(account, prices);
  return required > equity - marginUsed(account, prices) + EPSILON;
}

/**
 * Place an order. Market orders use a fresh matching bid/ask when available,
 * otherwise `prices[symbol]`, plus
 * slippage; the others rest until `processPrice` / `processBar` meets them.
 */
export function placeOrder(
  source: Account,
  input: NewOrder,
  prices: Prices,
  time: number,
  executionSource?:PaperExecutionSource,
  quote?:ExecutableQuote,
): Placement {
  const account = structuredClone(source);
  const book=validExecutionQuote(quote,time)&&((executionSource==="market"&&!quote.simulated)||(executionSource==="simulation"&&quote.simulated))?quote:undefined;
  const price = book?(input.side==="buy"?book.ask:book.bid):prices[input.symbol];
  const problem = validate(account, input, price);
  const order: Order = {
    exitLevels:!problem&&input.exitLevels?.length?structuredClone(input.exitLevels):undefined,
    createdSource:executionSource,
    id: nextId(account, "ord"),
    symbol: input.symbol,
    side: input.side,
    type: input.type,
    quantity: input.quantity,
    price: input.price,
    stopPrice: input.stopPrice,
    reduceOnly: Boolean(input.reduceOnly),
    takeProfit: input.takeProfit,
    stopLoss: input.stopLoss,
    status: "working",
    createdAt: time,
    note: input.note,
  };
  const reference =
    input.type === "market" ? price : (input.price ?? input.stopPrice ?? price ?? 0);
  if (!problem && reference && exceedsBuyingPower(account, input, reference, prices)) {
    return reject(account, order, "Insufficient buying power.");
  }
  if (problem) return reject(account, order, problem);
  if (input.reduceOnly) {
    const position = positionOf(account, input.symbol)!;
    if (input.quantity > Math.abs(position.quantity) + EPSILON)
      order.quantity = Math.abs(position.quantity);
  }
  account.orders.push(order);
  if (input.type === "market") {
    const fills = fillOrder(account, order, price!, time, true,executionSource,book?(input.side==="buy"?"ask":"bid"):"last");
    return { account, order: account.orders.find((o) => o.id === order.id)!, fills };
  }
  if (!price) return { account, order, fills: [] };
  // Marketable limit orders and stops already through the market execute at once.
  const immediate = processPrice(account, input.symbol, prices[input.symbol]??price, time, true, true, time, executionSource, book, order.id);
  const before = positionOf(source, input.symbol)?.quantity ?? 0;
  const after = positionOf(immediate.account, input.symbol)?.quantity ?? 0;
  if (immediate.fills.length && after !== 0 && (Math.abs(after) > Math.abs(before) || Math.sign(after) !== Math.sign(before))) {
    const marks = { ...prices, [input.symbol]: book ? (after > 0 ? book.bid : book.ask) : (prices[input.symbol] ?? price) };
    const margin = marginUsed(immediate.account, marks);
    const equity = equityOf(immediate.account, marks);
    if (!Number.isFinite(margin) || !Number.isFinite(equity) || margin > equity + EPSILON) {
      const rollback = structuredClone(source);
      rollback.seq = account.seq;
      return reject(rollback, order, "Insufficient buying power at the current executable price.");
    }
  }
  return {
    account: immediate.account,
    order: immediate.account.orders.find((o) => o.id === order.id)!,
    fills: immediate.fills,
  };
}

function reject(account: Account, order: Order, reason: string): Placement {
  const rejected: Order = { ...order,quantity:Number.isFinite(order.quantity)?order.quantity:0,status: "rejected", reason };
  for(const key of ["price","stopPrice","takeProfit","stopLoss"] as const)if(rejected[key]!==undefined&&!Number.isFinite(rejected[key]))delete rejected[key];
  account.orders.push(rejected);
  return { account, order: rejected, fills: [] };
}

export function cancelOrder(source: Account, id: string): Account {
  const account = structuredClone(source);
  const order = account.orders.find((o) => o.id === id);
  if (order?.status === "working") {
    order.status = "canceled";
    cancelLinked(account, order);
  }
  return account;
}

function cancelLinked(account: Account, order: Order) {
  if (!order.oco) return;
  for (const other of account.orders)
    if (other.id !== order.id && other.oco === order.oco && other.status === "working")
      other.status = "canceled";
}

export function cancelAll(source: Account, symbol?: string): Account {
  const account = structuredClone(source);
  for (const order of account.orders)
    if (order.status === "working" && (!symbol || order.symbol === symbol)) order.status = "canceled";
  return account;
}

/** Reverse with one double-size market order. Reject before changing exposure or protection. */
export function reversePosition(source:Account,symbol:string,prices:Prices,time:number,executionSource?:PaperExecutionSource,quote?:ExecutableQuote):Placement|null {
  const position=positionOf(source,symbol);if(!position)return null;
  const result=placeOrder(source,{symbol,side:position.quantity>0?"sell":"buy",type:"market",quantity:Math.abs(position.quantity)*2,note:"Reverse position"},prices,time,executionSource,quote);
  if(result.order.status==="rejected")return result;
  const book=validExecutionQuote(quote,time)&&((executionSource==="market"&&!quote.simulated)||(executionSource==="simulation"&&quote.simulated))?quote:undefined;
  const rejectedReversal=(reason:string)=>{
    const account=structuredClone(source),order:Order={...result.order,id:nextId(account,"ord"),status:"working",filledAt:undefined,fillPrice:undefined,fillSource:undefined};
    return reject(account,order,reason);
  };
  const reversed=positionOf(result.account,symbol);
  if(!reversed)return rejectedReversal("Position size is below the paper engine precision.");
  const marks={...prices,[symbol]:book?(reversed.quantity>0?book.bid:book.ask):prices[symbol]};
  const margin=marginUsed(result.account,marks),equity=equityOf(result.account,marks);
  if(!Number.isFinite(margin)||!Number.isFinite(equity)||margin>equity+EPSILON){
    return rejectedReversal("Insufficient buying power to reverse the position.");
  }
  // Old protective exits belong to the exposure that was just closed, not the new direction.
  for(const order of result.account.orders)if(order.symbol===symbol&&order.status==="working"&&order.reduceOnly)order.status="canceled";
  return result;
}

/** Close all or a reviewed quantity at market; a rejected close preserves working orders. */
export function closePosition(
  source: Account,
  symbol: string,
  prices: Prices,
  time: number,
  executionSource?:PaperExecutionSource,
  quote?:ExecutableQuote,
  quantity?:number,
): Placement | null {
  const position = positionOf(source, symbol);
  if (!position) return null;
  const size=Math.abs(position.quantity),amount=quantity??size,remainder=size-amount;
  if(!Number.isFinite(amount)||amount<EPSILON||amount>size||remainder>0&&remainder<EPSILON)throw new RangeError("Close quantity must be positive, within the position and above paper-engine precision.");
  if(remainder>0&&source.orders.some(o=>o.symbol===symbol&&o.status==="working"&&o.reduceOnly&&o.quantity>remainder&&!Number.isSafeInteger((o.revision??0)+1)))throw new RangeError("A protective order reached its modification limit.");
  const result=placeOrder(
    source,
    {
      symbol,
      side: position.quantity > 0 ? "sell" : "buy",
      type: "market",
      quantity: amount,
      reduceOnly: true,
      note: remainder>0?"Partial close position":"Close position",
    },
    prices,
    time,
    executionSource,
    quote,
  );
  if(result.order.status!=="filled")return result;
  if(!positionOf(result.account,symbol)){result.account=cancelAll(result.account,symbol);return result;}
  const remaining=Math.abs(positionOf(result.account,symbol)!.quantity);
  for(const order of result.account.orders){
    if(order.symbol!==symbol||order.status!=="working"||!order.reduceOnly||order.quantity<=remaining)continue;
    Object.assign(order,{quantity:remaining,revision:(order.revision??0)+1,modifiedAt:time,modifiedSource:executionSource});
  }
  return result;
}

function slip(price: number, side: Side, bps: number): number {
  const factor = bps / 10_000;
  return side === "buy" ? price * (1 + factor) : price * (1 - factor);
}

/** Apply one fill to the account (cash, position, bracket orders). */
function fillOrder(
  account: Account,
  order: Order,
  rawPrice: number,
  time: number,
  slippage: boolean,
  executionSource?:PaperExecutionSource,
  priceBasis:FillPriceBasis="last",
): Fill[] {
  if(order.reduceOnly){
    const current=positionOf(account,order.symbol);
    if(!current||Math.sign(current.quantity)===(order.side==="buy"?1:-1)){order.status="canceled";cancelLinked(account,order);return [];}
    order.quantity=Math.min(order.quantity,Math.abs(current.quantity));
  }
  const price = slippage ? slip(rawPrice, order.side, account.slippageBps) : rawPrice;
  const signed = order.side === "buy" ? order.quantity : -order.quantity;
  const notional = order.quantity * price;
  const fee = notional * account.feeRate;
  let position = positionOf(account, order.symbol);
  let realized = 0;
  if (position && Math.sign(position.quantity) !== Math.sign(signed)) {
    const closing = Math.min(Math.abs(signed), Math.abs(position.quantity));
    realized = (price - position.avgPrice) * closing * Math.sign(position.quantity);
  }
  account.cash += -signed * price - fee;
  if (!position) {
    position = {
      symbol: order.symbol,
      quantity: 0,
      avgPrice: price,
      openedAt: time,
      realizedPnl: 0,
    };
    account.positions.push(position);
  }
  const before = position.quantity;
  const after = before + signed;
  if (Math.abs(after) < EPSILON) position.quantity = 0;
  else if (Math.sign(before) === Math.sign(signed) || before === 0)
    position.avgPrice = (Math.abs(before) * position.avgPrice + Math.abs(signed) * price) / Math.abs(after);
  else if (Math.sign(after) !== Math.sign(before)) position.avgPrice = price;
  if (before === 0 || Math.sign(after) !== Math.sign(before)) position.openedAt = time;
  position.quantity = Math.abs(after) < EPSILON ? 0 : after;
  position.realizedPnl += realized;
  const net = realized - fee;
  const fill: Fill = {
    priceBasis,
    source:executionSource,
    id: nextId(account, "fill"),
    orderId: order.id,
    symbol: order.symbol,
    side: order.side,
    quantity: order.quantity,
    price,
    fee,
    time,
    realizedPnl: net,
    position: position.quantity,
  };
  account.fills.push(fill);
  if (account.fills.length > 5000) account.fills.splice(0, account.fills.length - 5000);
  const stored = account.orders.find((o) => o.id === order.id);
  if (stored) {
    stored.status = "filled";
    stored.filledAt = time;
    stored.fillPrice = price;
    stored.fillSource=executionSource;
  }
  const reversed = before !== 0 && position.quantity !== 0 && Math.sign(position.quantity) !== Math.sign(before);
  if (position.quantity === 0 || reversed) {
    if (position.quantity === 0) account.positions = account.positions.filter((p) => p !== position);
    // A flat or reversed position leaves no matching exposure for prior protective orders.
    for (const other of account.orders)
      if (other.status === "working" && other.symbol === order.symbol && other.reduceOnly)
        other.status = "canceled";
  }
  cancelLinked(account, order);
  if (stored && (order.takeProfit || order.stopLoss||order.exitLevels?.length)) bracket(account, order, time,executionSource);
  return [fill];
}

function bracket(account: Account, order: Order, time: number,executionSource?:PaperExecutionSource) {
  const position = positionOf(account, order.symbol);
  if (!position || Math.sign(position.quantity) !== (order.side === "buy" ? 1 : -1)) return;
  const availableTotal = Math.min(order.quantity, Math.abs(position.quantity));
  if (availableTotal < 1e-12) return;
  if(order.exitLevels?.length){
    let available=availableTotal;
    order.exitLevels.forEach((level,index)=>{
      const quantity=Math.min(level.quantity,available);if(quantity<1e-12)return;available-=quantity;
      const base={symbol:order.symbol,side:order.side==="buy"?"sell" as const:"buy" as const,quantity,reduceOnly:true,status:"working" as const,createdAt:time,createdSource:executionSource,oco:`oco-${order.id}-level-${index}`};
      if(level.takeProfit!==null)account.orders.push({...base,id:nextId(account,"ord"),type:"limit",price:level.takeProfit,note:`Take profit for ${order.id}`});
      if(level.stopLoss!==null)account.orders.push({...base,id:nextId(account,"ord"),type:"stop",stopPrice:level.stopLoss,note:`Stop loss for ${order.id}`});
    });return;
  }
  const exit: Side = order.side === "buy" ? "sell" : "buy";
  const group = `oco-${order.id}`;
  const base = { symbol: order.symbol, side: exit, quantity: availableTotal, reduceOnly: true, status: "working" as const, createdAt: time,createdSource:executionSource, oco: group };
  if (order.takeProfit)
    account.orders.push({
      ...base,
      id: nextId(account, "ord"),
      type: "limit",
      price: order.takeProfit,
      note: `Take profit for ${order.id}`,
    });
  if (order.stopLoss)
    account.orders.push({
      ...base,
      id: nextId(account, "ord"),
      type: "stop",
      stopPrice: order.stopLoss,
      note: `Stop loss for ${order.id}`,
    });
}

export interface ProcessResult {
  account: Account;
  fills: Fill[];
}

/** Does the price path from `previous` to `price` reach a level? */
function crossed(level: number, price: number, side: Side, kind: "limit" | "stop"): boolean {
  // buy limit / sell stop trade at or below; sell limit / buy stop at or above.
  const wantsLower = (side === "buy" && kind === "limit") || (side === "sell" && kind === "stop");
  return wantsLower ? price <= level : price >= level;
}

const orderRank = (o: Order) => (o.type === "stop" ? 0 : o.type === "stop_limit" ? 1 : 2);

/** Match working orders for `symbol` against a single price. */
export function processPrice(
  source: Account,
  symbol: string,
  price: number,
  time: number,
  mutateSource = false,
  /** Marketable limits at placement fill at the better market price. */
  improve = false,
  /** Live samples received before an order was accepted cannot fill it later in a queue. */
  eligibleThrough?:number,
  executionSource?:PaperExecutionSource,
  quote?:ExecutableQuote,
  onlyOrderId?:string,
): ProcessResult {
  const account = mutateSource ? source : structuredClone(source);
  const fills: Fill[] = [];
  const book=validExecutionQuote(quote,time)&&((executionSource==="market"&&!quote.simulated)||(executionSource==="simulation"&&quote.simulated))?quote:undefined;
  // Protective stops are matched before profit targets that share a price.
  const ordered = [...account.orders].sort((a, b) => orderRank(a) - orderRank(b));
  for (const order of ordered) {
    if(onlyOrderId&&order.id!==onlyOrderId)continue;
    if (order.symbol !== symbol || order.status !== "working") continue;
    if(eligibleThrough!==undefined&&Math.max(order.createdAt,order.modifiedAt??order.createdAt)>eligibleThrough)continue;
    if (!account.orders.some((o) => o.id === order.id && o.status === "working")) continue;
    const executable=book?(order.side==="buy"?book.ask:book.bid):price;
    const basis:FillPriceBasis=book?(order.side==="buy"?"ask":"bid"):"last";
    // A resting limit order is filled at its own price even when the market
    // gaps through it; only a marketable limit gets the better market price.
    const limitFill = (limit: number) =>
      !improve ? limit : order.side === "buy" ? Math.min(limit, executable) : Math.max(limit, executable);
    if (order.type === "limit") {
      if (crossed(order.price!, executable, order.side, "limit"))
        fills.push(...fillOrder(account, order, limitFill(order.price!), time, false,executionSource,improve?basis:"limit"));
    } else if (order.type === "stop") {
      if (crossed(order.stopPrice!, price, order.side, "stop"))
        fills.push(...fillOrder(account, order, executable, time, true,executionSource,basis));
    } else if (order.type === "stop_limit") {
      if (!order.triggered && crossed(order.stopPrice!, price, order.side, "stop")){order.triggered=true;order.revision=(order.revision??0)+1;}
      if (order.triggered && crossed(order.price!, executable, order.side, "limit"))
        fills.push(...fillOrder(account, order, limitFill(order.price!), time, false,executionSource,improve?basis:"limit"));
    }
  }
  return { account, fills };
}

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function triggerLevels(account: Account, symbol: string): number[] {
  const levels: number[] = [];
  for (const o of account.orders) {
    if (o.symbol !== symbol || o.status !== "working") continue;
    if (o.type === "limit") levels.push(o.price!);
    else if (o.type === "stop") levels.push(o.stopPrice!);
    else levels.push(o.triggered ? o.price! : o.stopPrice!);
  }
  return levels;
}

/**
 * Match working orders against one bar, walking the conventional intrabar
 * path (open→high→low→close for up bars, open→low→high→close otherwise) and
 * visiting each order's price in the order the path meets it. Orders created
 * along the way (bracket exits) are matched later in the same bar, and a
 * filled order cancels its OCO partner, so which of a target and a stop is
 * reached first on that path decides the outcome.
 */
export function processBar(source: Account, symbol: string, bar: Bar,executionSource?:PaperExecutionSource): ProcessResult {
  const account = structuredClone(source);
  const fills: Fill[] = [];
  const path =
    bar.close >= bar.open
      ? [bar.open, bar.high, bar.low, bar.close]
      : [bar.open, bar.low, bar.high, bar.close];
  const visit = (price: number) => fills.push(...processPrice(account, symbol, price, bar.time, true,false,undefined,executionSource).fills);
  visit(path[0]);
  for (let i = 1; i < path.length; i++) {
    const to = path[i];
    let cursor = path[i - 1];
    const direction = Math.sign(to - cursor);
    for (let guard = 0; guard < 200 && direction !== 0; guard++) {
      const ahead = triggerLevels(account, symbol).filter((l) =>
        direction > 0 ? l > cursor && l <= to : l < cursor && l >= to,
      );
      if (!ahead.length) break;
      cursor = direction > 0 ? Math.min(...ahead) : Math.max(...ahead);
      visit(cursor);
    }
    visit(to);
  }
  return { account, fills };
}
/** Record equity at `time` (one point per minute at most). */
export function markToMarket(source: Account, prices: Prices, time: number): Account {
  const equity = equityOf(source, prices);
  const last = source.equity.at(-1);
  if (last && time - last.time < 60_000 && Math.abs(last.equity - equity) < 1e-9) return source;
  const account = structuredClone(source);
  if (last && time - last.time < 60_000) account.equity[account.equity.length - 1] = { time: last.time, equity };
  else account.equity.push({ time, equity });
  if (account.equity.length > 5000) account.equity.splice(0, account.equity.length - 5000);
  return account;
}

export interface AccountStats {
  equity: number;
  cash: number;
  unrealized: number;
  realized: number;
  fees: number;
  margin: number;
  buyingPower: number;
  returnPercent: number;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
}

export function isClosingFill(fill: Fill): boolean {
  const signed = fill.side === "buy" ? fill.quantity : -fill.quantity;
  const before = fill.position - signed;
  return Math.abs(before) >= EPSILON && Math.sign(before) !== Math.sign(signed);
}

export function accountStats(account: Account, prices: Prices): AccountStats {
  const equity = equityOf(account, prices);
  const unrealized = account.positions.reduce((s, p) => s + unrealizedPnl(p, prices[p.symbol] ?? p.avgPrice), 0);
  const closing = account.fills.filter(isClosingFill);
  const wins = closing.filter((f) => f.realizedPnl > 0);
  const gross = wins.reduce((s, f) => s + f.realizedPnl, 0);
  const loss = closing.filter((f) => f.realizedPnl < 0).reduce((s, f) => s - f.realizedPnl, 0);
  let peak = account.initialBalance;
  let drawdown = 0;
  for (const point of account.equity) {
    peak = Math.max(peak, point.equity);
    drawdown = Math.max(drawdown, peak ? (peak - point.equity) / peak : 0);
  }
  return {
    equity,
    cash: account.cash,
    unrealized,
    realized: account.fills.reduce((s, f) => s + f.realizedPnl, 0),
    fees: account.fills.reduce((s, f) => s + f.fee, 0),
    margin: marginUsed(account, prices),
    buyingPower: buyingPower(account, prices),
    returnPercent: account.initialBalance ? ((equity - account.initialBalance) / account.initialBalance) * 100 : 0,
    trades: closing.length,
    winRate: closing.length ? (wins.length / closing.length) * 100 : null,
    profitFactor: loss > 0 ? gross / loss : gross > 0 ? Infinity : null,
    maxDrawdown: drawdown * 100,
  };
}
