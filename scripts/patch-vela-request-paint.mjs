import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const directory = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
const { version } = JSON.parse(await fs.readFile(path.join(directory, "../package.json"), "utf8"));
if (version !== "0.9.0") throw new Error(`Review chart paint scheduling before using Vela ${version}.`);

const targets = [
  ["dataWindowReadout() {", `requestPaint() { /* Affentrader: request a native paint without resizing. */
    this.renderer.requestPaint?.();
  }`],
  ["getDataWindowReadout() {", `requestPaint() { /* Affentrader: coalesce custom layer updates with the native frame. */
    this.scheduler?.invalidate(4 /* Full */);
  }`],
];
const counts = targets.map(() => 0);
const changes = [];
for (const name of await fs.readdir(directory)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(directory, name);
  const original = await fs.readFile(file, "utf8");
  let source = original;
  for (let i = 0; i < targets.length; i++) {
    const [anchor, method] = targets[i];
    const count = source.split(anchor).length - 1;
    if (!count) continue;
    if (count !== 1) throw new Error(`Unexpected chart paint anchor in ${name}.`);
    counts[i]++;
    if (!source.includes(method)) source = source.replace(anchor, `${method}\n  ${anchor}`);
  }
  if (source !== original) changes.push({ file, source });
}
if (counts.some((count) => count !== 5)) throw new Error(`Expected five copies of each chart paint adapter, got ${counts.join(",")}.`);
for (const { file, source } of changes) {
  const temporary = `${file}.affentrader-paint-tmp`;
  await fs.writeFile(temporary, source);
  await fs.rename(temporary, file);
}
