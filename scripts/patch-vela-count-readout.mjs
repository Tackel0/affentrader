import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
if (JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8")).version !== "0.9.0") throw new Error("Review native count readout formatting before upgrading Vela.");
const original = 'value: this.dataWindowFmt(value, pane, surface === "legend" ? "legend" : "dataWindow"), color });';
const patched = 'value: Number.isSafeInteger(value) && ["af-trade-count", "af-trade-count-delta", "af-ctcd"].includes(model.native?.type) ? (this.scene.format ?? ENGLISH_FORMAT).price(value, { decimals: 0, mode: "price", surface: surface === "legend" ? "legend" : "dataWindow" }) : this.dataWindowFmt(value, pane, surface === "legend" ? "legend" : "dataWindow"), color }); /* Affentrader count readouts v1: per-model integer units, independent of price tick and shared pane. */';
const changes = []; let found = 0;
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name), source = await fs.readFile(file, "utf8");
  const untouched = source.split(original).length - 1, ready = source.split(patched).length - 1;
  if (!untouched && !ready) continue;
  if (untouched + ready !== 1) throw new Error(`Ambiguous native count readout anchor in ${name}.`);
  found++;
  if (untouched) changes.push({ file, source: source.replace(original, patched) });
}
if (found !== 5) throw new Error(`Expected five native count readout bundles, found ${found}.`);
for (const { file, source } of changes) {
  const temporary = `${file}.affentrader-tmp`;
  await fs.writeFile(temporary, source); await fs.rename(temporary, file);
}
if (changes.length) process.stdout.write(`Vela count readouts: adapted ${changes.length} pinned bundles.\n`);
