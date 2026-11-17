import type { OHLCV } from "@/types/trading";
export type PriceTouchBar = Pick<OHLCV, "time" | "high" | "low">;
export interface PriceTouchReference { from: number; price: number }
export interface PriceRangeTouchReference { from: number; low: number; high: number }
function lowerBound<T>(values: readonly T[], value: number, key: (item: T) => number, afterEqual = false): number {
  let low = 0, high = values.length;
  while (low < high) { const middle = (low + high) >>> 1;
    if (key(values[middle]) < value || afterEqual && key(values[middle]) === value) low = middle + 1; else high = middle;
  }
  return low;
}
/** Earliest revealed candle at/after each reference's start whose inclusive
 * high/low contains its price. A gap over a price never proves a touch.
 * Reverse range assignment gives O((bars + references) log references). */
export function firstObservedPriceTouches(bars: readonly PriceTouchBar[], references: readonly PriceTouchReference[]): Array<number | null> {
  const result: Array<number | null> = references.map(() => null);
  if (!references.length || !bars.length) return result;
  const prices = [...new Set(references.map(r => r.price))].sort((a,b) => a-b);
  const pending = new Map<number, Array<{ reference: number; priceIndex: number }>>();
  references.forEach((reference,index) => {
    const from = lowerBound(bars, reference.from, b => b.time), queries = pending.get(from) ?? [];
    queries.push({ reference:index, priceIndex:lowerBound(prices,reference.price,v=>v) }); pending.set(from,queries);
  });
  const tree = new Int32Array(prices.length * 4).fill(-1);
  function assign(node:number,from:number,to:number,low:number,high:number,bar:number):void {
    if (high<=from || low>=to) return;
    if (low<=from && to<=high) { tree[node]=bar;return; }
    if (tree[node]!==-2) { tree[node*2]=tree[node*2+1]=tree[node];tree[node]=-2; }
    const middle=(from+to)>>>1;
    assign(node*2,from,middle,low,high,bar);assign(node*2+1,middle,to,low,high,bar);
  }
  function at(index:number):number {
    let node=1,from=0,to=prices.length;
    while (tree[node]===-2) { const middle=(from+to)>>>1;
      if(index<middle){node*=2;to=middle;}else{node=node*2+1;from=middle;}
    }
    return tree[node];
  }
  for(let index=bars.length-1;index>=0;index--){
    const bar=bars[index],low=lowerBound(prices,bar.low,v=>v),high=lowerBound(prices,bar.high,v=>v,true);
    if(low<high)assign(1,0,prices.length,low,high,index);
    for(const query of pending.get(index)??[]){const touched=at(query.priceIndex);result[query.reference]=touched<0?null:bars[touched].time;}
  }
  return result;
}

/** First later candle intersecting an inclusive price band. Sweep references by
 * upper edge, activating candles with low <= that edge. A temporal max-high tree
 * then finds the earliest eligible candle with high >= the lower edge. This is
 * O((bars + references) log bars) after sorting, without false gap crossings. */
export function firstObservedRangeTouches(bars: readonly PriceTouchBar[], references: readonly PriceRangeTouchReference[]): Array<number | null> {
  const result: Array<number | null> = references.map(() => null);
  if (!bars.length || !references.length) return result;
  const candles = bars.map((bar,index) => ({...bar,index})).filter(bar => Number.isFinite(bar.low) && Number.isFinite(bar.high) && bar.low <= bar.high).sort((a,b) => a.low-b.low || a.index-b.index);
  const queries = references.map((ref,index) => ({...ref,index})).filter(ref => Number.isFinite(ref.from) && Number.isFinite(ref.low) && Number.isFinite(ref.high) && ref.low <= ref.high).sort((a,b) => a.high-b.high);
  const tree = new Float64Array(bars.length * 4).fill(-Infinity);
  function add(node:number,lo:number,hi:number,index:number,high:number):void {
    if (hi-lo===1) { tree[node]=high; return; }
    const middle=(lo+hi)>>>1;
    if(index<middle)add(node*2,lo,middle,index,high);else add(node*2+1,middle,hi,index,high);
    tree[node]=Math.max(tree[node*2],tree[node*2+1]);
  }
  function first(node:number,lo:number,hi:number,start:number,low:number):number {
    if(hi<=start || tree[node]<low)return -1;
    if(hi-lo===1)return lo;
    const middle=(lo+hi)>>>1,left=first(node*2,lo,middle,start,low);
    return left>=0?left:first(node*2+1,middle,hi,start,low);
  }
  let cursor=0;
  for(const ref of queries){
    while(cursor<candles.length && candles[cursor].low<=ref.high){const candle=candles[cursor++];add(1,0,bars.length,candle.index,candle.high);}
    const start=lowerBound(bars,ref.from,bar=>bar.time),index=first(1,0,bars.length,start,ref.low);
    if(index>=0)result[ref.index]=bars[index].time;
  }
  return result;
}
