import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar, OHLCV } from "@/types/trading";
import { footprintValueArea } from "@/lib/orderflow/footprintValueArea";
import { createFootprintPocCache, paintFootprintPocExtensions } from "@/lib/orderflow/footprintPoc";
import { defaultFootprint, footprintSettings, resolveFootprint, resolveFootprintChart, resolveFootprintInstances, validFootprint, paintFootprintBar } from "@/lib/orderflow/footprint";
import { createFootprintInspection, footprintInspectionCsv } from "@/lib/orderflow/footprintInspection";
import { publishFootprintSurface, readFootprintSurface, captureFootprintInspection, clearFootprintSurface } from "@/lib/orderflow/footprintReadout";
const start = Date.UTC(2026, 10, 4), minute = 60000;
const bar = (volumes = [1, 4, 10, 4, 1], offset = 0): FootprintBar => ({ time: start + offset * minute, poc: 100 + volumes.indexOf(Math.max(...volumes)), volume: volumes.reduce((a,b)=>a+b,0), delta: volumes.reduce((a,b)=>a+b,0),
  levels: volumes.map((v,i)=>({ price: 100+i, upperPrice: 101+i, buyVolume: v, sellVolume: 0, buyCount: v ? 1 : 0, sellCount: 0, imbalance: null })) });
const candle = (offset: number, low = 100, high = 105): OHLCV => ({ time: start + offset * minute, open: low, close: high, high, low, volume: 1 });
it("expands from the highest total row to 70%, preferring the upper neighbor on ties", () => {
  expect(footprintValueArea(bar(),1,70)).toMatchObject({ low: 102, high: 104, pocLow: 102, pocHigh: 103, pocMid: 102.5, representedVolume: 20, selectedVolume: 14, lowIndex: 2, highIndex: 3, basis: "volume" });
  expect(footprintValueArea(bar([1,6,10,4,1]),1,70)).toMatchObject({ low: 101, high: 103, selectedVolume: 16 });
});
it("uses the lower first POC on equal maxima and handles 1% and 100% boundaries", () => {
  expect(footprintValueArea(bar([5,5]),1,1)).toMatchObject({ low: 100, high: 101, pocLow: 100 });
  expect(footprintValueArea(bar(),1,100)).toMatchObject({ low: 100, high: 105, selectedVolume: 20 });
  expect(footprintValueArea(bar([0,3,2,0]),1,100)).toMatchObject({ low: 101, high: 103, selectedVolume: 5 });
});
it("spans absent price rows without inventing their volume", () => {
  const input = bar([1,10,4]); input.levels[1].price = 105; input.levels[1].upperPrice = 106; input.levels[2].price = 110; input.levels[2].upperPrice = 111;
  expect(footprintValueArea(input,1,70)).toMatchObject({ low: 105, high: 111, selectedVolume: 14, representedVolume: 15 });
});
it("recalculates POC and value area from known side means while preserving raw quantities", () => {
  const input = bar([100,20]); input.levels[0].buyCount = 100;
  const saved = structuredClone(input);
  expect(footprintValueArea(input,1,70)).toMatchObject({ pocLow: 100, low: 100, high: 101 });
  expect(footprintValueArea(input,1,70,true)).toMatchObject({ pocLow: 101, low: 101, high: 102, representedVolume: 21, basis: "average-trade-size" });
  for (const row of input.levels) row.buyCount = null;
  expect(footprintValueArea(input,1,70,true)).toBeNull();
  expect(saved.volume).toBe(input.volume); expect(saved.levels.map(r=>r.buyVolume)).toEqual(input.levels.map(r=>r.buyVolume));
});
it("retains canonical upper boundaries and avoids multiplying huge totals by percentages", () => {
  const input = bar([1]); input.levels = [{ price: .2, upperPrice: .3, buyVolume: 1e308, sellVolume: 0, imbalance: null }];
  expect(footprintValueArea(input,.1,70)).toMatchObject({ low: .2, high: .3, pocMid: .25, representedVolume: 1e308 });
});
it("keeps empty, zero-volume and unsupported value areas unavailable", () => {
  for (const pct of [0,101,NaN]) expect(footprintValueArea(bar(),1,pct)).toBeNull();
  expect(footprintValueArea(bar(),0,70)).toBeNull(); expect(footprintValueArea(bar([0,0]),1,70)).toBeNull();
  expect(footprintValueArea({ ...bar(), levels: [] },1,70)).toBeNull();
});
it("migrates legacy settings and namespaces value area and POC options for each instance", () => {
  const legacy = { ...defaultFootprint() };
  for (const key of ["valueAreaVisible","valueAreaPercent","valueAreaColor","valueAreaBackground","valueAreaWidth","pocExtend","pocWidth"] as const) delete (legacy as Partial<typeof legacy>)[key];
  expect(validFootprint(legacy)).toBe(true); expect(resolveFootprint(legacy)).toMatchObject({ valueAreaVisible: true, valueAreaPercent: 70, pocExtend: false, pocWidth: 1 });
  const source = { ...legacy, fp2Enabled: true, fp2ValueAreaPercent: 80, fp2ValueAreaBackground: "#abcdef44", fp2PocExtend: true, fp2PocWidth: 3 };
  const restored = resolveFootprintChart(JSON.parse(JSON.stringify(source)));
  expect(validFootprint(restored)).toBe(true); expect(resolveFootprintInstances(restored)[1].style).toMatchObject({ valueAreaPercent: 80, pocExtend: true, pocWidth: 3, valueAreaBackground: "#abcdef44" });
  for (const invalid of [{ valueAreaPercent: 0 },{ valueAreaWidth: 1.5 },{ pocWidth: 11 },{ fp2PocExtend: 1 },{ fp2ValueAreaColor: "bad" }]) expect(validFootprint({ ...restored, ...invalid })).toBe(false);
  expect(footprintSettings().instances![1].rows.find(r=>"key" in r && r.key === "fp2PocExtend")).toMatchObject({ defval: false });
});
it("projects the row midpoint, ignores same-bar contact and does not bridge a price gap", () => {
  const cache = createFootprintPocCache(), input = bar([10]);
  expect(cache.read([input],[candle(0),candle(1,101,102),candle(2,99,100),candle(3,100.5,101)],"1m",1)[0]).toMatchObject({ price: 100.5, lower: 100, upper: 101, from: start+minute, touched: start+3*minute });
});
it("invalidates repaired historical ranges, changed grids, average sizing and Replay backseeks", () => {
  const cache = createFootprintPocCache(), input = bar([100,20]); input.levels[0].buyCount = 100;
  const candles = [candle(0),candle(1,102,103),candle(2,100.5,101.5)];
  const first = cache.read([input],candles,"1m",1);
  expect(first[0].touched).toBe(start+2*minute); expect(cache.read([input],candles,"1m",1)).toBe(first);
  candles[1].low = 100.5; expect(cache.read([input],candles,"1m",1)[0].touched).toBe(start+minute);
  expect(cache.read([input],candles,"1m",1,true)[0].price).toBe(101.5);
  expect(cache.read([input],candles,"1m",1,false,start+minute)[0].touched).toBeNull();
  expect(cache.read([input],candles,"1m",1,false,start)).toEqual([]);
  const merged = { ...input, levels: [{ ...input.levels[0], upperPrice: 102 }] };
  expect(cache.read([merged],candles,"1m",2)[0].price).toBe(101);
});
it("withholds a forming Replay touch and origins whose candle has not been revealed", () => {
  const cache = createFootprintPocCache(), candles = [candle(0),candle(1)];
  expect(cache.read([bar([10])],candles,"1m",1,false,start+minute)[0].touched).toBeNull();
  expect(cache.read([bar([10])],candles,"1m",1,false,start+2*minute)[0].touched).toBe(start+minute);
  expect(cache.read([bar([10],2)],candles,"1m",1)).toEqual([]);
});
const view = (invert: boolean) => ({ bars: [candle(0), candle(1), candle(2)], coords: { width: 800, pxPerBar: ()=>200, timeToX: (time: number)=>100+(time-start)/minute*200, priceToY: (p:number)=>invert ? (p-99)*40 : (106-p)*40 }, bounds: { top: 0, height: 300 }, scale: {}, theme: { background: "#ffffff", textColor: "#131722" } }) as unknown as RendererLayerArgs;
function canvas() {
  const lines: Array<{ points: number[][]; color: string; width: number; alpha: number }> = [], rects: Array<{ rect:number[]; color:string }> = [], boxes: number[][] = [];
  let path: number[][] = [];
  const ctx = { strokeStyle:"", fillStyle:"", globalAlpha:1, lineWidth:1, save() {}, restore() {}, beginPath(){path=[];}, moveTo(x:number,y:number){path.push([x,y]);}, lineTo(x:number,y:number){path.push([x,y]);}, stroke(){lines.push({points:path,color:ctx.strokeStyle,width:ctx.lineWidth,alpha:ctx.globalAlpha});}, fillRect(...rect:number[]){rects.push({rect,color:ctx.fillStyle});}, strokeRect(...r:number[]){boxes.push(r);}, fillText(){} };
  return { ctx:ctx as unknown as CanvasRenderingContext2D, lines, rects, boxes };
}
it.each([false,true])("paints exact value-area edges, configured fill and inset POC width on inverted=%s", invert => {
  const {ctx,lines,rects,boxes}=canvas(), args=view(invert), style={...defaultFootprint(),candleVisible:false,valueAreaColor:"#123456",valueAreaBackground:"rgba(1,2,3,0.2)",valueAreaWidth:3,pocWidth:4};
  const placement={width:100,offset:50,within:false};
  paintFootprintBar(ctx,args,bar(),undefined,1,style,placement);
  const edges=[104,102].map(p=>args.coords.priceToY(p,args.scale,args.bounds));
  const boundaries=lines.filter(l=>l.color==="#123456");
  expect(boundaries.map(l=>l.points)).toEqual(edges.map(y=>[[100,y],[200,y]]));
  expect(boundaries.every(l=>l.width===3)).toBe(true);
  expect(rects.at(-1)).toEqual({rect:[100,Math.min(...edges),100,80],color:"rgba(1,2,3,0.2)"});
  expect(boxes[0]).toEqual([102,Math.min(args.coords.priceToY(102,args.scale,args.bounds),args.coords.priceToY(103,args.scale,args.bounds))+2,96,35]);
});
it("uses instance geometry for midpoint rays, includes off-screen origins and respects visibility", () => {
  const cache=createFootprintPocCache(), args=view(false), refs=cache.read([bar([10])],[candle(0),candle(1,102,103),candle(2,100,101)],"1m",1), style={...defaultFootprint(),pocExtend:true,pocWidth:3,pocColor:"#123456"};
  const painted=canvas(); paintFootprintPocExtensions(painted.ctx,args,refs,style,{width:100,offset:50,within:false});
  expect(painted.lines[0]).toMatchObject({points:[[200,220],[500,220]],color:"#123456",width:3,alpha:.62});
  const hidden=canvas(); paintFootprintPocExtensions(hidden.ctx,args,refs,{...style,pocVisible:false}); expect(hidden.lines).toEqual([]);
  const narrow=canvas(); paintFootprintPocExtensions(narrow.ctx,args,refs,style,{width:30,offset:0,within:false,opacity:.5}); expect(narrow.lines[0]).toMatchObject({alpha:.31,points:[[115,220],[500,220]]});
  const faded=canvas(); paintFootprintPocExtensions(faded.ctx,args,refs,style,{width:30,offset:0,within:false,opacity:0}); expect(faded.lines).toEqual([]);
});
it("withholds POC projections until at least two candles are loaded, retaining the observed model", () => {
  const origin = bar([10]), candles = [candle(0), candle(1, 102, 103)], refs = createFootprintPocCache().read([origin], candles, "1m", 1), style = { ...defaultFootprint(), pocExtend: true };
  const painted = canvas(), args = view(false);
  paintFootprintPocExtensions(painted.ctx, { ...args, bars: [] }, refs, style); expect(painted.lines).toEqual([]);
  paintFootprintPocExtensions(painted.ctx, { ...args, bars: candles.slice(0, 1) }, refs, style); expect(painted.lines).toEqual([]);
  expect(refs).toHaveLength(1); expect(refs[0]).toMatchObject({ price: 100.5, touched: null });
  paintFootprintPocExtensions(painted.ctx, { ...args, bars: candles }, refs, style); expect(painted.lines).toHaveLength(1);
});
it("exposes value-area and observed revisit metadata and freezes it in captures and CSV", () => {
  const input=bar(), refs=createFootprintPocCache().read([input],[candle(0),candle(1)],"1m",1), settings={step:1,ratio:3,minimumVolume:0,ignoreZeroOpposite:false,minimumStackRows:3,valueAreaPercent:70,valueAreaVisible:true,pocExtend:true};
  const token=Symbol(), context={symbol:"KRK:BTC/USD",timeframe:"1m",epoch:0,replay:false,sourceStamp:"source"};
  publishFootprintSurface("value-area-test",token,{...context,bars:[input],simulated:false,dropped:0,analysis:settings,pocReferences:refs});
  const readout=readFootprintSurface("value-area-test",context,input.time); expect(readout.rows).toContainEqual({label:"Value area 70% [lower, upper)",value:"[102, 104)"});
  const snapshot=captureFootprintInspection(readout.inspectionTarget!,"source",start+5*minute)!;
  expect(snapshot.rows.filter(r=>r.inValueArea).map(r=>r.lower)).toEqual([102,103]); expect(snapshot.pocReference?.touched).toBe(start+minute);
  refs[0].touched=null; expect(snapshot.pocReference?.touched).toBe(start+minute);
  expect(footprintInspectionCsv(snapshot)).toContain('"poc_first_observed_revisit_utc"');
  const old=createFootprintInspection(input,{step:1,ratio:3,minimumVolume:0,ignoreZeroOpposite:false,minimumStackRows:3},{symbol:context.symbol,timeframe:"1m",simulated:false,coverage:"legacy"});
  expect(old.valueArea).toBeUndefined(); expect(old.rows[0].inValueArea).toBeUndefined(); clearFootprintSurface("value-area-test",token);
});
it("rejects captures with a mismatched POC reference or a still-forming Replay revisit", () => {
  const input=bar(), ref=createFootprintPocCache().read([input],[candle(0),candle(1)],"1m",1)[0];
  const settings={step:1,ratio:3,minimumVolume:0,ignoreZeroOpposite:false,minimumStackRows:3,valueAreaPercent:70,pocExtend:true};
  const context={symbol:"KRK:BTC/USD",timeframe:"1m",simulated:false,coverage:"fixture",pocReference:ref};
  expect(()=>createFootprintInspection(input,settings,{...context,replayThrough:start+minute})).toThrow(/Replay boundary/);
  expect(()=>createFootprintInspection(input,settings,{...context,replayThrough:start+2*minute})).not.toThrow();
  expect(()=>createFootprintInspection(input,settings,{...context,pocReference:{...ref,price:ref.price+1}})).toThrow(/invalid/);
});
