import type { AlertDraft, PriceAlert, TpoAlertCandidate, TpoAlertLevel, TpoAlertReference } from "@/types/trading";
import { isValidInterval } from "@/lib/market/intervals";
import { isSymbolId } from "@/lib/symbolId";

const fields = ["symbol", "timeframe", "level", "sessionStart", "sessionEnd", "price"] as const;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
function validLevel(value: unknown): value is TpoAlertLevel {
  return record(value) && isSymbolId(value.symbol) && typeof value.timeframe === "string" && isValidInterval(value.timeframe) &&
    typeof value.level === "string" && ["poc", "vah", "val"].includes(value.level) && timestamp(value.sessionStart) && timestamp(value.sessionEnd) && value.sessionStart < value.sessionEnd &&
    typeof value.price === "number" && Number.isFinite(value.price) && value.price > 0;
}
export function validTpoAlertReference(value: unknown): value is TpoAlertReference {
  return validLevel(value) && record(value) && Object.keys(value).length === fields.length + 1 &&
    [...fields, "simulated"].every(key => Object.hasOwn(value, key)) && typeof value.simulated === "boolean";
}
/** Revalidate the selected value against this instant's revealed, completed references. */
export function tpoSnapshotDraft(selected: TpoAlertCandidate, available: readonly TpoAlertCandidate[], source: "exchange" | "simulation"): AlertDraft | null {
  if (!validLevel(selected) || !Number.isSafeInteger(selected.epoch) || selected.epoch < 0 ||
    !available.some(value => value.epoch === selected.epoch && fields.every(key => Object.is(value[key], selected[key])))) return null;
  return { symbol: selected.symbol, timeframe: selected.timeframe, price: selected.price, source: "tpo",
    name: `TPO ${selected.level.toUpperCase()} · ${new Date(selected.sessionStart).toISOString().slice(0, 10)}`,
    tpoReference: { symbol: selected.symbol, timeframe: selected.timeframe, price: selected.price, level: selected.level,
      sessionStart: selected.sessionStart, sessionEnd: selected.sessionEnd, simulated: source === "simulation" } };
}
/** A manually changed threshold or band has no exact TPO level provenance. */
export function retainedTpoReference(reference: unknown, alert: Pick<PriceAlert, "symbol" | "price" | "condition" | "simulated">): TpoAlertReference | undefined {
  return validTpoAlertReference(reference) && reference.symbol === alert.symbol && reference.price === alert.price && reference.simulated === alert.simulated &&
    ["crossing", "crossing_up", "crossing_down"].includes(alert.condition) ? reference : undefined;
}
export function tpoReferenceLabel(reference: TpoAlertReference): string {
  return `Fixed TPO ${reference.level.toUpperCase()} · ${reference.timeframe} · ${new Date(reference.sessionStart).toISOString()} – ${new Date(reference.sessionEnd).toISOString()} · ${reference.simulated ? "simulation" : "market"}`;
}
