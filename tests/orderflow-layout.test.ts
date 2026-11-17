import { describe, expect, it } from "vitest";
import { footprintBarCount, footprintPalette, footprintWindow, FOOTPRINT_BAR_PX } from "@/lib/orderflow/layout";
import { isChartControl } from "@/lib/chart/controls";

describe("footprint layout", () => {
  it("fits as many bars as stay readable", () => {
    expect(footprintBarCount(620)).toBe(Math.floor((620 - 90) / FOOTPRINT_BAR_PX));
    expect(footprintBarCount(1600)).toBeGreaterThan(footprintBarCount(620));
  });
  it("retains two readable bars on narrow panes and tolerates bad widths", () => {
    expect(footprintBarCount(100)).toBe(2);
    expect(footprintBarCount(0)).toBe(8);
    expect(footprintBarCount(Number.NaN)).toBe(8);
  });
  it("has a distinct palette for each theme", () => {
    expect(footprintPalette("light").buyFill).not.toBe(footprintPalette("dark").buyFill);
    expect(footprintPalette("light").note).not.toBe(footprintPalette("dark").note);
  });
  it("frames the final Ask half with future whitespace, retaining a Replay cutoff", () => {
    const bars = [0, 60000, 120000, 180000].map(time => ({ time }));
    expect(footprintWindow(bars, "1m", 3)).toEqual({ from: 27000, to: 219000 });
    expect(footprintWindow(bars, "1m", 3, 120000)).toEqual({ from: -33000, to: 159000 });
    expect(footprintWindow([], "1m", 3)).toBeUndefined();
  });
});

describe("chart control detection", () => {
  const target = (selector: string | null) => ({ closest: (s: string) => (selector && s.includes(selector) ? {} : null) }) as unknown as EventTarget;
  it("recognises buttons and ignores the canvas", () => {
    expect(isChartControl(target("button"))).toBe(true);
    expect(isChartControl(target(null))).toBe(false);
    expect(isChartControl(null)).toBe(false);
    expect(isChartControl({} as EventTarget)).toBe(false);
  });
});
