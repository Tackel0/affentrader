import {describe,it,expect} from "vitest";
import {createAccount,placeOrder,processPrice,closePosition,type NewOrder} from "@/lib/trading/broker";
import {processReplayUpdate} from "@/lib/trading/replay";
import {paperSampleSource,paperSourceLabel,type PaperExecutionSource} from "@/lib/trading/executionSource";
import {validPaperAccount} from "@/lib/trading/paperPersistence";
const base=()=>createAccount({feeRate:0,slippageBps:0});
const order=(patch:Partial<NewOrder>={}):NewOrder=>({symbol:"BTCUSDT",side:"buy",type:"market",quantity:1,...patch});
describe("paper execution price provenance",()=>{
  it.each(["market","simulation","replay","replay_simulation"] as PaperExecutionSource[])("persists %s for immediate fills without changing account arithmetic",source=>{
    const result=placeOrder(base(),order(),{BTCUSDT:100},1,source),saved=JSON.parse(JSON.stringify(result.account));expect(saved.orders[0]).toMatchObject({createdSource:source,fillSource:source});expect(saved.fills[0].source).toBe(source);expect(saved.cash).toBe(99900);expect(validPaperAccount(saved)).toBe(true);
  });
  it("keeps acceptance and execution sources distinct through a bracket and source transition",()=>{
    const placed=placeOrder(base(),order({type:"limit",price:90,takeProfit:110,stopLoss:80}),{BTCUSDT:100},1,"market");
    const filled=processPrice(placed.account,"BTCUSDT",85,2,false,false,undefined,"simulation");expect(filled.account.orders[0]).toMatchObject({createdSource:"market",fillSource:"simulation"});expect(filled.fills[0].source).toBe("simulation");expect(filled.account.orders.filter(o=>o.status==="working").every(o=>o.createdSource==="simulation")).toBe(true);
    const exited=processPrice(filled.account,"BTCUSDT",115,3,false,false,undefined,"market");expect(exited.fills[0].source).toBe("market");expect(exited.account.positions).toHaveLength(0);expect(exited.account.orders.find(o=>o.status==="canceled")!.fillSource).toBeUndefined();
  });
  it.each([order({type:"limit",price:101}),order({type:"stop",stopPrice:99}),order({type:"stop_limit",stopPrice:99,price:101})])("tags marketable limit/stop/stop-limit paths",input=>{
    const result=placeOrder(base(),input,{BTCUSDT:100},1,"simulation");expect(result.order.status).toBe("filled");expect(result.order.fillSource).toBe("simulation");expect(result.fills[0].source).toBe("simulation");
  });
  it("uses the filling sample rather than the earlier stop-limit trigger's source",()=>{
    const placed=placeOrder(base(),order({type:"stop_limit",stopPrice:105,price:103}),{BTCUSDT:100},1,"market"),triggered=processPrice(placed.account,"BTCUSDT",106,2,false,false,undefined,"market");expect(triggered.fills).toHaveLength(0);expect(triggered.account.orders[0].triggered).toBe(true);
    const result=processPrice(triggered.account,"BTCUSDT",102,3,false,false,undefined,"simulation");expect(result.fills[0].source).toBe("simulation");expect(result.account.orders[0]).toMatchObject({createdSource:"market",fillSource:"simulation"});
  });
  it("tags Replay bar updates and explicit closes with their own observed context",()=>{
    const placed=placeOrder(base(),order({type:"limit",price:90}),{BTCUSDT:100},1,"replay"),replayed=processReplayUpdate(placed.account,"BTCUSDT",undefined,{time:2,open:100,high:110,low:85,close:100});expect(replayed.fills[0].source).toBe("replay");const closed=closePosition(replayed.account,"BTCUSDT",{BTCUSDT:101},3,"replay")!;expect(closed.fills[0].source).toBe("replay");
  });
  it("does not invent a source for old fills or infer an unknown fill from its acceptance source",()=>{
    const old=JSON.parse(JSON.stringify(placeOrder(base(),order(),{BTCUSDT:100},1).account));expect(paperSourceLabel(old.fills[0].source)).toBe("Not recorded");expect(validPaperAccount(old)).toBe(true);
    const pending=placeOrder(base(),order({type:"limit",price:90}),{BTCUSDT:100},2,"market"),filled=processPrice(pending.account,"BTCUSDT",85,3);expect(filled.account.orders[0].createdSource).toBe("market");expect(filled.account.orders[0].fillSource).toBeUndefined();expect(paperSourceLabel(filled.fills[0].source)).toBe("Not recorded");expect(old.fills[0].source).toBeUndefined();
  });
  it("rejects unsupported provenance without relabeling it as market data",()=>{
    const saved=JSON.parse(JSON.stringify(placeOrder(base(),order(),{BTCUSDT:100},1,"market").account));saved.fills[0].source="real_broker";expect(validPaperAccount(saved)).toBe(false);expect(paperSampleSource()).toBeUndefined();expect(paperSampleSource(false)).toBe("market");expect(paperSampleSource(true)).toBe("simulation");
  });
});
