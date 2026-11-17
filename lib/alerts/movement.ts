export interface MovementMeasurement {
  current: number;
  reference: number;
  change: number;
}

/** Signed movement; a zero percentage reference is unavailable, never an invented percent. */
export function measureMovement(values: readonly number[], bars: number, unit: "absolute" | "percent"): MovementMeasurement | undefined {
  if (!Number.isSafeInteger(bars) || bars < 1 || values.length <= bars) return;
  const current = values.at(-1)!, reference = values.at(-1 - bars)!;
  if (!Number.isFinite(current) || !Number.isFinite(reference) || unit === "percent" && reference === 0) return;
  const change = unit === "absolute" ? current - reference : (current - reference) / Math.abs(reference) * 100;
  if (!Number.isFinite(change)) return;
  return { current, reference, change };
}
