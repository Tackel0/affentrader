import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { buildTpoSessions, createTpoCache } from "@/lib/orderflow/tpoModel";
import { defaultTpo, resolveTpo, validTpo } from "@/lib/orderflow/tpoSettings";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";
import { paintTpoOverlay, resolveTpoOverlay, tpoOverlayInputVisible } from "@/lib/orderflow/tpoOverlay";
const start = Date.UTC(2026,10,4), minute = 60000;
const bars = [0,30].map(i=>({time:start+i*minute,open:.2,close:.5,low:.2,high:.5,volume:1}));
const style = {...defaultTpo(),rowSize:.1,sessionMinutes:60,valueAreaPercent:100,candlesVisible:false,histogramVisible:false,lettersVisible:false,boundariesVisible:false,ibVisible:false,
  valueAreaFill:true,valueAreaFillColor:"rgba(10,20,30,0.2)",valueAreaColor:"#123456",pocColor:"#abcdef",pocWidth:5};
const sessions = buildTpoSessions(bars,style,"30m");
function fixture(invert=false,compress=false) {
  const calls:Array<{kind:string;values:number[];color:string;alpha:number;width:number}> = [], path:number[] = [];
  const ctx = {globalAlpha:1,fillStyle:"",strokeStyle:"",lineWidth:1,save(){},restore(){},beginPath(){path.length=0;},moveTo(...v:number[]){path.push(...v);},lineTo(...v:number[]){path.push(...v);},
    stroke(){calls.push({kind:"stroke",values:[...path],color:ctx.strokeStyle,alpha:ctx.globalAlpha,width:ctx.lineWidth});},
    fillRect(...values:number[]){calls.push({kind:"fill",values,color:ctx.fillStyle,alpha:ctx.globalAlpha,width:ctx.lineWidth});}};
  const args = {bars,priceStyle:"tpo",bounds:{top:0,height:200},scale:{},theme:{textColor:"#111"},cursor:null,
    coords:{width:500,timeToX:(time:number)=>(time-start)/minute*(compress?.1:1),priceToY:(p:number)=>invert?200-p*100:p*100}} as unknown as RendererLayerArgs;
  return {ctx:ctx as unknown as CanvasRenderingContext2D,args,calls};
}
it.each([false,true])("paints canonical VAL-to-VAH fill behind the structure on inverted=%s axes",invert=>{
  const f=fixture(invert);paintTpoSessions(f.ctx,f.args,sessions,style);
  expect(f.calls[0]).toMatchObject({kind:"fill",color:style.valueAreaFillColor,alpha:1});
  expect(f.calls[0].values).toEqual([4,invert?140:20,52,40]);
  const va=f.calls.filter(c=>c.kind==="stroke"&&c.color===style.valueAreaColor);
  expect(va).toHaveLength(2);expect(va.every(c=>c.width===1)).toBe(true);
  expect(f.calls.find(c=>c.kind==="stroke"&&c.color===style.pocColor)?.width).toBe(5);
});
it("keeps fill independent of block visibility but hides it when either fill or VA is off",()=>{
  for(const patch of [{valueAreaFill:false},{valueAreaVisible:false}]) {
    const f=fixture();paintTpoSessions(f.ctx,f.args,sessions,{...style,...patch});
    expect(f.calls.some(c=>c.kind==="fill")).toBe(false);
  }
});
it("shares the exact band and independent line colors/widths with the overlay",()=>{
  const a=fixture(),b=fixture();paintTpoSessions(a.ctx,a.args,sessions,style);paintTpoOverlay(b.ctx,b.args,sessions,style);
  expect(a.calls).toEqual(b.calls);
});
it("uses compact rails instead of a large filled background when a session is compressed",()=>{
  const f=fixture(false,true);paintTpoSessions(f.ctx,f.args,sessions,style);
  expect(f.calls.filter(c=>c.kind==="fill")).toHaveLength(3);
  expect(f.calls.some(c=>c.color===style.valueAreaFillColor)).toBe(false);
  expect(f.calls.at(-1)?.values[3]).toBe(5);
});
it("migrates old preferences, rejects invalid widths and exposes both surfaces' controls",()=>{
  const legacy={...defaultTpo()};delete legacy.valueAreaFill;delete legacy.valueAreaFillColor;delete legacy.pocWidth;
  expect(validTpo(legacy)).toBe(true);expect(resolveTpo(legacy)).toMatchObject({valueAreaFill:false,pocWidth:2});
  for(const pocWidth of [0,6,1.5,NaN])expect(validTpo({...style,pocWidth})).toBe(false);
  expect(resolveTpoOverlay(style)).toMatchObject({valueAreaFill:true,valueAreaFillColor:style.valueAreaFillColor,pocWidth:5});
  expect(tpoOverlayInputVisible("valueAreaFill",{valueAreaVisible:false})).toBe(false);
  expect(tpoOverlayInputVisible("pocWidth",{pocVisible:false})).toBe(false);
});
it("reuses the session calculation when only fill or line styles change",()=>{
  const c=createTpoCache(),first=c.read(bars,style,"30m","BTCUSDT");
  expect(c.read(bars,{...style,valueAreaFill:false,pocWidth:1,valueAreaColor:"#ff0000"},"30m","BTCUSDT")).toBe(first);
});
