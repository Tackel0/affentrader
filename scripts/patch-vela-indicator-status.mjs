import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
const { version } = JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8"));
if (version !== "0.9.0") throw new Error(`Review indicator status rendering before using Vela ${version}.`);

const changes = [];
const counts = [0, 0, 0];

for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name);
  const original = await fs.readFile(file, "utf8");
  let source = original;
  const indent = name === "vela.global.js" ? "      " : "    ";
  const targets = [
    ["el, titleEl, statusEl, valuesEl, plotValues:", 'el, titleEl, statusEl, status: "idle", valuesEl, plotValues:'],
    [`if (!row2) return;\n${indent}const el = row2.statusEl;`,
      `if (!row2 || row2.status === status) return;\n${indent}row2.status = status;\n${indent}const el = row2.statusEl;`],
    ['background:${this.theme.upColor};animation:vela-ind-pulse', "background:var(--vela-up);animation:vela-ind-pulse"],
  ];
  for (const [index, [before, after]] of targets.entries()) {
    const unpatched = source.split(before).length - 1;
    const patched = source.split(after).length - 1;
    if (unpatched + patched === 0) continue;
    if (unpatched + patched !== 1) throw new Error(`Unexpected indicator status anchor in ${name}.`);
    counts[index]++;
    if (unpatched) source = source.replace(before, after);
  }
  if (source !== original) changes.push({ file, source });
}
if (counts.some(count => count !== 5)) throw new Error(`Expected five Vela indicator status bundles, got ${counts.join(", ")}.`);

for (const { file, source } of changes) {
  const temporary = `${file}.affentrader-indicator-status-tmp`;
  await fs.writeFile(temporary, source);
  await fs.rename(temporary, file);
}
