import type { SessionVolumeProfile } from "./volumeProfileModel";
import { firstObservedPriceTouches, type PriceTouchBar } from "./referenceTouches";
export interface ProfilePocExtension { from:number; price:number; touched:number|null }
export type ProfilePocExtensions = ReadonlyMap<number,ProfilePocExtension>;
export function createProfilePocExtensionCache() {
  let signature="",snapshot:PriceTouchBar[]=[],result:ProfilePocExtensions=new Map();
  return { read(bars:readonly PriceTouchBar[],sessions:readonly SessionVolumeProfile[]):ProfilePocExtensions {
    const revealed=bars.at(-1)?.time??-Infinity;
    const references=sessions.filter(s=>s.end<=revealed).map(s=>({start:s.start,from:s.end,
      price:s.rowGrid?.[s.valueArea.poc]?.center??s.rows[s.valueArea.poc].price+s.step/2}));
    const key=JSON.stringify(references);
    if(key!==signature||snapshot.length!==bars.length||bars.some((b,i)=>b.time!==snapshot[i].time||b.high!==snapshot[i].high||b.low!==snapshot[i].low)){
      const touches=firstObservedPriceTouches(bars,references);
      result=new Map(references.map((r,i)=>[r.start,{from:r.from,price:r.price,touched:touches[i]}]));
      signature=key;snapshot=bars.map(({time,high,low})=>({time,high,low}));
    }
    return result;
  } };
}
