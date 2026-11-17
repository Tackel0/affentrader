import { describe,expect,it } from "vitest";
import { DOM_COLUMNS,defaultDomColumns,shownDomColumns,shiftDomColumn,reorderDomColumn,domPnlAtPrice } from "@/lib/orderflow/domColumns";
import type { Position } from "@/lib/trading/broker";
describe("DOM column layout and position P&L",()=>{
  it("defaults to the reference execution columns with required Bid/Price/Ask and optional account columns",()=>{
    const value=defaultDomColumns();
    expect(shownDomColumns(value,false,false)).toEqual(["sold","bid","price","ask","bought","delta"]);
    expect(shownDomColumns(value,false,true)[0]).toBe("orders");
    value.visible.pnl=true;
    expect(shownDomColumns(value,true,false).slice(0,2)).toEqual(["orders","pnl"]);
    expect(shownDomColumns(value,false,true)).not.toContain("pnl");
  });
  it("retains required columns across every visibility mask and respects exposure gating",()=>{
    for(let mask=0;mask<1024;mask++)for(const hasPosition of [false,true]){
      const value=defaultDomColumns();DOM_COLUMNS.forEach((c,i)=>{value.visible[c.id]=!!(mask&(1<<i))});
      const shown=shownDomColumns(value,hasPosition,false);
      expect(shown).toEqual(expect.arrayContaining(["bid","price","ask"]));
      if(!hasPosition){expect(shown).not.toContain("orders");expect(shown).not.toContain("pnl");}
    }
  });
  it("moves columns before a drop target or one keyboard position without mutation or duplication",()=>{
    const original=defaultDomColumns(),before=structuredClone(original);
    const dragged=reorderDomColumn(original,"delta","bid");
    expect(dragged.order.slice(0,5)).toEqual(["orders","pnl","sold","delta","bid"]);
    expect(shiftDomColumn(dragged,"delta",-1).order.slice(0,4)).toEqual(["orders","pnl","delta","sold"]);
    expect(original).toEqual(before);expect(new Set(dragged.order).size).toBe(10);
    expect(shiftDomColumn(original,"orders",-1)).toBe(original);
    expect(reorderDomColumn(original,"bid","bid")).toBe(original);
  });
  it("calculates row mark-to-market for long/short/partial quantities, excluding booked profit and fees",()=>{
    const position:Position={symbol:"BTCUSDT",quantity:2,avgPrice:100,openedAt:0,realizedPnl:999};
    expect(domPnlAtPrice(position,101)).toBe(2);expect(domPnlAtPrice(position,99)).toBe(-2);
    expect(domPnlAtPrice({...position,quantity:-2},101)).toBe(-2);
    expect(domPnlAtPrice({...position,quantity:.25},104)).toBe(1);
    expect(domPnlAtPrice(position,100)).toBe(0);
    expect(domPnlAtPrice({...position,quantity:-2},100)).toBe(0);
    expect(domPnlAtPrice(undefined,100)).toBeNull();expect(domPnlAtPrice(position,Infinity)).toBeNull();
  });
});
