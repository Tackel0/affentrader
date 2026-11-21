import { BAR_STATS_ROWS, defaultBarStats } from "@/lib/orderflow/barStats";

export interface StatusLinePreferences {
  ohlc: boolean;
  volume: boolean;
  /** Optional in older saved charts; normalized to true. */
  barChange?: boolean;
  indicatorTitles: boolean;
  indicatorArguments: boolean;
  indicatorValues: boolean;
}

export const DEFAULT_STATUS_LINE: Readonly<Required<StatusLinePreferences>> = Object.freeze({
  ohlc: true,
  volume: true,
  barChange: true,
  indicatorTitles: true,
  indicatorArguments: true,
  indicatorValues: true,
});

export function validStatusLine(value: unknown): value is StatusLinePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).every(key => Object.hasOwn(DEFAULT_STATUS_LINE, key)) &&
    Object.keys(DEFAULT_STATUS_LINE).every(key => key === "barChange" && candidate[key] === undefined || typeof candidate[key] === "boolean");
}

/** Local storage and older cells may predate these optional display preferences. */
export function statusLinePreferences(value?: unknown): Required<StatusLinePreferences> {
  const saved = validStatusLine(value) ? value : undefined;
  return { ...DEFAULT_STATUS_LINE, ...saved, barChange: saved?.barChange ?? true };
}

/** Preserve stored input order, including zero/false; renderer style fields are not arguments. */
export function studyArguments(inputs: Record<string, string | number | boolean>, definitionId?: string): string {
  if (definitionId === "footprint" || definitionId === "visible-footprint") return `${inputs.volumeMode ?? "Bid × Ask Profile"} · ${inputs.rowSize ? `row ${inputs.rowSize}` : "Auto rows"}${definitionId === "visible-footprint" ? ` · ${inputs.alignment ?? "Right"}` : ""}`;
  if (definitionId === "tpo-overlay") return `${inputs.sessionPeriod ?? "Day"} · ${inputs.blockMinutes ?? "30"}m · ${inputs.valueAreaPercent ?? 70}%`;
  if (definitionId === "rolling-profile") return `${inputs.bars ?? 100} bars · ${inputs.rows ?? 24} rows · ${inputs.valueAreaPercent ?? 70}%`;
  if (definitionId && ["visible-tails", "rolling-tails", "session-tails"].includes(definitionId)) {
    const period = inputs.session ?? "Day", hours = inputs.tradingHours ?? "Full day";
    const window = period !== "Day" ? `${period} UTC` : hours === "Custom" ? `Day · ${String(inputs.customStart ?? 0).padStart(4, "0")}–${String(inputs.customEnd ?? 0).padStart(4, "0")} UTC`
      : `Day · ${hours === "Full day" ? inputs.sessionZone ?? "UTC" : hours}`;
    return `${inputs.threshold ?? 10}% · ${inputs.resolution ?? 50} bins${definitionId === "rolling-tails" ? ` · ${inputs.bars ?? 100} bars` : definitionId === "session-tails" ? ` · ${window}` : ""}`;
  }
  if (definitionId === "bar-stats") {
    const defaults = defaultBarStats();
    const count = BAR_STATS_ROWS.filter(row => typeof inputs[`${row}Visible`] === "boolean" ? inputs[`${row}Visible`] : defaults[`${row}Visible`]).length;
    return `${count} rows${inputs.values === "Off" ? " · color only" : ""}`;
  }
  if (definitionId === "vpvr") return `${inputs.rows ?? 40} rows ${inputs.valueAreaPct ?? 70}%${inputs.volumeSource === "Classified executions" ? " trades" : ""}`;
  if (definitionId === "depth-heatmap") return `${inputs.sampleMs ?? 1000}ms ${inputs.retentionMinutes ?? 10}m`;
  if (definitionId === "liquidation-heatmap") return `${inputs.leverages ?? "10× / 20× / 40×"} · ${inputs.lookback ?? 180} bars`;
  if (definitionId === "cvd") {
    const anchor = inputs.anchor === "Collection" ? "Collection" : inputs.anchor === "Session" ? `Session ${inputs.sessionZone ?? "UTC"}` : `${inputs.anchor ?? "Month"} UTC`;
    return `${anchor}${inputs.mode === "Average" ? " · Average" : ""}${inputs.calculation === "Bar delta" ? " Δ" : ""}`;
  }
  if (definitionId === "volume-delta") return inputs.mode === "Average" ? "Average" : "Total";
  if (definitionId === "session-profile") {
    const grid = typeof inputs.rowSize === "number" && inputs.rowSize > 0 ? `${inputs.rowSize} / row` : `${inputs.rows ?? 24} rows`;
    const window = inputs.sessionPeriod && inputs.sessionPeriod !== "Day" ? `${inputs.sessionPeriod} UTC` : inputs.tradingHours && inputs.tradingHours !== "Full day" ? inputs.tradingHours : inputs.sessionZone ?? "UTC";
    return `${grid} ${inputs.valueAreaPercent ?? 70}% ${window}`;
  }
  return Object.entries(inputs).filter(([key, value]) => !["color", "lineWidth"].includes(key) &&
    (typeof value !== "number" || Number.isFinite(value))).map(([, value]) => String(value)).join(" ");
}
