import type { StrategyDocument, StrategySettings } from "@/types/strategy";
import { parseInterval } from "@/lib/market/intervals";

export const DEFAULT_STRATEGY_SETTINGS: StrategySettings = {
  capital: 10000,
  quantityType: "percent_of_equity",
  quantity: 10,
  commissionType: "percent",
  commission: 0.1,
  slippage: 0,
  pyramiding: 1,
  marginLong: 100,
  marginShort: 100,
  fillOnClose: false,
  bars: 3000,
  from: "",
  to: "",
  source: "exchange",
  tickSize: 0,
  quantityStep: 0,
  pointValue: 0,
  extended: false,
  adjustDividends: false,
  useBarMagnifier: false,
  intrabarInterval: "auto",
};
export function utcTimestamp(value: string): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(`${value}Z`);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?$/.test(value) ||
    !Number.isFinite(time)
  )
    throw new Error("Enter a valid UTC date and time.");
  return time;
}
export function validateStrategySettings(s: StrategySettings) {
  const ranges: [number, number, number, string][] = [
    [s.capital, 1, 1e12, "Initial capital"],
    [s.quantity, 0.00000001, 1e12, "Order size"],
    [
      s.commission,
      0,
      s.commissionType === "percent" ? 100 : 1e12,
      "Commission",
    ],
    [s.slippage, 0, 100000, "Slippage"],
    [s.pyramiding, 0, 100, "Pyramiding"],
    [s.marginLong, 0, 100, "Long margin"],
    [s.marginShort, 0, 100, "Short margin"],
    [s.bars, 100, 20000, "History bars"],
  ];
  for (const [value, min, max, label] of ranges)
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(`${label} must be between ${min} and ${max}.`);
  for (const key of ["tickSize", "quantityStep", "pointValue"] as const) {
    const value = s[key] ?? 0;
    if (!Number.isFinite(value) || value < 0 || value > 1e12)
      throw new Error(`Invalid ${key} override.`);
  }
  for (const key of ["extended", "adjustDividends", "useBarMagnifier"] as const)
    if (s[key] !== undefined && typeof s[key] !== "boolean")
      throw new Error(`Invalid ${key} setting.`);
  if (s.intrabarInterval !== undefined && s.intrabarInterval !== "auto" &&
    (typeof s.intrabarInterval !== "string" || !parseInterval(s.intrabarInterval) || parseInterval(s.intrabarInterval)?.unit === "T"))
    throw new Error("Choose a valid time interval for the bar magnifier.");
  for (const value of [s.slippage, s.pyramiding, s.bars])
    if (!Number.isInteger(value))
      throw new Error(
        "Slippage, pyramiding and bar count must be whole numbers.",
      );
  if (
    !["percent_of_equity", "fixed", "cash"].includes(s.quantityType) ||
    !["percent", "cash_per_order", "cash_per_contract"].includes(
      s.commissionType,
    ) ||
    !["exchange", "simulation"].includes(s.source) ||
    typeof s.fillOnClose !== "boolean"
  )
    throw new Error("Invalid execution settings.");
  const from = utcTimestamp(s.from),
    to = utcTimestamp(s.to);
  if (from !== undefined && to !== undefined && from >= to)
    throw new Error("The start must be before the end of the test window.");
}
export function parseStrategyDocument(value: unknown): StrategyDocument {
  if (!value || typeof value !== "object")
    throw new Error("Invalid strategy document.");
  const d = value as StrategyDocument;
  if (
    typeof d.name !== "string" ||
    !d.name.trim() ||
    d.name.length > 100 ||
    typeof d.source !== "string" ||
    !d.source.trim() ||
    d.source.length > 500000 ||
    !d.inputs ||
    typeof d.inputs !== "object" ||
    Array.isArray(d.inputs) ||
    !d.settings ||
    typeof d.settings !== "object"
  )
    throw new Error("Invalid strategy source or inputs.");
  for (const [key, value] of Object.entries(d.inputs))
    if (
      key.length > 200 ||
      !(
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      )
    )
      throw new Error("Invalid strategy input value.");
  validateStrategySettings(d.settings);
  const allowed = Object.keys(DEFAULT_STRATEGY_SETTINGS);
  if (
    Object.keys(d.settings).some((key) => !allowed.includes(key)) ||
    Object.keys(d).some(
      (key) => !["name", "source", "inputs", "settings"].includes(key),
    )
  )
    throw new Error("Unexpected strategy state field.");
  return structuredClone(d);
}
