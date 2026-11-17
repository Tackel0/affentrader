import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url), dist = path.dirname(require.resolve("@luxalgo/vela"));
const info = JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8"));
if (info.version !== "0.9.0") throw new Error("Review the profile worker projector adapter before upgrading Vela.");
const marker = "/* Affentrader profile worker projector v1 */";
const anchor = /(drawingProjector\(\) \{\s*)return (createProjector\([\s\S]*?\n    \));/g;
const changes = []; let found = 0;
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name), source = await fs.readFile(file, "utf8");
  const ready = source.split(marker).length - 1, matches = [...source.matchAll(anchor)];
  if (!ready && !matches.length) continue;
  if (ready > 1 || (!ready && matches.length !== 1)) throw new Error(`Unexpected drawing projector in ${name}.`);
  found++;
  if (!ready) changes.push({ file, source: source.replace(anchor, (_, start, factory) => `${start}${marker}\n    return Object.assign(${factory}, { afCanvas: this.drawingsCanvas, afRepaint: () => this.scheduler?.invalidate(4 /* Full */) });`) });
}
if (found !== 5) throw new Error(`Expected five native projectors; found ${found}.`);
for (const { file, source } of changes) { const temp = `${file}.affentrader-tmp`; await fs.writeFile(temp, source); await fs.rename(temp, file); }
await fs.mkdir("public/workers", { recursive: true });
await build({ entryPoints: ["workers/fixed-profile.worker.ts"], bundle: true, format: "iife", platform: "browser", outfile: "public/workers/fixed-profile.js", minify: true, legalComments: "eof" });
await build({ entryPoints: ["workers/session-profile.worker.ts"], bundle: true, format: "iife", platform: "browser", outfile: "public/workers/session-profile.js", minify: true, legalComments: "eof" });
if (changes.length) process.stdout.write(`Vela profile worker: adapted ${changes.length} pinned projectors.\n`);
