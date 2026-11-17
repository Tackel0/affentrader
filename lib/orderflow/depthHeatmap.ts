import type { OrderBook } from "@/types/trading";
import { validChartColor } from "@/lib/chart/appearance";
import { canonicalDecimal, executionPriceGrid } from "./priceGrid";
export interface DepthHeatmapSettings { sampleMs: number; retentionMinutes: number; rowSize: number; opacity: number; bidColor: string; askColor: string; logarithmic: boolean }
export const defaultDepthHeatmap = (): DepthHeatmapSettings => ({ sampleMs: 1000, retentionMinutes: 10, rowSize: 0, opacity: 55, bidColor: "#26a69a", askColor: "#ef5350", logarithmic: true });
export function depthHeatmapSettings(values: Record<string, unknown>): DepthHeatmapSettings {
  const result = defaultDepthHeatmap();
  for (const [key, min, max, integer] of [["sampleMs", 250, 10000, true], ["retentionMinutes", 1, 30, true], ["rowSize", 0, 1e12, false], ["opacity", 1, 90, true]] as const) {
    const value = values[key]; if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new Error(`Choose ${key} between ${min} and ${max}.`);
    result[key] = value;
  }
  for (const key of ["bidColor", "askColor"] as const) if (values[key] !== undefined) { if (!validChartColor(values[key])) throw new Error("Choose a valid depth color."); result[key] = values[key] as string; }
  if (typeof values.logarithmic === "boolean") result.logarithmic = values.logarithmic;
  return result;
}
export interface DepthHeatmapColumn { observedAt: number; exchangeTime: number; bids: ReadonlyArray<Readonly<{ price: number; quantity: number }>>; asks: ReadonlyArray<Readonly<{ price: number; quantity: number }>> }
export const MAX_DEPTH_COLUMNS = 600, MAX_DEPTH_HOLD_MS = 3000;
/** Last observed snapshot per sample interval, never a sum of repeated resting orders. */
export class DepthHeatmapCollection {
  private columns: DepthHeatmapColumn[] = [];
  private snapshot?: readonly DepthHeatmapColumn[];
  private lastExchange = -Infinity;
  private lastObserved = -Infinity;
  constructor(readonly symbol: string) {}
  add(book: OrderBook, now: number, settings: DepthHeatmapSettings): boolean {
    if (book.symbol !== this.symbol || book.simulated) return false;
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(book.time) || book.time > now + 1000 || now - book.time > 5000 || book.time < this.lastExchange || now < this.lastObserved) return false;
    if (!book.bids.length || !book.asks.length || book.bids.length > 50 || book.asks.length > 50) return false;
    const valid = (levels: OrderBook["bids"], bids: boolean) => levels.every((level, index) => Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.quantity) && level.quantity > 0 && (!index || (bids ? level.price < levels[index - 1].price : level.price > levels[index - 1].price)));
    if (!valid(book.bids, true) || !valid(book.asks, false) || book.bids[0].price >= book.asks[0].price) return false;
    const copy = (levels: OrderBook["bids"]) => Object.freeze(levels.map(level => Object.freeze({ price: level.price, quantity: level.quantity })));
    const column = Object.freeze({ observedAt: now, exchangeTime: book.time, bids: copy(book.bids), asks: copy(book.asks) });
    const last = this.columns.at(-1);
    if (last && Math.floor(last.observedAt / settings.sampleMs) === Math.floor(now / settings.sampleMs)) this.columns[this.columns.length - 1] = column;
    else this.columns.push(column);
    this.snapshot = undefined;
    this.lastExchange = book.time; this.lastObserved = now; this.prune(now, settings); return true;
  }
  prune(now: number, settings: DepthHeatmapSettings) {
    const cutoff = now - settings.retentionMinutes * 60000;
    let first = 0; while (first < this.columns.length && this.columns[first].observedAt < cutoff) first++;
    const remove = Math.max(first, this.columns.length - MAX_DEPTH_COLUMNS);
    if (remove > 0) {
      this.columns.splice(0, remove);
      this.snapshot = undefined;
    }
  }
  read(now: number, settings: DepthHeatmapSettings): readonly DepthHeatmapColumn[] {
    this.prune(now, settings);
    return this.snapshot ??= Object.freeze([...this.columns]);
  }
  latest(): DepthHeatmapColumn | undefined { return this.columns.at(-1); }
}
export interface DepthHeatmapCell { from: number; to: number; lower: number; upper: number; bid: number; ask: number }
export function depthHeatmapThrough(columns: readonly DepthHeatmapColumn[] | undefined, now: number): number | undefined {
  const last = columns?.at(-1);
  return last && Math.min(now, last.observedAt + MAX_DEPTH_HOLD_MS);
}
type DepthHeatmapModel = { cells: DepthHeatmapCell[]; step: number; max: number };
type ColumnProjection = { cells: DepthHeatmapCell[]; max: number };

function projectColumn(column: DepthHeatmapColumn, to: number, grid: ReturnType<typeof executionPriceGrid>): ColumnProjection {
  const rows = new Map<number, { bid: number; ask: number }>();
  for (const [side, levels] of [["bid", column.bids], ["ask", column.asks]] as const) for (const level of levels) {
    const key = grid.index(level.price), row = rows.get(key) ?? { bid: 0, ask: 0 };
    row[side] += level.quantity;
    if (!Number.isFinite(row[side])) throw new Error("Depth quantity exceeds supported precision.");
    rows.set(key, row);
  }
  const cells: DepthHeatmapCell[] = [];
  let max = 0;
  for (const [index, row] of rows) {
    const bounds = grid.row(index);
    cells.push({ from: column.observedAt, to, lower: bounds.lower, upper: bounds.upper, ...row });
    max = Math.max(max, row.bid, row.ask);
  }
  return { cells, max };
}

function projectDepth(columns: readonly DepthHeatmapColumn[], now: number, rowSize: number,
  readColumn: (column: DepthHeatmapColumn, to: number, grid: ReturnType<typeof executionPriceGrid>, step: number) => ColumnProjection): DepthHeatmapModel {
  const last = columns.at(-1); if (!last) return { cells: [], step: rowSize, max: 0 };
  let step = rowSize;
  if (!step) {
    const prices = [...last.bids, ...last.asks].map(level => level.price).sort((a, b) => a - b);
    step = Infinity;
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] === prices[i - 1]) continue;
      const lower = canonicalDecimal(prices[i - 1]), upper = canonicalDecimal(prices[i]);
      const exponent = Math.min(lower.exponent, upper.exponent);
      const difference = upper.coefficient * 10n ** BigInt(upper.exponent - exponent)
        - lower.coefficient * 10n ** BigInt(lower.exponent - exponent);
      step = Math.min(step, Number(`${difference}e${exponent}`));
    }
  }
  const grid = executionPriceGrid(step), cells: DepthHeatmapCell[] = []; let max = 0;
  columns.forEach((column, index) => {
    const to = Math.min(now, column.observedAt + MAX_DEPTH_HOLD_MS, columns[index + 1]?.observedAt ?? Infinity);
    if (to <= column.observedAt) return;
    const projected = readColumn(column, to, grid, step);
    cells.push(...projected.cells);
    max = Math.max(max, projected.max);
  });
  return { cells, step, max };
}

export function depthHeatmapCells(columns: readonly DepthHeatmapColumn[], now: number, style: DepthHeatmapSettings): DepthHeatmapModel {
  return projectDepth(columns, now, style.rowSize, projectColumn);
}

/** Keep at most one projection per retained immutable column and one viewport-independent model. */
export function createDepthHeatmapProjection() {
  const columnsCache = new WeakMap<DepthHeatmapColumn, { gridStep: number; to: number; model: ColumnProjection }>();
  let previous: { columns: readonly DepthHeatmapColumn[]; through: number; rowSize: number; model: DepthHeatmapModel } | undefined;
  return (columns: readonly DepthHeatmapColumn[], now: number, rowSize: number) => {
    const last = columns.at(-1);
    if (!last || !Object.isFrozen(columns)) return projectDepth(columns, now, rowSize, projectColumn);
    const through = depthHeatmapThrough(columns, now)!;
    if (previous?.columns === columns && previous.through === through && previous.rowSize === rowSize) return previous.model;
    const model = projectDepth(columns, through, rowSize, (column, to, grid, step) => {
      const known = columnsCache.get(column);
      if (known?.gridStep === step && known.to === to) return known.model;
      const model = projectColumn(column, to, grid);
      columnsCache.set(column, { gridStep: step, to, model });
      return model;
    });
    previous = { columns, through, rowSize, model };
    return model;
  };
}
