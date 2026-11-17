import type { VolumeProfileContext, VolumeProfilePayload } from "./volumeProfileRenderer";

interface ProfileSurface { context: VolumeProfileContext; payload: VolumeProfilePayload }
export interface SessionProfileReadout {
  id: string; title: string; status: "ready" | "empty" | "pending" | "replay" | "unavailable";
  message: string; rows: Array<{ label: string; value: string }>;
}
const surfaces = new Map<string, Map<string, { token: symbol; surface: ProfileSurface }>>();
export function publishSessionProfileSurface(cell: string, token: symbol, surface: ProfileSurface): void {
  let studies = surfaces.get(cell); if (!studies) { studies = new Map(); surfaces.set(cell, studies); }
  studies.set(surface.context.id, { token, surface });
}
export function clearSessionProfileSurface(cell: string, token: symbol): void {
  const studies = surfaces.get(cell); if (!studies) return;
  for (const [id, entry] of studies) if (entry.token === token) studies.delete(id);
  if (!studies.size) surfaces.delete(cell);
}
const format = (value: number) => Number.isFinite(value) ? value.toLocaleString("en-US", { maximumSignificantDigits: 12 }) : "—";
const utc = (time: number) => new Date(time).toISOString().replace("T", " ").replace(".000Z", " UTC");

/** Read whole-session observations at the native candle timestamp; never manufacture candle-level volume. */
export function readSessionProfileSurfaces(cell: string, context: { symbol: string; timeframe: string; epoch: number; replay: boolean; replayThrough?: number | null },
  time: number | undefined, nativeIds: readonly string[]): SessionProfileReadout[] {
  const studies = surfaces.get(cell); if (!studies) return [];
  return nativeIds.flatMap<SessionProfileReadout>(id => {
    const surface = studies.get(id)?.surface;
    if (!surface || surface.context.symbol !== context.symbol || surface.context.timeframe !== context.timeframe || surface.context.epoch !== context.epoch) return [];
    const { payload } = surface, { style, model } = payload;
    const rolling = surface.context.kind === "rolling", scope = rolling ? "Window" : "Session";
    const basis = (style.sessionPeriod ?? "Day") === "Day" ? style.tradingHours && style.tradingHours !== "Full day" ? style.tradingHours : style.sessionZone : `${style.sessionPeriod} UTC`;
    const base = { id, title: rolling ? `Rolling Volume Profile · ${style.rows} rows` : `Session Volume Profile · ${style.rowSize ? `row ${style.rowSize}` : `${style.rows} rows`} · ${basis}`, rows: [] };
    if (context.replay ? context.replayThrough == null || surface.context.live || surface.context.replayThrough !== context.replayThrough : !surface.context.live)
      return [{ ...base, status: "replay" as const, message: "Replay: waiting for recorded executions at the current completed-bar boundary." }];
    if (context.replay && time !== undefined && time >= context.replayThrough!) return [{ ...base, status: "replay" as const, message: "This Replay candle is still forming; session quantities exclude its executions." }];
    if (payload.message) return [{ ...base, status: payload.pending ? "pending" as const : "unavailable" as const, message: payload.message }];
    if (!model || !Number.isFinite(time)) return [{ ...base, status: "unavailable" as const, message: "Waiting for the current profile and selected candle." }];
    const session = model.sessions.find(session => time! >= session.start && time! < session.end);
    if (!session) return [{ ...base, status: "empty" as const, message: rolling ? "This candle is outside the current rolling window. Historical rolling snapshots are not reconstructed from the current range." : "No collected session profile at this candle's opening time. Missing history is not zero volume." }];
    let buys = 0, sells = 0;
    for (const row of session.rows) { buys += row.buy; sells += row.sell; }
    const total = session.valueArea.total, delta = buys - sells, poc = session.valueArea.poc;
    const lower = session.rowGrid?.[poc]?.lower ?? session.rows[poc].price;
    const upper = session.rowGrid?.[poc]?.upper ?? lower + session.step;
    const val = session.rows[session.valueArea.low].price, high = session.valueArea.high;
    const vah = session.rowGrid?.[high]?.upper ?? session.rows[high].price + session.step;
    const extension=payload.pocExtensions?.get(session.start);
    const developing = !rolling && session.developing?.find(point => time! >= point.time && time! < point.through);
    return [{ ...base, status: "ready" as const,
      message: rolling ? `${model.source === "simulation" ? "SIMULATED · " : ""}Current rolling window snapshot; partial classified observations. These quantities include trades after the selected candle${context.replay ? " only through the completed Replay boundary" : ""}. They are not historical rolling-window signals or candle volumes. ${payload.summary ?? ""}` : `${model.source === "simulation" ? "SIMULATED · " : ""}Partial collected session snapshot${payload.pending ? " · updating" : ""}. Values cover the collected session${context.replay ? " only through the current Replay boundary" : ""}, including trades after the selected candle; they are not candle volume or historical signals.${payload.sourceLabel ? ` ${payload.sourceLabel}.` : ""}`,
      rows: [
        ...(!rolling ? [{label:"Trading hours",value:(style.sessionPeriod??"Day")==="Day"?style.tradingHours??"Full day":"Not applied to Week/Month"},
          ...(payload.hoursBasis?[{label:"Trading hours basis",value:payload.hoursBasis}]:[])] : []),
        { label: `${scope} start`, value: utc(session.start) }, { label: `${scope} end (exclusive)`, value: utc(session.end) },
        { label: "First collected execution", value: utc(session.firstTrade) }, { label: "Last collected execution", value: utc(session.lastTrade) },
        { label: "Collected executions", value: format(session.tradeCount) },
        { label: "Ask volume (buys)", value: format(buys) }, { label: "Bid volume (sells)", value: format(sells) },
        { label: `${scope} collected volume`, value: format(total) }, { label: `${scope} delta (Ask − Bid)`, value: format(delta) },
        { label: `${scope} delta %`, value: total > 0 ? `${format(delta / total * 100)}%` : "—" },
        { label: "POC row [lower, upper)", value: `[${lower}, ${upper})` },
        { label: "POC price", value: String(session.rowGrid?.[poc]?.center ?? lower + session.step / 2) },
        ...(!rolling && style.showPoc && style.extendPoc ? [
          {label:"Observed POC extension start",value:extension?utc(extension.from):"No revealed candle after this session ended"},
          {label:"First observed POC touch",value:!extension?"—":extension.touched===null?"None in revealed candles; gaps unknown":utc(extension.touched)},
          {label:"POC touch basis",value:"Inclusive OHLC ranges at/after session end; candle opening time, not an intrabar execution time"},
        ]:[]),
        { label: "Value area [lower, upper)", value: `[${val}, ${vah})` },
        ...(!rolling && (style.showDevelopingPoc || style.showDevelopingValueArea) ? [
          { label: "Developing basis", value: "Collected executions through the selected candle, on the current session grid; later extrema can rebin earlier points. Not a historical signal." },
          { label: "Developing candle volume (cumulative)", value: developing ? format(developing.volume) : "No collected executions in this candle" },
          ...(style.showDevelopingPoc ? [{ label: "Developing POC", value: developing ? String(developing.poc) : "—" }] : []),
          ...(style.showDevelopingValueArea ? [{ label: "Developing VA [lower, upper)", value: developing ? `[${developing.val}, ${developing.vah})` : "—" }] : []),
        ] : []),
        { label: "Value area collected volume", value: format(session.valueArea.volume) },
        { label: "Value area actual share", value: total > 0 ? `${format(session.valueArea.volume / total * 100)}%` : "—" },
        { label: "Price rows", value: format(session.rows.length) },
      ] }];
  });
}
