import type { DrawingTypeKey, Vela } from "@luxalgo/vela";
import type { DrawingPreferences, DrawingTool } from "@/types/trading";

export const DEFAULT_DRAWING_PREFERENCES: DrawingPreferences = {
  snap: "off", stay: false, favorites: [], lastTools: {}, toolDefaults: {}, toolTemplates: {},
};
const ALIASES: Record<string, DrawingTypeKey | null> = {
  cursor: null, trendline: "trendline", "horizontal-ray": "hray", "fib-retracement": "fibretracement",
  "long-position": "position", "anchored-vwap": "anchoredvwap", "fixed-profile": "fixedrangevp",
  "fixed-tails": "af-fixed-tails" as DrawingTypeKey,
};
export const nativeDrawingTool = (tool: DrawingTool): DrawingTypeKey | null =>
  Object.hasOwn(ALIASES, tool) ? ALIASES[tool] : tool as DrawingTypeKey;

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const toolKey = (value: unknown): value is DrawingTypeKey => typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_.:-]{0,79}$/.test(value);
/** The engine validates individual native style/template entries at restore time. */
export function parseDrawingPreferences(value: unknown): DrawingPreferences {
  if (!record(value) || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_DRAWING_PREFERENCES, key)) ||
    !["off", "weak", "strong"].includes(String(value.snap)) || typeof value.stay !== "boolean" ||
    !Array.isArray(value.favorites) || value.favorites.length > 100 || !value.favorites.every(toolKey) || new Set(value.favorites).size !== value.favorites.length ||
    !record(value.lastTools) || Object.keys(value.lastTools).length > 25 ||
    !Object.entries(value.lastTools).every(([group, tool]) => /^[a-z0-9-]{1,80}$/.test(group) && toolKey(tool)) ||
    !record(value.toolDefaults) || !record(value.toolTemplates) ||
    JSON.stringify(value.toolDefaults).length > 250_000 || JSON.stringify(value.toolTemplates).length > 250_000)
    throw new Error("Invalid drawing preferences.");
  return structuredClone(value) as unknown as DrawingPreferences;
}

interface PreferencesHost {
  read(): DrawingPreferences;
  write(value: DrawingPreferences): void;
  subscribe(listener: (value: DrawingPreferences) => void): () => void;
}
/** One active chart owns tool preferences. Switching charts restores the same shared preferences. */
export function bindDrawingPreferences(chart: Vela, host: PreferencesHost): () => void {
  let applying = false, current = host.read();
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const apply = (next: DrawingPreferences, initial = false) => {
    applying = true;
    try {
      if (initial || next.snap !== current.snap) chart.drawings.setSnapMode(next.snap);
      if (initial || next.stay !== current.stay) chart.drawings.setStayMode(next.stay);
      if (initial || !same(next.favorites, current.favorites)) chart.drawings.setFavorites(next.favorites);
      if (initial || !same(next.toolDefaults, current.toolDefaults)) chart.drawings.setToolDefaults(next.toolDefaults);
      if (initial || !same(next.toolTemplates, current.toolTemplates)) chart.drawings.setToolTemplates(next.toolTemplates);
      current = next;
    } finally { applying = false; }
  };
  apply(current, true);
  const write = (patch: Partial<DrawingPreferences>) => {
    if (applying) return;
    const next = { ...host.read(), ...patch };
    current = next;
    if (!same(next, host.read())) host.write(next);
  };
  const off = [
    chart.on("drawing:snap", event => write({ snap: event.mode })),
    chart.on("drawing:stay", event => write({ stay: event.on })),
    chart.on("drawing:favorites", () => write({ favorites: chart.drawings.favorites() })),
    chart.on("drawing:defaults", () => write({ toolDefaults: chart.drawings.toolDefaults() })),
    chart.on("drawing:templates", () => write({ toolTemplates: chart.drawings.toolTemplates() })),
    host.subscribe(next => apply(next)),
  ];
  return () => off.forEach(dispose => dispose());
}
