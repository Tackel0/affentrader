import type { PineAlertSnapshot, PineAlertInspection, PineOrderFill } from "@/types/pineAlerts";
import { CHART_TYPE_IDS } from "@/lib/chart/chartTypes";
import { isValidZone } from "@/lib/timezones";
export function isPineOrderFill(value: unknown): value is PineOrderFill {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fill = value as PineOrderFill;
  return typeof fill.id === "string" && fill.id.length > 0 && fill.id.length <= 300 &&
    typeof fill.orderId === "string" && fill.orderId.length <= 2000 && ["buy", "sell"].includes(fill.action) &&
    Number.isFinite(fill.contracts) && fill.contracts > 0 && Number.isFinite(fill.price) &&
    Number.isFinite(fill.positionSize) && Number.isFinite(fill.previousPositionSize) &&
    typeof fill.comment === "string" && fill.comment.length <= 10_000 && typeof fill.alertMessage === "string" && fill.alertMessage.length <= 20_000 &&
    typeof fill.leg === "string" && fill.leg.length <= 80;
}
export function validatePineSnapshot(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Invalid Pine snapshot.";
  const snapshot = value as PineAlertSnapshot;
  if (typeof snapshot.source !== "string" || snapshot.source.length > 200_000 || !/^\s*\/\/@version=[56]\b/m.test(snapshot.source)) return "Use a Pine v5/v6 script of at most 200,000 characters.";
  if (typeof snapshot.title !== "string" || !snapshot.title.trim() || snapshot.title.length > 120) return "Invalid Pine script title.";
  if (!snapshot.inputs || typeof snapshot.inputs !== "object" || Array.isArray(snapshot.inputs) || Object.keys(snapshot.inputs).length > 100 || Object.entries(snapshot.inputs).some(([key, val]) => key.length > 200 || !["string", "number", "boolean"].includes(typeof val) || typeof val === "number" && !Number.isFinite(val) || typeof val === "string" && val.length > 10_000)) return "Invalid frozen Pine inputs.";
  if (!snapshot.libraries || typeof snapshot.libraries !== "object" || Array.isArray(snapshot.libraries) || Object.keys(snapshot.libraries).length > 50 || Object.entries(snapshot.libraries).some(([key, val]) => !/^[\w-]+\/[\w-]+\/\d+$/.test(key) || typeof val !== "string" || val.length > 200_000) || JSON.stringify(snapshot.libraries).length > 2_000_000) return "Invalid frozen Pine libraries.";
  if (!snapshot.selection || !["calls", "condition", "orders", "both"].includes(snapshot.selection.type) || snapshot.selection.type === "condition" && !/^alertcondition_\d+$/.test(snapshot.selection.id)) return "Choose alert() calls, order fills or a named condition.";
  if (!Number.isInteger(snapshot.history) || snapshot.history < 50 || snapshot.history > 20_000) return "Pine alert history must be 50–20,000 bars.";
  if (!CHART_TYPE_IDS.includes(snapshot.chartType) || !isValidZone(snapshot.timezone)) return "Invalid frozen chart context.";
  if (["renko", "linebreak", "kagi", "range", "pointfigure"].includes(snapshot.chartType)) return "Pine alerts on synthetic non-time charts are not supported yet. Choose a time-based chart or Heikin Ashi.";
  return null;
}
export function validatePineInputs(snapshot: PineAlertSnapshot, inspection: PineAlertInspection): string | null {
  if (["orders", "both"].includes(snapshot.selection.type) && inspection.declaration !== "strategy") return "Order-fill subscriptions require a strategy() script.";
  for (const [key, value] of Object.entries(snapshot.inputs)) {
    const input = inspection.inputs.find(input => [input.id, input.varId, input.title].includes(key));
    if (!input) return `Unknown Pine input: ${key}.`;
    if (typeof value !== typeof input.defval || input.type === "int" && !Number.isInteger(value)) return `Invalid value for ${input.title}.`;
    if (typeof value === "number" && (input.min !== undefined && value < input.min || input.max !== undefined && value > input.max)) return `${input.title} is outside its allowed range.`;
    if (input.options?.length && !input.options.includes(value)) return `Choose a valid ${input.title} option.`;
  }
  if (snapshot.selection.type === "condition" && !inspection.conditions.some(condition => condition.id === (snapshot.selection as { id: string }).id)) return "The saved alertcondition is not defined by this script.";
  return null;
}
