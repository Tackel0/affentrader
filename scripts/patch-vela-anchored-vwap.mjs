import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), dist = path.dirname(require.resolve("@luxalgo/vela"));
const info = JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8"));
if (info.version !== "0.9.0") throw new Error(`Review the Anchored VWAP adapter for Vela ${info.version}.`);
const marker = "/* Affentrader anchored VWAP notice v1 */";
const original = /paintAnchoredVwap\(ctx, d, proj\) \{\s*const L = d\.layout\(proj\);/g;
const replacement = `paintAnchoredVwap(ctx, d, proj, theme) {
    const L = d.layout(proj);
    ${marker}
    if (typeof d.vwapNotice === "string" && d.vwapNotice) {
      const pane = proj.paneRect?.(d.paneId) ?? { top: 0, height: proj.height };
      const x = Math.max(8, Math.min(proj.width - 220, proj.xOf(d.anchors[0]?.time ?? 0)));
      const width = Math.max(20, proj.width - x - 8);
      let bottom = pane.top + 34;
      if (L) for (const points of [L.upper, L.lower]) for (const point of points) bottom = Math.max(bottom, point[1]);
      const lines = []; let line = "";
      ctx.save(); ctx.font = "10px sans-serif"; ctx.textBaseline = "alphabetic";
      for (const word of d.vwapNotice.split(" ")) {
        const next = line ? line + " " + word : word;
        if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
      }
      if (line) lines.push(line);
      const top = Math.max(pane.top + 14, Math.min(bottom + 14, pane.top + pane.height - 32 - (lines.length - 1) * 12));
      ctx.fillStyle = theme.background; ctx.fillRect(x - 3, top - 11, width + 6, lines.length * 12 + 2);
      ctx.fillStyle = theme.textColor;
      lines.forEach((text, index) => ctx.fillText(text, x, top + index * 12, width)); ctx.restore();
    }`;
const changes = []; let found = 0;
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name), source = (await fs.readFile(file, "utf8")).replaceAll("\r\n", "\n");
  const count = [...source.matchAll(original)].length, ready = source.split(marker).length - 1;
  if (!count && !ready) continue;
  if (count + ready !== 1) throw new Error(`Unexpected Anchored VWAP painter in ${name}.`);
  found++;
  if (!ready) {
    const call = "this.paintAnchoredVwap(ctx, d, proj);";
    if (source.split(call).length - 1 !== 1) throw new Error(`Unexpected Anchored VWAP dispatch in ${name}.`);
    changes.push({ file, source: source.replace(original, replacement).replace(call, "this.paintAnchoredVwap(ctx, d, proj, theme);") });
  } else {
    const oldPosition = "Math.min(bottom + 14, pane.top + pane.height - 8 - (lines.length - 1) * 12)", currentPosition = "Math.min(bottom + 14, pane.top + pane.height - 32 - (lines.length - 1) * 12)";
    if (source.split(oldPosition).length - 1 === 1) changes.push({ file, source: source.replace(oldPosition, currentPosition) });
    else if (source.split(currentPosition).length - 1 !== 1) throw new Error(`Unexpected Anchored VWAP notice position in ${name}.`);
  }
}
if (found !== 5) throw new Error(`Expected five pinned Anchored VWAP painters; found ${found}.`);
for (const { file, source } of changes) {
  const temporary = `${file}.affentrader-tmp`; await fs.writeFile(temporary, source, "utf8"); await fs.rename(temporary, file);
}
if (changes.length) process.stdout.write(`Vela Anchored VWAP: adapted ${changes.length} pinned painters.\n`);
