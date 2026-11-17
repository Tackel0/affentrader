import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), dist = path.dirname(require.resolve("@luxalgo/vela"));
const info = JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8"));
if (info.version !== "0.9.0") throw new Error(`Review the fixed-profile notice adapter for Vela ${info.version}.`);
const marker = "/* Affentrader fixed profile notice v1 */";
const anchor = /paintFixedRangeVp\(ctx, d, proj, theme\) \{\s*const L = d\.layout\(proj\);/g;
const replacement = `paintFixedRangeVp(ctx, d, proj, theme) {
    const L = d.layout(proj);
    ${marker}
    if (typeof d.frvpNotice === "string" && d.frvpNotice) {
      const pane = proj.paneRect?.(d.paneId) ?? { top: 0, height: proj.height };
      const start = L?.x0 ?? proj.xOf(d.anchors[0]?.time ?? 0);
      const x = Math.max(8, Math.min(proj.width - 180, start));
      const width = Math.max(20, proj.width - x - 8);
      const y = Math.max(pane.top + 14, Math.min(pane.top + pane.height - 14, L ? Math.max(...L.yEdges) + 14 : pane.top + 48));
      ctx.save(); ctx.font = "10px sans-serif"; ctx.textBaseline = "alphabetic";
      const lines = []; let line = "";
      for (const word of d.frvpNotice.split(" ")) {
        const next = line ? line + " " + word : word;
        if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
      }
      if (line) lines.push(line);
      const top = Math.min(y, pane.top + pane.height - 8 - (lines.length - 1) * 12);
      ctx.fillStyle = theme.background; ctx.fillRect(x - 3, top - 11, Math.min(width + 6, Math.max(...lines.map(text => ctx.measureText(text).width)) + 6), lines.length * 12 + 2);
      ctx.fillStyle = theme.textColor;
      lines.forEach((text, index) => ctx.fillText(text, x, top + index * 12, width)); ctx.restore();
    }`;
const changes = []; let found = 0;
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name), source = await fs.readFile(file, "utf8");
  const count = [...source.matchAll(anchor)].length, ready = source.split(marker).length - 1;
  if (!count && !ready) continue;
  if (count !== 1 || ready > 1) throw new Error(`Unexpected fixed-profile painter in ${name}.`);
  found++;
  if (!ready) changes.push({ file, source: source.replace(anchor, replacement) });
  else if (!source.includes("/* Affentrader fixed profile notice foreground v2 */")) {
    const previous = ["L ? Math.min(...L.yEdges) - 8 : pane.top + 28", "L ? Math.min(...L.yEdges) - 8 : pane.top + 48"];
    const current = "L ? Math.max(...L.yEdges) + 14 : pane.top + 48", legacy = previous.filter(value => source.split(value).length - 1 === 1);
    if (legacy.length === 1) changes.push({ file, source: source.replace(legacy[0], current) });
    else if (source.split(current).length - 1 !== 1) throw new Error(`Unexpected fixed-profile notice position in ${name}.`);
  }
}
if (found !== 5) throw new Error(`Expected five pinned fixed-profile painters; found ${found}.`);
for (const { file, source } of changes) {
  const temporary = `${file}.affentrader-tmp`; await fs.writeFile(temporary, source, "utf8"); await fs.rename(temporary, file);
}
if (changes.length) process.stdout.write(`Vela fixed profile: adapted ${changes.length} pinned painters.\n`);
