import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { buildTpoSessions } from "@/lib/orderflow/tpoModel";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";
import { paintTpoMarkers, layoutTpoPriceTags, tpoTagPriceText } from "@/lib/orderflow/tpoMarkerRenderer";
import { tpoOverlayInputVisible } from "@/lib/orderflow/tpoOverlay";
const bars=[{time:0,open:.2,close:.2,high:.2,low:.2,volume:1}];
const style={...defaultTpo(),rowSize:.1,pocLabelVisible:true,vahLabelVisible:true,valLabelVisible:true,pocColor:"#fff",valueAreaColor:"#000"};
const session=buildTpoSessions(bars,style,"30m")[0];
function draw(patch:Partial<typeof style>={},project=(p:number)=>p*500,left=200,end=500) {
  const rectangles:Array<{x:number;y:number;width:number;height:number;color:string}>=[],texts:Array<{text:string;x:number;y:number;color:string}>=[];
  let box:number[]=[];
  const ctx={fillStyle:"",save(){},restore(){},beginPath(){},roundRect(...r:number[]){box=r;},fill(){const [x,y,width,height]=box;rectangles.push({x,y,width,height,color:ctx.fillStyle});},
    measureText:(s:string)=>({width:s.length*6}),fillText(text:string,x:number,y:number){texts.push({text,x,y,color:ctx.fillStyle});}};
  const args={bounds:{top:0,height:200},scale:{},theme:{fontFamily:"sans-serif"},coords:{width:1000,priceToY:project}} as unknown as RendererLayerArgs;
  paintTpoMarkers(ctx as unknown as CanvasRenderingContext2D,args,session,{...style,...patch},left,end);
  return {rectangles,texts};
}
it("places colored rounded tags wholly to the left of their session, at exact price anchors",()=>{
  const d=draw();expect(d.texts.map(t=>t.text)).toEqual(["POC 0.25","VAH 0.3","VAL 0.2"]);
  expect(d.texts.map(t=>t.y)).toEqual([125,150,100]);
  for(const r of d.rectangles)expect(r.x+r.width).toBe(198);
  expect(d.rectangles.map(r=>r.color)).toEqual(["rgba(255,255,255,0.95)","rgba(0,0,0,0.95)","rgba(0,0,0,0.95)"]);
  expect(d.texts.map(t=>t.color)).toEqual(["#131722","#ffffff","#ffffff"]);
});
it("omits parent-disabled labels without discarding their saved label switches",()=>{
  expect(draw({pocVisible:false}).texts.map(t=>t.text)).toEqual(["VAH 0.3","VAL 0.2"]);
  expect(draw({valueAreaVisible:false}).texts.map(t=>t.text)).toEqual(["POC 0.25"]);
  expect(draw({pocVisible:false,valueAreaVisible:false}).texts).toEqual([]);
  expect(style.pocLabelVisible).toBe(true);
  expect(tpoOverlayInputVisible("pocLabelVisible",{pocVisible:false})).toBe(false);
  for(const key of ["vahLabelVisible","valLabelVisible"])expect(tpoOverlayInputVisible(key,{valueAreaVisible:false})).toBe(false);
});
it("preserves POC/VAH/VAL collision priority and never shifts a tag to another price",()=>{
  expect(draw({},()=>50).texts.map(t=>[t.text,t.y])).toEqual([["POC 0.25",50]]);
  expect(draw({pocVisible:false},()=>50).texts.map(t=>[t.text,t.y])).toEqual([["VAH 0.3",50]]);
  expect(layoutTpoPriceTags([{y:50,name:"POC"},{y:63,name:"VAH"},{y:64,name:"VAL"}],0,100,14).map(t=>t.name)).toEqual(["POC","VAL"]);
});
it("respects inverted axes, off-pane prices and the reference minimum profile width",()=>{
  expect(draw({},p=>200-p*500).texts.map(t=>t.y)).toEqual([75,50,100]);
  expect(draw({},()=>201).texts).toEqual([]);
  expect(draw({},()=>NaN).texts).toEqual([]);
  expect(draw({},undefined,200,309).texts).toEqual([]);
  expect(draw({},undefined,200,310).texts.length).toBeGreaterThan(0);
});
it("formats tick decimals and POC half-ticks independently, keeping trailing zeros",()=>{
  expect(tpoTagPriceText(80341.5,.5)).toBe("80341.5");
  expect(tpoTagPriceText(80341,.01)).toBe("80341.00");
  expect(tpoTagPriceText(.00000012,.00000001)).toBe("0.00000012");
  expect(tpoTagPriceText(10,1)).toBe("10");
});
it("uses source structure colors for tag contrast even when manual TPO letter color differs",()=>{
  const d=draw({pocColor:"hsl(120,100%,50%)",valueAreaColor:"rgb(0,0,255)",textColorAuto:false,textColor:"#ff0000"});
  expect(d.rectangles.map(r=>r.color)).toEqual(["rgba(0,255,0,0.95)","rgba(0,0,255,0.95)","rgba(0,0,255,0.95)"]);
  expect(d.texts.map(t=>t.color)).toEqual(["#131722","#ffffff","#ffffff"]);
});
