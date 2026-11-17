import type { AlertRule, Operand } from "@/types/alerts";

export type LineOperand = Extract<Operand, { type: "line" }>;

/** A chart drawing as Vela serialises it: only the fields alerts need. */
export interface DrawnLine {
  id: string;
  type: string;
  anchors: { time: number; price: number }[];
  style?: { extendLeft?: boolean; extendRight?: boolean };
}

/** Drawing types that are a straight line through two anchors. */
const SLOPED = new Set(["trendline", "ray", "extendedline", "infoline"]);
/** Drawing types that mark one price level. */
const LEVEL = new Set(["hline", "hray"]);

export function supportsLineAlert(type: string): boolean {
  return SLOPED.has(type) || LEVEL.has(type);
}

/** Price of the line at `time`, or NaN when the line does not reach that time. */
export function lineValueAt(line: LineOperand, time: number): number {
  const { from, to } = line;
  if (!Number.isFinite(time) || to.time === from.time) return Number.NaN;
  const left = Math.min(from.time, to.time);
  const right = Math.max(from.time, to.time);
  const reachesLeft = line.extend === "left" || line.extend === "both";
  const reachesRight = line.extend === "right" || line.extend === "both";
  if (time < left && !reachesLeft) return Number.NaN;
  if (time > right && !reachesRight) return Number.NaN;
  return from.price + ((to.price - from.price) * (time - from.time)) / (to.time - from.time);
}

function extendOf(drawing: DrawnLine): LineOperand["extend"] {
  if (drawing.type === "ray") return "right";
  if (drawing.type === "extendedline") return "both";
  const left = Boolean(drawing.style?.extendLeft);
  const right = Boolean(drawing.style?.extendRight);
  return left && right ? "both" : right ? "right" : left ? "left" : "none";
}

export interface LineAlertOptions {
  symbol: string;
  timeframe: string;
  direction: "up" | "down" | "either";
  /** Used when the drawing is a level and the last price is unknown. */
  now?: number;
  id?: string;
}

/**
 * Build an alert that fires when price crosses a drawn line or level. Sloped
 * lines follow their slope into the future only when they extend that way;
 * levels use a plain price comparison.
 */
export function ruleFromDrawing(drawing: DrawnLine, options: LineAlertOptions): AlertRule | null {
  if (!supportsLineAlert(drawing.type) || drawing.anchors.length < 1) return null;
  const comparator = options.direction === "up" ? "crossing_up" : options.direction === "down" ? "crossing_down" : "crossing";
  const level = LEVEL.has(drawing.type);
  if (!level && drawing.anchors.length < 2) return null;
  const right: Operand = level
    ? { type: "number", value: drawing.anchors[0].price }
    : { type: "line", from: drawing.anchors[0], to: drawing.anchors[1], extend: extendOf(drawing) };
  const verb = options.direction === "up" ? "crosses above" : options.direction === "down" ? "crosses below" : "crosses";
  return {
    id: options.id ?? crypto.randomUUID(),
    name: `${level ? "Level" : "Trendline"} alert`,
    kind: "technical",
    status: "active",
    scope: { type: "symbol", symbol: options.symbol, timeframe: options.timeframe },
    condition: {
      op: "leaf",
      leaf: { type: "compare", left: { type: "quote", field: "price" }, comparator, right },
    },
    frequency: "tick",
    repeat: false,
    cooldownMs: 60_000,
    message: `Price ${verb} the ${level ? `level ${drawing.anchors[0].price}` : "trendline"}`,
    sound: true,
    browserNotification: false,
    serverSide: false,
    createdAt: options.now ?? Date.now(),
  };
}
