import type { FootprintDeltaPath } from "@/types/trading";

export function validFootprintDeltaPath(path: FootprintDeltaPath, candle: number, replayThrough?: number): boolean {
  return [path.high, path.low, path.close].every(Number.isFinite) && path.high >= 0 && path.low <= 0 &&
    path.high >= path.close && path.low <= path.close && Number.isSafeInteger(path.executions) && path.executions > 0 &&
    Number.isSafeInteger(path.first) && Number.isSafeInteger(path.last) && path.first >= candle && path.last >= path.first &&
    Math.abs(path.first) < 8640000000000000 && Math.abs(path.last) < 8640000000000000 &&
    (replayThrough === undefined || path.last < replayThrough) && path.ordering === "time-sequence-id";
}

/** Whitelist a capture: never retain the mutable history or tree nodes. */
export function copyFootprintDeltaPath(path: FootprintDeltaPath): Readonly<FootprintDeltaPath> {
  return Object.freeze({ high: path.high, low: path.low, close: path.close, executions: path.executions,
    first: path.first, last: path.last, ordering: "time-sequence-id" });
}
