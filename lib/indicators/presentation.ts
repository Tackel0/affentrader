import type { IndicatorInstance } from "@/types/trading";

/** Global status-line policy takes precedence over an individual study's preference. */
export function showsIndicatorValues(indicator: IndicatorInstance, globallyEnabled: boolean): boolean {
  return globallyEnabled && indicator.valuesInStatusLine !== false && indicator.visible && !indicator.error;
}

/** Host-only presentation changes must not restart native or Pine calculations. */
export function indicatorExecutionSignature(indicator: IndicatorInstance): string {
  const { valuesInStatusLine: _values, valuesOnPriceScale: _axis, ...execution } = indicator;
  return JSON.stringify(execution);
}
