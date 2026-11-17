import type { TpoPreferences } from "@/lib/orderflow/tpoSettings";
export type TpoAlertSettings = Pick<TpoPreferences, "rowSize" | "targetRows" | "blockMinutes" | "sessionZone" | "sessionStartMinutes" | "sessionMinutes" | "weekdaysOnly" | "valueAreaPercent" | "sessionPeriod" | "tradingHours" | "customStart" | "customEnd">;
export interface TpoAlertCondition {
  type: "tpo";
  level: "poc" | "vah" | "val";
  direction: "crossing" | "crossing_up" | "crossing_down";
  settings: TpoAlertSettings;
}
export interface TpoAlertObservation { reference: string; price: number; at: number }
