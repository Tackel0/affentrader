export const tapeHighlightMultipliers = [2, 3, 5, 10, 20] as const;

export const defaultTapePreferences = {
  tapeView: "trades" as "trades" | "second" | "minute",
  side: "all" as TimeSalesFilters["side"],
  unit: "quantity" as TimeSalesFilters["unit"],
  minimum: "0",
  maximumValue: "",
  milliseconds: true,
  combine: false,
  pauseOnHover: false,
  sizeDisplay: "both" as "both" | "quantity" | "value",
  highlightMode: "fixed" as "off" | "fixed" | "auto",
  highlightAt: "",
  highlightMultiplier: 3,
};

export function readTapePreferences(value: unknown): typeof defaultTapePreferences {
  if (!value || typeof value !== "object") return defaultTapePreferences;
  const data = value as Record<string, unknown>;
  const threshold = data.highlightAt;
  const limit = (value: unknown, fallback: string) =>
    typeof value === "string" && value.length <= 32 && Number.isFinite(Number(value)) && Number(value) >= 0 ? value : fallback;
  const minimum = limit(data.minimum, "0");
  const maximumValue = limit(data.maximumValue, "");
  const unit = data.unit === "price-times-quantity" ? "price-times-quantity" : "quantity";
  return {
    side: data.side === "buy" || data.side === "sell" ? data.side : "all",
    unit,
    minimum,
    maximumValue: unit === "price-times-quantity" && Number(maximumValue) > 0 && Number(maximumValue) < Number(minimum) ? "" : maximumValue,
    tapeView: data.tapeView === "second" || data.tapeView === "minute" ? data.tapeView : "trades",
    milliseconds: typeof data.milliseconds === "boolean" ? data.milliseconds : defaultTapePreferences.milliseconds,
    combine: data.combine === true,
    pauseOnHover: data.pauseOnHover === true,
    sizeDisplay: data.sizeDisplay === "quantity" || data.sizeDisplay === "value" ? data.sizeDisplay : "both",
    highlightMode: data.highlightMode === "off" || data.highlightMode === "auto" ? data.highlightMode : "fixed",
    highlightAt: typeof threshold === "string" && threshold.length <= 32 && Number.isFinite(Number(threshold)) && Number(threshold) >= 0 ? threshold : "",
    highlightMultiplier: tapeHighlightMultipliers.some(n => n === data.highlightMultiplier) ? Number(data.highlightMultiplier) : 3,
  };
}
import type { TimeSalesFilters } from "@/types/trading";

