import {describe,it,expect} from "vitest";
import {createAccount,placeOrder,reversePosition,positionOf,accountStats,type Account} from "@/lib/trading/broker";
import {validPaperAccount} from "@/lib/trading/paperPersistence";
const symbol="BTCUSDT",prices={[symbol]:100},base=()=>createAccount({feeRate:0,slippageBps:0});
const open=(side:"buy"|"sell"="buy",patch:Partial<Account>={})=>placeOrder(createAccount({...base(),...patch}),{symbol,side,type:"market",quantity:2,takeProfit:side==="buy"?120:80,stopLoss:side==="buy"?80:120},prices,1,"market").account;
describe("atomic paper position reversal",()=>{
  it.each(["buy","sell"] as const)("reverses a %s position with one double-size opposite fill",side=>{
    const before=open(side),unchanged=structuredClone(before),result=reversePosition(before,symbol,{[symbol]:110},2,"market")!;
    expect(before).toEqual(unchanged);expect(result.fills).toHaveLength(1);expect(result.fills[0]).toMatchObject({quantity:4,side:side==="buy"?"sell":"buy",price:110,source:"market"});expect(positionOf(result.account,symbol)).toMatchObject({quantity:side==="buy"?-2:2,avgPrice:110,openedAt:2});expect(result.fills[0].realizedPnl).toBe(side==="buy"?20:-20);expect(result.account.orders.filter(o=>o.reduceOnly&&o.status==="working")).toHaveLength(0);expect(validPaperAccount(JSON.parse(JSON.stringify(result.account)))).toBe(true);
  });
  it("uses bid/ask for reversal and charges fees/slippage on the full double quantity",()=>{
    const before=open("buy",{feeRate:.01,slippageBps:0}),result=reversePosition({...before,slippageBps:10},symbol,prices,1000,"market",{bid:99,ask:101,time:1000,simulated:false})!;
    expect(result.fills[0]).toMatchObject({side:"sell",quantity:4,priceBasis:"bid"});expect(result.fills[0].price).toBeCloseTo(98.901);expect(result.fills[0].fee).toBeCloseTo(3.95604);expect(result.fills[0].realizedPnl).toBeCloseTo(-6.15404);expect(positionOf(result.account,symbol)?.avgPrice).toBeCloseTo(98.901);
  });
  it("rejects insufficient post-reversal buying power without closing or removing protection",()=>{
    const before=open("buy",{initialBalance:202,cash:202}),result=reversePosition(before,symbol,prices,1000,"market",{bid:99,ask:101,time:1000,simulated:false})!;
    expect(result.order.status).toBe("rejected");expect(result.order.reason).toMatch(/buying power/);expect(result.fills).toEqual([]);expect(result.account.positions).toEqual(before.positions);expect(result.account.fills).toEqual(before.fills);expect(result.account.cash).toBe(before.cash);expect(result.account.orders.slice(0,-1)).toEqual(before.orders);expect(result.order.fillPrice).toBeUndefined();expect(result.order.fillSource).toBeUndefined();expect(validPaperAccount(result.account)).toBe(true);
  });
  it("preserves protection and equity on missing execution prices",()=>{
    const before=open(),result=reversePosition(before,symbol,{},2,"market")!;expect(result.order.status).toBe("rejected");expect(result.account.positions).toEqual(before.positions);expect(result.account.cash).toBe(before.cash);expect(result.account.orders.filter(o=>o.status==="working")).toEqual(before.orders.filter(o=>o.status==="working"));
  });
  it("retains unrelated entry orders and another symbol's protection",()=>{
    let before=open();before=placeOrder(before,{symbol,side:"buy",type:"limit",price:50,quantity:1},prices,2).account;before=placeOrder(before,{symbol:"ETHUSDT",side:"buy",type:"market",quantity:1,stopLoss:50},{...prices,ETHUSDT:100},3).account;const result=reversePosition(before,symbol,{...prices,ETHUSDT:100},4)!;
    expect(result.account.orders.find(o=>o.symbol===symbol&&o.price===50)?.status).toBe("working");expect(result.account.orders.find(o=>o.symbol==="ETHUSDT"&&o.reduceOnly)?.status).toBe("working");expect(positionOf(result.account,"ETHUSDT")).toEqual(positionOf(before,"ETHUSDT"));
  });
  it("considers other open markets when testing the new margin",()=>{
    let before=open("buy",{initialBalance:305,cash:305});before=placeOrder(before,{symbol:"ETHUSDT",side:"sell",type:"market",quantity:1},{...prices,ETHUSDT:100},2).account;const result=reversePosition(before,symbol,{...prices,ETHUSDT:200},3)!;expect(result.order.status).toBe("rejected");expect(result.account.positions).toEqual(before.positions);
  });
  it("preserves the account for a flat symbol and rejects undersized legacy exposure",()=>{
    const source=base();expect(reversePosition(source,symbol,prices,1)).toBeNull();source.positions=[{symbol,quantity:1e-14,avgPrice:100,openedAt:1,realizedPnl:0}];const result=reversePosition(source,symbol,prices,2)!;expect(result.order.status).toBe("rejected");expect(result.account.positions).toEqual(source.positions);
  });
  it("counts both closing realization and the new opposite exposure in account statistics",()=>{
    const before=open(),result=reversePosition(before,symbol,{[symbol]:110},2)!;expect(accountStats(result.account,{[symbol]:105}).unrealized).toBe(10);expect(accountStats(result.account,{[symbol]:105}).realized).toBe(20);expect(result.order.note).toBe("Reverse position");
  });
});
