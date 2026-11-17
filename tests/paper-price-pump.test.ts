import {describe,it,expect,vi} from "vitest";
import {PaperPricePump,type PaperObservation} from "@/lib/trading/paperPricePump";
import {createAccount,placeOrder,processPrice} from "@/lib/trading/broker";
const settle=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
describe("paper price FIFO",()=>{
  it("retains each sample's source even when prices are identical",async()=>{
    const sources:(boolean|undefined)[]=[],pump=new PaperPricePump({valid:()=>true,write:async batch=>{sources.push(...batch.map(o=>o.simulated));},failed:error=>{throw error;}});[false,true,false].forEach((simulated,time)=>pump.push({symbol:"BTCUSDT",price:100,time,simulated}));await settle();expect(sources).toEqual([false,true,false]);pump.stop();
  });
  it("fills an actual stop entry and protective exit even when the final batched price is below the entry",async()=>{
    let account=placeOrder(createAccount({feeRate:0,slippageBps:0}),{symbol:"BTCUSDT",side:"buy",type:"stop",stopPrice:110,stopLoss:90,quantity:1},{BTCUSDT:100},0).account;
    const pump=new PaperPricePump({valid:()=>true,write:async batch=>{for(const o of batch)account=processPrice(account,o.symbol,o.price,o.time).account;},failed:error=>{throw error;}});[100,120,80].forEach((price,time)=>pump.push({symbol:"BTCUSDT",price,time}));await settle();expect(account.fills.map(fill=>[fill.side,fill.price])).toEqual([["buy",120],["sell",80]]);expect(account.positions).toHaveLength(0);pump.stop();
  });
  it("retains every delivered up/down transition in bounded FIFO batches",async()=>{
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;}),seen:number[]=[],batches:number[]=[];let first=true;
    const pump=new PaperPricePump({valid:()=>true,write:async(batch,valid)=>{if(first){first=false;await wait;}if(valid()){batches.push(batch.length);seen.push(...batch.map(o=>o.price));}},failed:error=>{throw error;}},100,3);
    [100,120,80,110,90,101,105,106].forEach((price,time)=>pump.push({symbol:"BTCUSDT",price,time}));release();await settle();expect(seen).toEqual([100,120,80,110,90,101,105,106]);expect(batches.every(n=>n<=3)).toBe(true);pump.stop();
  });
  it("fences an in-flight batch and clears queued observations when ownership ends",async()=>{
    let release!:()=>void,owns=true;const wait=new Promise<void>(resolve=>{release=resolve;}),seen:PaperObservation[]=[];
    const pump=new PaperPricePump({valid:()=>owns,write:async(batch,valid)=>{await wait;if(valid())seen.push(...batch);},failed:vi.fn()});pump.push({symbol:"BTCUSDT",price:100,time:1});pump.push({symbol:"BTCUSDT",price:90,time:2});owns=false;pump.stop();release();await settle();expect(seen).toEqual([]);
  });
  it("reports capacity or write failures once instead of silently dropping live matching work",async()=>{
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;}),failed=vi.fn(),pump=new PaperPricePump({valid:()=>true,write:async()=>wait,failed},2,1);for(let i=0;i<6;i++)pump.push({symbol:"BTCUSDT",price:100+i,time:i});expect(failed).toHaveBeenCalledTimes(1);release();await settle();
    const rejected=vi.fn(),broken=new PaperPricePump({valid:()=>true,write:async()=>{throw new Error("quota");},failed:rejected});broken.push({symbol:"BTCUSDT",price:100,time:1});await settle();broken.push({symbol:"BTCUSDT",price:101,time:2});expect(rejected).toHaveBeenCalledTimes(1);
  });
});
