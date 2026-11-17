import { firstObservedPriceTouches } from "./referenceTouches";
import type { OHLCV } from "@/types/trading";
import type { TpoSession } from "./tpoModel";
import { tpoReferenceLevels } from "./tpoReferenceLevels";

type Bar = Pick<OHLCV, "time" | "high" | "low">;
type Level = "poc" | "vah" | "val";
export type TpoTouches = ReadonlyMap<number, Readonly<Record<Level, number | null>>>;
const levels = ["poc", "vah", "val"] as const;
/** Same indexed inclusive-range lookup as session VP; retain the TPO-specific
 * complete-reference gate and its public per-session level map. */
export function tpoReferenceTouches(bars: readonly Bar[], sessions: readonly TpoSession[]): TpoTouches {
  const references = sessions.flatMap(session => { const value = tpoReferenceLevels(session); return value ? [value] : []; });
  const touches = firstObservedPriceTouches(bars, references.flatMap(reference => levels.map(level => ({ from:reference.from, price:reference[level] }))));
  return new Map(references.map((reference,index) => [reference.sessionStart, { poc:touches[index*3], vah:touches[index*3+1], val:touches[index*3+2] }]));
}
/** Skip all touch indexing on unchanged paint frames; inspect every contributing field for repairs. */
export function createTpoTouchCache() {
  let previous: readonly TpoSession[] | undefined, snapshot: Bar[] = [], result: TpoTouches = new Map();
  return { read(bars: readonly Bar[], sessions: readonly TpoSession[]): TpoTouches {
    if (previous !== sessions || snapshot.length !== bars.length || bars.some((bar, index) =>
      bar.time !== snapshot[index].time || bar.high !== snapshot[index].high || bar.low !== snapshot[index].low)) {
      result = tpoReferenceTouches(bars, sessions); previous = sessions;
      snapshot = bars.map(({ time, high, low }) => ({ time, high, low }));
    }
    return result;
  } };
}
