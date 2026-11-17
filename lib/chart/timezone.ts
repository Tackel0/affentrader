import type { Vela } from "@luxalgo/vela";
import { resolveZone } from "@/lib/timezones";

/** Show the chart's time axis, crosshair and tooltips in the chosen zone. */
export function applyTimezone(chart: Vela, choice: string, symbol: string) {
  chart.renderer.applyConfig({ timeScale: { timezone: resolveZone(choice, symbol) } });
}
