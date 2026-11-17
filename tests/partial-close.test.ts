import {describe,it,expect} from "vitest";
import {createAccount,placeOrder,closePosition,positionOf,processPrice,type Account} from "@/lib/trading/broker";
const symbol="BTCUSDT",prices={[symbol]:100};
const open=(side:"buy"|"sell"="buy",patch:Partial<Account>={})=>placeOrder(createAccount({feeRate:0,slippageBps:0,...patch}),{symbol,side,type:"market",quantity:2,takeProfit:side==="buy"?120:80,stopLoss:side==="buy"?80:120},prices,1,"market").account;
describe("reviewed partial position close",()=>{
  it.each(["buy","sell"] as const)("reduces a %s position and retains its original entry",side=>{
    const before=open(side),copy=structuredClone(before),result=closePosition(before,symbol,{[symbol]:110},2,"market",undefined,.5)!;
    expect(before).toEqual(copy);expect(result.fills).toHaveLength(1);expect(result.fills[0]).toMatchObject({quantity:.5,side:side==="buy"?"sell":"buy",price:110,realizedPnl:side==="buy"?5:-5,source:"market"});expect(positionOf(result.account,symbol)).toMatchObject({quantity:side==="buy"?1.5:-1.5,avgPrice:100,openedAt:1});expect(result.account.orders.filter(o=>o.status==="working"&&o.reduceOnly).map(o=>o.quantity)).toEqual([1.5,1.5]);
  });
  it("uses liquidation bid plus slippage and charges the exit quantity only",()=>{
    const result=closePosition(open("buy",{feeRate:.001}),symbol,prices,1000,"market",{bid:99,ask:101,time:1000,simulated:false},.5)!;
    expect(result.fills[0]).toMatchObject({quantity:.5,price:99,priceBasis:"bid",fee:.0495});expect(result.fills[0].realizedPnl).toBeCloseTo(-.5495);
    const slipped=closePosition({...open(),slippageBps:10},symbol,prices,1000,"market",{bid:99,ask:101,time:1000,simulated:false},.5)!;expect(slipped.fills[0].price).toBeCloseTo(98.901);
  });
  it("preserves smaller protective quantities and unrelated entries/markets",()=>{
    let before=open();before.orders[1].quantity=.25;before=placeOrder(before,{symbol,side:"buy",type:"limit",quantity:1,price:50},prices,2).account;before=placeOrder(before,{symbol:"ETHUSDT",side:"buy",type:"limit",quantity:1,price:50},{...prices,ETHUSDT:100},2).account;
    const result=closePosition(before,symbol,prices,3,"market",undefined,.5)!;expect(result.account.orders[1].quantity).toBe(.25);expect(result.account.orders[1].revision).toBeUndefined();expect(result.account.orders[2]).toMatchObject({quantity:1.5,revision:1,modifiedAt:3,modifiedSource:"market"});expect(result.account.orders.slice(3,5).every(o=>o.status==="working")).toBe(true);
  });
  it("keeps resized protection executable and cancels its OCO sibling",()=>{
    const partial=closePosition(open(),symbol,prices,2,"market",undefined,.5)!,exit=processPrice(partial.account,symbol,130,3);
    expect(exit.fills[0].quantity).toBe(1.5);expect(exit.account.positions).toHaveLength(0);expect(exit.account.orders.filter(o=>o.status==="working")).toHaveLength(0);
  });
  it.each([0,-1,3,NaN,Infinity,1e-13,2-1e-13])("rejects invalid or unrepresentable close quantity %s without mutations",quantity=>{
    const before=open(),copy=structuredClone(before);expect(()=>closePosition(before,symbol,prices,2,"market",undefined,quantity)).toThrow(/quantity/);expect(before).toEqual(copy);
  });
  it("retains all working orders after a rejected quote and cancels them only after a full fill",()=>{
    let before=open();before=placeOrder(before,{symbol,side:"buy",type:"limit",quantity:1,price:50},prices,2).account;
    const rejected=closePosition(before,symbol,{},3,"market",undefined,.5)!;expect(rejected.order.status).toBe("rejected");expect(rejected.account.orders.filter(o=>o.status==="working")).toHaveLength(3);expect(rejected.account.positions).toEqual(before.positions);
    const full=closePosition(before,symbol,prices,3,"market")!;expect(full.account.positions).toHaveLength(0);expect(full.account.orders.filter(o=>o.status==="working")).toHaveLength(0);
  });
  it("returns null for flat positions and guards protective revision overflow",()=>{
    expect(closePosition(createAccount(),symbol,prices,2,"market",undefined,1)).toBeNull();const before=open();before.orders[1].revision=Number.MAX_SAFE_INTEGER;expect(()=>closePosition(before,symbol,prices,2,"market",undefined,.5)).toThrow(/modification limit/);expect(before.positions[0].quantity).toBe(2);
  });
});
