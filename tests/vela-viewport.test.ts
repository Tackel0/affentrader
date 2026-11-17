import {describe,expect,it} from "vitest";
import {NativeRenderer} from "@luxalgo/vela";
interface NativeViewport{barSpacing:number;rightOffset:number}
const methods=NativeRenderer.prototype as unknown as {setVisibleRange:(range:{from:number;to:number})=>void;clampViewport:(spacing:number,offset:number)=>NativeViewport};
describe("actual native Vela bounded dense viewport",()=>{
  it.each([80,320,800,1300])("frames all 20,000 loaded bars in a %s-pixel chart",width=>{
    const bars=20000;let applied:NativeViewport|undefined;
    const host={coords:{width,barCount:bars,spacingScale:1,timeToLogical:(time:number)=>time/60000},applyViewport(value:NativeViewport){applied=methods.clampViewport.call(this,value.barSpacing,value.rightOffset);}};
    methods.setVisibleRange.call(host,{from:0,to:(bars-1)*60000});expect(applied!.barSpacing).toBeCloseTo(width/(bars-1),10);expect(applied!.rightOffset).toBe(0);expect(width/applied!.barSpacing).toBeGreaterThanOrEqual(bars-1-1e-8);
  });
  it("retains the native protections against unlimited zoom-out and runaway pan",()=>{
    const host={coords:{width:800,barCount:20000,spacingScale:1}},small=methods.clampViewport.call(host,-1,-1e12),large=methods.clampViewport.call(host,1e12,1e12);
    expect(small.barSpacing).toBeGreaterThan(0.01);expect(small.rightOffset).toBeGreaterThan(-20000);expect(large.barSpacing).toBeLessThan(1000);expect(large.rightOffset).toBeLessThan(1000);
  });
});
