import type { FixedProfileResult } from "./fixedProfileModel";
import type { VisibleProfileSettings } from "./visibleProfile";

export interface VisibleProfileSnapshot {
  style?: VisibleProfileSettings; result?: FixedProfileResult | null;
  message: string; pending?: boolean; first?: number; last?: number;
}
export interface VisibleProfileSurface extends VisibleProfileSnapshot {
  id: string; symbol: string; timeframe: string; epoch: number; replay: boolean; replayThrough?: number | null;
  sourceStamp: string; viewport: { from: number; to: number } | null;
}
export interface VisibleProfileReadout {
  id: string; title: string; status: "ready" | "waiting" | "empty" | "unavailable";
  message: string; rows: Array<{ label: string; value: string }>;
}
const surfaces = new Map<string, Map<string, { token: symbol; surface: VisibleProfileSurface }>>();
export function publishVisibleProfileSurface(cell: string, token: symbol, surface: VisibleProfileSurface) {
  let entries = surfaces.get(cell); if (!entries) { entries = new Map(); surfaces.set(cell, entries); }
  entries.set(surface.id, { token, surface });
}
export function clearVisibleProfileSurface(cell: string, token: symbol) {
  const entries = surfaces.get(cell); if (!entries) return;
  for (const [id, entry] of entries) if (entry.token === token) entries.delete(id);
  if (!entries.size) surfaces.delete(cell);
}
const utc = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? new Date(value).toISOString() : "—";
const amount = (value: number) => Number.isFinite(value) ? value.toLocaleString("en-US", { maximumSignificantDigits: 12, useGrouping: false }) : "—";
export function visibleProfileStyleKey(style: VisibleProfileSettings) { return JSON.stringify(style); }
/** Inspect the painted viewport snapshot, not the crosshair candle or a second calculation. */
export function readVisibleProfileSurfaces(cell: string, context: {
  symbol: string; timeframe: string; epoch: number; replay: boolean; replayThrough?: number | null;
  sourceStamp?: string; viewport?: { from: number; to: number } | null; styles?: Record<string, string>;
}, nativeIds: readonly string[]): VisibleProfileReadout[] {
  const entries = surfaces.get(cell);
  return nativeIds.flatMap<VisibleProfileReadout>(id => {
    const surface = entries?.get(id)?.surface;
    if (!surface || surface.symbol !== context.symbol || surface.timeframe !== context.timeframe || surface.epoch !== context.epoch) return [];
    const base = { id, title: `Visible Range Volume Profile · ${surface.style?.rows ?? "?"} rows`, rows: [] };
    if (surface.replay !== context.replay || context.replay && (context.replayThrough == null || surface.replayThrough !== context.replayThrough) ||
      context.sourceStamp !== surface.sourceStamp || context.styles?.[id] !== (surface.style ? visibleProfileStyleKey(surface.style) : "invalid") ||
      !context.viewport || !surface.viewport || context.viewport.from !== surface.viewport.from || context.viewport.to !== surface.viewport.to)
      return [{ ...base, status: "waiting", message: "Waiting for the profile painted for the current viewport, settings and data source." }];
    const result = surface.result;
    if (!result) return [{ ...base, status: surface.pending ? "waiting" : surface.message.startsWith("Unavailable:") ? "unavailable" : "empty", message: surface.message }];
    if (!surface.style) return [{ ...base, status: "unavailable", message: surface.message }];
    const { profile } = result, classified = surface.style.volumeSource === "Classified executions";
    let area = 0; for (let i = profile.vaFrom; i <= profile.vaTo; i++) area += profile.rows[i].up + profile.rows[i].down;
    const rows = [
      { label: "Volume source", value: surface.style.volumeSource },
      { label: "First included candle (UTC)", value: utc(surface.first) }, { label: "Last included candle (UTC)", value: utc(surface.last) },
      { label: "Included candles", value: amount(result.bars) },
      ...(classified ? [
        { label: "First observed execution (UTC)", value: utc(result.firstTrade) }, { label: "Last observed execution (UTC)", value: utc(result.lastTrade) },
        { label: "Observed executions", value: amount(result.executions!) },
        { label: "Ask volume (buys)", value: amount(result.buys!) }, { label: "Bid volume (sells)", value: amount(result.sells!) },
        { label: "Observed volume", value: amount(result.total) }, { label: "Delta (Ask − Bid)", value: amount(result.delta!) },
        { label: "Delta %", value: result.total > 0 ? `${amount(result.delta! / result.total * 100)}%` : "—" },
      ] : [
        { label: "Estimated candle volume", value: amount(result.total) },
        { label: "Invalid candles excluded", value: amount(result.rejected) },
      ]),
      { label: "POC row [lower, upper)", value: `[${profile.edges[profile.poc]}, ${profile.edges[profile.poc + 1]})` },
      { label: "POC price", value: String(profile.centers[profile.poc]) },
      { label: "Value area [lower, upper)", value: `[${profile.edges[profile.vaFrom]}, ${profile.edges[profile.vaTo + 1]})` },
      { label: "Value area volume", value: amount(area) },
      { label: "Value area actual share", value: result.total > 0 ? `${amount(area / result.total * 100)}%` : "—" },
      { label: "Price rows", value: amount(profile.rows.length) },
    ];
    return [{ ...base, status: "ready", rows, message: `${result.simulated ? "SIMULATED · " : ""}${context.replay ? "REPLAY · " : ""}Whole visible-range snapshot, including partially visible end candles. These are not crosshair-candle values or historical signals. ${classified ? "Observed executions only; gaps remain unknown. " : "Candle volume distributed over high/low rows; candle direction is not aggressor side. "}${surface.message}` }];
  });
}
