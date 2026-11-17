import { expect, it } from "vitest";
import { buildTpoSessions, createTpoCache } from "@/lib/orderflow/tpoModel";
import { defaultTpo, resolveTpo, validTpo } from "@/lib/orderflow/tpoSettings";
import { tpoTimePalette } from "@/lib/orderflow/tpoTimeColors";
import { resolveTpoOverlay, tpoOverlayDescriptor, tpoOverlayInputVisible } from "@/lib/orderflow/tpoOverlay";
const minute = 60000;
const bars = Array.from({ length: 4 }, (_, i) => ({ time: i * 30 * minute, open: 100, close: 101, high: 102, low: 99, volume: 100 }));
const style = { ...defaultTpo(), sessionMinutes: 120, rowSize: 1 };
const session = buildTpoSessions(bars, style, "30m")[0];

it("uses the four reference Simple colors at fixed session positions", () => {
  expect(tpoTimePalette(session, style).colors).toEqual([
    "rgba(74,80,94,1)", "rgba(107,115,133,1)", "rgba(61,111,212,1)", "rgba(30,79,214,1)",
  ]);
});
it.each([
  ["thermal", "rgba(41,98,255,1)", "rgba(242,54,69,1)"],
  ["spectrum", "rgba(68,1,84,1)", "rgba(253,231,37,1)"],
  ["ocean", "rgba(30,58,95,1)", "rgba(128,222,234,1)"],
  ["ember", "rgba(106,27,154,1)", "rgba(255,213,79,1)"],
] as const)("retains the %s theme endpoints", (metricTheme, first, last) => {
  const { colors } = tpoTimePalette(session, { ...style, metricTheme });
  expect(colors[0]).toBe(first); expect(colors.at(-1)).toBe(last);
});
it("interpolates custom colors with their alpha rather than discarding transparency", () => {
  const custom = { ...style, sessionMinutes: 180, metricTheme: "custom" as const, metricColor1: "#0000", metricColor2: "rgba(100%,0%,0%,0.5)", metricColor3: "hsl(120,100%,50%)", metricColor4: "#00f" };
  const s = buildTpoSessions(bars, custom, "30m")[0], colors = tpoTimePalette(s, custom).colors;
  expect(colors[0]).toBe("rgba(0,0,0,0)");
  expect(colors[1]).toBe("rgba(153,0,0,0.3)");
  expect(colors.at(-1)).toBe("rgba(0,0,255,1)");
});
it("keeps revealed colors stable across missing blocks and historical corrections", () => {
  const early = buildTpoSessions(bars.slice(0, 1), style, "30m")[0];
  const sparse = buildTpoSessions([bars[0], bars[3]], style, "30m")[0];
  const palette = tpoTimePalette(session, style).colors;
  expect(tpoTimePalette(early, style).colors).toEqual(palette);
  expect(tpoTimePalette(sparse, style).colors).toEqual(palette);
  expect(sparse.rows[1].periodIndices).toEqual([0, 3]);
});
it("normalizes merged-session periods against member spans, excluding calendar gaps", () => {
  const composite = { ...session, end: 3 * 86400000, periodSpans: [{ first: 0, count: 2, start: 0, end: 60 * minute }, { first: 2, count: 2, start: 2 * 86400000, end: 2 * 86400000 + 60 * minute }] };
  expect(tpoTimePalette(composite, style).colors).toEqual(tpoTimePalette(session, style).colors);
});
it("honors 0/45/100 outside opacity and disables dimming with value area hidden", () => {
  for (const outsideVaOpacity of [0, 45, 100]) {
    const palette = tpoTimePalette(session, { ...style, outsideVaOpacity });
    expect(palette.alpha(true)).toBe(.9); expect(palette.alpha(false)).toBe(.9 * (outsideVaOpacity / 100));
    expect(tpoTimePalette(session, { ...style, outsideVaOpacity, valueAreaVisible: false }).alpha(false)).toBe(.9);
  }
});
it("migrates saved preferences and shares theme controls with independent overlay instances", () => {
  const legacy = { ...defaultTpo() };
  for (const key of ["metricTheme", "metricColor1", "metricColor2", "metricColor3", "metricColor4", "outsideVaOpacity"] as const) delete legacy[key];
  expect(validTpo(legacy)).toBe(true); expect(resolveTpo(legacy).outsideVaOpacity).toBe(45);
  expect(resolveTpo({ metricTheme: "unknown", outsideVaOpacity: -1 })).toEqual(defaultTpo());
  expect(validTpo({ ...style, metricTheme: "unknown" })).toBe(false);
  expect(validTpo({ ...style, outsideVaOpacity: 100.5 })).toBe(false);
  const values = { metricTheme: "custom", metricColor1: "#f008", outsideVaOpacity: 0 };
  expect(resolveTpoOverlay(values)).toMatchObject(values);
  expect(tpoOverlayDescriptor().defaultInputs!()).toMatchObject({ metricTheme: "simple", outsideVaOpacity: 45 });
  expect(tpoOverlayInputVisible("metricColor1", values)).toBe(true);
  expect(tpoOverlayInputVisible("metricColor1", { metricTheme: "ocean" })).toBe(false);
});
it("reuses the price/time model for color-only settings edits", () => {
  const cache = createTpoCache(), first = cache.read(bars, style, "30m", "BTCUSDT");
  expect(cache.read(bars, { ...style, metricTheme: "thermal", outsideVaOpacity: 0 }, "30m", "BTCUSDT")).toBe(first);
});
