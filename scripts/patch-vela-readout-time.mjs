import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
if (JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8")).version !== "0.9.0") throw new Error("Review the selected-bar timestamp adapter before upgrading Vela.");
const anchor = "return { date: parts.date, time: parts.time, ohlc: this.dataWindowOHLC(bar, pricePane), groups: this.dataWindowGroups(idx, pricePane) };";
const variants = [anchor, anchor.replaceAll("parts.", "parts3.")].map(original => {
  const previous = original.replace("return { ", "return { /* Affentrader selected-bar timestamp v2 */ barTime: bar?.time, seriesRange: { first: this.bars[0].time, last: this.bars[this.bars.length - 1].time, count: this.bars.length, high: this.bars[this.bars.length - 1].high, low: this.bars[this.bars.length - 1].low }, ");
  const third = previous.replace("timestamp v2", "timestamp v3").replace("low: this.bars[this.bars.length - 1].low", "low: this.bars[this.bars.length - 1].low, open: this.bars[this.bars.length - 1].open, close: this.bars[this.bars.length - 1].close");
  return { original, previous, third,
  legacy: original.replace("return { ", "return { /* Affentrader selected-bar timestamp v1 */ barTime: bar?.time, "),
  patched: third.replace("timestamp v3", "timestamp v4").replace("close: this.bars[this.bars.length - 1].close", "close: this.bars[this.bars.length - 1].close, volume: this.bars[this.bars.length - 1].volume") }; });
let found = 0; const changes = [];
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name), source = await fs.readFile(file, "utf8");
  const variant = variants.find(value => [value.original, value.legacy, value.previous, value.third, value.patched].some(text => source.includes(text))); if (!variant) continue;
  const matches = [variant.original, variant.legacy, variant.previous, variant.third, variant.patched].filter(text => source.includes(text));
  if (matches.length !== 1 || source.split(matches[0]).length !== 2) throw new Error(`Unexpected selected-bar readout in ${name}.`);
  found++; if (matches[0] !== variant.patched) changes.push({ file, source: source.replace(matches[0], variant.patched) });
}
if (found !== 5) throw new Error(`Expected five selected-bar readouts; found ${found}.`);
for (const { file, source } of changes) { const temp = `${file}.affentrader-tmp`; await fs.writeFile(temp, source); await fs.rename(temp, file); }
if (changes.length) process.stdout.write(`Vela selected-bar timestamp: adapted ${changes.length} pinned readouts.\n`);
