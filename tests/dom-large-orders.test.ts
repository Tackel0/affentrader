import {describe,expect,it} from "vitest";
import {defaultDomHighlight,domLargeThresholds,domOrderTier,validDomHighlight} from "@/lib/orderflow/domLargeOrders";
import {defaultDomPreferences,readDomPreferences,validDomPreferences} from "@/lib/orderflow/domPreferences";
const rows=[{price:100,bid:1,ask:0},{price:99,bid:1,ask:0},{price:98,bid:20,ask:0},{price:97,bid:4,ask:0},{price:101,bid:0,ask:1},{price:102,bid:0,ask:1},{price:103,bid:0,ask:1}];
describe("DOM large waiting orders",()=>{
  it("uses upper median of visible quote notionals and ignores empty slots",()=>{
    const threshold=domLargeThresholds(rows,defaultDomHighlight());expect(threshold).toEqual({large:306,block:1530});
    expect(domOrderTier(20,98,threshold)).toBe(2);expect(domOrderTier(4,97,threshold)).toBe(1);expect(domOrderTier(1,100,threshold)).toBe(0);
    expect(domLargeThresholds([...rows,{price:104,bid:0,ask:0}],defaultDomHighlight())).toEqual(threshold);
  });
  it("requires six observed side levels and chooses the upper rather than average even median",()=>{
    expect(domLargeThresholds(rows.slice(0,5),defaultDomHighlight())).toBeNull();
    expect(domLargeThresholds(rows.slice(0,6),{mode:"auto",multiplier:2})).toEqual({large:204,block:1020});
  });
  it("uses inclusive large/block fixed-quote boundaries independent of base quantity",()=>{
    const threshold=domLargeThresholds([],{mode:"fixed",value:400});expect(threshold).toEqual({large:400,block:2000});
    expect(domOrderTier(4,100,threshold)).toBe(1);expect(domOrderTier(20,100,threshold)).toBe(2);
    expect(domOrderTier(3.999,100,threshold)).toBe(0);expect(domOrderTier(19.999,100,threshold)).toBe(1);
    expect(domOrderTier(0,100,threshold)).toBe(0);
  });
  it("validates controls and preserves old saved view preferences when adding highlight defaults",()=>{
    for(const value of [{mode:"auto",multiplier:0},{mode:"fixed",value:0},{mode:"fixed",value:Infinity},{mode:"fixed",value:1,unlocked:true}])expect(validDomHighlight(value)).toBe(false);
    const old=defaultDomPreferences();delete old.highlight;old.follow="fixed";old.columns.visible.volume=true;
    expect(validDomPreferences(old)).toBe(true);expect(readDomPreferences(old)).toMatchObject({follow:"fixed",highlight:{mode:"auto",multiplier:3},columns:{visible:{volume:true}}});
    expect(validDomPreferences({...old,highlight:{mode:"fixed",value:-1}})).toBe(false);
  });
});
