import {expect,it} from "vitest";
import type {FootprintBar} from "@/types/trading";
import type {RendererLayerArgs} from "@luxalgo/vela";
import {firstObservedRangeTouches} from "@/lib/orderflow/referenceTouches";
import {createFootprintStackedZoneCache,paintFootprintStackedZones} from "@/lib/orderflow/footprintStackedZones";
import {defaultFootprint,validFootprint,resolveFootprintChart,resolveFootprintInstances,footprintSettings} from "@/lib/orderflow/footprint";
import {footprintDisplayBar} from "@/lib/orderflow/footprintCells";
import {createFootprintInspection,footprintInspectionCsv} from "@/lib/orderflow/footprintInspection";
import {publishFootprintSurface,readFootprintSurface,captureFootprintInspection,clearFootprintSurface} from "@/lib/orderflow/footprintReadout";
const start=Date.UTC(2026,10,4),minute=60000;
const candle=(offset:number,low=104,high=105)=>({time:start+offset*minute,low,high});
const bar=(count=3):FootprintBar=>({time:start,volume:count*20,delta:0,poc:100,levels:Array.from({length:count},(_,i)=>({price:100+i,upperPrice:101+i,rowIndex:100+i,buyVolume:10,sellVolume:10,buyCount:1,sellCount:1,imbalance:"buy",buyImbalance:true,sellImbalance:true}))});
it("finds inclusive edge/interior overlaps while ignoring earlier candles and price gaps",()=>{
  const bars=[candle(0,99,104),candle(1,104,105),candle(2,101,102)];
  expect(firstObservedRangeTouches(bars,[{from:start+minute,low:100,high:103},{from:start+minute,low:105,high:106},{from:start+3*minute,low:100,high:103}])).toEqual([start+2*minute,start+minute,null]);
  expect(firstObservedRangeTouches([candle(1,90,99),candle(2,104,110)],[{from:start,low:100,high:103}])).toEqual([null]);
});
it("matches brute-force earliest overlaps across 1,000 randomized range queries",()=>{
  let seed=12345;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  const bars=Array.from({length:300},(_,i)=>{const low=Math.floor(random()*150);return candle(i,low,low+Math.floor(random()*15));});
  const refs=Array.from({length:1000},()=>{const low=Math.floor(random()*150);return {from:start+Math.floor(random()*340)*minute,low,high:low+Math.floor(random()*25)};});
  expect(firstObservedRangeTouches(bars,refs)).toEqual(refs.map(ref=>bars.find(b=>b.time>=ref.from&&b.low<=ref.high&&b.high>=ref.low)?.time??null));
});
it("does not confuse alternating candles above and below a band with a real touch",()=>{
  const bars=Array.from({length:5000},(_,i)=>candle(i,i%2?200:0,i%2?201:1));
  const refs=bars.map(b=>({from:b.time,low:100,high:101}));expect(firstObservedRangeTouches(bars,refs).every(time=>time===null)).toBe(true);
});
it("keeps empty and malformed range queries unavailable",()=>{
  expect(firstObservedRangeTouches([], [{from:start,low:1,high:2}])).toEqual([null]);
  expect(firstObservedRangeTouches([candle(0)],[{from:NaN,low:1,high:2},{from:start,low:3,high:2}])).toEqual([null,null]);
});
it("builds independent buy/sell stacks and ends at the first later interior candle",()=>{
  const zones=createFootprintStackedZoneCache().read([bar()],[candle(0,90,110),candle(1),candle(2,101,102)],"1m",1,3);
  expect(zones.map(z=>[z.side,z.lower,z.upper,z.rows,z.touched])).toEqual([["buy",100,103,3,start+2*minute],["sell",100,103,3,start+2*minute]]);
  expect(createFootprintStackedZoneCache().read([bar()],[candle(0)],"1m",1,4)).toEqual([]);
  expect(createFootprintStackedZoneCache().read([bar(40)],[candle(0)],"1m",1,40)).toHaveLength(2);
});
it("includes boundary-only contact, source-row changes and historical range repairs",()=>{
  const cache=createFootprintStackedZoneCache(),prints=[bar()],bars=[candle(0),candle(1),candle(2,103,104)];
  const first=cache.read(prints,bars,"1m",1,3);expect(first[0].touched).toBe(start+2*minute);expect(cache.read(prints,bars,"1m",1,3)).toBe(first);
  bars[1].low=103;expect(cache.read(prints,bars,"1m",1,3)[0].touched).toBe(start+minute);
  prints[0].levels[1].buyImbalance=false;expect(cache.read(prints,bars,"1m",1,3).map(z=>z.side)).toEqual(["sell"]);
});
it("fences completed Replay origins and contacts and invalidates backwards seeks",()=>{
  const cache=createFootprintStackedZoneCache(),bars=[candle(0),candle(1,100,103)];
  expect(cache.read([bar()],bars,"1m",1,3,start+2*minute)[0].touched).toBe(start+minute);
  expect(cache.read([bar()],bars,"1m",1,3,start+minute)[0].touched).toBeNull();
  expect(cache.read([bar()],bars,"1m",1,3,start)).toEqual([]);
  expect(cache.read([bar()],[],"1m",1,3)).toEqual([]);
});
it("uses the displayed average/filter flags rather than unfiltered projected-POC rules",()=>{
  const input=bar(4);for(const level of input.levels){level.buyVolume=10;level.sellVolume=1;level.buyCount=100;}
  const style={...defaultFootprint(),stackedVisible:true};const bars=[candle(0)];
  const raw=footprintDisplayBar(input,1,{...style,maxVolume:20});expect(createFootprintStackedZoneCache().read([raw],bars,"1m",1,3)).toHaveLength(1);
  const mean=footprintDisplayBar(input,1,{...style,averageTradeSize:true});expect(createFootprintStackedZoneCache().read([mean],bars,"1m",1,3).map(zone=>zone.side)).toEqual(["sell"]);
  input.levels[1].buyVolume=100;const filtered=footprintDisplayBar(input,1,{...style,maxVolume:20});expect(createFootprintStackedZoneCache().read([filtered],bars,"1m",1,3)).toEqual([]);
});
const args=(invert=false)=>({coords:{width:600,pxPerBar:()=>100,timeToX:(time:number)=>100+(time-start)/minute*100,priceToY:(price:number)=>invert?(price-95)*20:(110-price)*20},bounds:{top:0,height:400},scale:{},theme:{background:"#ffffff",textColor:"#111111"}}) as unknown as RendererLayerArgs;
function canvas(){const fills:Array<{rect:number[];color:string;alpha:number}>=[];const ctx={fillStyle:"",globalAlpha:1,save(){},restore(){},fillRect(...rect:number[]){fills.push({rect,color:ctx.fillStyle,alpha:ctx.globalAlpha});}};return{ctx:ctx as unknown as CanvasRenderingContext2D,fills};}
it.each([false,true])("paints full-band projections from the instance edge, inverted=%s",invert=>{
  const zones=createFootprintStackedZoneCache().read([bar()],[candle(0),candle(1),candle(2,101,102)],"1m",1,3),c=canvas();
  paintFootprintStackedZones(c.ctx,args(invert),zones,{...defaultFootprint(),stackedVisible:true,stackedBuyColor:"#12345680",stackedSellColor:"rgba(4,5,6,0.2)"},{width:60,offset:0,within:false});
  expect(c.fills).toEqual([{rect:[130,invert?100:140,170,60],color:"#12345680",alpha:1},{rect:[130,invert?100:140,170,60],color:"rgba(4,5,6,0.2)",alpha:1}]);
});
it("keeps off-screen origins, clips horizontal extents and honors zoom/master visibility",()=>{
  const zone={time:start-2*minute,side:"buy"as const,lower:100,upper:103,rows:3,from:start-minute,touched:null};
  const c=canvas();paintFootprintStackedZones(c.ctx,args(),[zone],{...defaultFootprint(),stackedVisible:true},{width:60,offset:0,within:false});expect(c.fills[0].rect).toEqual([0,140,600,60]);
  for(const enabled of [false,true]){const hidden=canvas();paintFootprintStackedZones(hidden.ctx,args(),[zone],{...defaultFootprint(),stackedVisible:enabled},{width:30,offset:0,within:false,opacity:enabled?0:1});expect(hidden.fills).toEqual([]);}
});
it("retains legacy colors, independent instance fills and the 2–40 row contract",()=>{
  const legacy={...defaultFootprint()};delete (legacy as Partial<typeof legacy>).stackedBuyColor;delete (legacy as Partial<typeof legacy>).stackedSellColor;expect(validFootprint(legacy)).toBe(true);
  const saved=resolveFootprintChart({...legacy,fp2Enabled:true,fp2StackedRows:40,fp2StackedBuyColor:"#12345644",fp5Enabled:false,fp5StackedSellColor:"#ff000080"});expect(validFootprint(saved)).toBe(true);expect(resolveFootprintInstances(saved)[1].style).toMatchObject({stackedRows:40,stackedBuyColor:"#12345644"});
  for(const invalid of [{stackedRows:41},{stackedRows:2.5},{fp5StackedSellColor:"bad"}])expect(validFootprint({...saved,...invalid})).toBe(false);
  expect(footprintSettings().rows!.find(r=>"key"in r&&r.key==="stackedRows")).toMatchObject({max:40});
});
it("freezes displayed zone revisits in readout/captures/CSV and rejects future Replay contacts",()=>{
  const input=bar(),zones=createFootprintStackedZoneCache().read([input],[candle(0),candle(1,103,104)],"1m",1,3);
  const context={symbol:"KRK:BTC/USD",timeframe:"1m",epoch:1,replay:false,sourceStamp:"source"},settings={step:1,ratio:3,minimumVolume:0,ignoreZeroOpposite:false,minimumStackRows:3};const token=Symbol();
  publishFootprintSurface("stack-test",token,{...context,bars:[input],analysis:settings,simulated:false,dropped:0,stackedZones:zones});
  const readout=readFootprintSurface("stack-test",context,start);expect(readout.rows.some(r=>r.label.startsWith("Projected buy stack"))).toBe(true);
  const snapshot=captureFootprintInspection(readout.inspectionTarget!,"source",start+5*minute)!;expect(snapshot.stackedZones).toHaveLength(2);expect(snapshot.rows.every(r=>r.buyStackRevisit===start+minute)).toBe(true);
  zones[0].touched=null;expect(snapshot.stackedZones![0].touched).toBe(start+minute);expect(footprintInspectionCsv(snapshot)).toContain('"buy_stack_first_observed_revisit_utc"');
  const capture={symbol:context.symbol,timeframe:"1m",simulated:false,coverage:"fixture",stackedZones:snapshot.stackedZones};
  expect(()=>createFootprintInspection(input,settings,{...capture,replayThrough:start+minute})).toThrow(/Replay boundary/);
  expect(()=>createFootprintInspection(input,settings,{...capture,stackedZones:[{...snapshot.stackedZones![0],rows:4},snapshot.stackedZones![1]]})).toThrow(/invalid/);
  expect(createFootprintInspection(input,settings,{symbol:context.symbol,timeframe:"1m",simulated:false,coverage:"legacy"}).stackedZones).toBeUndefined();clearFootprintSurface("stack-test",token);
});
