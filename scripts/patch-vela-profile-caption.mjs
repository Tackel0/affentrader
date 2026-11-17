import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), dist = path.dirname(require.resolve("@luxalgo/vela"));
const info = JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8"));
if (info.version !== "0.9.0") throw new Error("Review the fixed-profile foreground caption before upgrading Vela.");
const marker = "/* Affentrader fixed profile notice foreground v2 */";
const bridge = "/* Affentrader fixed profile notice host v3 */";
const method = /paintFixedRangeVp\(ctx, d, proj, theme\) \{([\s\S]*?)\n[ \t]+\}\n[ \t]+(?=\/\*\* Paint an anchored VWAP)/g;
const changes = []; let found = 0;
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name), source = await fs.readFile(file, "utf8"), matches = [...source.matchAll(method)];
  if (!matches.length) continue;
  if (matches.length !== 1) throw new Error(`Unexpected profile caption method in ${name}.`);
  found++;
  if (source.includes(marker)) {
    if (!source.includes(bridge)) { const target = "const paintNotice = () => {"; if (source.split(target).length - 1 !== 1) throw new Error(`Unexpected caption callback in ${name}.`); changes.push({ file, source: source.replace(target, `${target}\n      ${bridge}\n      if (d.afReportNotice?.(d.frvpNotice)) return;`) }); }
    continue;
  }
  const body = matches[0][1], begin = body.indexOf("/* Affentrader fixed profile notice v1 */"), end = body.indexOf("    if (!L) return;", begin);
  if (begin < 0 || end < 0) throw new Error(`Missing profile source notice in ${name}.`);
  const notice = body.slice(begin, end).trimEnd().replace(/const y = [^\n]+;/, "const y = Math.min(pane.top + 48, pane.top + pane.height - 14);");
  const replacement = `paintFixedRangeVp(ctx, d, proj, theme) {\n    const L = d.layout(proj);\n    ${marker}\n    const paintNotice = () => {\n      ${bridge}\n      if (d.afReportNotice?.(d.frvpNotice)) return;\n      ${notice}\n    };\n    try {\n${body.slice(end)}\n    } finally { paintNotice(); }\n  }\n  `;
  changes.push({ file, source: source.replace(method, replacement) });
}
if (found !== 5) throw new Error(`Expected five fixed-profile caption methods; found ${found}.`);
for (const { file, source } of changes) { const temp = `${file}.affentrader-tmp`; await fs.writeFile(temp, source); await fs.rename(temp, file); }
if (changes.length) process.stdout.write(`Vela profile caption: adapted ${changes.length} foreground painters.\n`);
