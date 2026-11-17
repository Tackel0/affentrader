import type { InputSchema, InputValue, NativeIndicatorContext, NativeIndicatorDescriptor, RendererLayerArgs } from "@luxalgo/vela";
import { resolveTpo, tpoSettings } from "./tpoSettings";
import { emptyTpoOperations } from "./tpoOperations";
import { paintTpoSessions } from "./tpoRenderer";
import type { TpoSession } from "./tpoModel";
import type { TpoPreferences } from "./tpoSettings";
import type { TpoTouches } from "./tpoReferenceTouches";
import type { TpoMetrics } from "./tpoMetrics";
export const TPO_OVERLAY_ID = "af-tpo-overlay";
const text = (value: string | { defaultMessage: string }) => typeof value === "string" ? value : value.defaultMessage;
const calculation = new Set(["tradingHours", "customStart", "customEnd", "sessionPeriod", "sessionZone", "sessionStartMinutes", "sessionMinutes", "weekdaysOnly", "blockMinutes", "ibMinutes", "ibExtensionPercent", "rowSize", "targetRows", "valueAreaPercent"]);
/** Derive study controls from the chart-type schema so the two surfaces cannot
 * silently drift when another TPO display/structure option is introduced. */
export function tpoOverlayInputs(): InputSchema[] {
  const inputs: InputSchema[] = []; let group = "";
  for (const row of tpoSettings().rows ?? []) {
    if (row.kind === "heading") group = text(row.label);
    if (!("key" in row) || row.key === "candlesVisible") continue;
    if (row.kind === "number" || row.kind === "toggle" || row.kind === "select" || row.kind === "color") {
      inputs.push({ key: row.key, title: text(row.label), type: row.kind === "toggle" ? "bool" : row.kind === "color" ? "color" : row.kind === "select" ? "string" : row.key === "rowSize" ? "float" : "int",
        defval: row.defval, group, ...(!calculation.has(row.key) ? { tab: "Style" } : {}),
        ...(row.kind === "number" ? { min: row.min, max: row.max, step: row.step } : {}),
        ...(row.kind === "select" ? { options: row.options.map(option => typeof option === "string" ? option : option[0]) } : {}) });
      if ("colors" in row) for (const color of row.colors ?? []) inputs.push({ key: color.key, title: text(color.label), type: "color", defval: color.defval, tab: "Style", group });
    }
  }
  return inputs;
}
export function resolveTpoOverlay(values: Record<string, unknown>) {
  return { ...resolveTpo(values), candlesVisible: false, sessionOperations: emptyTpoOperations() };
}
export function paintTpoOverlay(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, sessions: readonly TpoSession[], style: TpoPreferences, touches?: TpoTouches, metrics?: TpoMetrics) {
  return paintTpoSessions(ctx, { ...args, priceStyle: "tpo" }, sessions, { ...style, candlesVisible: false }, touches, args.bars, metrics);
}
export function tpoOverlayInputVisible(key: string, values: Record<string, unknown>): boolean {
  const row = (tpoSettings().rows ?? []).find(row => "key" in row && row.key === key);
  if (!row || !("when" in row) || !row.when) return true;
  const defaults = resolveTpoOverlay({}) as unknown as Record<string, unknown>;
  const conditions = "key" in row.when ? [row.when] : row.when;
  return conditions.every(condition => {
    const value = values[condition.key] ?? defaults[condition.key];
    return condition.anyOf ? condition.anyOf.includes(value as InputValue) : value === condition.equals;
  });
}
export interface TpoOverlayChannel { id: string; symbol: string; timeframe: string; live: boolean; values: Record<string, InputValue> }
export function tpoOverlayDescriptor(): NativeIndicatorDescriptor {
  return { type: TPO_OVERLAY_ID, title: "Time Price Opportunity", shortTitle: "TPO overlay", overlay: true, paneHint: "price", multiInstance: true,
    inputsSchema: tpoOverlayInputs, defaultInputs: () => Object.fromEntries(tpoOverlayInputs().map(input => [input.key, input.defval])),
    create: () => {
      let context: NativeIndicatorContext | undefined, values: Record<string, InputValue> = {}, active = false;
      const publish = () => { if (active && context) context.pushData({ id: context.id, symbol: context.symbol, timeframe: context.timeframe, live: context.live, values: { ...values } } satisfies TpoOverlayChannel); };
      return {
        start(ctx, inputs) { context = ctx; values = inputs; active = true; ctx.emit({}); publish(); },
        onBars() {}, onViewport() {}, setInputs(inputs) { values = inputs; publish(); },
        suspend() { active = false; context?.pushData(null); }, resume() { active = true; publish(); },
        stop() { active = false; context?.pushData(null); context = undefined; },
      };
    } };
}
