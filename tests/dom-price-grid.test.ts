import { afterEach, describe, expect, it, vi } from "vitest";
import { domGridChoice, validateDomGrid, watchDomGrid, type DomGridState } from "@/lib/orderflow/domPriceGrid";
import type { PriceGridMetadata } from "@/lib/market/priceGridMetadata";
const metadata=(patch:Partial<PriceGridMetadata>={}):PriceGridMetadata=>({symbol:"KRK:BTC/USD",source:"Kraken AssetPairs tick_size",tickSize:.1,checkedAt:Date.now(),...patch});
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
afterEach(()=>vi.useRealTimers());
describe("DOM venue grid lifecycle",()=>{
  it("prefers matching venue metadata over sparse observed spacing and recomputes Hyperliquid's price-dependent tick",()=>{
    expect(domGridChoice("KRK:BTC/USD",{metadata:metadata(),pending:false,error:""},76000,10)).toMatchObject({tick:.1,verified:true});
    const hl=metadata({symbol:"HL:BTC",tickSize:undefined,sizeDecimals:3});
    const high=domGridChoice("HL:BTC",{metadata:hl,pending:false,error:""},76000,10);
    const low=domGridChoice("HL:BTC",{metadata:hl,pending:false,error:""},.012345,10);
    expect(high.verified).toBe(true);expect(high.tick).toBe(1);expect(low.verified).toBe(true);expect(low.tick).toBe(.001);
    expect(domGridChoice("KRK:ETH/USD",{metadata:metadata(),pending:false,error:""},3000,2)).toMatchObject({tick:2,verified:false});
  });
  it("rejects mismatched, malformed, disabled and future metadata",()=>{
    for(const patch of [{symbol:"BTCUSDT"},{source:""},{tickSize:0},{tickSize:NaN},{sizeDecimals:7},{checkedAt:Date.now()+2000}])
      expect(()=>validateDomGrid("KRK:BTC/USD",metadata(patch))).toThrow();
  });
  it("fences a delayed response after stop and skips requests cancelled before their microtask",async()=>{
    let resolve!:(value:PriceGridMetadata)=>void;
    const load=vi.fn(()=>new Promise<PriceGridMetadata>(r=>{resolve=r})),changed=vi.fn();
    const stop=watchDomGrid("KRK:BTC/USD",load,changed);await flush();stop();resolve(metadata());await flush();
    expect(changed).toHaveBeenCalledTimes(1);
    const skipped=vi.fn(async()=>metadata());const cancel=watchDomGrid("KRK:BTC/USD",skipped,()=>{});cancel();await flush();expect(skipped).not.toHaveBeenCalled();
  });
  it("refreshes after five minutes, backs off failures for thirty seconds and retains last-checked provenance",async()=>{
    vi.useFakeTimers();const load=vi.fn().mockResolvedValueOnce(metadata()).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(metadata({tickSize:.5}));
    const states:DomGridState[]=[];const stop=watchDomGrid("KRK:BTC/USD",load,s=>states.push(s));await flush();
    expect(states.at(-1)?.metadata?.tickSize).toBe(.1);
    await vi.advanceTimersByTimeAsync(299999);expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect(load).toHaveBeenCalledTimes(2);expect(states.at(-1)).toMatchObject({pending:false,error:"offline",metadata:{tickSize:.1}});
    await vi.advanceTimersByTimeAsync(30000);expect(load).toHaveBeenCalledTimes(3);expect(states.at(-1)?.metadata?.tickSize).toBe(.5);
    stop();expect(vi.getTimerCount()).toBe(0);
  });
  it("does not publish a successful result under the requested market when its symbol differs",async()=>{
    vi.useFakeTimers();const states:DomGridState[]=[];
    const stop=watchDomGrid("KRK:BTC/USD",async()=>metadata({symbol:"KRK:ETH/USD"}),s=>states.push(s));await flush();
    expect(states.at(-1)?.metadata).toBeUndefined();expect(states.at(-1)?.error).toMatch(/match/);stop();
  });
});
