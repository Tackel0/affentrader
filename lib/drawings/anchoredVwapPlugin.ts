import { getDrawingType, registerDrawingType, type Drawing, type Projector } from "@luxalgo/vela";
import { AnchoredVwapCache, type VwapSample } from "@/lib/orderflow/anchoredVwap";

interface NativeAnchoredVwap extends Drawing {
  vwap: { multiplier: number };
  cachedRange: { min: number; max: number } | null;
  cachedExtent: { min: number; max: number } | null;
  vwapNotice: string;
  series(projector: Projector): VwapSample[] | null;
}
const REGISTERED = Symbol.for("affentrader.anchored-vwap-construction.v1");
const caches = new Map<Drawing, { cache: AnchoredVwapCache; bars: number }>(); let retained = 0;
function cache(drawing: Drawing, bars: number) {
  const entry = caches.get(drawing) ?? { cache: new AnchoredVwapCache(), bars: 0 };
  retained += bars - entry.bars; entry.bars = bars; caches.delete(drawing); caches.set(drawing, entry);
  while (caches.size > 64 || retained > 250000) { const oldest = caches.keys().next().value!; retained -= caches.get(oldest)!.bars; caches.delete(oldest); }
  return entry.cache;
}
export function registerAnchoredVwapConstruction(): void {
  const entry = getDrawingType("anchoredvwap"); if (!entry) throw new Error("Native Anchored VWAP is unavailable.");
  if (Reflect.get(entry.create, REGISTERED)) return;
  const create: typeof entry.create = init => {
    const drawing = entry.create(init) as NativeAnchoredVwap;
    drawing.series = projector => {
      drawing.cachedRange = null; drawing.cachedExtent = null; drawing.vwapNotice = "";
      const anchor = drawing.anchors[0]; if (!anchor) return null;
      try {
        const bars = projector.barsInRange?.(-Infinity, Infinity) ?? [];
        const result = cache(drawing, Math.min(bars.length, 50000)).read(bars, anchor.time, drawing.vwap.multiplier);
        if (!result.samples.length) { drawing.vwapNotice = result.rows ? "VWAP unavailable: no positive volume after the anchor." : "No loaded bars at or after the VWAP anchor."; return null; }
        let min = Infinity, max = -Infinity;
        for (const sample of result.samples) { min = Math.min(min, sample.lower); max = Math.max(max, sample.upper); }
        drawing.cachedRange = { min, max }; drawing.cachedExtent = { min: result.samples[0].time, max: result.samples.at(-1)!.time };
        drawing.vwapNotice = `HLC3 VWAP · ${result.rows} loaded bars · volume ${Number(result.volume.toPrecision(7))}${result.zeroBars ? ` · ${result.zeroBars} zero-volume bars` : ""}`;
        return result.samples;
      } catch (error) { drawing.vwapNotice = `VWAP unavailable: ${error instanceof Error ? error.message : "Invalid data."}`; return null; }
    };
    return drawing;
  };
  Object.defineProperty(create, REGISTERED, { value: true }); registerDrawingType({ ...entry, create });
}
