import type { TpoSession } from "./tpoModel";
import { tpoIbMinutes, type TpoPreferences } from "./tpoSettings";
import { tpoIbExtension } from "./tpoIbExtension";
import { tpoReferenceLevels } from "./tpoReferenceLevels";
import type { TpoAlertCandidate } from "@/types/trading";
import type { TpoTouches } from "./tpoReferenceTouches";
import type { TpoVolumeLadder } from "./tpoVolumeLadder";
import { tpoTradingHoursBasis } from "./tpoTradingHours";
import type { MarketSessionCalendar } from "@/lib/market/sessionWindows";
import type { TpoMetrics } from "./tpoMetrics";

export interface TpoSeriesRange { first: number; last: number; count: number; high: number; low: number; open?: number; close?: number; volume?: number }
interface TpoContext { symbol: string; timeframe: string; epoch: number; replay: boolean; seriesRange?: TpoSeriesRange; style?: TpoPreferences }
interface TpoSurface extends TpoContext { sessions?: readonly TpoSession[]; style?: TpoPreferences; touches?: TpoTouches; ladders?: ReadonlyMap<number, TpoVolumeLadder>; metrics?: TpoMetrics; error?: string; pending?: string; sourceBasis?: string; sourceCalendar?: MarketSessionCalendar }
export interface TpoReadout { status: "ready" | "empty" | "waiting" | "error"; message: string; rows: Array<{ label: string; value: string }>; alertCandidates?: TpoAlertCandidate[] }
const surfaces = new Map<string, { token: symbol; surface: TpoSurface }>();
export function publishTpoSurface(cell: string, token: symbol, surface: TpoSurface): void { surfaces.set(cell, { token, surface }); }
export function clearTpoSurface(cell: string, token: symbol): void { if (surfaces.get(cell)?.token === token) surfaces.delete(cell); }
const utc = (time: number) => new Date(time).toISOString().replace("T", " ").replace(".000Z", " UTC");
const number = (value: number) => value.toLocaleString("en-US", { maximumSignificantDigits: 12 });
export function readTpoOverlaySurfaces(cell: string, context: TpoContext, time: number | undefined, ids: readonly string[]) {
  return ids.flatMap(id => {
    const key = `${cell}:${id}`;
    if (!surfaces.has(key)) return [];
    const readout = readTpoSurface(key, context, time);
    return [{ ...readout, id, title: "Time Price Opportunity" }];
  });
}
export function readTpoSurface(cell: string, context: TpoContext, time: number | undefined): TpoReadout {
  const surface = surfaces.get(cell)?.surface;
  if (!surface || surface.symbol !== context.symbol || surface.timeframe !== context.timeframe || surface.epoch !== context.epoch || surface.replay !== context.replay)
    return { status: "waiting", message: "Waiting for the current TPO calculation.", rows: [] };
  if (surface.error) return { status: "error", message: `TPO unavailable: ${surface.error}`, rows: [] };
  if (surface.pending) return { status: "waiting", message: surface.pending, rows: [] };
  if (context.style && (!surface.style || (Object.keys(context.style) as Array<keyof TpoPreferences>).some(key => key === "sessionOperations"
    ? JSON.stringify(context.style![key]) !== JSON.stringify(surface.style![key]) : !Object.is(context.style![key], surface.style![key]))))
    return { status: "waiting", message: "Waiting for the TPO model of the current profile settings.", rows: [] };
  if (!context.seriesRange || !surface.seriesRange || (["first", "last", "count", "high", "low", "open", "close", "volume"] as const).some(key => !Object.is(context.seriesRange![key], surface.seriesRange![key])))
    return { status: "waiting", message: "Waiting for the TPO model of the currently revealed chart history.", rows: [] };
  if (!Number.isFinite(time)) return { status: "waiting", message: "Select a loaded candle to inspect its TPO session.", rows: [] };
  const session = surface.sessions?.find(session => time! >= session.start && time! < session.end), style = surface.style;
  if (!session || !style) return { status: "empty", message: "No loaded TPO session at this candle's opening time. Missing history is not zero activity.", rows: [] };
  const { rows, coverage, valueArea } = session, poc = rows[valueArea.poc];
  const ladder = surface.ladders?.get(session.start), vp = ladder?.profile?.profile;
  const lower = poc.grid?.lower ?? poc.price, upper = poc.grid?.upper ?? poc.price + session.step;
  const last = rows[valueArea.high];
  const extension = style.ibExtensionVisible ? tpoIbExtension(session.initialBalance, style.ibExtensionPercent ?? 100) : null;
  const extended = style.extendPoc || style.extendVah || style.extendVal;
  const reference = extended ? [...(surface.sessions ?? [])].reverse().map(tpoReferenceLevels).find(value => value !== null) : null;
  const referenceTouch = reference ? surface.touches?.get(reference.sessionStart) : undefined;
  return { status: "ready", message: `${context.replay ? "REPLAY · " : ""}Loaded OHLC-derived TPO session snapshot, including revealed candles after the selected candle. These are time/price opportunities, not trade volume or historical signals.${coverage.missingSlots ? " Missing candle slots can understate opportunities." : ""}`,
    alertCandidates: !context.replay && reference ? (["poc", "vah", "val"] as const).filter(level =>
      style[level === "poc" ? "extendPoc" : level === "vah" ? "extendVah" : "extendVal"] && Number.isFinite(reference[level]) && reference[level] > 0)
      .map(level => ({ symbol: context.symbol, timeframe: context.timeframe, epoch: context.epoch, level,
        sessionStart: reference.sessionStart, sessionEnd: reference.from, price: reference[level] })) : [],
    rows: [
      { label: "Color row by", value: style.colorBy ?? "Time" },
      ...(style.colorBy && style.colorBy !== "Time" ? [
        { label: "Metric source", value: surface.metrics?.message ?? "Time coloring: no classified execution source." },
        { label: "Session metric coloring", value: !surface.metrics?.sessions.has(session.start) ? "Time fallback: no observed executions" : style.colorBy === "Trades count" && !surface.metrics.sessions.get(session.start)!.countsKnown ? "Time fallback: underlying print counts unknown" : `${style.colorBy}; unobserved rows use Time` },
      ] : []),
      ...(surface.sourceBasis ? [{ label: "TPO candle source", value: surface.sourceBasis }] : []),
      { label: "Trading hours", value: style.tradingHours ?? "Full day" },
      { label: "Trading hours basis", value: tpoTradingHoursBasis(style, context.symbol, surface.sourceCalendar) },
      ...((style.sessionPeriod ?? "Day") !== "Day" ? [{ label: "Session period", value: `${style.sessionPeriod} UTC` }] : []),
      { label: "Session start", value: utc(session.start) }, { label: "Session end (exclusive)", value: utc(session.end) },
      { label: "Session completion", value: session.completion.status },
      { label: "Expected session candle slots", value: number(session.completion.expectedBars) },
      { label: "Missing due session slots", value: number(session.completion.missingSlots) },
      ...(extended ? [
        { label: "Latest completed reference session", value: reference ? utc(reference.sessionStart) : "—" },
        { label: "Reference extension start", value: reference ? utc(reference.from) : "—" },
        ...(style.extendPoc ? [{ label: "Extended POC", value: reference ? String(reference.poc) : "—" }] : []),
        ...(style.extendVah ? [{ label: "Extended VAH", value: reference ? String(reference.vah) : "—" }] : []),
        ...(style.extendVal ? [{ label: "Extended VAL", value: reference ? String(reference.val) : "—" }] : []),
        ...(style.extensionUntilTouch ? (["poc", "vah", "val"] as const).filter(level =>
          style[level === "poc" ? "extendPoc" : level === "vah" ? "extendVah" : "extendVal"]).map(level => ({ label: `${level.toUpperCase()} first observed touch`,
            value: !reference ? "—" : !referenceTouch ? "Waiting for touch calculation" : referenceTouch[level] === null ? "None in loaded candles; gaps are unknown" : utc(referenceTouch[level]!) })) : []),
        ...(style.extensionUntilTouch ? [{ label: "Reference touch basis", value: "Loaded OHLC ranges; times label candle opens, not exact intrabar contact" }] : []),
      ] : []),
      { label: "First loaded candle", value: utc(coverage.firstBar) }, { label: "Last loaded candle", value: utc(coverage.lastBar) },
      { label: "Loaded candle slots", value: number(coverage.loadedBars) }, { label: "Missing slots through last candle", value: number(coverage.missingSlots) },
      { label: "Session opening loaded", value: session.partialStart ? "No" : "Yes" }, { label: "Block length", value: `${style.blockMinutes} min` },
      { label: "Session open price", value: session.markers?.open.price === null || !session.markers ? "—" : String(session.markers.open.price) },
      { label: "Session open price status", value: session.markers?.open.status ?? "missing" },
      { label: "Last loaded close", value: session.markers?.close.price === null || !session.markers ? "—" : String(session.markers.close.price) },
      { label: "Close marker status", value: session.markers?.close.status !== "observed" ? session.markers?.close.status ?? "missing" : session.completion.status === "complete" ? "complete" : "last observed; final close unproven" },
      { label: "Observed range midpoint", value: session.markers ? String(session.markers.midpoint) : "—" },
      { label: "Observed blocks", value: number(coverage.observedBlocks) }, { label: "TPO opportunities", value: number(valueArea.total) },
      { label: "TPO arrangement", value: (session.expanded ?? style.splitPeriods) ? "Expanded into chart time columns" : "Packed session profile" },
      { label: "Composite sessions", value: String(session.members?.length ?? 1) },
      ...(style.ladderVisible ? [
        { label: "Volume ladder basis", value: ladder?.message ?? "Waiting for OHLCV estimate" },
        { label: "Volume ladder allocation status", value: ladder?.status ?? "waiting" },
        { label: "Volume ladder missing / invalid candles", value: `${ladder?.missing ?? 0} / ${ladder?.rejected ?? 0}` },
        { label: "Volume ladder observed candle volume", value: ladder?.profile ? number(ladder.profile.total) : "—" },
        { label: "Volume ladder rows", value: vp ? String(vp.rows.length) : "—" },
        { label: "Volume ladder POC", value: vp ? String(vp.centers[vp.poc]) : "—" },
        { label: "Volume ladder VAH", value: vp ? String(vp.edges[vp.vaTo + 1]) : "—" },
        { label: "Volume ladder VAL", value: vp ? String(vp.edges[vp.vaFrom]) : "—" },
      ] : []),
      { label: "POC row [lower, upper)", value: `[${lower}, ${upper})` }, { label: "POC price", value: String(poc.grid?.center ?? poc.price + session.step / 2) },
      { label: "POC opportunities", value: number(poc.count) }, { label: "Value area [lower, upper)", value: `[${rows[valueArea.low].price}, ${last.grid?.upper ?? last.price + session.step})` },
      { label: "Value area opportunities", value: number(valueArea.count) }, { label: "Value area actual share", value: `${number(valueArea.count / valueArea.total * 100)}%` },
      { label: "Rows visited by one block", value: number(rows.filter(row => row.count === 1).length) }, { label: "Price rows", value: number(rows.length) },
      { label: "Poor high row [lower, upper)", value: session.structure.poorHigh ? `[${session.structure.poorHigh.lower}, ${session.structure.poorHigh.upper})` : "—" },
      { label: "Poor high opportunities", value: session.structure.poorHigh ? number(session.structure.poorHigh.opportunities) : "—" },
      { label: "Poor low row [lower, upper)", value: session.structure.poorLow ? `[${session.structure.poorLow.lower}, ${session.structure.poorLow.upper})` : "—" },
      { label: "Poor low opportunities", value: session.structure.poorLow ? number(session.structure.poorLow.opportunities) : "—" },
      { label: "Interior single-print zones", value: number(session.structure.singlePrintZones.length) },
      { label: "Interior single-print rows", value: number(session.structure.singlePrintZones.reduce((count, zone) => count + zone.rows, 0)) },
      ...session.structure.singlePrintZones.map((zone, index) => ({ label: `Single-print zone ${index + 1} [lower, upper)`, value: `[${zone.lower}, ${zone.upper}) · ${zone.rows} ${zone.rows === 1 ? "row" : "rows"}` })),
      { label: "Initial balance status", value: session.initialBalance.status },
      { label: "Initial balance duration", value: `${tpoIbMinutes(style)} min (clamped at session end)` },
      { label: "Initial balance source", value: "Whole loaded candles inside the opening window; unaligned or missing slots remain incomplete" },
      { label: "Initial balance end (exclusive)", value: utc(session.initialBalance.end) },
      { label: "Initial balance loaded / expected slots", value: `${session.initialBalance.loadedBars} / ${session.initialBalance.expectedBars}` },
      { label: "Initial balance missing revealed slots", value: number(session.initialBalance.missingSlots) },
      { label: "Initial balance low", value: session.initialBalance.low === null ? "—" : String(session.initialBalance.low) },
      { label: "Initial balance high", value: session.initialBalance.high === null ? "—" : String(session.initialBalance.high) },
      { label: "Initial balance range", value: session.initialBalance.range === null ? "—" : String(session.initialBalance.range) },
      ...(extension ? [
        { label: "IB extension status", value: extension.status },
        { label: "IB extension beyond range", value: `${style.ibExtensionPercent ?? 100}%` },
        { label: "IB extension upper", value: extension.upper === null ? "—" : String(extension.upper) },
        { label: "IB extension lower", value: extension.lower === null ? "—" : String(extension.lower) },
      ] : []),
    ] };
}
