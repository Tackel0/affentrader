import { describe,it,expect } from "vitest";
import { createDrawing,deserializeDrawing,getDrawingType,type Projector,type DrawingTypeKey } from "@luxalgo/vela";
import { registerFibonacciConstruction,isLogarithmicProjector } from "@/lib/drawings/fibonacciPlugin";
import { fibonacciPrice } from "@/lib/drawings/fibonacciMath";
import { drawingGeometry,defaultDrawingTarget,fibLevelPrice,evaluateDrawing,validateDrawingCondition,drawingSync } from "@/lib/alerts/drawing";
import { stepRule } from "@/lib/alerts/runtime";
import type { DrawingAlertCondition } from "@/types/drawingAlerts";
import type { AlertRule } from "@/types/alerts";
const points=[{time:1000,price:100},{time:2000,price:400},{time:3000,price:200}];
const projector=(log:boolean,invert=false):Projector=>({xOf:time=>time/10,yOf:price=>(invert?1:-1)*(log?Math.log(price):price)*100+250,pxToPoint:(x,y)=>({time:x*10,price:log?Math.exp((y-250)/(invert?100:-100)):(y-250)/(invert?100:-100)}),paneIdAtY:()=>"price",width:1000,height:1000});
type EntrySurface={entryLines:(projector:Projector)=>{x1:number;x2:number;y1:number;numberText:string}[];fillBands?:(projector:Projector)=>{y:number;h:number}[]};
function native(type:DrawingTypeKey="fibretracement"){
  const value=createDrawing(type,{id:"fib",paneId:"price",anchors:points.slice(0,type==="fibextensiontrend"?3:2),props:{levels:[{ratio:0.5,enabled:true,color:"#123456",label:"Midpoint"}]}});if(!value)throw new Error("Missing native fixture.");return value;
}
registerFibonacciConstruction();
describe("native Fibonacci construction extension",()=>{
  it("interpolates geometric levels, exact endpoints and trend-based projections",()=>{
    expect(fibonacciPrice("fibretracement",points,0.5,false,true)).toBeCloseTo(200);expect(fibonacciPrice("fibretracement",points,0.5,false,false)).toBe(250);
    expect(fibonacciPrice("fibretracement",points,0,false,true)).toBe(400);expect(fibonacciPrice("fibretracement",points,1,false,true)).toBe(100);
    expect(fibonacciPrice("fibextensiontrend",points,1,false,true)).toBeCloseTo(800);expect(fibonacciPrice("fibextensiontrend",points,1,true,true)).toBeCloseTo(50);expect(fibonacciPrice("fibextensiontrend",points,-1,false,true)).toBeCloseTo(50);
    expect(fibonacciPrice("fibextensiontrend",points,2,false,false)).toBe(800);
  });
  it("preserves precision across tiny/wide prices and rejects invalid numeric constructions",()=>{
    expect(fibonacciPrice("fibextension",[{time:1,price:1e-250},{time:2,price:1e250}],0.5,false,true)).toBeCloseTo(1,12);
    expect(fibonacciPrice("fibretracement",[{time:1,price:0},{time:2,price:400}],0.5,false,true)).toBeNaN();expect(fibonacciPrice("fibextension",points,10000,false,true)).toBeNaN();
  });
  it("registers once while preserving the original native tool metadata",()=>{
    const before=getDrawingType("fibretracement")!;registerFibonacciConstruction();const after=getDrawingType("fibretracement")!;expect(after.create).toBe(before.create);expect(after.group).toBe("fibonacci");expect(after.defaultStyle).toEqual(before.defaultStyle);expect(after.label).toBe(before.label);
  });
  it.each(["fibretracement","fibextension","fibextensiontrend"] as const)("uses one price construction for actual %s native painting, hit tests and alerts",type=>{
    const drawing=native(type),surface=drawing as unknown as EntrySurface;
    drawing.applySettings({logLevels:true});const p=projector(true),lines=surface.entryLines(p),geometry=drawingGeometry(drawing.serialize(),true)!;
    const expected=fibonacciPrice(type,drawing.anchors,0.5,false,true);expect(lines).toHaveLength(1);expect(lines[0].y1).toBeCloseTo(p.yOf(expected,"price")!,9);expect(lines[0].numberText).toContain(expected.toFixed(2));
    expect(fibLevelPrice(geometry,0.5)).toBeCloseTo(expected,9);expect(drawing.hitTest((lines[0].x1+lines[0].x2)/2,lines[0].y1,p,1)).toBe(true);expect(drawing.priceRange()!.min).toBeLessThanOrEqual(expected);
    const field=drawing.schema().fields.find(field=>field.path==="logLevels")!;expect(field.when).toEqual({path:"logarithmicAxis",in:[true]});expect(Reflect.get(drawing,"logarithmicAxis")).toBe(true);
  });
  it("retains the linear calculation on linear axes or when the log preference is off",()=>{
    const drawing=native(),surface=drawing as unknown as EntrySurface;drawing.applySettings({logLevels:true});expect(surface.entryLines(projector(false))[0].numberText).toContain("250.00");expect(Reflect.get(drawing,"logarithmicAxis")).toBe(false);
    drawing.applySettings({logLevels:false});expect(surface.entryLines(projector(true))[0].numberText).toContain("250.00");
  });
  it("detects log projection with inversion, large offsets and tiny references",()=>{
    expect(isLogarithmicProjector(projector(true,true),"price",1e-8)).toBe(true);expect(isLogarithmicProjector(projector(false,true),"price",1000000)).toBe(false);expect(isLogarithmicProjector({yOf:()=>null},"price",100)).toBe(false);expect(isLogarithmicProjector({yOf:()=>10},"price",100)).toBe(false);
  });
  it("round trips settings, partial property edits, templates and earlier serialized snapshots",()=>{
    const drawing=native(),linear=drawing.serialize();drawing.applySettings({logLevels:true,reverse:true,"levels.0.label":"Custom"});const saved=JSON.parse(JSON.stringify(drawing.serialize()));
    const restored=deserializeDrawing(saved)!;expect(restored.serialize().props).toMatchObject({logLevels:true,reverse:true});restored.applyProps({numbersSize:"large"});expect(restored.serialize().props).toMatchObject({logLevels:true,numbersSize:"large"});
    const previous=deserializeDrawing(linear)!;expect(previous.serialize().props?.logLevels).toBe(false);expect(previous.editableLevels()![0].label).toBe("Midpoint");expect(restored.editableLevels()![0].label).toBe("Custom");
    const templated=createDrawing("fibretracement",{paneId:"price",anchors:points.slice(0,2),props:saved.props})!;expect((templated as unknown as EntrySurface).entryLines(projector(true))[0].numberText).toContain("200.00");
  });
  it("reverses and extends the actual native trend-based extension",()=>{
    const drawing=native("fibextensiontrend");drawing.applySettings({logLevels:true,reverse:true,"style.extendLeft":true,"style.extendRight":true});const lines=(drawing as unknown as EntrySurface).entryLines(projector(true));
    expect(lines[0]).toMatchObject({x1:0,x2:1000});expect(lines[0].numberText).toContain("100.00");expect(drawing.serialize().props).toMatchObject({logLevels:true,reverse:true});
  });
  it("keeps native fill bands on the same logarithmic levels and omits overflowing levels",()=>{
    const drawing=native();drawing.applyProps({levels:[{ratio:0.25,enabled:true,color:"#111111"},{ratio:0.75,enabled:true,color:"#222222"}]});drawing.applySettings({logLevels:true});
    const surface=drawing as unknown as EntrySurface,p=projector(true),lines=surface.entryLines(p),bands=surface.fillBands!(p);expect(bands).toHaveLength(1);expect(bands[0].h).toBeCloseTo(Math.abs(lines[0].y1-lines[1].y1),9);
    drawing.applyProps({levels:[{ratio:10000,enabled:true,color:"#111111"}]});expect(surface.entryLines(p)).toEqual([]);
  });
  it("changes the alert threshold with construction/axis changes while rebaselining instead of firing",()=>{
    const drawing=native();drawing.applySettings({logLevels:true});const geometry=drawingGeometry(drawing.serialize(),false,"cell-1")!,c:DrawingAlertCondition={type:"drawing",geometry,...defaultDrawingTarget(geometry)},rule:AlertRule={id:"fib-rule",name:"Fib",kind:"drawing",status:"active",scope:{type:"symbol",symbol:"BTCUSDT",timeframe:"1m"},condition:{op:"leaf",leaf:c},frequency:"tick",trigger:"every_time",repeat:true,cooldownMs:0,sound:false,browserNotification:false,serverSide:false,createdAt:1};
    const view=(price:number,time:number)=>({bars:[],timeframe:"1m",quote:{price,previous:price,changePercent:0,volume:1,high:price,low:price,time},at:time});const first=stepRule(rule,"BTCUSDT",undefined,()=>view(220,10000),10000);
    const moved={...rule,...drawingSync(rule,{...geometry,logarithmic:true})};expect(stepRule(moved,"BTCUSDT",first.state,()=>view(220,10001),10001).fire).toBe(false);
    expect(evaluateDrawing({...c,geometry:{...geometry,logarithmic:true}}, {...view(201,10002),quote:{...view(201,10002).quote,previous:199}}).met).toBe(true);
    const overflow={...c,geometry:{...geometry,logarithmic:true,levels:[{ratio:10000,enabled:true}]},target:{type:"level" as const,ratio:10000}};expect(validateDrawingCondition(overflow)).toMatch(/numeric price range/);
  });
});
