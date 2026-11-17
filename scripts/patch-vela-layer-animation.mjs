import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), directory = path.dirname(require.resolve("@luxalgo/vela"));
const info = JSON.parse(await fs.readFile(path.join(directory, "../package.json"), "utf8"));
if (info.version !== "0.9.0") throw new Error(`Review custom layer animation before using Vela ${info.version}.`);
const original = "if (this.animZoom.on && l.instance.animating?.()) this.animator.start();";
const patched = "/* Affentrader: SDK layer fades own their clock independently of viewport zoom. */ if (l.instance.animating?.()) this.animator.start();";
const tick = /(\banimTick\(dtMs\)\s*\{[\s\S]*?this\.emitViewportChange\(\);\s*)return active;/g;
const tickMarker = "/* Affentrader: keep custom layer clocks alive after viewport motion stops. */";
const tickReturn = `${tickMarker} return active || this.extLayers.some((layer) => {
      const pane = this.layerPane(layer) ?? [...this.scene.panes.values()].find((candidate) => candidate.kind === "price");
      return !pane?.collapsed && !this.layerHiddenWithCandles(layer) && layer.instance.animating?.();
    });`;
const changes = []; let bundles = 0;
for (const name of await fs.readdir(directory)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(directory, name), source = await fs.readFile(file, "utf8");
  const count = source.split(original).length - 1, ready = source.split(patched).length - 1;
  if (!count && !ready) continue;
  if (count + ready !== 2) throw new Error(`Unexpected custom layer animation anchors in ${name}.`);
  const ticks = [...source.matchAll(tick)].length, readyTicks = source.split(tickMarker).length - 1;
  if (ticks + readyTicks !== 1) throw new Error(`Unexpected custom layer clock completion anchor in ${name}.`);
  bundles++;
  if (count || ticks) changes.push({ file, source: source.replaceAll(original, patched).replace(tick, (_match, prefix) => prefix + tickReturn) });
}
if (bundles !== 5) throw new Error(`Expected five Vela layer animation bundles; found ${bundles}.`);
for (const { file, source } of changes) {
  const temp = `${file}.affentrader-animation-tmp`;
  await fs.writeFile(temp, source); await fs.rename(temp, file);
}
if (changes.length) console.log(`Vela custom layer animation: adapted ${changes.length} pinned bundles.`);
