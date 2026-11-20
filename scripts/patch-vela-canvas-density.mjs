import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
// Only Vela's backing resolution changes. The host and all input coordinates keep their CSS geometry.
const original = "const dpr = window.devicePixelRatio || 1;";
const adapted = `const canvasDensity = Number.parseFloat(getComputedStyle(this.wrapper).getPropertyValue("--chart-canvas-max-dpr"));
    const dpr = Math.min(window.devicePixelRatio || 1, canvasDensity > 0 ? canvasDensity : Infinity);`;
const changes = [];
let found = 0;
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name);
  const source = await fs.readFile(file, "utf8");
  const oldCount = source.split(original).length - 1;
  const newCount = source.split(adapted).length - 1;
  if (oldCount + newCount === 0) continue;
  if (oldCount + newCount !== 1) throw new Error(`Unexpected chart canvas sizing anchor in ${name}.`);
  found++;
  if (oldCount) changes.push({ file, source: source.replace(original, adapted) });
}
if (found !== 5) throw new Error(`Expected five Vela canvas sizing bundles, found ${found}.`);
for (const { file, source } of changes) {
  const temporary = `${file}.affentrader-density-tmp`;
  await fs.writeFile(temporary, source);
  await fs.rename(temporary, file);
}
if (changes.length) process.stdout.write(`Vela canvas density: adapted ${changes.length} pinned bundles.\n`);
