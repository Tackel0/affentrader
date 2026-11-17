import { describe,expect,it } from "vitest";
import { assertDomOrderReview,domOrderDraft,workingDomOrders,type DomOrderContext,type DomOrderReview } from "@/lib/trading/domOrder";
import type { Order } from "@/lib/trading/broker";
const context:DomOrderContext={symbol:"BTCUSDT",timeframe:"1m",feedMode:"auto",feedEpoch:0,marketEpoch:0,source:"exchange",replay:false,paperMode:"live",paperEpoch:0,quantity:2,cellId:"one"};
describe("DOM click-order drafts and review",()=>{
  it("indexes working orders by rounded price and moves a triggered stop-limit to its limit row", () => {
    const order = (id: string, patch: Partial<Order> = {}): Order => ({ id, symbol: "BTCUSDT", side: "buy", type: "limit",
      price: 100.8, quantity: 1, createdAt: 1, reduceOnly: false, status: "working", ...patch });
    const stopLimit = order("stop", { side: "sell", type: "stop_limit", price: 102.1, stopPrice: 101.2 });
    const orders = [order("limit"), stopLimit, order("other", { symbol: "ETHUSDT" }), order("closed", { status: "filled" }), order("bad", { price: NaN })];
    expect([...workingDomOrders(orders, "BTCUSDT", 1).byPrice]).toEqual([[100, [orders[0]]], [102, [stopLimit]]]);
    const triggered = { ...stopLimit, triggered: true };
    expect(workingDomOrders([triggered], "BTCUSDT", 1).byPrice.get(103)).toEqual([triggered]);
  });
  it("chooses the explicit clicked price as limit or stop using side and reference",()=>{
    for(const [side,price,type] of [["buy",90,"limit"],["buy",110,"stop"],["sell",90,"stop"],["sell",110,"limit"],["buy",100,"limit"],["sell",100,"limit"]] as const){
      const order=domOrderDraft("BTCUSDT",side,2,price,100);
      expect(order).toEqual({symbol:"BTCUSDT",side,quantity:2,type,...(type==="stop"?{stopPrice:price}:{price})});
    }
    expect(domOrderDraft("BTCUSDT","buy",2)).toEqual({symbol:"BTCUSDT",side:"buy",quantity:2,type:"market"});
  });
  it("rejects invalid quantity or missing/faulty reference rather than guessing a limit",()=>{
    for(const quantity of [0,-1,NaN,Infinity])expect(()=>domOrderDraft("BTCUSDT","buy",quantity,90,100)).toThrow();
    for(const reference of [undefined,NaN,0,-1,Infinity])expect(()=>domOrderDraft("BTCUSDT","buy",1,90,reference)).toThrow();
  });
  it("invalidates a review on any chart/account/source/ticket identity change",()=>{
    const review:DomOrderReview={order:domOrderDraft("BTCUSDT","buy",2,90,100),context,ladder:true};
    expect(()=>assertDomOrderReview(review,{...context})).not.toThrow();
    for(const patch of [{symbol:"ETHUSDT"},{timeframe:"5m"},{feedEpoch:1},{marketEpoch:1},{source:"simulation"},{replay:true},{paperMode:"replay"},{paperEpoch:1},{quantity:3},{cellId:"two"}])
      expect(()=>assertDomOrderReview(review,{...context,...patch})).toThrow();
    expect(()=>assertDomOrderReview({...review,order:{...review.order,quantity:9}},context)).toThrow();
  });
  it("excludes Replay/simulation even when the frozen and current contexts agree",()=>{
    for(const patch of [{replay:true},{paperMode:"replay"},{feedMode:"simulation"},{source:"yahoo"}]){
      const next={...context,...patch};
      expect(()=>assertDomOrderReview({order:domOrderDraft("BTCUSDT","buy",2),context:next,ladder:false},next)).toThrow(/live exchange/);
    }
  });
});
