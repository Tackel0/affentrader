import { describe,it,expect } from "vitest";
import { drawingCondition,drawingFingerprint,drawingGeometry,drawingSourceRevision } from "@/lib/alerts/drawing";
import { applyDrawingEdit,checkDrawingEdit,type DrawingEditIntent } from "@/lib/alerts/drawingEdits";
import type { AlertRule } from "@/types/alerts";
const geometry=drawingGeometry({id:"dw-1",type:"fibretracement",anchors:[{time:100,price:100},{time:200,price:400}],props:{levels:[{ratio:0.5,enabled:true}]}},true,"cell-1")!;
const rule=():AlertRule=>({id:"a",name:"Drawing",kind:"drawing",status:"paused",scope:{type:"symbol",symbol:"BTCUSDT",timeframe:"1m"},condition:{op:"leaf",leaf:{type:"drawing",geometry:structuredClone(geometry),target:{type:"level",ratio:0.5},operator:"crossing"}},frequency:"tick",trigger:"every_time",repeat:true,cooldownMs:0,sound:false,browserNotification:false,serverSide:false,createdAt:1,rate:{recent:[{symbol:"BTCUSDT",time:5}],stoppedSymbols:{}},lastFired:{BTCUSDT:{time:5}}});
const intent=(patch:Partial<typeof geometry>={}):DrawingEditIntent=>({id:"a",symbol:"BTCUSDT",expected:drawingFingerprint(geometry),geometry:{...geometry,...patch}});
describe("linked drawing edit revisions",()=>{
  it("rejects an older tab's real edit after another tab moved the source",()=>{
    const r=rule(),first=intent({logLevels:true});Object.assign(r,applyDrawingEdit(r,first));const stale=intent({anchors:geometry.anchors.map(a=>({...a,price:a.price+20}))});expect(checkDrawingEdit(r,stale)).toBe("conflict");expect(()=>applyDrawingEdit(r,stale)).toThrow(/newer drawing/);expect(drawingCondition(r)!.geometry.logLevels).toBe(true);expect(r.rate!.recent).toHaveLength(1);
  });
  it("accepts sequential revisions, preserves pause and gates, and treats duplicate broadcasts as no-ops",()=>{
    const r=rule(),first=intent({logLevels:true});Object.assign(r,applyDrawingEdit(r,first));expect(r.status).toBe("paused");expect(r.lastFired?.BTCUSDT.time).toBe(5);expect(checkDrawingEdit(r,first)).toBe("same");
    const second={...first,expected:drawingSourceRevision(r),geometry:{...first.geometry!,logarithmic:false}};Object.assign(r,applyDrawingEdit(r,second));expect(drawingCondition(r)!.geometry.logarithmic).toBe(false);expect(drawingSourceRevision(r)).toBe(drawingFingerprint(second.geometry));
  });
  it("tracks unavailable revisions while retaining usable geometry, then repairs only the matching source",()=>{
    const r=rule(),disabled=intent({levels:[{ratio:0.5,enabled:false}]});Object.assign(r,applyDrawingEdit(r,disabled,10));expect(r.status).toBe("stopped");expect(drawingCondition(r)!.geometry.levels[0].enabled).toBe(true);expect(drawingSourceRevision(r)).toBe(drawingFingerprint(disabled.geometry));
    expect(checkDrawingEdit(r,intent({logLevels:true}))).toBe("conflict");const removed={id:r.id,symbol:"BTCUSDT",expected:drawingSourceRevision(r)};Object.assign(r,applyDrawingEdit(r,removed,11));expect(drawingSourceRevision(r)).toBe("missing");
    Object.assign(r,applyDrawingEdit(r,{...intent(),expected:"missing"},12));expect(r.drawingIssue).toBeUndefined();expect(r.status).toBe("stopped");
  });
  it("does not adopt same-numbered drawings on another market or chart context",()=>{
    const r=rule();expect(checkDrawingEdit(r,{...intent({logLevels:true}),symbol:"HL:BTC"})).toBe("conflict");expect(checkDrawingEdit(r,intent({chartCellId:"cell-2"}))).toBe("conflict");expect(checkDrawingEdit(undefined,intent())).toBe("conflict");
  });
  it("canonicalizes legacy off preferences and property order for stable source revisions",()=>{
    const {logLevels,...legacy}=geometry,{levels,...remaining}=geometry;expect(drawingFingerprint(legacy)).toBe(drawingFingerprint({...legacy,logLevels:false}));expect(drawingFingerprint({...geometry,id:geometry.id})).toBe(drawingFingerprint({levels,...remaining}));
  });
});
