import { describe,it,expect } from "vitest";
import { createDrawing } from "@luxalgo/vela";
import { registerAnchoredVwapConstruction } from "@/lib/drawings/anchoredVwapPlugin";
registerAnchoredVwapConstruction();
import { defaultDrawingTarget,describeDrawing,drawingCondition,drawingFingerprint,drawingGeometry,drawingHistory,drawingSync,drawingValues,evaluateDrawing,fibLevelPrice,validateDrawingCondition } from "@/lib/alerts/drawing";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import { stepRule } from "@/lib/alerts/runtime";
import { validateRuleShape,requiredHistoryViews,type MarketView } from "@/lib/alerts/rules";
import { restartRule } from "@/lib/alerts/rateLimit";
import { parseWorkspace } from "@/lib/workspace";
import type { DrawingAlertCondition,DrawingAlertGeometry } from "@/types/drawingAlerts";
import type { AlertRule,RuleEvent } from "@/types/alerts";
import type { DrawingTypeKey } from "@luxalgo/vela";
const start=1_800_000_000_000,minute=60000;
const anchors=[{time:start,price:100},{time:start+2*minute,price:200},{time:start+minute,price:200},{time:start+2*minute,price:250}];
const bars=Array.from({length:6},(_,i)=>({time:start+i*minute,open:100+i*10,high:110+i*10,low:90+i*10,close:100+i*10,volume:i+1}));
function native(type:DrawingTypeKey="fibretracement",patch:Record<string,unknown>={}){
  const count=["hline","hray","crossline","anchoredvwap"].includes(type)?1:["parallelchannel","flattopbottom","fibextensiontrend"].includes(type)?3:type==="disjointchannel"?4:2;
  const drawing=createDrawing(type,{id:"drawing",paneId:"price",anchors:anchors.slice(0,count),...patch});if(!drawing)throw new Error(`Native fixture ${type} is unavailable.`);return drawing;
}
function condition(type:DrawingTypeKey="fibretracement"):DrawingAlertCondition{const geometry=drawingGeometry(native(type).serialize())!;return {type:"drawing",geometry,...defaultDrawingTarget(geometry)};}
function rule(c=condition(),patch:Partial<AlertRule>={}):AlertRule{return {id:"drawing-alert",name:"Drawing alert",kind:"drawing",status:"active",scope:{type:"symbol",symbol:"BTCUSDT",timeframe:"1m"},condition:{op:"leaf",leaf:c},trigger:"every_time",repeat:true,frequency:"tick",cooldownMs:0,sound:false,browserNotification:false,serverSide:false,createdAt:start,...patch};}
function view(price:number,previous=price,at=start+3*minute):MarketView{return {bars:structuredClone(bars),timeframe:"1m",at,previousAt:at-1000,quote:{price,previous,changePercent:0,volume:1,high:price,low:price,time:at,simulated:false}};}
describe("linked drawing alert geometry",()=>{
  it.each(["fibretracement","fibextension","fibextensiontrend"] as const)("matches actual native %s levels, including reverse and custom labels",type=>{
    const drawing=native(type),geometry=drawingGeometry(drawing.serialize())!,c={...condition(type),geometry};
    const projected=drawing as unknown as {entryLines:(p:unknown)=>{y1:number;numberText:string}[]};
    const nativeLines=projected.entryLines({xOf:(time:number)=>time,yOf:(price:number)=>price,width:1000,height:1000});
    for(const [i,level] of geometry.levels.filter(l=>l.enabled).entries())expect(fibLevelPrice(geometry,level.ratio)).toBeCloseTo(nativeLines[i].y1,9);
    if(type==="fibretracement"){
      drawing.applySettings({reverse:true,"levels.4.label":"Golden zone"});const reversed=drawingGeometry(drawing.serialize())!;expect(fibLevelPrice(reversed,0.618)).toBeCloseTo(161.8);expect(describeDrawing({...c,geometry:reversed})).toContain("Golden zone");
    }
  });
  it("crosses enabled Fib levels at equality, reports the exact custom level and excludes hidden levels",()=>{
    const c=condition();c.geometry.levels=[{ratio:0.5,enabled:true,label:"Midpoint"},{ratio:0.618,enabled:false,label:"Disabled"}];c.target={type:"all_levels"};
    const result=evaluateDrawing(c,view(150,149));expect(result).toMatchObject({met:true,event:true,incomplete:false});expect(result.detail).toContain("0.5 (Midpoint)");expect(result.detail).not.toContain("Disabled");expect(evaluateDrawing(c,view(140,139)).met).toBe(false);
  });
  it("tracks reversed and negative Fib zones independently of displayed width",()=>{
    const c=condition();c.geometry.levels.push({ratio:-1,enabled:true});c.target={type:"zone",ratios:[-1,0.5]};c.operator="entering";
    expect(drawingValues(c,[],"1m",start+20*minute)).toMatchObject({low:150,high:300});expect(evaluateDrawing(c,view(200,100)).met).toBe(true);
    c.geometry.reverse=true;expect(drawingValues(c,[],"1m",start+20*minute)).toMatchObject({low:0,high:150});
  });
  it.each(["parallelchannel","disjointchannel","flattopbottom"] as const)("uses actual native %s boundaries",type=>{
    const drawing=native(type),c=condition(type);const nativeGeometry=(drawing as unknown as {geometry:(p:unknown)=>{segments:number[][]}}).geometry({xOf:(time:number)=>(time-start)/minute,yOf:(price:number)=>price,width:100,height:1000});
    const values=drawingValues(c,bars,"1m",start+minute)!;
    const at=(s:number[])=>s[1]+(s[3]-s[1])*(1-s[0])/(s[2]-s[0]);expect([values.low,values.high]).toEqual(nativeGeometry.segments.map(at).sort((a,b)=>a-b));
  });
  it("resolves a sloped channel on actual candle positions across a session gap",()=>{
    const c=condition("parallelchannel"),data=[bars[0],{...bars[1],time:start+minute},{...bars[2],time:start+100*minute}];c.geometry.anchors=[{time:start,price:100},{time:start+100*minute,price:200},{time:start+minute,price:200}];
    expect(drawingValues(c,data,"1m",start+minute)).toMatchObject({low:150,high:200});
    c.geometry.logarithmic=true;expect(drawingValues(c,data,"1m",start+minute)?.low).toBeCloseTo(Math.sqrt(100*200));
    expect(drawingValues(c,data.slice(1),"1m",start+minute)).toBeUndefined();
  });
  it("follows the actual disjoint channel end cap and finite channel time domain",()=>{
    const c=condition("disjointchannel"),time=start+minute/2,values=drawingValues(c,bars,"1m",time)!;
    expect(values).toMatchObject({low:125,high:150,active:true});expect(drawingValues(c,bars,"1m",start+3*minute)?.active).toBe(false);
    c.operator="entering";expect(evaluateDrawing(c,{...view(180,120,start+minute),previousAt:start+minute}).met).toBe(true);
    c.geometry.extendRight=true;expect(drawingValues(c,bars,"1m",start+3*minute)?.active).toBe(true);
  });
  it("uses both rectangle time and price bounds, including time-boundary exits",()=>{
    const c=condition("box");c.operator="entering";expect(evaluateDrawing(c,view(150,90,start+minute)).met).toBe(true);
    c.operator="exiting";const before=evaluateDrawing({...c,operator:"inside"},view(150,150,start+2*minute));expect(evaluateDrawing(c,{...view(150,150,start+2*minute+1),previousDrawing:before.sample}).met).toBe(true);
    c.operator="outside";expect(evaluateDrawing(c,view(150,150,start+3*minute)).met).toBe(true);
  });
  it("matches native Anchored VWAP bands and rejects an unweighted zero-volume fallback",()=>{
    for(const zero of [false,true]){
      const data=bars.map(bar=>({...bar,volume:zero?0:bar.volume})),drawing=native("anchoredvwap"),c=condition("anchoredvwap");c.target={type:"zone"};c.operator="inside";
      const samples=(drawing as unknown as {series:(p:unknown)=>{mid:number;upper:number;lower:number}[]}).series({barsInRange:()=>data});const actual=drawingValues(c,data,"1m",data.at(-1)!.time)!;
      if(zero){expect(samples).toBeNull();expect(actual).toBeUndefined();}
      else{expect(actual.low).toBeCloseTo(samples.at(-1)!.lower,9);expect(actual.high).toBeCloseTo(samples.at(-1)!.upper,9);}
    }
  });
  it("matches the actual native regression fit and channel deviation",()=>{
    const drawing=native("regressionchannel"),c=condition("regressionchannel"),data=bars.map((bar,i)=>({...bar,close:100+[1,6,2,9,4,10][i]}));c.geometry.anchors[1].time=data.at(-1)!.time;drawing.anchors=c.geometry.anchors;
    const fit=(drawing as unknown as {fit:(p:unknown)=>{mid1:number;dev:number}}).fit({barsInRange:()=>data});const actual=drawingValues(c,data,"1m",data.at(-1)!.time)!;
    expect(actual.low).toBeCloseTo(fit.mid1-fit.dev,9);expect(actual.high).toBeCloseTo(fit.mid1+fit.dev,9);
  });
  it("retains an observed intrabar VWAP with its matching price through JSON restart",()=>{
    const c=condition("anchoredvwap"),r=rule(c),data=bars.slice(0,3),read=()=>({...view(128,128,start+2*minute+1),bars:data});
    const first=stepRule(r,"BTCUSDT",undefined,read,start+2*minute+1);expect(first.fire).toBe(false);
    data[2]={...data[2],high:400,low:120,close:400,volume:100};const nextView={...read(),quote:{...read().quote!,price:200,previous:128,time:start+2*minute+2}};
    const next=stepRule(r,"BTCUSDT",JSON.parse(JSON.stringify(first.state)),()=>nextView,start+2*minute+2);expect(next.fire).toBe(true);expect(next.state.drawing?.price).toBe(200);
  });
  it("does not fire when the linked drawing moves through a stationary price",()=>{
    const c=condition(),r=rule(c);c.target={type:"level",ratio:0.5};let current=view(160,160),state=stepRule(r,"BTCUSDT",undefined,()=>current,start+3*minute).state;
    const moved={...c.geometry,anchors:c.geometry.anchors.map(a=>({...a,price:a.price+20}))};const patch=drawingSync(r,moved)!;Object.assign(r,patch);current=view(160,160,start+3*minute+1);
    const movedStep=stepRule(r,"BTCUSDT",state,()=>current,start+3*minute+1);expect(movedStep.fire).toBe(false);state=movedStep.state;
    current=view(180,160,start+3*minute+2);expect(stepRule(r,"BTCUSDT",state,()=>current,start+3*minute+2).fire).toBe(true);
  });
  it("rebaselines stored VWAP observations after the algorithm upgrade without a phantom crossing",()=>{
    const c=condition("anchoredvwap"),r=rule(c),data=[{...bars[0],high:100,low:100,close:100}],at=start+1;
    const read=(price:number,time:number)=>({...view(price,price,time),bars:data});
    const first=stepRule(r,"BTCUSDT",undefined,()=>read(99,at),at).state;
    first.drawing!.fingerprint=JSON.stringify([drawingFingerprint(c.geometry),c.target,c.operator]);
    first.firedAt=start-100; first.hasFired=true;
    const migrated=stepRule(r,"BTCUSDT",JSON.parse(JSON.stringify(first)),()=>read(101,at+1),at+1);
    expect(migrated.fire).toBe(false); expect(migrated.state.firedAt).toBe(first.firedAt); expect(migrated.state.hasFired).toBe(true);
    expect(migrated.state.drawing!.fingerprint).toContain("weighted-hlc3-v1");
    expect(stepRule(r,"BTCUSDT",migrated.state,()=>read(99,at+2),at+2).fire).toBe(true);
  });
  it("stops when a selected level disappears, retains limits and needs an explicit restart after repair",()=>{
    const c=condition(),r=rule(c,{lastFired:{BTCUSDT:{time:start}},rate:{recent:[{symbol:"BTCUSDT",time:start}],stoppedSymbols:{}}}),disabled=structuredClone(c.geometry);disabled.levels=disabled.levels.map(l=>({...l,enabled:false}));
    const stopped={...r,...drawingSync(r,disabled,start+1)};expect(stopped.status).toBe("stopped");expect(stopped.drawingIssue).toMatch(/Enable/);expect(stopped.rate).toEqual(r.rate);expect(validateRuleShape(stopped)).toBeNull();expect(()=>restartRule(stopped,start+2)).toThrow(/Enable/);
    const repaired={...stopped,...drawingSync(stopped,c.geometry,start+3)};expect(repaired.status).toBe("stopped");expect(repaired.drawingIssue).toBeUndefined();expect(restartRule(repaired,start+4).status).toBe("active");expect(drawingFingerprint(drawingCondition(repaired)!.geometry)).toBe(drawingFingerprint(c.geometry));
  });
  it("validates standalone market binding and complete workspace round trips",()=>{
    const r=rule();expect(validateRuleShape(r)).toBeNull();expect(validateRuleShape({...r,kind:"technical"})).toMatch(/own linked/);
    const workspace={version:1,chart:{state:{symbol:"BTCUSDT",timeframe:"1m",chartType:"candles",feedMode:"auto",indicators:[],drawings:{},pineLibraries:{}}},watchlists:{state:{lists:[{id:"w",name:"Crypto",symbols:["BTCUSDT"]}],activeId:"w"}},alerts:{state:{alerts:[],logs:[],rules:[r]}}};expect(parseWorkspace(JSON.stringify(workspace)).alerts.state.rules).toEqual([r]);
    const bad=condition();bad.target={type:"zone",ratios:[0.618,0.618]};bad.operator="entering";expect(validateDrawingCondition(bad)).toMatch(/distinct/);
  });
  it("uses history planning for complete anchors and bounds requests at the real provider limit",()=>{
    const c=condition("anchoredvwap"),r=rule(c);expect(drawingHistory(c,"1s",start+60_000_000)).toBe(20000);expect(requiredHistoryViews(r.condition,{symbol:"BTCUSDT",timeframe:"1m"})[0].count).toBeGreaterThanOrEqual(300);
  });
  it("runs real browser dispatch with a moved Fib level and preserves firing timing gates",()=>{
    const c=condition();c.target={type:"level",ratio:0.5};let r=rule(c,{trigger:"once_per_bar"}),quote=view(149).quote!,clock=start+3*minute;const events:RuleEvent[]=[];
    const engine=new BrowserRuleEngine({rules:()=>[r],bars:()=>bars,quote:()=>quote,ensure:async()=>{},now:()=>clock,fire:(_r,event)=>{events.push(event);r={...r,lastFired:{BTCUSDT:{time:clock,bar:bars[3].time}}};}});engine.prime();quote={...quote,price:150,time:++clock};engine.onPrice("BTCUSDT");expect(events).toHaveLength(1);
    r={...r,...drawingSync(r,{...c.geometry,anchors:c.geometry.anchors.map(a=>({...a,price:a.price+20}))})};engine.prime();quote={...quote,price:180,time:++clock};engine.onPrice("BTCUSDT");expect(events).toHaveLength(1);
  });
});
