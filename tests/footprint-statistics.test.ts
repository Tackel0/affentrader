import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import { FOOTPRINT_STAT_TOGGLES, defaultFootprintStatistics, footprintStatistics, footprintStatisticRows, paintFootprintStatistics } from "@/lib/orderflow/footprintStatistics";
import { defaultFootprint, resolveFootprint, resolveFootprintChart, resolveFootprintInstances, validFootprint, footprintSettings, paintFootprintBar } from "@/lib/orderflow/footprint";
const bar = (): FootprintBar => ({ time:60000,volume:50,delta:10,poc:100,levels:[
  {price:100,upperPrice:101,buyVolume:20,sellVolume:10,buyCount:2,sellCount:5,imbalance:null},
  {price:101,upperPrice:102,buyVolume:10,sellVolume:10,buyCount:1,sellCount:2,imbalance:null},
] });
const all = { ...defaultFootprint(),statisticsVisible:true,...Object.fromEntries(FOOTPRINT_STAT_TOGGLES.map(key=>[key,true])) };
it("calculates all ten raw metrics from underlying counts independently of aggregate messages",()=>{
  expect(footprintStatistics(bar())).toEqual({buy:30,sell:20,total:50,delta:10,buyPercent:60,sellPercent:40,deltaPercent:20,buyCount:3,sellCount:7,tradeCount:10});
  const input=bar();input.levels[0].buyCount=99;expect(footprintStatistics(input).tradeCount).toBe(107);
});
it("poisons unknown sides and totals, preserves the known side and distinguishes zero",()=>{
  const input=bar();input.levels[0].buyCount=null;
  expect(footprintStatistics(input)).toMatchObject({buyCount:null,sellCount:7,tradeCount:null});
  expect(footprintStatisticRows(footprintStatistics(input),all).slice(-3).map(row=>row.text)).toEqual(["—","7","—"]);
  input.levels[0].buyVolume=0;input.levels[1].buyVolume=0;
  expect(footprintStatistics(input)).toMatchObject({buyCount:0,sellCount:7,tradeCount:7});
});
it("withholds count overflow instead of fabricating a combined count",()=>{
  const input=bar();input.levels[0].buyCount=Number.MAX_SAFE_INTEGER;
  expect(footprintStatistics(input)).toMatchObject({buyCount:null,sellCount:7,tradeCount:null});
  input.levels[1].buyVolume=0;expect(footprintStatistics(input)).toMatchObject({buyCount:Number.MAX_SAFE_INTEGER,tradeCount:null});
});
it("handles zero denominators and large finite volume without overflowing percentages",()=>{
  expect(footprintStatistics({...bar(),levels:[]})).toMatchObject({total:0,buyPercent:null,sellPercent:null,deltaPercent:null,tradeCount:0});
  const huge=bar();huge.levels=[{...huge.levels[0],buyVolume:1e308,sellVolume:0}];expect(footprintStatistics(huge)).toMatchObject({buyPercent:100,deltaPercent:100});
  huge.levels[0].buyVolume=-1;expect(()=>footprintStatistics(huge)).toThrow(/invalid/);
});
it("retains default rows and merges each side's volume/percentage into one reference-style row",()=>{
  const stats=footprintStatistics(bar());
  expect(footprintStatisticRows(stats,defaultFootprintStatistics()).map(r=>[r.label,r.text])).toEqual([["Volume","50"],["Delta","+10"],["Delta %","20%"]]);
  expect(footprintStatisticRows(stats,all).map(r=>[r.label,r.text])).toEqual([["Volume","50"],["Buy","30 (60%)"],["Sell","20 (40%)"],["Delta","+10"],["Delta %","20%"],["Trades","10"],["Bid trades","7"],["Ask trades","3"]]);
});
it("honors all 1,024 independent toggle combinations without duplicate rows",()=>{
  for(let mask=0;mask<1024;mask++){
    const style={...defaultFootprintStatistics(),...Object.fromEntries(FOOTPRINT_STAT_TOGGLES.map((key,i)=>[key,!!(mask&(1<<i))]))};
    const rows=footprintStatisticRows(footprintStatistics(bar()),style);
    const expected=Number(style.statVolume)+Number(style.statBuy||style.statBuyPct)+Number(style.statSell||style.statSellPct)+Number(style.statDelta)+Number(style.statDeltaPct)+Number(style.statTradeCount)+Number(style.statBidCount)+Number(style.statAskCount);
    expect(rows).toHaveLength(expected);expect(new Set(rows.map(r=>r.key)).size).toBe(expected);
  }
});
it("migrates legacy tables and validates independent instance styles and disabled choices",()=>{
  const legacy={...defaultFootprint(),statisticsVisible:true};for(const key of Object.keys(defaultFootprintStatistics()))delete (legacy as Record<string,unknown>)[key];
  expect(validFootprint(legacy)).toBe(true);expect(resolveFootprint(legacy)).toMatchObject({...defaultFootprintStatistics(),statisticsVisible:true});
  const source={...legacy,fp2Enabled:true,fp2StatisticsVisible:true,fp2StatisticsPosition:"above",fp2StatisticsSize:14,fp2StatVolume:false,fp2StatTradeCount:true,fp2StatisticsBackground:"#12345680"};
  const saved=resolveFootprintChart(JSON.parse(JSON.stringify(source)));expect(validFootprint(saved)).toBe(true);
  expect(resolveFootprintInstances(saved)[1].style).toMatchObject({statisticsPosition:"above",statisticsSize:14,statVolume:false,statTradeCount:true,statisticsBackground:"#12345680"});
  expect(resolveFootprintInstances(saved)[0].style.statisticsPosition).toBe("below");
  for(const invalid of [{statisticsPosition:"middle"},{statisticsSize:5},{statisticsSize:8.5},{statBuy:1},{fp2StatisticsSize:25},{fp2StatisticsColor:"bad"}])expect(validFootprint({...saved,...invalid})).toBe(false);
  const rows=footprintSettings().instances![1].rows;expect(rows.filter(r=>r.kind==="toggle"&&FOOTPRINT_STAT_TOGGLES.some(key=>"key"in r&&r.key===`fp2${key[0].toUpperCase()}${key.slice(1)}`))).toHaveLength(10);
});
const args=(invert=false)=>({coords:{width:800,pxPerBar:()=>220,timeToX:()=>200,priceToY:(p:number)=>invert?(p-90)*20:(110-p)*20},bounds:{top:0,height:600},scale:{},theme:{background:"#ffffff",textColor:"#131722"}}) as unknown as RendererLayerArgs;
function canvas(){
  const boxes:number[][]=[],texts:Array<{text:string;x:number;y:number;color:string;align:string}>=[];
  const ctx={fillStyle:"",textAlign:"",font:"",save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},strokeRect(){},fillRect(...r:number[]){boxes.push(r);},fillText(text:string,x:number,y:number){texts.push({text,x,y,color:ctx.fillStyle,align:ctx.textAlign});}};
  return{ctx:ctx as unknown as CanvasRenderingContext2D,boxes,texts};
}
it.each([[false,"above",38],[false,"below",204],[true,"above",78],[true,"below",244]] as const)("anchors metrics to observed prices, inverted=%s position=%s",(invert,position,y)=>{
  const c=canvas();paintFootprintStatistics(c.ctx,args(invert),bar(),1,{...all,statisticsPosition:position,statisticsSize:10},200,200);
  expect(c.boxes[0]).toEqual([100,y,200,118]);expect(c.texts.filter(t=>t.align==="right").map(t=>t.text)).toEqual(["50","30 (60%)","20 (40%)","+10","20%","10","7","3"]);
});
it("uses values-only in narrow lanes, supports stat-only zoom and honors master/all-off switches",()=>{
  const c=canvas(),style={...defaultFootprint(),statisticsVisible:true};paintFootprintStatistics(c.ctx,args(),bar(),1,style,200,30);
  expect(c.texts.map(t=>t.text)).toEqual(["50","+10","20%"]);expect(c.texts.every(t=>t.align==="center")).toBe(true);
  const zoom=canvas();paintFootprintBar(zoom.ctx,args(),bar(),undefined,1,{...style,candleVisible:false},{width:30,offset:0,within:false});expect(zoom.texts.map(t=>t.text).slice(-3)).toEqual(["50","+10","20%"]);expect(zoom.texts.length).toBeGreaterThan(3);
  for(const changes of [{statisticsVisible:false},Object.fromEntries(FOOTPRINT_STAT_TOGGLES.map(key=>[key,false]))]){const hidden=canvas();paintFootprintStatistics(hidden.ctx,args(),bar(),1,{...style,...changes},200,100);expect(hidden.texts).toEqual([]);expect(hidden.boxes).toEqual([]);}
});
