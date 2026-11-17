import { expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
const sources = readdirSync(dist).filter(name => /\.(js|cjs)$/.test(name) && !name.endsWith(".min.js"))
  .map(name => readFileSync(path.join(dist, name), "utf8"));
const methods = sources.flatMap(source => [...source.matchAll(/paintFixedRangeVp\(ctx, d, proj, theme\) \{([\s\S]*?)\n[ \t]+\}\n[ \t]+(?=\/\*\* Paint an anchored VWAP)/g)].map(match => match[1]));
it("paints source captions after native rows/lines in all pinned bundles and inside the visible upper pane", () => {
  expect(methods).toHaveLength(5);
  for (const body of methods) {
    const marks: string[] = [], labels: Array<{ text: string; y: number }> = [];
    const context = { save() {}, restore() {}, measureText: (text: string) => ({ width: text.length * 5 }), fillRect: () => marks.push("rect"),
      fillText: (text: string, _x: number, y: number) => { marks.push("notice"); labels.push({ text, y }); } };
    const painter = { strokePolyline: () => marks.push("developing"), stroke: () => marks.push("level") };
    const paint = new Function("ctx", "d", "proj", "theme", "isTransparent", "contrastColor", body);
    const layout = { x0: 10, profile: { rows: [{ up: 10, down: 10 }], maxTotal: 20, vaFrom: 0, vaTo: 0 }, maxW: 100, anchorX: 10, grow: 1, yEdges: [90, 900], developingPoc: [], developingVaHigh: [], developingVaLow: [] };
    const drawing = { layout: () => layout, anchors: [{ time: 0 }], paneId: "price", frvpNotice: "OHLCV estimate · 5000 loaded bars", style: { lineWidth: 1 },
      frvp: { showDevelopingPoc: true, showDevelopingVa: true } };
    paint.call(painter, context, drawing, { width: 400, height: 800, paneRect: () => ({ top: 10, height: 300 }) }, { background: "black", textColor: "white" }, () => false, () => "white");
    expect(labels.map(label => label.text).join(" ")).toContain("OHLCV estimate");
    expect(labels.every(label => label.y >= 24 && label.y < 310)).toBe(true);
    expect(marks.lastIndexOf("developing")).toBeLessThan(marks.indexOf("notice"));
  }
});
it("keeps pending/error notices visible when native layout is unavailable", () => {
  for (const body of methods) {
    const texts: string[] = [];
    const paint = new Function("ctx", "d", "proj", "theme", body);
    paint({ save() {}, restore() {}, fillRect() {}, measureText: () => ({ width: 20 }), fillText: (text: string) => texts.push(text) },
      { layout: () => null, anchors: [], frvpNotice: "Calculating developing profile" },
      { width: 375, height: 600, xOf: () => 0 }, { background: "black", textColor: "white" });
    expect(texts.join(" ")).toContain("Calculating developing profile");
  }
});
