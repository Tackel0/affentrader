import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
const pkg = JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8"));
if (pkg.version !== "0.9.0") throw new Error("Review Vela candle repair before upgrading.");

const seams = [
  ["onBar(bar) {\n    if (this.healing) {", `onBar(bar) {
    const repair = bar[Symbol.for("affentrader.vela.candle-repair")];
    if (repair) {
      if (this.replayQueue) return;
      const tail = repair.bars.filter(b => b.time >= repair.from);
      if (!tail.length) return;
      const raw = this.rawBars.filter(b => b.time < repair.from).concat(tail);
      this.afRepairRevision = (this.afRepairRevision ?? 0) + 1;
      this.healing = false;
      this.healBuffer = [];
      this.setBarSeries(raw, { preserveView: true });
      this.notifySessionsBars("complete");
      this.events.emit("bar", tail[tail.length - 1]);
      return;
    }
    if (this.healing) {`],
  ["async healGap(fromMs) {\n    const gen = this.generation;", "async healGap(fromMs) {\n    const gen = this.generation;\n    const repairRevision = this.afRepairRevision;"],
  ["if (this.replayQueue) return;\n      for (const b of bars) this.applyBar(b, false);", "if (this.replayQueue || this.afRepairRevision !== repairRevision) return;\n      for (const b of bars) this.applyBar(b, false);"],
  ["if (this.generation === gen && !this.replayQueue) {\n        this.healing = false;", "if (this.generation === gen && !this.replayQueue && this.afRepairRevision === repairRevision) {\n        this.healing = false;"],
];

const changes = [];
for (const name of ["chunk-XIRSR3D6.js", "index.cjs", "workspace.cjs", "widget.cjs", "vela.global.js"]) {
  const file = path.join(dist, name);
  const original = await fs.readFile(file, "utf8");
  let updated = original;
  for (const [before, after] of seams) {
    const variants = [[before, after], [before.replaceAll("\n", "\n  "), after.replaceAll("\n", "\n  ")]];
    if (variants.some(([, applied]) => updated.split(applied).length === 2)) continue;
    const variant = variants.find(([anchor]) => updated.split(anchor).length === 2);
    if (!variant) throw new Error(`Missing or ambiguous candle repair anchor in ${name}.`);
    updated = updated.replace(...variant);
  }
  if (updated !== original) changes.push({ file, updated });
}
for (const { file, updated } of changes) {
  const temporary = `${file}.affentrader-tmp`;
  await fs.writeFile(temporary, updated);
  await fs.rename(temporary, file);
}
