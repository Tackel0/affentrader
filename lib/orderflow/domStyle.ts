export const DOM_ZOOMS=[70,80,90,100,110,120,130,140,150] as const;
export interface DomColors {bid:string|null;ask:string|null}
export const defaultDomColors=():DomColors=>({bid:null,ask:null});
export const validDomColor=(value:unknown):value is string=>typeof value==="string"&&/^#[0-9a-f]{6}$/i.test(value);
export function validDomColors(value:unknown):value is DomColors {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).length===2&&Object.hasOwn(v,"bid")&&Object.hasOwn(v,"ask")&&[v.bid,v.ask].every(c=>c===null||validDomColor(c));
}
export function domStyle(zoom:number,colors:DomColors=defaultDomColors()) {
  if(!(DOM_ZOOMS as readonly number[]).includes(zoom)||!validDomColors(colors))throw new Error("Invalid DOM style settings.");
  const pixels=(base:number)=>Math.round(base*zoom/100),text=(base:number)=>Math.round(base*zoom)/100;
  const bid=colors.bid??"#089981",ask=colors.ask??"#f23645";
  const alpha=(hex:string,value:number)=>`rgba(${parseInt(hex.slice(1,3),16)}, ${parseInt(hex.slice(3,5),16)}, ${parseInt(hex.slice(5,7),16)}, ${value})`;
  return {row:pixels(20),head:pixels(26),text:text(12),headText:text(11),chip:pixels(16),chipText:text(10.5),bid,ask,
    bid14:alpha(bid,.14),bid30:alpha(bid,.3),bid60:alpha(bid,.6),ask14:alpha(ask,.14),ask30:alpha(ask,.3),ask60:alpha(ask,.6)};
}
export function domVisibleRows(height:number,metrics:{row:number;head:number}) {
  return Math.max(5,Math.min(101,Math.floor((height-metrics.head)/metrics.row)));
}
