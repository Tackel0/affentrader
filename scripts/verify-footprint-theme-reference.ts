import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { defaultFootprint } from "../lib/orderflow/footprint";
import { footprintTextColor } from "../lib/orderflow/footprintTheme";
import { footprintPocColor } from "../lib/orderflow/footprintStructure";
import { explicitPickerColor } from "../lib/chart/colorPickerEnhancement";
import { tpoColorRgba } from "../lib/orderflow/tpoTimeColors";
const source = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8"), sourceHash = createHash("sha256").update(source).digest("hex");
assert.equal(sourceHash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
function block(name: string) { const start = source.indexOf(`function ${name}(`, 1100000); assert.ok(start >= 0); let end = source.indexOf("{", start) + 1, depth = 1; for (; depth && end < source.length; end++) { if (source[end] === "{") depth++; else if (source[end] === "}") depth--; } assert.equal(depth, 0); return source.slice(start, end); }
const colorsStart = source.indexOf('var tq="#089981"', 1100000), colorsEnd = source.indexOf(";function t7", colorsStart);
const statsStart = source.indexOf("var ie=", colorsEnd), statsEnd = source.indexOf(";function it", statsStart);
assert.ok(colorsStart > 0 && colorsEnd > colorsStart && statsStart > colorsEnd && statsEnd > statsStart);
// Reviewed literal palette/enum/stat-key declarations and pure settings parser.
const reference = runInNewContext(`${source.slice(colorsStart, colorsEnd)};${source.slice(statsStart, statsEnd)};${["t7", "it", "ii", "ir", "ia", "is"].map(block).join("\n")}\nis`, Object.create(null), { timeout: 1000 });
let comparisons = 0;
for (const [background, light] of [["#000000", false], ["#ffffff", true], ["#777777", false], ["#808080", true]] as const) {
  const defaults = reference({}, "", light), style = defaultFootprint();
  assert.equal(footprintTextColor(style, { background, textColor: "#ff00ff" }), defaults.text.color); comparisons++;
  assert.equal(footprintPocColor(style.pocColor, background), defaults.poc.color); comparisons++;
  for (const color of ["#112233", "#aabbcc80", "rgba(10,20,30,0.4)", "#00000000", "#d1d4dc", "#ffffff", "#b2b5be", "#3a3d45", "#a3a9b5"]) {
    const custom = reference({ textColor: color, pocColor: color }, "", light);
    assert.deepEqual(tpoColorRgba(footprintTextColor({ textColor: explicitPickerColor(color), textColorAuto: false }, { background, textColor: "#ff00ff" })), tpoColorRgba(custom.text.color)); comparisons++;
    assert.deepEqual(tpoColorRgba(footprintPocColor(explicitPickerColor(color), background)), tpoColorRgba(custom.poc.color)); comparisons++;
  }
}
const report = { checkedAt: new Date().toISOString(), sourceHash, comparisons, scope: "Reviewed reference settings parser: light/dark defaults and explicit text/POC colors including alpha and all opaque default-marker collisions versus production picker/color resolution, compared as RGBA values. Existing six-digit legacy markers retain old adaptation; new explicit picker choices use equivalent eight-digit CSS. Explicit legacy chart-theme override is an app compatibility option. Not complete control or whole-renderer parity." };
await writeFile("artifacts/footprint-theme-reference.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
