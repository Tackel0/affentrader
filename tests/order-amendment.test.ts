import {describe,it,expect} from "vitest";
import {createAccount,placeOrder,amendOrder,processPrice,positionOf,type OrderPatch} from "@/lib/trading/broker";
import {validPaperAccount} from "@/lib/trading/paperPersistence";
const symbol="BTCUSDT",prices={[symbol]:100},base=()=>createAccount({feeRate:0,slippageBps:0});
const pending=()=>placeOrder(base(),{symbol,side:"buy",type:"limit",quantity:1,price:90,takeProfit:120,stopLoss:80},prices,10,"market");
describe("working order amendments",()=>{
  it("retains the original order when a marketable stop's actual gap fill exceeds capital",()=>{
    const source=placeOrder(createAccount({initialBalance:150,feeRate:0,slippageBps:0}),{symbol,side:"buy",type:"stop",quantity:1,stopPrice:110},prices,10),result=amendOrder(source.account,source.order.id,{stopPrice:105},0,{[symbol]:200},20);expect(result.ok).toBe(false);expect(result.error).toMatch(/executable price/);expect(result.account).toBe(source.account);expect(result.order?.stopPrice).toBe(110);expect(result.fills).toHaveLength(0);
  });
  it("keeps identity, acceptance and protection while changing quantity/price",()=>{
    const source=pending(),result=amendOrder(source.account,source.order.id,{quantity:2,price:95},0,prices,20,"simulation");expect(result.ok).toBe(true);expect(result.order).toMatchObject({id:source.order.id,createdAt:10,createdSource:"market",modifiedAt:20,modifiedSource:"simulation",revision:1,quantity:2,price:95,takeProfit:120,stopLoss:80});expect(result.account.seq).toBe(source.account.seq);expect(source.order.price).toBe(90);expect(validPaperAccount(JSON.parse(JSON.stringify(result.account)))).toBe(true);
  });
  it("supports removing pending brackets explicitly without normalizing blanks to zero",()=>{const source=pending(),result=amendOrder(source.account,source.order.id,{takeProfit:null,stopLoss:null},0,prices,20);expect(result.ok).toBe(true);expect(result.order?.takeProfit).toBeUndefined();expect(result.order?.stopLoss).toBeUndefined();});
  it.each([{quantity:0},{quantity:NaN},{price:null},{price:-1},{price:Infinity},{stopPrice:85},{takeProfit:85},{side:"sell"}] as OrderPatch[])("rejects invalid patch %# without changing the account",patch=>{const source=pending(),result=amendOrder(source.account,source.order.id,patch,0,prices,20);expect(result.ok).toBe(false);expect(result.account).toBe(source.account);expect(result.fills).toEqual([]);});
  it("rejects stale revisions, backwards clocks and completed orders",()=>{
    const source=pending(),edited=amendOrder(source.account,source.order.id,{price:95},0,prices,20);expect(amendOrder(edited.account,source.order.id,{price:94},0,prices,21).error).toMatch(/changed/);expect(amendOrder(edited.account,source.order.id,{price:94},1,prices,19).ok).toBe(false);const filled=processPrice(source.account,symbol,80,30);expect(amendOrder(filled.account,source.order.id,{price:94},0,prices,31).error).toMatch(/no longer working/);
  });
  it("does not match or version a no-op save",()=>{const source=pending(),result=amendOrder(source.account,source.order.id,{price:90},0,{[symbol]:80},20);expect(result.account).toBe(source.account);expect(result.fills).toHaveLength(0);});
  it("executes only the edited marketable order at fresh ask and retains its ID",()=>{
    const source=pending(),second=placeOrder(source.account,{symbol,side:"buy",type:"limit",quantity:1,price:91},prices,11);const result=amendOrder(second.account,source.order.id,{price:105},0,prices,20,"market",{bid:99,ask:101,time:20,simulated:false});expect(result.fills[0]).toMatchObject({orderId:source.order.id,price:101,priceBasis:"ask"});expect(result.account.orders.find(o=>o.id===second.order.id)?.status).toBe("working");
  });
  it("ignores queued observations received before an amendment",()=>{
    const source=pending(),edited=amendOrder(source.account,source.order.id,{price:95},0,prices,20);expect(processPrice(edited.account,symbol,90,19,false,false,19).fills).toHaveLength(0);expect(processPrice(edited.account,symbol,90,21,false,false,21).fills).toHaveLength(1);
  });
  it("keeps triggered stop-limits triggered and versions the transition",()=>{
    const source=placeOrder(base(),{symbol,side:"buy",type:"stop_limit",quantity:1,price:103,stopPrice:105},prices,10),triggered=processPrice(source.account,symbol,110,20);expect(triggered.account.orders[0]).toMatchObject({triggered:true,revision:1});expect(amendOrder(triggered.account,source.order.id,{price:104},0,{[symbol]:110},21).ok).toBe(false);expect(amendOrder(triggered.account,source.order.id,{stopPrice:108},1,{[symbol]:110},21).ok).toBe(false);const edited=amendOrder(triggered.account,source.order.id,{price:104},1,{[symbol]:110},21);expect(edited.order).toMatchObject({triggered:true,stopPrice:105,price:104,revision:2});
  });
  it("synchronizes OCO exit quantities and invalidates the sibling's old revision",()=>{
    const entry=placeOrder(base(),{symbol,side:"buy",type:"market",quantity:2,takeProfit:120,stopLoss:80},prices,10),[tp,sl]=entry.account.orders.filter(o=>o.reduceOnly);const result=amendOrder(entry.account,tp.id,{quantity:1,price:125},0,prices,20);expect(result.order).toMatchObject({quantity:1,price:125,revision:1});expect(result.account.orders.find(o=>o.id===sl.id)).toMatchObject({quantity:1,stopPrice:80,revision:1,modifiedAt:20});expect(amendOrder(result.account,sl.id,{stopPrice:85},0,prices,21).ok).toBe(false);
  });
  it("rejects oversized protective edits and cannot flip a subsequently reduced position",()=>{
    const entry=placeOrder(base(),{symbol,side:"buy",type:"market",quantity:2,takeProfit:120,stopLoss:80},prices,10),tp=entry.account.orders.find(o=>o.reduceOnly&&o.type==="limit")!;expect(amendOrder(entry.account,tp.id,{quantity:3},0,prices,20).ok).toBe(false);
    const reduced=placeOrder(entry.account,{symbol,side:"sell",type:"market",quantity:1,reduceOnly:true},prices,21),filled=processPrice(reduced.account,symbol,125,22);expect(filled.fills[0].quantity).toBe(1);expect(positionOf(filled.account,symbol)).toBeUndefined();
  });
  it("rejects edits beyond buying power and retains legacy metadata compatibility",()=>{
    const source=pending(),result=amendOrder(source.account,source.order.id,{quantity:100000},0,prices,20);expect(result.ok).toBe(false);expect(result.account).toBe(source.account);expect(validPaperAccount(source.account)).toBe(true);const corrupt=structuredClone(source.account);corrupt.orders[0].modifiedAt=9;expect(validPaperAccount(corrupt)).toBe(false);corrupt.orders[0].modifiedAt=20;corrupt.orders[0].revision=-1;expect(validPaperAccount(corrupt)).toBe(false);
  });
});
