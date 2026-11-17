import type { Tick, FootprintBar, FootprintLevel, FootprintDeltaPath } from "@/types/trading";
import { bucketStart, isTickInterval, parseInterval } from "@/lib/market/intervals";
import { DerivedTransformError } from "@/lib/chart/transformCapacity";
import { executionPriceGrid } from "./priceGrid";
import { footprintRows } from "./math";
import { DeltaPath } from "./deltaPath";
import { addFootprintCount } from "./footprintCounts";

interface Bucket { trades: Map<string, Tick>; path: DeltaPath; first: number; last: number; deltaOutput?: FootprintDeltaPath }
interface Settings { step: number; ratio: number; minimumVolume?: number; ignoreZeroOpposite?: boolean }
interface GridBucket { rows: Map<number, FootprintLevel>; output?: FootprintBar }
interface View { settings: Settings; grid: ReturnType<typeof executionPriceGrid>; buckets: Map<number, GridBucket>; cached?: FootprintBar[] }
/** Cell-owned collected executions. Evict whole bars, never silently shave their volume. */
export class FootprintHistory {
  private buckets = new Map<number, Bucket>();
  private ids = new Set<string>();
  private floor = -Infinity;
  private source?: boolean;
  private views = new Map<string, View>();
  private rows = 0;
  private failure?: Error;
  private latest = -Infinity;
  private revision = 0;
  private visibleCache?: { key: string; bar: FootprintBar | null };
  dropped = 0;
  rejected = 0;
  constructor(readonly timeframe: string, private limits = { trades: 100000, bars: 20000, rows: 200000 }) {
    if (!parseInterval(timeframe) || isTickInterval(timeframe)) throw new Error("Footprints require a time interval.");
  }
  private reset() {
    this.buckets.clear(); this.ids.clear(); this.floor = -Infinity; this.rows = 0;
    this.views.clear(); this.failure = undefined; this.dropped = 0; this.rejected = 0;
    this.latest = -Infinity;
    this.revision++; this.visibleCache = undefined;
  }
  private fail(message: string): never {
    const error = new DerivedTransformError("capacity"); error.message = message;
    this.failure = error; throw error;
  }
  private insert(view: View, time: number, tick: Tick) {
    let bucket = view.buckets.get(time);
    if (!bucket) { bucket = { rows: new Map() }; view.buckets.set(time, bucket); }
    const index = view.grid.index(tick.price), { lower: price, upper: upperPrice } = view.grid.row(index);
    let level = bucket.rows.get(index);
    if (!level) {
      if (this.rows >= this.limits.rows) this.fail("Collected footprints exceed 200,000 price rows. Switch chart type to restart collection.");
      level = { price, upperPrice, rowIndex: index, buyVolume: 0, sellVolume: 0, imbalance: null };
      bucket.rows.set(index, level); this.rows++;
    }
    const field = tick.side === "buy" ? "buyVolume" : "sellVolume";
    const next = level[field] + tick.quantity;
    if (!Number.isFinite(next)) this.fail("Collected footprint quantity exceeds supported precision. Switch chart type to restart collection.");
    addFootprintCount(level, tick); level[field] = next; bucket.output = undefined; view.cached = undefined;
  }
  add(trades: readonly Tick[]) {
    if (this.failure) throw this.failure;
    try { this.ingest(trades); } catch (error) { this.failure = error instanceof Error ? error : new Error("Invalid footprint data."); throw this.failure; }
  }
  private ingest(trades: readonly Tick[]) {
    for (const tick of [...trades].sort((a, b) => a.time - b.time)) {
      if (!tick.id || typeof tick.id !== "string" || !Number.isFinite(tick.time) || Math.abs(tick.time) >= 8640000000000000 ||
        !Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.quantity) || tick.quantity <= 0 ||
        tick.side !== "buy" && tick.side !== "sell" || typeof tick.simulated !== "boolean") { this.rejected++; continue; }
      if (this.source !== undefined && this.source !== tick.simulated) {
        if (tick.time < this.latest) { this.rejected++; continue; }
        this.reset();
      }
      this.source = tick.simulated;
      this.latest = Math.max(this.latest, tick.time);
      const time = bucketStart(this.timeframe, tick.time);
      if (time <= this.floor || this.ids.has(tick.id)) continue;
      const bucket: Bucket = this.buckets.get(time) ?? { trades: new Map<string, Tick>(), path: new DeltaPath(), first: Infinity, last: -Infinity };
      const copy = { ...tick };
      bucket.trades.set(tick.id, copy); this.ids.add(tick.id); this.buckets.set(time, bucket);
      this.revision++;
      // Apply capacity before adding a row, so evictable old bars can free their grid entries.
      while (this.ids.size > this.limits.trades || this.buckets.size > this.limits.bars) {
        if (this.buckets.size === 1) this.fail("One footprint bar exceeds 100,000 collected trades. Use a shorter interval or switch chart type to restart collection.");
        let oldest = Infinity; for (const start of this.buckets.keys()) oldest = Math.min(oldest, start);
        const removed = this.buckets.get(oldest)!;
        for (const id of removed.trades.keys()) this.ids.delete(id);
        for (const view of this.views.values()) { this.rows -= view.buckets.get(oldest)?.rows.size ?? 0; view.buckets.delete(oldest); view.cached = undefined; }
        this.dropped += removed.trades.size;
        this.floor = Math.max(this.floor, oldest); this.buckets.delete(oldest);
      }
      if (this.buckets.has(time)) {
        try { bucket.path.add(copy); }
        catch { this.fail("Collected footprint delta path exceeds supported precision. Switch chart type to restart collection."); }
        bucket.first = Math.min(bucket.first, copy.time); bucket.last = Math.max(bucket.last, copy.time);
        bucket.deltaOutput = undefined;
        for (const view of this.views.values()) this.insert(view, time, copy);
      }
    }
  }
  read(settings: Settings, viewId = "default"): FootprintBar[] {
    if (this.failure) throw this.failure;
    try { return this.calculate(settings, viewId); }
    catch (error) { this.failure = error instanceof Error ? error : new Error("Invalid footprint grid."); throw this.failure; }
  }
  readDelta(time: number): FootprintDeltaPath | undefined {
    if (this.failure) throw this.failure;
    const bucket = this.buckets.get(time);
    if (!bucket?.trades.size) return;
    if (!bucket.deltaOutput) {
      const summary = bucket.path.read();
      bucket.deltaOutput = Object.freeze({ high: summary.high, low: summary.low, close: summary.total, executions: bucket.trades.size,
        first: bucket.first, last: bucket.last, ordering: "time-sequence-id" });
    }
    return bucket.deltaOutput;
  }
  /** One bounded aggregate grid from the shared deduplicated raw tape. It does
   * not allocate a sixth per-candle grid or sum already-filtered/mean rows. */
  readVisible(settings: Settings, times: readonly number[]): FootprintBar | null {
    if (this.failure) throw this.failure;
    if (!(settings.step > 0) || !Number.isFinite(settings.step) || !Number.isFinite(settings.ratio) || settings.ratio < 1 || !Number.isFinite(settings.minimumVolume ?? 0) || (settings.minimumVolume ?? 0) < 0) return null;
    const selected = [...new Set(times.filter(Number.isFinite))].sort((a, b) => a - b);
    const key = JSON.stringify([this.revision, settings, selected]);
    if (this.visibleCache?.key === key) return this.visibleCache.bar;
    const grid = executionPriceGrid(settings.step), rows = new Map<number, FootprintLevel>();
    for (const time of selected) for (const tick of this.buckets.get(time)?.trades.values() ?? []) {
      const index = grid.index(tick.price);
      let row = rows.get(index);
      if (!row) {
        if (rows.size >= this.limits.rows) throw new DerivedTransformError("capacity");
        const edges = grid.row(index); row = { price: edges.lower, upperPrice: edges.upper, rowIndex: index, buyVolume: 0, sellVolume: 0, imbalance: null }; rows.set(index, row);
      }
      addFootprintCount(row, tick);
      row[tick.side === "buy" ? "buyVolume" : "sellVolume"] += tick.quantity;
    }
    const bar = rows.size ? footprintRows(selected[0], rows, settings.ratio, settings) : null;
    this.visibleCache = { key, bar }; return bar;
  }
  clearVisible() { this.visibleCache = undefined; }
  visibleCoverage(times: readonly number[]) {
    return { observedCandles: [...new Set(times)].filter(time => (this.buckets.get(time)?.trades.size ?? 0) > 0).length };
  }
  /** Disabled instances release their grid rows while keeping the single shared tape. */
  retainViews(ids: readonly string[]) {
    const keep = new Set(ids);
    for (const [id, view] of this.views) if (!keep.has(id)) {
      for (const bucket of view.buckets.values()) this.rows -= bucket.rows.size;
      this.views.delete(id);
    }
  }
  private calculate(settings: Settings, viewId: string): FootprintBar[] {
    if (!Number.isFinite(settings.ratio) || settings.ratio < 1 || !Number.isFinite(settings.minimumVolume ?? 0) || (settings.minimumVolume ?? 0) < 0) return [];
    let view = this.views.get(viewId);
    const previous = view?.settings;
    if (!view || !previous || previous.step !== settings.step) {
      if (view) for (const bucket of view.buckets.values()) this.rows -= bucket.rows.size;
      if (!view && this.views.size >= 5) this.fail("Footprints support at most five independent price grids.");
      view = { grid: executionPriceGrid(settings.step), settings: { ...settings }, buckets: new Map() };
      this.views.set(viewId, view);
      for (const [time, bucket] of this.buckets) for (const tick of bucket.trades.values()) this.insert(view, time, tick);
    } else if (previous.ratio !== settings.ratio || previous.minimumVolume !== settings.minimumVolume || previous.ignoreZeroOpposite !== settings.ignoreZeroOpposite) {
      view.settings = { ...settings }; view.cached = undefined;
      for (const bucket of view.buckets.values()) bucket.output = undefined;
    }
    return view.cached ??= [...view.buckets.entries()].sort((a, b) => a[0] - b[0]).map(([time, bucket]) =>
      bucket.output ??= footprintRows(time, bucket.rows, settings.ratio, settings));
  }
  get coverage() { return { trades: this.ids.size, bars: this.buckets.size, dropped: this.dropped, rejected: this.rejected,
    first: this.buckets.size ? Math.min(...this.buckets.keys()) : null, simulated: this.source === true }; }
}
