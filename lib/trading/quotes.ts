import type {OrderBook} from "@/types/trading";
import type {Account,Prices} from "./broker";
export interface ExecutableQuote {bid:number;ask:number;time:number;simulated:boolean}
export const PAPER_BOOK_MAX_AGE=10_000;
/** Reject crossed, empty, stale, future or differently sourced books. Never manufacture a spread. */
export function executableQuote(book:OrderBook|undefined|null,symbol:string,simulated:boolean|undefined,now=Date.now()):ExecutableQuote|undefined {
  if(!book||book.symbol!==symbol||simulated===undefined||book.simulated!==simulated||!Number.isFinite(book.time)||book.time>now||now-book.time>PAPER_BOOK_MAX_AGE)return;
  const bids=book.bids.filter(level=>Number.isFinite(level.price)&&level.price>0&&Number.isFinite(level.quantity)&&level.quantity>0),asks=book.asks.filter(level=>Number.isFinite(level.price)&&level.price>0&&Number.isFinite(level.quantity)&&level.quantity>0);
  if(!bids.length||!asks.length)return;
  const bid=Math.max(...bids.map(level=>level.price)),ask=Math.min(...asks.map(level=>level.price));
  return bid<=ask?{bid,ask,time:book.time,simulated:book.simulated}:undefined;
}
export function validExecutionQuote(quote:ExecutableQuote|undefined,time:number):quote is ExecutableQuote {
  return Boolean(quote&&Number.isFinite(quote.bid)&&quote.bid>0&&Number.isFinite(quote.ask)&&quote.ask>=quote.bid&&Number.isFinite(quote.time)&&quote.time<=time&&time-quote.time<=PAPER_BOOK_MAX_AGE);
}
/** Liquidation marks: sell a long at bid, buy back a short at ask. */
export function liquidationPrices(account:Account,prices:Prices,books:Record<string,OrderBook|undefined>,sources:Record<string,string|undefined>,now=Date.now()):Prices {
  const marks={...prices};
  for(const position of account.positions){const source=sources[position.symbol],quote=executableQuote(books[position.symbol],position.symbol,source===undefined?undefined:source==="simulation",now);if(quote)marks[position.symbol]=position.quantity>0?quote.bid:quote.ask;}
  return marks;
}
