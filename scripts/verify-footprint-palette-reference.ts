import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { defaultFootprint } from "../lib/orderflow/footprint";
import { footprintIntensity, footprintModeRects } from "../lib/orderflow/footprintModes";
const source = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8"), hash = createHash("sha256").update(source).digest("hex");
assert.equal(hash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
function block(at: number) { assert.ok(at >= 0); let n = 1, end = source.indexOf("{", at) + 1; for (; n && end < source.length; end++) { if (source[end] === "{") n++; else if (source[end] === "}") n--; } assert.equal(n, 0); return source.slice(at, end); }
const helpers = ["t$", "tL", "tF"].map(n => block(source.indexOf(`function ${n}(`, 1100000))).join("\n");
const mono = block(source.indexOf("function(e,t,i){let r=t$(i);return tL", 1115500));
const reference = runInNewContext(`${helpers}\n({shade:tF,mix:${mono}})`, Object.create(null), { timeout: 1000 });
const colors = [[8, 153, 129, 1], [242, 54, 69, .5], [0, 0, 0, 0], [255, 255, 255, .8], [17, 34, 51, .25], [255, 0, 200, 1]];
const css = (c: number[]) => `rgba(${c.join(",")})`, object = (c: number[]) => ({ r: c[0], g: c[1], b: c[2], a: c[3] });
let shadeComparisons = 0, monoComparisons = 0;
for (const c of colors) for (const ratio of [0, .01, .25, .5, 1, 2]) for (const gradient of [false, true]) for (const [background, light] of [["#000000", false], ["#ffffff", true], ["#777777", false], ["#808080", true]] as const) {
  assert.equal(footprintIntensity(css(c), ratio, gradient, background), reference.shade(object(c), ratio, gradient, light)); shadeComparisons++;
}
for (let i = 0; i < colors.length; i++) for (const ratio of [.01, .25, .5, 1, 2]) for (const gradientCells of [false, true]) {
  const a = colors[i], b = colors[(i + 1) % colors.length];
  const actual = footprintModeRects("total", ratio, 0, 1, 100, 40, { ...defaultFootprint(), volumeSplit: false, monoLowColor: css(a), monoHighColor: css(b), gradientCells }, "#000000");
  assert.equal(actual[0].color, reference.mix(object(a), object(b), ratio)); monoComparisons++;
}
const report = { checkedAt: new Date().toISOString(), sourceHash: hash, shadeComparisons, monoComparisons, scope: "Actual reviewed Vela pure shade and mono-mix functions versus production palette helpers, including alpha, light/dark threshold, clamping and gradient-off mono. No full pixel or historical-source equivalence claim." };
await writeFile("artifacts/footprint-palette-reference.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
