import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
if (JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8")).version !== "0.9.0") throw new Error("Review count axes before upgrading Vela.");
const helpers = `/* Affentrader count axes v1: units are selected from visible native model identity. */
function afCountModel(model) {
  return ["af-trade-count", "af-trade-count-delta", "af-ctcd"].includes(model?.native?.type);
}
function afCountAxis(pane, models) {
  const master = models.filter(model => model.ownScale !== true);
  const owns = pane.kind !== "price" && master.length > 0 && master.every(afCountModel);
  if (owns) pane.axisFormat = "af-count";
  else if (pane.axisFormat === "af-count") pane.axisFormat = void 0;
  return owns;
}
function afCountValue(value, fmt, surface) {
  const integer = Math.round(value);
  return Number.isSafeInteger(integer) ? fmt.price(integer === 0 ? 0 : integer, { decimals: 0, mode: "price", surface }) : "";
}
function afCountTicks(scale, heightPx, fmt) {
  const integers = [...new Set(paneTicks(scale, heightPx).map(Math.round))];
  return integers.filter(value => Number.isSafeInteger(value) && value >= scale.min && value <= scale.max)
    .map(price => ({ price: price === 0 ? 0 : price, label: afCountValue(price, fmt, "priceAxis") }));
}
`;
const targets = [
  { original: 'function paneAxisTicks(scale, heightPx, pct, mintick, format, fmt = ENGLISH_FORMAT) {', patched: helpers + 'function paneAxisTicks(scale, heightPx, pct, mintick, format, fmt = ENGLISH_FORMAT) {' },
  { original: 'if (format === "volume") {\n    return paneTicks(scale, heightPx).map((price) => ({ price, label: formatCompactValue(price, fmt) }));', patched: 'if (format === "af-count") return afCountTicks(scale, heightPx, fmt);\n  if (format === "volume") {\n    return paneTicks(scale, heightPx).map((price) => ({ price, label: formatCompactValue(price, fmt) }));' },
  { original: 'if (format === "volume") return formatCompactValue(value, fmt, surface);', patched: 'if (format === "af-count") return afCountValue(value, fmt, surface);\n  if (format === "volume") return formatCompactValue(value, fmt, surface);' },
  { original: 'for (const pane of panes) {\n      if (pane.manualScale) {', patched: 'for (const pane of panes) {\n      const afCountOwnsAxis = afCountAxis(pane, this.scene.indicatorsForPane(pane.id));\n      if (pane.manualScale) {' },
  { original: 'pane.axisFormat = void 0;\n      pane.axisBands = void 0;', patched: 'pane.axisFormat = afCountOwnsAxis ? "af-count" : void 0;\n      pane.axisBands = void 0;' },
  { original: 'paneAxisTicks(sc, pane.bounds.height, void 0, scene.priceMintick, void 0, scene.format)', patched: 'paneAxisTicks(sc, pane.bounds.height, void 0, scene.priceMintick, afCountModel(model) ? "af-count" : void 0, scene.format)' },
].map(target => ({ ...target, count: 0 }));
const changes = [];
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name), initial = await fs.readFile(file, "utf8"); let source = initial;
  for (const target of targets) {
    // The global bundle has two extra indentation spaces inside each function.
    const variants = [target, { original: target.original.replaceAll("\n", "\n  "), patched: target.patched.replaceAll("\n", "\n  ") }];
    const match = variants.find(({original,patched}) => source.includes(patched) || source.includes(original));
    if (!match) continue;
    const ready = source.split(match.patched).length - 1;
    if (ready > 1 || !ready && source.split(match.original).length !== 2) throw new Error(`Ambiguous count-axis anchor in ${name}.`);
    target.count++;
    if (!ready) source = source.replace(match.original, match.patched);
  }
  if (source !== initial) changes.push({file,source});
}
if (targets.some(target => target.count !== 5)) throw new Error(`Expected five copies per count-axis seam, got ${targets.map(t=>t.count).join(",")}.`);
for (const {file,source} of changes) {
  const temporary = `${file}.affentrader-tmp`; await fs.writeFile(temporary,source); await fs.rename(temporary,file);
}
if (changes.length) process.stdout.write(`Vela count axes: adapted ${changes.length} pinned bundles.\n`);
