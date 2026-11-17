import type { ResolvedFootprintPreferences } from "./footprint";
import { tpoColorRgba } from "./tpoTimeColors";

/** Default ink follows the reference light/dark palette. An explicit legacy
 * chart-theme preference remains available independently of that palette. */
export function footprintTextColor(style: Pick<ResolvedFootprintPreferences, "textColor" | "textColorAuto">, theme: { background?: string; textColor: string }): string {
  if (style.textColorAuto) return theme.textColor;
  const [r, g, b] = tpoColorRgba(theme.background ?? "#131722");
  return style.textColor === "#d1d4dc" && .2126 * r + .7152 * g + .0722 * b >= 128 ? "#2a2e39" : style.textColor;
}
