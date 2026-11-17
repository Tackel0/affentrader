import type { InputSchema, InputValue } from "@luxalgo/vela";
import { TIMEZONES, isValidZone } from "@/lib/timezones";
import type { SessionClock } from "./sessionCalendar";

export interface CvdPreferences extends SessionClock {
  anchor: "Day" | "Week" | "Month" | "All data" | "Session" | "Collection";
  calculation: "Cumulative delta" | "Bar delta";
  plot: "Line" | "Area" | "Histogram" | "Candles";
  mode?: "Total" | "Average";
  color: string;
  lineWidth: number;
  upColor: string; downColor: string; wickUpColor: string; wickDownColor: string; borderUpColor: string; borderDownColor: string;
}
export const CVD_CANDLE_COLORS = ["upColor", "downColor", "wickUpColor", "wickDownColor", "borderUpColor", "borderDownColor"] as const;
export const defaultCvd = (): CvdPreferences => ({ anchor: "Month", calculation: "Cumulative delta", plot: "Candles", mode: "Total",
  sessionZone: "UTC", sessionStartMinutes: 0, sessionMinutes: 1440, weekdaysOnly: false, color: "#38bea1", lineWidth: 2,
  upColor: "#089981", downColor: "#f23645", wickUpColor: "#089981", wickDownColor: "#f23645", borderUpColor: "#089981", borderDownColor: "#f23645" });
export function resolveCvd(values: Record<string, unknown>): CvdPreferences {
  const result = defaultCvd();
  for (const key of ["anchor", "calculation", "plot", "mode"] as const) {
    const choices = { anchor: ["Day", "Week", "Month", "All data", "Session", "Collection"], calculation: ["Cumulative delta", "Bar delta"], plot: ["Line", "Area", "Histogram", "Candles"], mode: ["Total", "Average"] };
    if (values[key] !== undefined) {
      if (typeof values[key] !== "string" || !choices[key].includes(values[key])) throw new Error(`Choose a valid CVD ${key}.`);
      Object.assign(result, { [key]: values[key] });
    }
  }
  for (const [key, min, max] of [["sessionStartMinutes", 0, 1439], ["sessionMinutes", 1, 1440], ["lineWidth", 1, 10]] as const) {
    const value = values[key]; if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid CVD ${key}.`);
    result[key] = value;
  }
  if (values.sessionZone !== undefined) {
    if (typeof values.sessionZone !== "string" || !isValidZone(values.sessionZone)) throw new Error("Choose a valid CVD session time zone.");
    result.sessionZone = values.sessionZone;
  }
  if (typeof values.weekdaysOnly === "boolean") result.weekdaysOnly = values.weekdaysOnly;
  for (const key of ["color", ...CVD_CANDLE_COLORS] as const) if (values[key] !== undefined) {
    if (typeof values[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(values[key])) throw new Error(`Choose a valid CVD ${key}.`);
    result[key] = values[key];
  }
  return result;
}
export const cvdClockKey = (style: CvdPreferences) => JSON.stringify(style.anchor === "Session"
  ? [style.anchor, style.sessionZone, style.sessionStartMinutes, style.sessionMinutes, style.weekdaysOnly] : [style.anchor]);
export function cvdInputs(): InputSchema[] {
  const d = defaultCvd();
  const input = (key: keyof CvdPreferences, title: string, type: InputSchema["type"], extra: Partial<InputSchema> = {}): InputSchema =>
    ({ key, title, type, defval: d[key] as InputValue, ...extra });
  return [input("anchor", "Reset accumulation", "string", { options: ["Day", "Week", "Month", "All data", "Session", "Collection"] }),
    input("mode", "Mode", "string", { options: ["Total", "Average"] }),
    input("calculation", "Calculation", "string", { options: ["Cumulative delta", "Bar delta"] }),
    input("sessionZone", "Session time zone", "string", { options: ["UTC", "exchange", "local", ...TIMEZONES.filter(zone => zone.id !== "UTC").map(zone => zone.id)], group: "Session" }),
    input("sessionStartMinutes", "Start (minutes after midnight)", "int", { min: 0, max: 1439, group: "Session" }),
    input("sessionMinutes", "Session length (minutes)", "int", { min: 1, max: 1440, group: "Session" }),
    input("weekdaysOnly", "Weekdays only", "bool", { group: "Session" }),
    input("plot", "Plot", "string", { options: ["Candles", "Line", "Area", "Histogram"], tab: "Style" }),
    ...CVD_CANDLE_COLORS.map((key, index) => input(key, ["Up body", "Down body", "Up wick", "Down wick", "Up border", "Down border"][index], "color", { tab: "Style" })),
    input("color", "Color", "color", { tab: "Style" }), input("lineWidth", "Line width", "int", { min: 1, max: 10, tab: "Style" })];
}
