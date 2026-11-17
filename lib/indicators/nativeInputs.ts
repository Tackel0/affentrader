import type { IndicatorInstance } from "@/types/trading";
import { migrateFootprintInputs } from "@/lib/orderflow/footprintInputMigration";
/** VWAP owns its native eight-source input; the generic six-source study field
 * must neither overwrite its HLC3 default nor erase OHLC4/HLCC4 selections. */
export function nativeIndicatorInputs(indicator: IndicatorInstance) {
  const source = indicator.definitionId === "vwap" ? indicator.inputs.source ?? "HLC3"
    : indicator.source === "hl2" ? "HL2" : indicator.source === "hlc3" ? "HLC3" : indicator.source.charAt(0).toUpperCase()+indicator.source.slice(1);
  const inputs = indicator.definitionId === "footprint" || indicator.definitionId === "visible-footprint" ? migrateFootprintInputs(indicator.inputs) : indicator.inputs;
  return {...inputs,source,color:indicator.color,lineWidth:indicator.lineWidth};
}
