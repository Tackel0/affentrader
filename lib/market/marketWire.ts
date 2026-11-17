export function parseWireObject(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "string") return null;
  try { return wireObject(JSON.parse(data)); } catch { return null; }
}

export function wireObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function wireDecimal(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  return typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
}
