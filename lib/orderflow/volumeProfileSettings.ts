import type { InputSchema, InputValue } from "@luxalgo/vela";
import { TIMEZONES, isValidZone } from "@/lib/timezones";
import type { SessionClock } from "./sessionCalendar";
import { validSessionPeriod, type SessionPeriod } from "./sessionPeriods";
import { TPO_TRADING_HOURS, validTpoTradingHours, type TpoTradingHours } from "./tpoTradingHours";

export interface VolumeProfilePreferences extends SessionClock {
  extendPoc?: boolean;
  showDevelopingPoc?: boolean; showDevelopingValueArea?: boolean;
  tradingHours?: TpoTradingHours; customStart?: number; customEnd?: number;
  sessionPeriod?: SessionPeriod;
  rows: number; rowSize: number; valueAreaPercent: number; widthPercent: number;
  placement: "Session start" | "Session end";
  volumeMode: "Buy/Sell" | "Total" | "Delta";
  showHistogram: boolean; showPoc: boolean; showValueArea: boolean; showLabels: boolean;
  showNodes?: boolean;
  buyColor: string; sellColor: string; outsideBuyColor: string; outsideSellColor: string; pocColor: string; valueLineColor: string;
}
export const defaultVolumeProfile = (): VolumeProfilePreferences => ({
  sessionPeriod: "Day", tradingHours: "Full day", customStart: 0, customEnd: 0, sessionZone: "UTC", sessionStartMinutes: 0, sessionMinutes: 1440, weekdaysOnly: false,
  rows: 24, rowSize: 0, valueAreaPercent: 70, widthPercent: 30, placement: "Session start", volumeMode: "Buy/Sell",
  showHistogram: true, showPoc: true, showValueArea: true, showLabels: true, showNodes: true, extendPoc: false, showDevelopingPoc: false, showDevelopingValueArea: false,
  buyColor: "#2962ff", sellColor: "#f7b955", outsideBuyColor: "#434651", outsideSellColor: "#787b86", pocColor: "#f23645", valueLineColor: "#9598a1",
});
const numeric = { rows: [2, 500], rowSize: [0, 1e9], valueAreaPercent: [1, 100], widthPercent: [5, 100], sessionStartMinutes: [0, 1439], sessionMinutes: [1, 1440] } as const;
const flags = ["weekdaysOnly", "showHistogram", "showPoc", "showValueArea", "showLabels", "showNodes", "extendPoc", "showDevelopingPoc", "showDevelopingValueArea"] as const;
const colors = ["buyColor", "sellColor", "outsideBuyColor", "outsideSellColor", "pocColor", "valueLineColor"] as const;
export function resolveVolumeProfile(values: Record<string, unknown>): VolumeProfilePreferences {
  const result = defaultVolumeProfile();
  if (values.tradingHours !== undefined) {
    if (!validTpoTradingHours(values.tradingHours)) throw new Error("Choose a supported trading-hours window.");
    result.tradingHours = values.tradingHours;
  }
  for (const key of ["customStart", "customEnd"] as const) if (values[key] !== undefined) {
    if (typeof values[key] !== "number" || !Number.isInteger(values[key]) || values[key] < 0 || values[key] > 2400) throw new Error("Custom hours require UTC HHMM times from 0000 to 2400.");
    result[key] = values[key];
  }
  if (values.sessionPeriod !== undefined) {
    if (!validSessionPeriod(values.sessionPeriod)) throw new Error("Choose Day, Week or Month for the session period.");
    result.sessionPeriod = values.sessionPeriod;
  }
  for (const key of Object.keys(numeric) as Array<keyof typeof numeric>) {
    const value = values[key]; if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < numeric[key][0] || value > numeric[key][1] || key !== "rowSize" && !Number.isInteger(value))
      throw new Error(`Invalid ${key}. Choose a value between ${numeric[key][0]} and ${numeric[key][1]}.`);
    result[key] = value;
  }
  for (const key of flags) if (typeof values[key] === "boolean") result[key] = values[key];
  for (const key of colors) if (typeof values[key] === "string" && /^#[0-9a-f]{6}$/i.test(values[key])) result[key] = values[key];
  if (typeof values.sessionZone === "string") {
    if (!isValidZone(values.sessionZone) || values.sessionZone.length > 64) throw new Error("Choose a valid session time zone.");
    result.sessionZone = values.sessionZone;
  }
  if (values.placement === "Session start" || values.placement === "Session end") result.placement = values.placement;
  if (values.volumeMode === "Buy/Sell" || values.volumeMode === "Total" || values.volumeMode === "Delta") result.volumeMode = values.volumeMode;
  return result;
}
export function volumeProfileInputs(): InputSchema[] {
  const d = defaultVolumeProfile();
  const input = (key: keyof VolumeProfilePreferences, title: string, type: InputSchema["type"], extra: Partial<InputSchema> = {}): InputSchema =>
    ({ key, title, type, defval: d[key] as InputValue, ...extra });
  return [
    input("sessionPeriod", "Session period", "string", { options: ["Day", "Week", "Month"], group: "Session" }),
    input("tradingHours", "Trading hours", "string", { options: [...TPO_TRADING_HOURS], group: "Session" }),
    input("customStart", "Custom start (UTC HHMM)", "int", { min: 0, max: 2400, group: "Session" }),
    input("customEnd", "Custom end (UTC HHMM)", "int", { min: 0, max: 2400, group: "Session" }),
    input("sessionZone", "Session time zone", "string", { options: ["UTC", "exchange", "local", ...TIMEZONES.filter(zone => zone.id !== "UTC").map(zone => zone.id)], group: "Session" }),
    input("sessionStartMinutes", "Start (minutes after midnight)", "int", { min: 0, max: 1439, group: "Session" }),
    input("sessionMinutes", "Session length (minutes)", "int", { min: 1, max: 1440, group: "Session" }),
    input("weekdaysOnly", "Weekdays only", "bool", { group: "Session" }),
    input("rows", "Auto rows per session", "int", { min: 2, max: 500, group: "Price levels" }),
    input("rowSize", "Price row size (0 = auto)", "float", { min: 0, max: 1e9, group: "Price levels" }),
    input("valueAreaPercent", "Value area (%)", "int", { min: 1, max: 100, group: "Price levels" }),
    input("volumeMode", "Volume", "string", { options: ["Buy/Sell", "Total", "Delta"], tab: "Style" }),
    input("placement", "Placement", "string", { options: ["Session start", "Session end"], tab: "Style" }),
    input("widthPercent", "Profile width (%)", "int", { min: 5, max: 100, tab: "Style" }),
    ...(["showHistogram", "showPoc", "showValueArea", "showLabels"] as const).map((key, i) => input(key, ["Histogram", "Point of control", "Value area lines", "Labels"][i], "bool", { tab: "Style" })),
    input("extendPoc", "Extend POC until broken", "bool", { tab: "Style" }),
    input("showNodes", "HVN / LVN nodes", "bool", { tab: "Style" }),
    input("showDevelopingPoc", "Developing POC", "bool", { tab: "Style" }),
    input("showDevelopingValueArea", "Developing VA", "bool", { tab: "Style" }),
    ...colors.map((key, i) => input(key, ["Value area buy", "Value area sell", "Outside buy", "Outside sell", "POC color", "Value area line color"][i], "color", { tab: "Style" })),
  ];
}
export function volumeProfileInputVisible(key: string, values: Record<string, unknown>): boolean {
  if (key === "extendPoc") return values.showPoc !== false;
  const day = (values.sessionPeriod ?? "Day") === "Day", hours = values.tradingHours ?? "Full day";
  if (["tradingHours", "sessionZone", "sessionStartMinutes", "sessionMinutes", "weekdaysOnly", "customStart", "customEnd"].includes(key) && !day) return false;
  if (["customStart", "customEnd"].includes(key)) return hours === "Custom";
  if (["sessionZone", "sessionStartMinutes", "sessionMinutes", "weekdaysOnly"].includes(key)) return hours === "Full day" || hours === "Regular hours (RTH)" || hours === "Extended hours (ETH)";
  return true;
}
