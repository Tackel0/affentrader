import { describe, expect, it } from "vitest";
import { domNavigation, followDom, scrollDom, type DomNavigation } from "@/lib/orderflow/domNavigation";
import { centeredLadder } from "@/lib/orderflow/depthLadder";
import type { OrderBook } from "@/types/trading";
const book:OrderBook={symbol:"TEST",time:10000,simulated:false,bids:[{price:100,quantity:2},{price:99,quantity:3}],asks:[{price:101,quantity:4},{price:102,quantity:5}]};
const follow=(state:DomNavigation,patch:Partial<Parameters<typeof followDom>[1]>={})=>followDom(state,{target:101,mode:"auto",halfRows:5,delay:5000,now:10000,...patch});
describe("DOM navigation",()=>{
  it("follows by default, holds while hovered and rescues a moved market outside the viewport",()=>{
    const state=domNavigation(100);
    expect(follow(state).center).toBe(101);
    const hovered={...state,hovered:true};
    expect(follow(hovered)).toBe(hovered);
    expect(follow(hovered,{target:106}).center).toBe(106);
    expect(follow(hovered,{target:105})).toBe(hovered);
  });
  it("keeps Fixed untouched and honors all four Timed leave deadlines, even for offscreen prices",()=>{
    const state={...domNavigation(100),hovered:true};
    expect(follow(state,{mode:"fixed",target:1000})).toBe(state);
    expect(follow(state,{mode:"timed",target:1000})).toBe(state);
    for(const delay of [5000,10000,30000,60000]){
      const left={...state,hovered:false,leftAt:10000};
      expect(follow(left,{mode:"timed",delay,target:1000,now:10000+delay-1})).toBe(left);
      expect(follow(left,{mode:"timed",delay,target:1000,now:10000+delay}).center).toBe(1000);
    }
  });
  it("retains an explicit scroll across quantity/clock updates and bounds arbitrary wheel movement",()=>{
    const moved=scrollDom({...domNavigation(100),hovered:true},20,100);
    expect(moved.center).toBe(120);
    expect(follow(moved,{target:100})).toBe(moved);
    expect(follow(moved,{target:101}).center).toBe(101);
    expect(scrollDom(moved,-1000,100).center).toBe(1);
    expect(scrollDom(moved,Infinity,100)).toBe(moved);
    expect(follow({...moved,hovered:false,scrollTarget:null},{target:100}).center).toBe(100);
  });
  it("keeps contiguous price rows fixed as orders change, without retaining removed liquidity",()=>{
    const before=centeredLadder(book,1,101,2);
    expect(before.map(r=>r.price)).toEqual([103,102,101,100,99]);
    const after=centeredLadder({...book,bids:[{price:99,quantity:7}],asks:[{price:102,quantity:8}]},1,101,2);
    expect(after.map(r=>r.price)).toEqual(before.map(r=>r.price));
    expect(after.find(r=>r.price===100)?.bid).toBe(0);
    expect(after.find(r=>r.price===102)?.ask).toBe(8);
    expect(centeredLadder(book,5,20,1)).toEqual([{price:105,bid:0,ask:9},{price:100,bid:2,ask:0},{price:95,bid:3,ask:0}]);
  });
  it("bounds wide spreads and low-price viewports instead of allocating their missing range",()=>{
    const wide={...book,bids:[{price:1,quantity:1}],asks:[{price:1e10,quantity:2}]};
    expect(centeredLadder(wide,.01,500000000000,50)).toHaveLength(101);
    expect(centeredLadder(book,1,1,3).map(r=>r.price)).toEqual([4,3,2,1]);
    expect(()=>centeredLadder(book,1,100,51)).toThrow(/viewport/);
  });
});
