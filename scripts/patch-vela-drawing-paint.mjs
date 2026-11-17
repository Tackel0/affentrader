import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
const info = JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8"));
if (info.version !== "0.9.0") throw new Error("Review custom drawing painting before upgrading Vela.");
const marker = "/* Affentrader registered drawing paint v1 */", anchor = "paintOne(ctx, d, proj, theme) {";
const changes = []; let found = 0;
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name), source = await fs.readFile(file, "utf8");
  const count = source.split(anchor).length - 1, ready = source.split(marker).length - 1;
  if (!count && !ready) continue;
  if (count !== 1 || ready > 1 || ready && !source.includes(`${anchor}\n    ${marker}`)) throw new Error(`Unexpected custom drawing paint anchor in ${name}.`);
  found++;
  if (!ready) changes.push({ file, source: source.replace(anchor, `${anchor}\n    ${marker}\n    if (typeof d.afPaint === "function") { d.afPaint(ctx, proj, theme); return; }`) });
}
if (found !== 5) throw new Error(`Expected five pinned drawing painters; found ${found}.`);
for (const { file, source } of changes) { const temp = `${file}.affentrader-tmp`; await fs.writeFile(temp, source); await fs.rename(temp, file); }
if (changes.length) process.stdout.write(`Vela custom drawings: adapted ${changes.length} pinned painters.\n`);
