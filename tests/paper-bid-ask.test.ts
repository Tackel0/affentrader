import {describe,it,expect} from "vitest";
import {createAccount,placeOrder,processPrice,closePosition,accountStats,type NewOrder} from "@/lib/trading/broker";
import {executableQuote,liquidationPrices,PAPER_BOOK_MAX_AGE,type ExecutableQuote} from "@/lib/trading/quotes";
import {validPaperAccount} from "@/lib/trading/paperPersistence";
import type {OrderBook} from "@/types/trading";
const now=100_000,symbol="BTCUSDT",prices={[symbol]:100};
const book=(patch:Partial<OrderBook>={}):OrderBook=>({symbol,time:now,simulated:false,bids:[{price:98,quantity:2},{price:99,quantity:1}],asks:[{price:102,quantity:1},{price:101,quantity:2}],...patch});
const quote=(patch:Partial<ExecutableQuote>={}):ExecutableQuote=>({bid:99,ask:101,time:now,simulated:false,...patch});
const order=(patch:Partial<NewOrder>={}):NewOrder=>({symbol,side:"buy",type:"market",quantity:1,...patch});
const account=()=>createAccount({feeRate:0,slippageBps:0});
describe("paper bid/ask execution",()=>{
  it("extracts the best nonempty levels without assuming sorted depth",()=>expect(executableQuote(book(),symbol,false,now)).toEqual(quote()));
  it.each([
    book({symbol:"ETHUSDT"}),book({time:now-PAPER_BOOK_MAX_AGE-1}),book({time:now+1}),book({simulated:true}),book({bids:[]}),book({asks:[]}),book({bids:[{price:103,quantity:1}]}),book({asks:[{price:101,quantity:0}]}),book({time:NaN}),
  ])("rejects invalid, mismatched or stale depth %#",value=>expect(executableQuote(value,symbol,false,now)).toBeUndefined());
  it("does not infer a matching feed when price provenance is unknown",()=>expect(executableQuote(book(),symbol,undefined,now)).toBeUndefined());
  it("buys at ask, sells at bid and realizes the spread on a round trip",()=>{
    const bought=placeOrder(account(),order(),prices,now,"market",quote());expect(bought.fills[0]).toMatchObject({price:101,priceBasis:"ask",source:"market"});
    const sold=closePosition(bought.account,symbol,prices,now+1,"market",quote())!;expect(sold.fills[0]).toMatchObject({price:99,priceBasis:"bid",realizedPnl:-2});expect(sold.account.cash).toBe(99998);expect(sold.account.positions).toHaveLength(0);expect(validPaperAccount(JSON.parse(JSON.stringify(sold.account)))).toBe(true);
  });
  it("covers short entry/close with opposite sides of the same book",()=>{
    const sold=placeOrder(account(),order({side:"sell"}),prices,now,"market",quote()),bought=closePosition(sold.account,symbol,prices,now+1,"market",quote())!;expect(sold.fills[0].price).toBe(99);expect(bought.fills[0]).toMatchObject({price:101,priceBasis:"ask",realizedPnl:-2});
  });
  it("applies configured adverse slippage after selecting the executable side",()=>{
    const result=placeOrder(createAccount({feeRate:0,slippageBps:10}),order(),prices,now,"market",quote());expect(result.fills[0].price).toBeCloseTo(101.101);expect(result.fills[0].priceBasis).toBe("ask");
  });
  it("does not fill a buy limit just because last traded inside the spread",()=>{
    const placed=placeOrder(account(),order({type:"limit",price:100}),prices,now,"market",quote());expect(placed.fills).toHaveLength(0);
    const waiting=processPrice(placed.account,symbol,99.5,now+1,false,false,undefined,"market",quote());expect(waiting.fills).toHaveLength(0);
    const filled=processPrice(waiting.account,symbol,99.5,now+2,false,false,undefined,"market",quote({ask:100}));expect(filled.fills[0]).toMatchObject({price:100,priceBasis:"limit"});
  });
  it("uses bid for sell limits and better ask for immediately marketable buys",()=>{
    const pending=placeOrder(account(),order({side:"sell",type:"limit",price:100}),prices,now,"market",quote());expect(pending.fills).toHaveLength(0);
    const buy=placeOrder(account(),order({type:"limit",price:105}),prices,now,"market",quote());expect(buy.fills[0]).toMatchObject({price:101,priceBasis:"ask"});
  });
  it("triggers stops from last and executes against the opposite book side",()=>{
    const pending=placeOrder(account(),order({type:"stop",stopPrice:102}),prices,now,"market",quote({ask:103}));expect(pending.fills).toHaveLength(0);
    const filled=processPrice(pending.account,symbol,102,now+1,false,false,undefined,"market",quote({ask:104}));expect(filled.fills[0]).toMatchObject({price:104,priceBasis:"ask"});
  });
  it("keeps stop-limit triggered while the ask remains above its limit",()=>{
    const placed=placeOrder(account(),order({type:"stop_limit",stopPrice:102,price:102}),prices,now,"market",quote());const pending=processPrice(placed.account,symbol,103,now+1,false,false,undefined,"market",quote({ask:104}));expect(pending.account.orders[0].triggered).toBe(true);expect(pending.fills).toHaveLength(0);
    expect(processPrice(pending.account,symbol,103,now+2,false,false,undefined,"market",quote({ask:102})).fills[0]).toMatchObject({price:102,priceBasis:"limit"});
  });
  it("falls back honestly for unavailable, expired or future books",()=>{
    for(const value of [undefined,quote({time:now-PAPER_BOOK_MAX_AGE-1}),quote({time:now+1})])expect(placeOrder(account(),order(),prices,now,"market",value).fills[0]).toMatchObject({price:100,priceBasis:"last"});
  });
  it("cannot mix public depth into simulation or historical Replay fills",()=>{
    for(const source of ["simulation","replay","replay_simulation"] as const)expect(placeOrder(account(),order(),prices,now,source,quote()).fills[0]).toMatchObject({price:100,priceBasis:"last"});
    expect(placeOrder(account(),order(),prices,now,"market",quote({simulated:true})).fills[0].priceBasis).toBe("last");
    expect(placeOrder(account(),order(),prices,now,"simulation",quote({simulated:true})).fills[0]).toMatchObject({price:101,priceBasis:"ask"});
  });
  it("marks longs at bid and shorts at ask without changing last prices",()=>{
    const long=placeOrder(account(),order(),prices,now,"market",quote()).account,short=placeOrder(account(),order({side:"sell"}),prices,now,"market",quote()).account;
    for(const a of [long,short]){const marks=liquidationPrices(a,prices,{[symbol]:book()},{[symbol]:"market"},now);expect(accountStats(a,marks).unrealized).toBe(-2);expect(accountStats(a,marks).equity).toBe(99998);}expect(prices[symbol]).toBe(100);
    expect(liquidationPrices(long,prices,{[symbol]:book()},{[symbol]:"market"},now+PAPER_BOOK_MAX_AGE+1)).toEqual(prices);
  });
  it("retains unknown legacy fill bases and rejects invented bases",()=>{
    const saved=placeOrder(account(),order(),prices,now).account;delete saved.fills[0].priceBasis;expect(validPaperAccount(saved)).toBe(true);(saved.fills[0] as unknown as {priceBasis:string}).priceBasis="midpoint";expect(validPaperAccount(saved)).toBe(false);
  });
});
