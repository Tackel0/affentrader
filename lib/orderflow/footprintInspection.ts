import type { FootprintBar, FootprintDeltaPath, FootprintVolumeMode, OHLCV } from "@/types/trading";
import { copyFootprintDeltaPath, validFootprintDeltaPath } from "./footprintDelta";
import { footprintDeltaPercent, footprintStacks, type FootprintStack } from "./footprintAnalysis";
import { detectFootprintBarSignals, detectTrappedParticipants, type FootprintBarSignal, type TrappedParticipantsSummary } from "./footprintSignals";
import { unfinishedAuctionRows } from "./unfinishedAuctions";
import { executionPriceGrid } from "./priceGrid";
import { footprintSideCount } from "./footprintCounts";
import { FOOTPRINT_CELL_VALUES, type FootprintCellValues } from "./footprintCells";
import { FOOTPRINT_MODES } from "./footprintModes";
import { footprintValueArea, type FootprintValueArea } from "./footprintValueArea";
import type { FootprintPocReference } from "./footprintPoc";
import type { FootprintStackedZone } from "./footprintStackedZones";
import { nextBucket } from "@/lib/market/intervals";
import { FOOTPRINT_FILTER_KEYS, validFootprintFilter, type FootprintVolumeFilters } from "./footprintFilters";
export interface FootprintInspectionSettings extends FootprintVolumeFilters { step: number; ratio: number; minimumVolume: number; ignoreZeroOpposite: boolean; minimumStackRows: number; averageTradeSize?: boolean; cellValues?: FootprintCellValues; volumeMode?: FootprintVolumeMode; volumeSplit?: boolean; instance?: string; valueAreaPercent?: number; valueAreaVisible?: boolean; pocExtend?: boolean }
export interface FootprintInspectionTarget { cell: string; symbol: string; timeframe: string; epoch: number; time: number; replay: boolean; replayThrough?: number; sourceStamp: string; instance?: string }
export interface FootprintInspectionRow { lower: number; upper: number; bid: number; ask: number; total: number; delta: number; buyImbalance: boolean; sellImbalance: boolean; poc: boolean; buyStack: boolean; sellStack: boolean; bidCount?: number | null; askCount?: number | null; bidAverage?: number | null; askAverage?: number | null; inValueArea?: boolean; displayFiltered?: boolean; buyStackRevisit?:number|null; sellStackRevisit?:number|null }
export interface FootprintInspection {
  version: 1; capturedAt: number; symbol: string; timeframe: string; time: number; replayThrough?: number; simulated: boolean; coverage: string;
  settings: Readonly<FootprintInspectionSettings>; volume: number; delta: number; poc: number | null;
  rows: readonly Readonly<FootprintInspectionRow>[]; stacks: readonly Readonly<FootprintStack>[];
  deltaPath?: Readonly<FootprintDeltaPath>;
  valueArea?: Readonly<FootprintValueArea>; pocReference?: Readonly<FootprintPocReference>;
  stackedZones?: readonly Readonly<FootprintStackedZone>[];
}
export function validInspectionSettings(value: FootprintInspectionSettings): boolean {
  return Number.isFinite(value.step) && value.step > 0 && Number.isFinite(value.ratio) && value.ratio >= 1 && value.ratio <= 20 &&
    Number.isFinite(value.minimumVolume) && value.minimumVolume >= 0 && typeof value.ignoreZeroOpposite === "boolean" && Number.isInteger(value.minimumStackRows) && value.minimumStackRows >= 2 && value.minimumStackRows <= 40 &&
    (value.averageTradeSize === undefined || typeof value.averageTradeSize === "boolean") && (value.cellValues === undefined || FOOTPRINT_CELL_VALUES.includes(value.cellValues)) &&
    (value.volumeMode === undefined || FOOTPRINT_MODES.includes(value.volumeMode)) && (value.volumeSplit === undefined || typeof value.volumeSplit === "boolean") &&
    (value.instance === undefined || /^fp[1-5]$/.test(value.instance)) &&
    (value.valueAreaPercent === undefined || Number.isFinite(value.valueAreaPercent) && value.valueAreaPercent >= 1 && value.valueAreaPercent <= 100) &&
    (value.valueAreaVisible === undefined || typeof value.valueAreaVisible === "boolean") && (value.pocExtend === undefined || typeof value.pocExtend === "boolean") &&
    FOOTPRINT_FILTER_KEYS.every(key => value[key] === undefined || validFootprintFilter(value[key]));
}
export function footprintInspectionStats(bar: FootprintBar, settings: FootprintInspectionSettings) {
  if (!validInspectionSettings(settings)) throw new Error("The painted footprint settings are unavailable.");
  const stacks = footprintStacks(bar, settings.step, settings.minimumStackRows);
  return { buyRows: bar.levels.filter(row => row.buyImbalance).length, sellRows: bar.levels.filter(row => row.sellImbalance).length,
    buyStacks: stacks.filter(stack => stack.side === "buy").length, sellStacks: stacks.filter(stack => stack.side === "sell").length, stacks };
}
/** Copy the actual painted rows once, when the user captures a candle. */
export function createFootprintInspection(bar: FootprintBar, settings: FootprintInspectionSettings,
  context: { symbol: string; timeframe: string; simulated: boolean; replayThrough?: number; coverage: string; deltaPath?: FootprintDeltaPath; pocReference?: FootprintPocReference; stackedZones?:readonly FootprintStackedZone[] }, capturedAt = Date.now()): FootprintInspection {
  if (!Number.isSafeInteger(capturedAt) || Math.abs(capturedAt) >= 8640000000000000 || !Number.isSafeInteger(bar.time) || Math.abs(bar.time) >= 8640000000000000 ||
    !Number.isFinite(bar.volume) || bar.volume < 0 || !Number.isFinite(bar.delta) || (!Number.isFinite(bar.poc) && !(Number.isNaN(bar.poc) && bar.levels.length > 0 && bar.levels.every(row => row.filtered === true))) || bar.levels.length > 100000) throw new Error("Footprint capture exceeds supported values or 100,000 price rows.");
  if (context.replayThrough !== undefined && (!Number.isSafeInteger(context.replayThrough) || context.replayThrough <= bar.time || Math.abs(context.replayThrough) >= 8640000000000000)) throw new Error("The completed Replay cutoff is unavailable.");
  if (context.deltaPath && !validFootprintDeltaPath(context.deltaPath, bar.time, context.replayThrough)) throw new Error("The observed Footprint delta path is invalid or exceeds the Replay boundary.");
  if (bar.levels.some((row, index) => index > 0 && row.price <= bar.levels[index - 1].price)) throw new Error("Footprint rows must be unique and ordered by price.");
  const stats = footprintInspectionStats(bar, settings), ordered = [...bar.levels], grid = executionPriceGrid(settings.step);
  const zoneKey=(side:string,lower:number,upper:number)=>`${side}:${lower}:${upper}`;
  const zones=new Map<string,FootprintStackedZone>();
  if(context.stackedZones){
    const expected=new Map(stats.stacks.map(stack=>[zoneKey(stack.side,stack.from,stack.to),stack]));
    if(context.stackedZones.length!==expected.size)throw new Error("The projected stacked zones no longer match this footprint.");
    for(const zone of context.stackedZones){
      const key=zoneKey(zone.side,zone.lower,zone.upper),stack=expected.get(key);
      if(!stack||stack.rows!==zone.rows||zone.time!==bar.time||zone.from!==nextBucket(context.timeframe,bar.time)||zones.has(key)||
        zone.touched!==null&&(!Number.isSafeInteger(zone.touched)||Math.abs(zone.touched)>=8640000000000000||zone.touched<zone.from||context.replayThrough!==undefined&&nextBucket(context.timeframe,zone.touched)>context.replayThrough))
        throw new Error("The stacked-zone reference is invalid or exceeds the completed Replay boundary.");
      zones.set(key,zone);
    }
  }
  const valueArea = settings.valueAreaPercent === undefined ? null : footprintValueArea(bar, settings.step, settings.valueAreaPercent, settings.averageTradeSize);
  if (context.pocReference) {
    const ref = context.pocReference, expected = footprintValueArea(bar, settings.step, 1, settings.averageTradeSize, true);
    if (!expected || ref.time !== bar.time || ref.lower !== expected.pocLow || ref.upper !== expected.pocHigh || ref.price !== expected.pocMid || ref.from !== nextBucket(context.timeframe, bar.time) ||
      ref.touched !== null && (!Number.isSafeInteger(ref.touched) || Math.abs(ref.touched) >= 8640000000000000 || ref.touched < ref.from ||
        context.replayThrough !== undefined && nextBucket(context.timeframe, ref.touched) > context.replayThrough))
      throw new Error("The observed POC reference is invalid or exceeds the completed Replay boundary.");
  }
  const buy = stats.stacks.filter(stack => stack.side === "buy"), sell = stats.stacks.filter(stack => stack.side === "sell"); let bi = 0, si = 0;
  const rows = ordered.map((row, index) => {
    const upper = row.upperPrice ?? grid.row(row.rowIndex ?? grid.index(row.price)).upper, total = row.buyVolume + row.sellVolume, delta = row.buyVolume - row.sellVolume;
    if (![row.price, upper, row.buyVolume, row.sellVolume, total, delta].every(Number.isFinite) || !(upper > row.price) || row.buyVolume < 0 || row.sellVolume < 0 || index > 0 && row.price <= ordered[index - 1].price) throw new Error("Footprint contains invalid or duplicate price rows.");
    while (buy[bi] && row.price >= buy[bi].to) bi++; while (sell[si] && row.price >= sell[si].to) si++;
    const bidCount = footprintSideCount(row, "sell"), askCount = footprintSideCount(row, "buy");
    const inBuy=!!buy[bi]&&row.price>=buy[bi].from&&upper<=buy[bi].to,inSell=!!sell[si]&&row.price>=sell[si].from&&upper<=sell[si].to;
    const buyZone=inBuy?zones.get(zoneKey("buy",buy[bi].from,buy[bi].to)):undefined,sellZone=inSell?zones.get(zoneKey("sell",sell[si].from,sell[si].to)):undefined;
    return Object.freeze({ lower: row.price, upper, bid: row.sellVolume, ask: row.buyVolume, total, delta, bidCount, askCount,
      bidAverage: bidCount === null ? null : bidCount > 0 ? row.sellVolume / bidCount : 0,
      askAverage: askCount === null ? null : askCount > 0 ? row.buyVolume / askCount : 0,
      buyImbalance: row.buyImbalance === true, sellImbalance: row.sellImbalance === true, poc: row.price === bar.poc,
      ...(valueArea ? { inValueArea: !row.filtered && index >= valueArea.lowIndex && index <= valueArea.highIndex } : {}),
      ...(row.filtered === undefined ? {} : { displayFiltered: row.filtered }),
      buyStack:inBuy,sellStack:inSell,...(buyZone?{buyStackRevisit:buyZone.touched}:{}),...(sellZone?{sellStackRevisit:sellZone.touched}:{}) });
  });
  return Object.freeze({ version: 1, capturedAt, symbol: context.symbol, timeframe: context.timeframe, time: bar.time,
    ...(context.replayThrough !== undefined ? { replayThrough: context.replayThrough } : {}), simulated: context.simulated, coverage: context.coverage,
    settings: Object.freeze({ step: settings.step, ratio: settings.ratio, minimumVolume: settings.minimumVolume, ignoreZeroOpposite: settings.ignoreZeroOpposite, minimumStackRows: settings.minimumStackRows,
      ...(settings.averageTradeSize === undefined ? {} : { averageTradeSize: settings.averageTradeSize }), ...(settings.cellValues === undefined ? {} : { cellValues: settings.cellValues }),
      ...(settings.volumeMode === undefined ? {} : { volumeMode: settings.volumeMode }), ...(settings.volumeSplit === undefined ? {} : { volumeSplit: settings.volumeSplit }), ...(settings.instance === undefined ? {} : { instance: settings.instance }),
      ...(settings.valueAreaPercent === undefined ? {} : { valueAreaPercent: settings.valueAreaPercent }), ...(settings.valueAreaVisible === undefined ? {} : { valueAreaVisible: settings.valueAreaVisible }), ...(settings.pocExtend === undefined ? {} : { pocExtend: settings.pocExtend }),
      ...Object.fromEntries(FOOTPRINT_FILTER_KEYS.flatMap(key => settings[key] === undefined ? [] : [[key, settings[key]]])) }),
    volume: bar.volume, delta: bar.delta, poc: Number.isFinite(bar.poc) ? bar.poc : null, rows: Object.freeze(rows), stacks: Object.freeze(stats.stacks.map(stack => Object.freeze({ ...stack }))),
    ...(valueArea ? { valueArea: Object.freeze({ ...valueArea }) } : {}), ...(context.pocReference ? { pocReference: Object.freeze({ ...context.pocReference }) } : {}),
    ...(context.stackedZones?{stackedZones:Object.freeze(context.stackedZones.map(zone=>Object.freeze({...zone})))}:{}),
    ...(context.deltaPath ? { deltaPath: copyFootprintDeltaPath(context.deltaPath) } : {}) });
}
export type FootprintRowFilter = "all" | "buy" | "sell" | "stacked" | "poc";
export function footprintInspectionPage(snapshot: FootprintInspection, filter: FootprintRowFilter, minimumVolume: number, page: number, ascending = false) {
  if (!["all", "buy", "sell", "stacked", "poc"].includes(filter) || !Number.isFinite(minimumVolume) || minimumVolume < 0 || !Number.isInteger(page) || page < 0) throw new Error("Choose a valid row filter, minimum volume and page.");
  const rows = snapshot.rows.filter(row => row.total >= minimumVolume && (filter === "all" || filter === "buy" && row.buyImbalance || filter === "sell" && row.sellImbalance || filter === "stacked" && (row.buyStack || row.sellStack) || filter === "poc" && row.poc));
  if (!ascending) rows.reverse(); const pages = Math.max(1, Math.ceil(rows.length / 50)), current = Math.min(page, pages - 1);
  return { total: rows.length, pages, page: current, rows: rows.slice(current * 50, current * 50 + 50) };
}
const csv = (value: string | number | boolean) => `"${String(value).replaceAll('"', '""')}"`;
/** Export all captured rows, independently of the UI's filter and page. */
export function footprintInspectionCsv(snapshot: FootprintInspection): string {
  const header = ["symbol", "timeframe", "candle_utc", "captured_utc", "replay_before_utc", "simulated", "row_size", "imbalance_ratio", "minimum_imbalance_volume", "ignore_zero_opposite", "minimum_stack_rows", "coverage", "lower", "upper_exclusive", "bid_sells", "ask_buys", "total", "delta", "buy_imbalance", "sell_imbalance", "poc", "buy_stack", "sell_stack"];
  const prefix = [snapshot.symbol, snapshot.timeframe, new Date(snapshot.time).toISOString(), new Date(snapshot.capturedAt).toISOString(), snapshot.replayThrough === undefined ? "" : new Date(snapshot.replayThrough).toISOString(), snapshot.simulated,
    snapshot.settings.step, snapshot.settings.ratio, snapshot.settings.minimumVolume, snapshot.settings.ignoreZeroOpposite, snapshot.settings.minimumStackRows, snapshot.coverage];
  const path = snapshot.deltaPath;
  header.push("observed_delta_max", "observed_delta_min", "ordered_delta_close", "observed_executions", "first_execution_utc", "last_execution_utc", "execution_ordering");
  header.push("bid_trade_count", "ask_trade_count", "bid_average_trade_size", "ask_average_trade_size", "average_shapes", "cell_values");
  header.push("display_mode", "volume_buy_sell_split", "footprint_instance");
  header.push("value_area_percent", "value_area_visible", "value_area_low", "value_area_high_exclusive", "in_value_area", "poc_extend", "poc_midpoint", "poc_first_observed_revisit_utc");
  header.push("projected_poc_midpoint", "display_filtered", ...FOOTPRINT_FILTER_KEYS.map(key => `filter_${key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`));
  header.push("buy_stack_projection_known","buy_stack_first_observed_revisit_utc","sell_stack_projection_known","sell_stack_first_observed_revisit_utc");
  const pathFields = path ? [path.high, path.low, path.close, path.executions, new Date(path.first).toISOString(), new Date(path.last).toISOString(), path.ordering] : Array<string>(7).fill("");
  return [header.map(csv).join(","), ...snapshot.rows.map(row => [...prefix, row.lower, row.upper, row.bid, row.ask, row.total, row.delta, row.buyImbalance, row.sellImbalance, row.poc, row.buyStack, row.sellStack, ...pathFields,
    row.bidCount ?? "", row.askCount ?? "", row.bidAverage ?? "", row.askAverage ?? "", snapshot.settings.averageTradeSize ?? false, snapshot.settings.cellValues ?? "auto", snapshot.settings.volumeMode ?? "bid-ask", snapshot.settings.volumeSplit ?? false, snapshot.settings.instance ?? "",
    snapshot.settings.valueAreaPercent ?? "", snapshot.settings.valueAreaVisible ?? "", snapshot.valueArea?.low ?? "", snapshot.valueArea?.high ?? "", row.inValueArea ?? "", snapshot.settings.pocExtend ?? "", snapshot.valueArea?.pocMid ?? "", snapshot.pocReference?.touched == null ? "" : new Date(snapshot.pocReference.touched).toISOString(),
    snapshot.pocReference?.price ?? "", row.displayFiltered ?? "", ...FOOTPRINT_FILTER_KEYS.map(key => snapshot.settings[key] ?? ""),
    row.buyStackRevisit!==undefined,row.buyStackRevisit==null?"":new Date(row.buyStackRevisit).toISOString(),row.sellStackRevisit!==undefined,row.sellStackRevisit==null?"":new Date(row.sellStackRevisit).toISOString()].map(csv).join(","))].join("\r\n");
}

export interface FootprintRowAnalytics {
  buyRatio: number | null;
  sellRatio: number | null;
}

export interface FootprintInspectionSummary {
  deltaPercent: number | null;
  buyImbalances: number;
  sellImbalances: number;
  signals: FootprintBarSignal[];
  trapped: TrappedParticipantsSummary;
  unfinishedHigh: number | null;
  unfinishedLow: number | null;
}

/** Computes exact contiguous-grid diagonal imbalance ratios per inspected price row. */
export function footprintInspectionRowMetrics(snapshot: FootprintInspection): Map<number, FootprintRowAnalytics> {
  const result = new Map<number, FootprintRowAnalytics>();
  if (!(snapshot.settings.step > 0) || !snapshot.rows.length) return result;
  const grid = executionPriceGrid(snapshot.settings.step);
  const byIndex = new Map<number, FootprintInspectionRow>();
  const rowIndices = new Map<number, number>();
  for (const row of snapshot.rows) {
    try {
      const idx = grid.index(row.lower);
      byIndex.set(idx, row);
      rowIndices.set(row.lower, idx);
    } catch { /* Non-grid rows report null diagonal ratios cleanly. */ }
  }
  for (const row of snapshot.rows) {
    const idx = rowIndices.get(row.lower);
    if (idx === undefined) {
      result.set(row.lower, { buyRatio: null, sellRatio: null });
      continue;
    }
    const below = byIndex.get(idx - 1);
    const above = byIndex.get(idx + 1);
    const buyRatio = !below || row.ask <= 0 ? null : below.bid > 0 ? row.ask / below.bid : Infinity;
    const sellRatio = !above || row.bid <= 0 ? null : above.ask > 0 ? row.bid / above.ask : Infinity;
    result.set(row.lower, { buyRatio, sellRatio });
  }
  return result;
}

/** Derives institutional bar telemetry from a captured FootprintInspection without mutating its frozen schema. */
export function footprintInspectionSummary(
  snapshot: FootprintInspection,
  candle?: Pick<OHLCV, "open" | "high" | "low" | "close">,
): FootprintInspectionSummary {
  const bar: FootprintBar = {
    time: snapshot.time,
    volume: snapshot.volume,
    delta: snapshot.delta,
    poc: snapshot.poc ?? NaN,
    levels: snapshot.rows.map((row) => ({
      price: row.lower,
      upperPrice: row.upper,
      buyVolume: row.ask,
      sellVolume: row.bid,
      buyImbalance: row.buyImbalance,
      sellImbalance: row.sellImbalance,
      imbalance: row.buyImbalance ? "buy" : row.sellImbalance ? "sell" : null,
      ...(row.displayFiltered !== undefined ? { filtered: row.displayFiltered } : {}),
    })),
  };
  const signals = detectFootprintBarSignals(bar, candle);
  const trapped = detectTrappedParticipants(bar, candle);
  const unfinished = unfinishedAuctionRows(bar, snapshot.settings.step, 0);
  const highAuction = unfinished.find((u) => u.side === "high");
  const lowAuction = unfinished.find((u) => u.side === "low");
  return {
    deltaPercent: footprintDeltaPercent({ delta: snapshot.delta, volume: snapshot.volume }),
    buyImbalances: snapshot.rows.filter((r) => r.buyImbalance).length,
    sellImbalances: snapshot.rows.filter((r) => r.sellImbalance).length,
    signals,
    trapped,
    unfinishedHigh: highAuction ? highAuction.price : null,
    unfinishedLow: lowAuction ? lowAuction.price : null,
  };
}
