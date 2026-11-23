import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
const info = JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8"));
if (info.version !== "0.9.0") throw new Error("Review drawing hitbox adaptation before upgrading Vela.");

const marker = "/* Affentrader drawing hitboxes v1 */";

const changes = [];
let found = 0;

for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name);
  const source = await fs.readFile(file, "utf8");
  const hasMarker = source.includes(marker);
  const hasHitTol = /^([ \t]*)var HIT_TOLERANCE = 6;$/m.test(source);
  if (!hasMarker && !hasHitTol) continue;

  found++;
  if (hasMarker) continue;

  let next = source;

  // 1. Tighten body HIT_TOLERANCE (6 -> 4) and add adaptive handle & tap-to-select tolerances
  const hitTolRe = /^([ \t]*)var HIT_TOLERANCE = 6;$/m;
  if (!hitTolRe.test(next)) throw new Error(`Missing HIT_TOLERANCE anchor in ${name}.`);
  next = next.replace(
    hitTolRe,
    `$1${marker}\n$1var HIT_TOLERANCE = 4;\n$1var AF_HANDLE_TOLERANCE = () => (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches ? 12 : 8);\n$1var AF_TAP_SELECT_TOLERANCE = () => (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches ? 10 : 5);`,
  );

  // 2. Increase drawing drag slop (3px -> 8px) so micro-jitter on tap never nudges an object
  const dragSlopRe = /(\/\/ src\/renderers\/native\/drawings\/DrawingInteraction\.ts\n[ \t]*var DRAG_SLOP\d* = )3;/;
  if (!dragSlopRe.test(next)) throw new Error(`Missing DrawingInteraction DRAG_SLOP anchor in ${name}.`);
  next = next.replace(dragSlopRe, "$18;");

  // 3. Use generous handle radius once an object is selected/hovered
  const handleDownRe = /const handle = hit\.hitHandle\(x, y, proj, HIT_TOLERANCE\);/;
  const handleHitRe = /if \(d\.hitHandle\(x, y, proj, HIT_TOLERANCE\) >= 0\) return d;/;
  if (!handleDownRe.test(next) || !handleHitRe.test(next)) {
    throw new Error(`Missing hitHandle anchor in ${name}.`);
  }
  next = next.replace(handleDownRe, "const handle = hit.hitHandle(x, y, proj, AF_HANDLE_TOLERANCE());");
  next = next.replace(handleHitRe, "if (d.hitHandle(x, y, proj, AF_HANDLE_TOLERANCE()) >= 0) return d;");

  // 4. Select-first, drag-second: unselected or locked drawings must not steal chart pan/pinch gestures
  const claimRe =
    /^([ \t]*)claim\(x, y\) \{\n\1  if \(this\.deps\.activeTool\(\) != null \|\| this\.state\.kind !== "idle"\) return true;\n\1  return this\.hitAt\(x, y\) != null;\n\1\}/m;
  if (!claimRe.test(next)) throw new Error(`Missing DrawingInteraction.claim anchor in ${name}.`);
  next = next.replace(
    claimRe,
    `$1claim(x, y) {\n$1  if (this.deps.activeTool() != null || this.state.kind !== "idle") return true;\n$1  const hit = this.hitAt(x, y);\n$1  if (!hit || hit.locked) return false;\n$1  return this.deps.selectedIds().has(hit.id);\n$1}`,
  );

  // 5. Add UserDrawings.selectAt(x, y) so a clean tap/click selects an unselected drawing
  const udClaimRe =
    /^([ \t]*)claim\(x, y\) \{\n\1  if \(this\.measureMode \|\| this\.eraserMode\) return true;\n\1  if \(this\.magnifierChipAt\(x, y\)\) return true;\n\1  return this\.interaction\.claim\(x, y\);\n\1\}/m;
  if (!udClaimRe.test(next)) throw new Error(`Missing UserDrawings.claim anchor in ${name}.`);
  next = next.replace(
    udClaimRe,
    `$&\n$1selectAt(x, y) {\n$1  if (this.activeTool != null || this.measureMode || this.eraserMode) return false;\n$1  const hit = topDrawingAt(this.onScreen(), x, y, this.deps.projector(), AF_TAP_SELECT_TOLERANCE());\n$1  if (!hit) return false;\n$1  this.openSettingsById(hit.id, x, y);\n$1  return true;\n$1}`,
  );

  // 6. Wire selectAt(x, y) into Vela's onClick before deselecting
  const onClickRe =
    /^([ \t]*)if \(this\.handleMarkClick\(x, y\)\) return;\n\1this\.userDrawings\?\.deselect\(\);/m;
  if (!onClickRe.test(next)) throw new Error(`Missing Vela onClick anchor in ${name}.`);
  next = next.replace(
    onClickRe,
    `$1if (this.handleMarkClick(x, y)) return;\n$1if (this.userDrawings?.selectAt?.(x, y)) return;\n$1this.userDrawings?.deselect();`,
  );

  changes.push({ file, source: next });
}

if (found !== 5) throw new Error(`Expected five pinned Vela bundles for drawing hitboxes; found ${found}.`);
for (const { file, source } of changes) {
  const temp = `${file}.affentrader-tmp`;
  await fs.writeFile(temp, source);
  await fs.rename(temp, file);
}
if (changes.length) {
  process.stdout.write(`Vela drawing hitboxes: adapted ${changes.length} pinned bundles.\n`);
}
