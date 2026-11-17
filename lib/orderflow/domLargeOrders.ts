import type { LadderRow } from "./depthLadder";
export type DomHighlight={mode:"auto";multiplier:number}|{mode:"fixed";value:number};
export const defaultDomHighlight=():DomHighlight=>({mode:"auto",multiplier:3});
export function validDomHighlight(value:unknown):value is DomHighlight {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return v.mode==="auto" ? Object.keys(v).length===2&&[2,3,5,10,20].includes(v.multiplier as number)
    :v.mode==="fixed"&&Object.keys(v).length===2&&typeof v.value==="number"&&Number.isFinite(v.value)&&v.value>0;
}
export function domLargeThresholds(rows:readonly LadderRow[],settings:DomHighlight):{large:number;block:number}|null {
  if(!validDomHighlight(settings))throw new Error("Invalid DOM large-order settings.");
  const values=rows.flatMap(row=>[row.bid,row.ask].filter(q=>q>0&&Number.isFinite(q)&&row.price>0&&Number.isFinite(row.price)).map(q=>q*row.price));
  const typical=values.length>=6?[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]:null;
  const large=settings.mode==="fixed"?settings.value:typical===null?null:typical*settings.multiplier;
  return large!==null&&large>0?{large,block:5*large}:null;
}
export function domOrderTier(quantity:number,price:number,thresholds:ReturnType<typeof domLargeThresholds>):0|1|2 {
  if(!(quantity>0)||!Number.isFinite(quantity)||!(price>0)||!Number.isFinite(price)||!thresholds)return 0;
  const value=quantity*price;return value>=thresholds.block?2:value>=thresholds.large?1:0;
}
