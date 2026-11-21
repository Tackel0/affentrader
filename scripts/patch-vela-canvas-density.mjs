import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
// Backing resolution and input geometry use the same effective pixel ratio.
const originalDpr = "const dpr = window.devicePixelRatio || 1;";
const adaptedDpr = `const canvasDensity = Number.parseFloat(getComputedStyle(this.wrapper).getPropertyValue("--chart-canvas-max-dpr"));
    const dpr = Math.min(window.devicePixelRatio || 1, canvasDensity > 0 ? canvasDensity : Infinity);`;
const canvasPatches = [
  // Assigning an equal dimension still clears and resets a canvas context.
  ["canvas.width = bw;\n      canvas.height = bh;", `/* Affentrader: retain the current backing buffer when its size is unchanged. */
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;`],
  // Release the drawing buffers promptly when changing charts or layouts.
  ["this.wrapper?.remove();\n  }\n  // ── price data", `/* Affentrader: free detached plot backing buffers before garbage collection. */
    for (const canvas of this.plot?.querySelectorAll("canvas") ?? []) {
      if (canvas.width) canvas.width = 0;
      if (canvas.height) canvas.height = 0;
    }
    this.wrapper?.remove();
  }
  // ── price data ──`],
  ["l.instance.destroy?.();\n    l.canvas.remove();", `l.instance.destroy?.();
    if (l.canvas.width) l.canvas.width = 0;
    if (l.canvas.height) l.canvas.height = 0;
    l.canvas.remove();`],
];
const changes = [];
let found = 0;
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name);
  const source = await fs.readFile(file, "utf8");
  const oldCount = source.split(originalDpr).length - 1;
  const newCount = source.split(adaptedDpr).length - 1;
  if (oldCount + newCount === 0) continue;
  if (oldCount + newCount !== 1) throw new Error(`Unexpected chart density anchor in ${name}.`);
  // The standalone build nests the renderer two spaces deeper than the ESM build.
  const indent = name.startsWith("vela.") ? "  " : "";
  const indentLines = value => value.replaceAll("\n", `\n${indent}`);
  let next = oldCount ? source.replace(originalDpr, adaptedDpr) : source;
  for (const [original, adapted] of canvasPatches) {
    const before = indentLines(original);
    const after = indentLines(adapted);
    if (next.includes(after)) continue;
    if (next.split(before).length !== 2) throw new Error(`Unexpected chart canvas sizing anchor in ${name}.`);
    next = next.replace(before, after);
  }
  found++;
  if (next !== source) changes.push({ file, source: next });
}
if (found !== 5) throw new Error(`Expected five Vela canvas sizing bundles, found ${found}.`);
for (const { file, source } of changes) {
  const temporary = `${file}.affentrader-density-tmp`;
  await fs.writeFile(temporary, source);
  await fs.rename(temporary, file);
}
if (changes.length) process.stdout.write(`Vela canvas density: adapted ${changes.length} pinned bundles.\n`);
