import { describe, expect, it } from "vitest";
import { heatColor, squarify } from "@/lib/heatmap";

const items = (sizes: number[]) => sizes.map((size, i) => ({ id: i, size }));

describe("squarified treemap", () => {
  it("fills the box exactly with areas proportional to size", () => {
    const rects = squarify(items([60, 25, 10, 5, 5, 3, 2]), 400, 250);
    const area = rects.reduce((n, r) => n + r.width * r.height, 0);
    expect(area).toBeCloseTo(400 * 250, 4);
    const total = 110;
    for (const r of rects) expect((r.width * r.height) / (400 * 250)).toBeCloseTo(r.item.size / total, 6);
  });
  it("keeps every tile inside the box and free of overlaps", () => {
    const rects = squarify(items([30, 20, 20, 10, 8, 6, 4, 2]), 300, 200);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.width).toBeLessThanOrEqual(300 + 1e-9);
      expect(r.y + r.height).toBeLessThanOrEqual(200 + 1e-9);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        expect(overlapX > 1e-6 && overlapY > 1e-6).toBe(false);
      }
  });
  it("lays out the biggest item first and keeps tiles reasonably square", () => {
    const rects = squarify(items([1, 40, 3, 20, 10]), 500, 300);
    expect(rects[0].item.size).toBe(40);
    for (const r of rects) expect(Math.max(r.width / r.height, r.height / r.width)).toBeLessThan(6);
  });
  it("ignores invalid sizes and degenerate boxes", () => {
    expect(squarify(items([0, -4, Number.NaN]), 100, 100)).toEqual([]);
    expect(squarify(items([5]), 0, 100)).toEqual([]);
    const single = squarify(items([5]), 100, 50);
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({ x: 0, y: 0, width: 100, height: 50 });
  });
});

describe("heat colours", () => {
  it("is neutral near zero and saturates", () => {
    expect(heatColor(0)).toBe(heatColor(0.01));
    expect(heatColor(5)).toBe(heatColor(20));
    expect(heatColor(-5)).toBe(heatColor(-20));
    expect(heatColor(3)).not.toBe(heatColor(-3));
    expect(heatColor(Number.NaN)).toBe("#5d6573");
  });
});
