import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Execute the actual pinned SDK tick/format functions. These helpers are private
// to the bundle, so isolate their source section with its real dependencies.
const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
const entry = readFileSync(path.join(dist, "index.js"), "utf8");
const chunk = /\.\/chunk-[^"']+\.js/g;
let source = "";
for (const name of new Set(entry.match(chunk) ?? [])) {
  const value = readFileSync(path.join(dist, name), "utf8");
  if (value.includes("function afCountAxis(")) { source = value; break; }
}
if (!source) throw new Error("Patched native count tick section not found");
const start = source.indexOf("function priceTicks("), end = source.indexOf("var SEC =", start);
type Scale = { min: number; max: number; log?: boolean };
type Formatter = { price(value: number, opts: { decimals: number; mode: string; surface: string }): string; compact(value: number): string };
const fmt: Formatter = { price: (v, o) => `${o.mode}:${v.toFixed(o.decimals)}`, compact: v => `compact:${v}` };
const sdk = new Function("ENGLISH_FORMAT", source.slice(start, end) + ";return {afCountAxis,afCountValue,paneAxisTicks,formatAxisValue};")(fmt) as {
  afCountAxis(pane: {kind:string;axisFormat?:string;manualScale?:unknown}, models: unknown[]): boolean;
  afCountValue(value:number, format:Formatter, surface:string):string;
  paneAxisTicks(scale:Scale,height:number,pct:unknown,tick:number,mode:unknown,format:Formatter):{price:number;label:string}[];
  formatAxisValue(scale:Scale,height:number,value:number,pct:unknown,tick:number,mode:unknown,format:Formatter,surface:string):string;
};
const count = (type="af-trade-count", ownScale=false) => ({native:{type},ownScale});
describe("native count axis units", () => {
  it("selects only count-owned study master axes and clears stale mode even with a manual scale", () => {
    for (const type of ["af-trade-count","af-trade-count-delta","af-ctcd"]) {
      const pane = {kind:"indicator",manualScale:{min:0,max:10},axisFormat:undefined as string|undefined};
      expect(sdk.afCountAxis(pane,[count(type),count("af-ctcd",true)])).toBe(true);
      expect(pane.axisFormat).toBe("af-count");
      expect(sdk.afCountAxis(pane,[count(type),count("af-cvd")])).toBe(false);
      expect(pane.axisFormat).toBeUndefined();
    }
    for (const [kind,models] of [["price",[count()]],["indicator",[]],["indicator",[count("af-ctcd",true)]]] as const) {
      const pane={kind,axisFormat:"af-count"};
      expect(sdk.afCountAxis(pane,[...models])).toBe(false);
      expect(pane.axisFormat).toBeUndefined();
    }
    const volume={kind:"indicator",axisFormat:"volume"};
    sdk.afCountAxis(volume,[count("volume")]); expect(volume.axisFormat).toBe("volume");
  });
  it("produces unique in-range integer ticks at narrow, negative, inverted and logarithmic scales", () => {
    for (const scale of [{min:-4,max:11},{min:-.4,max:.4},{min:.2,max:.8},{min:100,max:101},{min:1,max:1000,log:true},{min:0,max:1000000}]) {
      for (const height of [40,100,720]) {
        const ticks=sdk.paneAxisTicks(scale,height,undefined,.00001,"af-count",fmt);
        expect(new Set(ticks.map(t=>t.price)).size).toBe(ticks.length);
        expect(new Set(ticks.map(t=>t.label)).size).toBe(ticks.length);
        for (const tick of ticks) {
          expect(Number.isSafeInteger(tick.price)).toBe(true);
          expect(tick.price).toBeGreaterThanOrEqual(scale.min); expect(tick.price).toBeLessThanOrEqual(scale.max);
          expect(tick.label).toBe(`price:${tick.price}`);
        }
      }
    }
    expect(sdk.paneAxisTicks({min:.2,max:.8},100,undefined,.1,"af-count",fmt)).toEqual([]);
  });
  it("formats crosshair counts with locale policy and no negative zero, retaining explicit percent/index modes and other units", () => {
    const price=vi.fn((v:number,o:{decimals:number;mode:string;surface:string})=> `${Object.is(v,-0)?'negative-zero':v}:${o.decimals}:${o.surface}`);
    const custom={...fmt,price}, scale={min:-4,max:11};
    expect(sdk.formatAxisValue(scale,200,-.1,undefined,.1,"af-count",custom,"crosshair")).toBe("0:0:crosshair");
    expect(sdk.formatAxisValue(scale,200,7.4,undefined,.1,"af-count",custom,"crosshair")).toBe("7:0:crosshair");
    expect(sdk.formatAxisValue(scale,200,1.5,undefined,.1,undefined,fmt,"crosshair")).toBe("price:1.5");
    expect(sdk.formatAxisValue(scale,200,8,undefined,.1,"volume",fmt,"crosshair")).toBe("compact:8");
    expect(sdk.formatAxisValue(scale,200,110,{baseline:100,indexed:false},.1,"af-count",fmt,"crosshair")).toBe("percent:10.00");
    expect(sdk.formatAxisValue(scale,200,110,{baseline:100,indexed:true},.1,"af-count",fmt,"crosshair")).toBe("indexed:110.00");
    expect(sdk.afCountValue(Infinity,fmt,"crosshair")).toBe("");
  });
});
