import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
const { version } = JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8"));
if (version !== "0.9.0") throw new Error(`Review price axis caching before using Vela ${version}.`);

const counts = [0, 0];
const changes = [];

for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name);
  const original = await fs.readFile(file, "utf8");
  let source = original;
  const defaults = name.endsWith(".cjs") || name === "vela.global.js" ? "defaults5" : "defaults";
  const callHook = `this.callHook(fn, scene, pane, coords, ${defaults}, pct?.baseline, pct ? pct.indexed ? "indexed" : "percent" : "price")`;
  const targets = [
    ["if (!fn || !(height > 0)) return paneAxisTicks(", "if (!(height > 0)) return paneAxisTicks("],
    [`const ticks = ${callHook};`, `const ticks = fn ? ${callHook} : ${defaults};`],
  ];
  for (const [index, [before, after]] of targets.entries()) {
    const unpatched = source.split(before).length - 1;
    const patched = source.split(after).length - 1;
    if (!unpatched && !patched) continue;
    if (unpatched + patched !== 1) throw new Error(`Unexpected price axis cache anchor in ${name}.`);
    counts[index]++;
    if (unpatched) source = source.replace(before, after);
  }
  if (source !== original) changes.push({ file, source });
}
if (counts.some(count => count !== 5)) throw new Error(`Expected five Vela price axis bundles, got ${counts.join(", ")}.`);

for (const { file, source } of changes) {
  const temporary = `${file}.affentrader-axis-cache-tmp`;
  await fs.writeFile(temporary, source);
  await fs.rename(temporary, file);
}
