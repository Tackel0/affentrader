import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
if (JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8")).version !== "0.9.0") throw new Error("Review the study-axis-label adapter before upgrading Vela.");
const targets = [
  { original: "dataWindowReadout() {", patched: `setStudyAxisLabelPainter(painter) { /* Affentrader study axis labels v1: facade */
    this.renderer.setStudyAxisLabelPainter(painter);
  }
  dataWindowReadout() {` },
  { original: "getDataWindowReadout() {", patched: `setStudyAxisLabelPainter(painter) { /* Affentrader study axis labels v1: native */
    this.chrome.afStudyAxisLabels = painter;
    this.scheduler?.invalidate(2);
  }
  getDataWindowReadout() {` },
  { original: "this.drawPriceLineAndCountdown(ctx, scene, coords, theme, dataW, pricePane);", previous: `this.drawPriceLineAndCountdown(ctx, scene, coords, theme, dataW, pricePane);
    /* Affentrader study axis labels v1: chrome, including native snapshot composition */
    this.afStudyAxisLabels?.({ ctx, scene, coords, theme, dataW, panes, axisX: column => axisColumnX(dataW, column), format: (value, scale, height) => formatPriceLabel(scale, height, value, scene.priceMintick, scene.format) });`, patched: `this.drawPriceLineAndCountdown(ctx, scene, coords, theme, dataW, pricePane);
    /* Affentrader study axis labels v2: native axis units and snapshot composition */
    this.afStudyAxisLabels?.({ ctx, scene, coords, theme, dataW, panes, axisX: column => axisColumnX(dataW, column), format: (value, scale, height, pane, own) => formatAxisValue(scale, height, value, own ? void 0 : percentScaleFor(scene, pane), scene.priceMintick, own ? void 0 : pane.axisFormat, scene.format) });` },
];
// Count-aware value chips share this seam; keep one owner so repeated builds
// never append a second callback after the count-axis adapter has run.
const axisTarget = targets[2];
axisTarget.previousV2 = axisTarget.patched;
axisTarget.patched = axisTarget.patched.replace(
  'format: (value, scale, height, pane, own) => formatAxisValue(scale, height, value, own ? void 0 : percentScaleFor(scene, pane), scene.priceMintick, own ? void 0 : pane.axisFormat, scene.format)',
  'format: (value, scale, height, pane, own, model) => afCountModel(model) ? afCountValue(value, scene.format ?? ENGLISH_FORMAT, "priceAxis") : formatAxisValue(scale, height, value, own ? void 0 : percentScaleFor(scene, pane), scene.priceMintick, own ? void 0 : pane.axisFormat, scene.format)'
);
const counts = targets.map(() => 0), changes = [];
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name); let source = await fs.readFile(file, "utf8"), changed = false;
  for (let index = 0; index < targets.length; index++) {
    const { original, patched, previous, previousV2 } = targets[index], ready = source.split(patched).length - 1;
    if (ready) { if (ready !== 1) throw new Error(`Duplicate study-axis adapter in ${name}.`); counts[index]++; continue; }
    if (previousV2 && source.includes(previousV2)) { if (source.split(previousV2).length !== 2) throw new Error(`Duplicate v2 study-axis adapter in ${name}.`); source = source.replace(previousV2, patched); counts[index]++; changed = true; continue; }
    if (previous && source.includes(previous)) { if (source.split(previous).length !== 2) throw new Error(`Duplicate old study-axis adapter in ${name}.`); source = source.replace(previous, patched); counts[index]++; changed = true; continue; }
    const count = source.split(original).length - 1; if (!count) continue;
    if (count !== 1) throw new Error(`Ambiguous study-axis adapter anchor in ${name}.`);
    counts[index]++; source = source.replace(original, patched); changed = true;
  }
  if (changed) changes.push({ file, source });
}
if (counts.some(count => count !== 5)) throw new Error(`Expected five copies of each study-axis seam, got ${counts.join(",")}.`);
for (const { file, source } of changes) { const temporary = `${file}.affentrader-tmp`; await fs.writeFile(temporary, source); await fs.rename(temporary, file); }
if (changes.length) process.stdout.write(`Vela study axis labels: adapted ${changes.length} pinned bundles.\n`);
