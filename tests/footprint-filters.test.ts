import { expect,it } from "vitest";
import type { FootprintBar } from "@/types/trading";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprintFilters,footprintFilterPasses,FOOTPRINT_FILTER_KEYS } from "@/lib/orderflow/footprintFilters";
import { footprintDisplayBar } from "@/lib/orderflow/footprintCells";
import { footprintValueArea } from "@/lib/orderflow/footprintValueArea";
import { footprintStatistics } from "@/lib/orderflow/footprintStatistics";
import { footprintStacks } from "@/lib/orderflow/footprintAnalysis";
import { createFootprintPocCache } from "@/lib/orderflow/footprintPoc";
import { unfinishedAuctionRows } from "@/lib/orderflow/unfinishedAuctions";
import { defaultFootprint,paintFootprintBar,resolveFootprintChart,resolveFootprintInstances,validFootprint,footprintSettings } from "@/lib/orderflow/footprint";
import { createFootprintInspection,footprintInspectionCsv } from "@/lib/orderflow/footprintInspection";
const bar=():FootprintBar=>({time:60000,volume:225,delta:-5,poc:100,levels:([
  [100,100,100,100],[5,5,1,1],[0,8,0,2],[3,0,1,0],[2,2,1,1]
]).map(([buyVolume,sellVolume,buyCount,sellCount],i)=>({price:100+i,upperPrice:101+i,buyVolume,sellVolume,buyCount,sellCount,imbalance:null}))});
const style={...defaultFootprint(),rowSize:1};
it("keeps the original unfiltered object and quantities when all bounds are off",()=>{
  const input=bar();expect(footprintDisplayBar(input,1,style)).toBe(input);expect(footprintFilterPasses(0,0,defaultFootprintFilters())).toBe(true);
});
it.each([["minVolume",10,10.001],["maxVolume",10,9.999],["minBidVolume",3,3.001],["maxBidVolume",3,2.999],["minAskVolume",7,7.001],["maxAskVolume",7,6.999]] as const)("enforces inclusive %s bounds",(key,edge,outside)=>{
  expect(footprintFilterPasses(7,3,{[key]:edge})).toBe(true);expect(footprintFilterPasses(7,3,{[key]:outside})).toBe(false);
});
it("combines all bounds and keeps contradictory positive ranges empty",()=>{
  expect(footprintFilterPasses(7,3,{minVolume:10,maxVolume:10,minBidVolume:3,maxBidVolume:3,minAskVolume:7,maxAskVolume:7})).toBe(true);
  expect(footprintFilterPasses(7,3,{minVolume:11,maxVolume:10})).toBe(false);
});
it("retains blank slots, recomputes visible POC/VA and restores filters without mutating raw rows",()=>{
  const input=bar(),saved=structuredClone(input),shown=footprintDisplayBar(input,1,{...style,maxVolume:10});
  expect(shown.levels.map(r=>[r.price,r.filtered])).toEqual([[100,true],[101,false],[102,false],[103,false],[104,false]]);
  expect(shown.poc).toBe(101);expect(footprintValueArea(shown,1,70)).toMatchObject({low:101,high:103,representedVolume:25,selectedVolume:18,lowIndex:1,highIndex:2});
  expect(shown.levels.map(r=>r.buyVolume)).toEqual(input.levels.map(r=>r.buyVolume));expect(input).toEqual(saved);
  const restored=footprintDisplayBar(shown,1,style);expect(restored.poc).toBe(100);expect(restored.levels.every(r=>r.filtered===false)).toBe(true);
});
it("filters mean sizes in average mode while preserving all raw statistics and counts",()=>{
  const input=bar(),raw=footprintDisplayBar(input,1,{...style,maxVolume:5}),mean=footprintDisplayBar(input,1,{...style,maxVolume:5,averageTradeSize:true});
  expect(raw.levels.filter(r=>!r.filtered).map(r=>r.price)).toEqual([103,104]);
  expect(mean.levels.filter(r=>!r.filtered).map(r=>r.price)).toEqual([100,102,103,104]);expect(mean.poc).toBe(102);
  expect(footprintStatistics(mean)).toEqual(footprintStatistics(input));expect(footprintStatistics(raw)).toEqual(footprintStatistics(input));
});
it("blocks explicitly filtered diagonal counterparts and breaks adjacent stacks",()=>{
  const input=bar();input.levels=input.levels.slice(0,3).map((r,i)=>({...r,buyVolume:i===1?100:10,sellVolume:1,buyImbalance:true}));
  const shown=footprintDisplayBar(input,1,{...style,maxVolume:20});expect(shown.levels[1].filtered).toBe(true);
  expect(shown.levels[1].buyImbalance).toBe(false);expect(shown.levels[2].buyImbalance).toBe(false);
  expect(footprintStacks(shown,1,2)).toEqual([]);
});
it("keeps projected POC and unfinished references on unfiltered source rows, including Replay fences",()=>{
  const input=bar(),shown=footprintDisplayBar(input,1,{...style,maxVolume:10}),candles=[{time:60000,low:100,high:105},{time:120000,low:100,high:101}];
  const cache=createFootprintPocCache();expect(cache.read([shown],candles,"1m",1)[0]).toMatchObject({price:100.5,touched:120000});
  expect(cache.read([shown],candles,"1m",1,false,120000)[0].touched).toBeNull();
  expect(unfinishedAuctionRows(shown,1,0)).toEqual(unfinishedAuctionRows(input,1,0));
});
it("captures all-filtered rows with no local POC, raw quantities and explicit CSV filter metadata",()=>{
  const shown=footprintDisplayBar(bar(),1,{...style,minVolume:1000});expect(Number.isNaN(shown.poc)).toBe(true);expect(footprintValueArea(shown,1,70)).toBeNull();
  const ref=createFootprintPocCache().read([shown],[{time:60000,low:100,high:105}],"1m",1)[0];
  const settings={step:1,ratio:3,minimumVolume:0,ignoreZeroOpposite:false,minimumStackRows:3,minVolume:1000,valueAreaPercent:70,pocExtend:true};
  const snapshot=createFootprintInspection(shown,settings,{symbol:"BTCUSDT",timeframe:"1m",simulated:false,coverage:"fixture",pocReference:ref});
  expect(snapshot.poc).toBeNull();expect(snapshot.volume).toBe(225);expect(snapshot.rows.every(r=>r.displayFiltered&&!r.poc&&!r.inValueArea)).toBe(true);expect(snapshot.pocReference?.price).toBe(100.5);
  expect(footprintInspectionCsv(snapshot)).toContain('"display_filtered"');expect(footprintInspectionCsv(snapshot)).toContain('"filter_min_volume"');expect(footprintInspectionCsv(snapshot)).toContain('"projected_poc_midpoint"');
  const legacy=createFootprintInspection(bar(),{step:1,ratio:3,minimumVolume:0,ignoreZeroOpposite:false,minimumStackRows:3},{symbol:"BTCUSDT",timeframe:"1m",simulated:false,coverage:"fixture"});expect(legacy.rows[0].displayFiltered).toBeUndefined();
});
it("validates legacy and independent instance filter settings, including disabled instances",()=>{
  const legacy={...style};for(const key of FOOTPRINT_FILTER_KEYS)delete (legacy as Record<string,unknown>)[key];expect(validFootprint(legacy)).toBe(true);
  const saved=resolveFootprintChart({...legacy,fp2Enabled:true,fp2MinBidVolume:.5,fp2MaxAskVolume:20,fp5Enabled:false,fp5MaxVolume:3});
  expect(validFootprint(saved)).toBe(true);expect(resolveFootprintInstances(saved)[1].style).toMatchObject({minBidVolume:.5,maxAskVolume:20});
  for(const invalid of [{minVolume:-1},{maxVolume:Infinity},{fp5MinVolume:"2"},{fp2MaxAskVolume:NaN}])expect(validFootprint({...saved,...invalid})).toBe(false);
  expect(footprintSettings().instances![1].rows.filter(r=>r.kind==="number"&&"key"in r&&r.key.startsWith("fp2M"))).toHaveLength(6);
});
it.each([false,true])("blanks text/shapes at original prices and normalizes only visible rows, inverted=%s",invert=>{
  const shown=footprintDisplayBar(bar(),1,{...style,maxVolume:10}),texts:string[]=[],fills:Array<{x:number;width:number;y:number}>=[];
  const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},strokeRect(){},fillText(s:string){texts.push(s);},fillRect(x:number,y:number,width:number){fills.push({x,y,width});}} as unknown as CanvasRenderingContext2D;
  const args={coords:{width:600,pxPerBar:()=>100,timeToX:()=>100,priceToY:(p:number)=>invert?(p-95)*20:(110-p)*20},scale:{},bounds:{top:0,height:400},theme:{background:"#ffffff",textColor:"#111111"}} as unknown as RendererLayerArgs;
  paintFootprintBar(ctx,args,shown,undefined,1,{...style,candleVisible:false,pocVisible:false,valueAreaVisible:false,imbalanceVisible:false});
  expect(texts).toEqual(["5","5","8","3","2","2"]);expect(fills.length).toBe(6);expect(fills.some(fill=>fill.width===37)).toBe(true);
  expect(fills.every(fill=>invert?fill.y>=120:fill.y<180)).toBe(true);
});
