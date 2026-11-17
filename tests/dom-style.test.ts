import {describe,it,expect} from "vitest";
import {domStyle,DOM_ZOOMS,validDomColors,domVisibleRows} from "@/lib/orderflow/domStyle";
import {centeredLadder} from "@/lib/orderflow/depthLadder";
import {defaultDomPreferences,readDomPreferences,validDomPreferences} from "@/lib/orderflow/domPreferences";
describe("DOM style metrics and saved colors",()=>{
  it("applies the source rounding independently to rows, headers, text and order chips",()=>{
    expect(domStyle(100)).toMatchObject({row:20,head:26,text:12,headText:11,chip:16,chipText:10.5});
    expect(domStyle(70)).toMatchObject({row:14,head:18,text:8.4,headText:7.7,chip:11,chipText:7.35});
    expect(domStyle(150)).toMatchObject({row:30,head:39,text:18,headText:16.5,chip:24,chipText:15.75});
    for(const zoom of DOM_ZOOMS)expect(domStyle(zoom).row).toBeGreaterThan(0);
    expect(()=>domStyle(160)).toThrow();
    expect(domVisibleRows(426,domStyle(150))).toBe(12);
    const book={symbol:"TEST",time:0,simulated:false,bids:[{price:100,quantity:1}],asks:[{price:101,quantity:1}]};
    expect(centeredLadder(book,1,101,3,6).map(r=>r.price)).toEqual([104,103,102,101,100,99]);
  });
  it("retains explicit side colors with the measured normal/large/outline alpha",()=>{
    expect(domStyle(100,{bid:"#123456",ask:"#ABCDEF"})).toMatchObject({bid:"#123456",ask:"#ABCDEF",bid14:"rgba(18, 52, 86, 0.14)",bid30:"rgba(18, 52, 86, 0.3)",ask60:"rgba(171, 205, 239, 0.6)"});
    for(const colors of [{bid:"red",ask:null},{bid:"#123",ask:null},{bid:"#123456;display:none",ask:null},{bid:null,ask:null,unlocked:true}])expect(validDomColors(colors)).toBe(false);
  });
  it("upgrades earlier saved views without discarding them and validates optional style fields",()=>{
    const old=defaultDomPreferences();delete old.zoom;delete old.colors;old.follow="fixed";old.groups.BTCUSDT=5;
    expect(validDomPreferences(old)).toBe(true);expect(readDomPreferences(old)).toMatchObject({follow:"fixed",groups:{BTCUSDT:5},zoom:100,colors:{bid:null,ask:null}});
    expect(validDomPreferences({...old,zoom:101})).toBe(false);expect(validDomPreferences({...old,colors:{bid:"blue",ask:null}})).toBe(false);
  });
});
