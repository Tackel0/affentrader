import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const directory = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela-pinets"));
const { version } = JSON.parse(await fs.readFile(path.join(directory, "../package.json"), "utf8"));
if (version !== "0.3.0") throw new Error(`Review chart worker cleanup before using Vela-PineTS ${version}.`);

// The pinned engine lazily creates a worker inside post(). A delayed library or
// history response can reach that method after terminate() has set worker to null.
const replacements = [
  [`  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }`, `  terminate() {
    this.affentraderClosed = true;
    this.worker?.terminate();
    this.worker = null;
    this.sessions.clear();
    this.prepares.clear();
    for (const resolve of this.contextWaits.values()) resolve(null);
    this.contextWaits.clear();
  }`],
  [`  post(msg) {
    this.workerInstance().postMessage(msg);
  }`, `  post(msg) {
    if (this.affentraderClosed) return;
    this.workerInstance().postMessage(msg);
  }`],
];

const changes = [];
for (const name of ["index.js", "index.cjs"]) {
  const file = path.join(directory, name);
  const original = await fs.readFile(file, "utf8");
  let source = original;
  for (const [before, after] of replacements) {
    const originalCount = source.split(before).length - 1;
    const patchedCount = source.split(after).length - 1;
    if (originalCount + patchedCount !== 1) throw new Error(`Unexpected Pine worker lifecycle anchor in ${name}.`);
    if (originalCount) source = source.replace(before, after);
  }
  if (original !== source) changes.push({ file, source });
}
for (const { file, source } of changes) {
  const temporary = `${file}.affentrader-lifecycle-tmp`;
  await fs.writeFile(temporary, source);
  await fs.rename(temporary, file);
}
if (changes.length) process.stdout.write(`Vela-PineTS: closed worker lifecycles in ${changes.length} pinned bundles.\n`);
