import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
import { bindPriceScale } from "@/lib/chart/priceScale";
import type { PriceScaleSelection } from "@/lib/chart/scaleMode";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
import { parseWorkspace } from "@/lib/workspace";
import { linkedDrawingAxis } from "@/lib/alerts/drawingProjection";
import { drawingGeometry } from "@/lib/alerts/drawing";
const originalChart=useChartStore.getState(),originalWorkspace=useWorkspaceStore.getState();
beforeEach(()=>{vi.spyOn(console,"warn").mockImplementation(()=>{});useChartStore.setState({...originalChart},true);useWorkspaceStore.setState({...originalWorkspace,cells:structuredClone(originalWorkspace.cells),layouts:[]},true);});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe("persistent chart price scales",()=>{
  it("captures independent log axes across activation, named layouts and complete backups",()=>{
    useChartStore.getState().set({logarithmic:true});useWorkspaceStore.getState().capture();const id=useWorkspaceStore.getState().activeId;useWorkspaceStore.getState().activate("cell-2");expect(useChartStore.getState().logarithmic).toBe(false);useWorkspaceStore.getState().activate(id);expect(useChartStore.getState().logarithmic).toBe(true);
    useWorkspaceStore.getState().saveLayout("Log layout");const saved=useWorkspaceStore.getState().layouts[0];useChartStore.getState().set({logarithmic:false});useWorkspaceStore.getState().loadLayout(saved.id);expect(useChartStore.getState().logarithmic).toBe(true);
    const backup=createWorkspaceBackup();expect(backup.chart.state.logarithmic).toBe(true);expect(parseWorkspace(JSON.stringify(backup)).premium!.state.cells).toEqual(backup.premium!.state.cells);
    backup.chart.state.logarithmic="yes";expect(()=>parseWorkspace(JSON.stringify(backup))).toThrow(/logarithmic/);
  });
  it("routes an alert's projection through its owning cell, including two charts of one market",()=>{
    const geometry=drawingGeometry({id:"fib",type:"fibretracement",anchors:[{time:1,price:100},{time:2,price:400}],props:{logLevels:true,levels:[{ratio:0.5,enabled:true}]}},true,"cell-1")!;
    const workspace={activeId:"cell-2",cells:[{...originalWorkspace.cells[0],symbol:"BTCUSDT",logarithmic:true},{...originalWorkspace.cells[1],symbol:"BTCUSDT",logarithmic:false}]};expect(linkedDrawingAxis(geometry,"BTCUSDT",{symbol:"BTCUSDT",logarithmic:false},workspace)).toBe(true);
    expect(linkedDrawingAxis({...geometry,chartCellId:"cell-2"},"BTCUSDT",{symbol:"BTCUSDT",logarithmic:false},workspace)).toBe(false);expect(linkedDrawingAxis({...geometry,chartCellId:undefined},"BTCUSDT",{symbol:"BTCUSDT",logarithmic:false},workspace)).toBe(true);
  });
  it("bridges actual renderer changes after UI events, external restore and cleanup without feedback",async()=>{
    vi.useFakeTimers();const element=new EventTarget();let stored=true,rendered=false,listener:((value:PriceScaleSelection)=>void)|undefined;
    const set=vi.fn((_name:unknown,value:unknown)=>{rendered=Boolean(value);return renderer;}),renderer={set,get:()=>rendered};
    const write=vi.fn((value:PriceScaleSelection)=>{stored=value.logarithmic;listener?.(value);});const dispose=bindPriceScale({renderer} as unknown as Parameters<typeof bindPriceScale>[0],element,{read:()=>({mode:"price",logarithmic:stored}),write,subscribe:fn=>{listener=fn;return()=>{listener=undefined;};}});
    expect(rendered).toBe(true);rendered=false;element.dispatchEvent(new Event("click"));await vi.runAllTicks();expect(stored).toBe(false);expect(write).toHaveBeenCalledTimes(1);
    listener?.({mode:"price",logarithmic:true});expect(rendered).toBe(true);rendered=false;await vi.advanceTimersByTimeAsync(250);expect(write).toHaveBeenCalledTimes(2);dispose();rendered=true;element.dispatchEvent(new Event("change"));await vi.advanceTimersByTimeAsync(500);expect(write).toHaveBeenCalledTimes(2);expect(listener).toBeUndefined();
  });
});
