import {describe,it,expect} from "vitest";
import {orderLineLevels,placeOrderLines,draggedOrderPrice} from "@/lib/trading/orderLineGeometry";
import type {Order} from "@/lib/trading/broker";
const order=(patch:Partial<Order>={}):Order=>({id:"ord-1",symbol:"BTCUSDT",side:"buy",type:"limit",quantity:1,price:100,reduceOnly:false,status:"working",createdAt:1,...patch});
describe("interactive chart order geometry",()=>{
  it("selects working symbol orders and both phases of a stop-limit",()=>{
    const levels=orderLineLevels([order(),order({id:"s",type:"stop",stopPrice:110}),order({id:"sl",type:"stop_limit",stopPrice:110,price:112}),order({id:"done",status:"filled"}),order({id:"other",symbol:"ETHUSDT"})],"BTCUSDT");expect(levels.map(l=>l.id)).toEqual(["ord-1:price","s:stopPrice","sl:stopPrice","sl:price"]);expect(orderLineLevels([order({type:"stop_limit",triggered:true,stopPrice:110,price:112})],"BTCUSDT").map(l=>l.field)).toEqual(["price"]);
  });
  it("keeps TP/SL colors and rejects unusable levels",()=>{
    expect(orderLineLevels([order({note:"Take profit"}),order({note:"Stop loss",type:"stop",stopPrice:80})],"BTCUSDT").map(l=>l.color)).toEqual(["#089981","#f23645"]);expect(orderLineLevels([order({price:NaN}),order({price:0}),order({price:Infinity}),order({type:"market"})],"BTCUSDT")).toEqual([]);
  });
  it("packs overlapping labels inside a pane while retaining exact price coordinates",()=>{
    const levels=[100,101,102].map((price,i)=>orderLineLevels([order({id:String(i),price})],"BTCUSDT")[0]),rows=placeOrderLines(levels,p=>p,90,80);expect(rows.map(l=>l.y)).toEqual([101,102]);expect(rows.every(l=>l.labelY>=101&&l.labelY<=159)).toBe(true);expect(rows[1].labelY-rows[0].labelY).toBeGreaterThanOrEqual(22);
  });
  it("uses inverted/log projections and omits offscreen/over-capacity labels",()=>{
    const levels=[10,20,30,40].map((price,i)=>orderLineLevels([order({id:String(i),price})],"BTCUSDT")[0]);expect(placeOrderLines(levels,p=>100-p,0,100).map(l=>l.price)).toEqual([40,30,20]);expect(placeOrderLines(levels,p=>Math.log(p)*20,0,22)).toHaveLength(0);expect(placeOrderLines(levels,()=>50,0,44)).toHaveLength(0);expect(placeOrderLines(levels,()=>20,0,44)).toHaveLength(2);expect(placeOrderLines(levels,()=>NaN,0,100)).toEqual([]);
  });
  it("translates drag delta from the actual line rather than a displaced label",()=>{
    expect(draggedOrderPrice(100,10,y=>1000-y)).toBe(890);expect(draggedOrderPrice(50,-10,y=>Math.exp(y/10))).toBeCloseTo(Math.exp(4));expect(draggedOrderPrice(1,2,()=>-1)).toBeNull();expect(draggedOrderPrice(NaN,2,y=>y)).toBeNull();expect(draggedOrderPrice(1,2,()=>Infinity)).toBeNull();
  });
});
