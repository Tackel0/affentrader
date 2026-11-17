import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), dist = path.dirname(require.resolve("@luxalgo/vela"));
const info = JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8"));
if (info.version !== "0.9.0") throw new Error(`Review the native readout adapter before using Vela ${info.version}.`);
const bounded = "Number.isInteger(this.hoverLogical) && this.hoverLogical >= 0 && this.hoverLogical < n";
const targets = [
  {
    name: "settled theme settings",
    original: `this.settingsDialog?.refreshConfig(this.getConfig());
    this.syncThemeControl();
    this.settingsDialog?.setTheme(this.theme);`,
    patch: anchor => `queueMicrotask(() => { /* Affentrader: include synchronous host canvas restores after theme events. */
      this.settingsDialog?.refreshConfig(this.getConfig());
      this.syncThemeControl();
      this.settingsDialog?.setTheme(this.theme);
    });`,
  },
  {
    name: "responsive settings snapshot",
    original: `this.userDrawings?.setLayoutMode(mode);
    this.settingsDialog?.setLayoutMode(mode);`,
    patch: anchor => anchor.replace("this.settingsDialog?.setLayoutMode(mode);", 'this.settingsDialog?.refreshConfig(this.getConfig()); /* Affentrader: re-present current settings, not the open-time snapshot. */\n    this.settingsDialog?.setLayoutMode(mode);'),
  },
  {
    name: "data window",
    original: `getDataWindowReadout() {
    const n = this.bars.length;
    if (n === 0) return { date: "", time: "", ohlc: null, groups: [] };
    const idx = this.hoverLogical != null ? this.hoverLogical : n - 1;`,
    patch: anchor => anchor.replace("this.hoverLogical != null", bounded) + " /* Affentrader: stale crosshairs fall back inside the revealed series. */",
  },
  {
    name: "legend",
    original: `const values = /* @__PURE__ */ new Map();
    if (n > 0) {
      const idx = this.hoverLogical != null ? this.hoverLogical : n - 1;`,
    patch: anchor => anchor.replace("this.hoverLogical != null", bounded) + " /* Affentrader: legends read the same bounded bar as the data window. */",
  },
  {
    name: "identified plot surfaces",
    original: `const rows = this.readoutRowsFor(model, idx, pricePane, "dataWindow");
      if (rows.length) groups.push({ name: this.modelTitle(model), rows });`,
    patch: anchor => anchor.replace('if (rows.length) groups.push({ name: this.modelTitle(model), rows });',
      'const legendRows = this.readoutRowsFor(model, idx, pricePane, "legend");\n      if (rows.length || legendRows.length) groups.push({ id: model.id, name: this.modelTitle(model), rows, legendRows }); /* Affentrader: stable instance identity and distinct plot surfaces. */'),
  },
  {
    name: "keyboard announcement",
    original: `this.bars = normalizeBars(bars);
    this.scene.bars = this.bars;`,
    patch: anchor => anchor.replace("this.scene.bars = this.bars;", 'if (this.liveRegion) this.liveRegion.textContent = ""; /* Affentrader: discard prior-series keyboard announcements. */\n    this.scene.bars = this.bars;'),
  },
].map(target => ({ ...target, found: 0, variants: [target.original, target.original.replaceAll("\n    ", "\n      ")].map(original => {
  // The UMD form has two extra spaces at every nested line.
  const patched = target.patch(target.original);
  return { original, patched: original === target.original ? patched : patched.replaceAll("\n    ", "\n      ") };
}) }));
const changes = [];
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name), initial = await fs.readFile(file, "utf8");
  let source = initial;
  for (const target of targets) {
    const matched = target.variants.find(variant => source.includes(variant.original) || source.includes(variant.patched));
    if (!matched) continue;
    const ready = source.split(matched.patched).length - 1, untouched = source.split(matched.original).length - 1;
    if (ready + untouched !== 1) throw new Error(`Unexpected ${target.name} anchor count in ${name}.`);
    target.found++;
    if (untouched) source = source.replace(matched.original, matched.patched);
  }
  if (source !== initial) changes.push({ file, source });
}
for (const target of targets) if (target.found !== 5) throw new Error(`Expected five Vela 0.9 ${target.name} bundles; found ${target.found}.`);
for (const { file, source } of changes) {
  const temporary = `${file}.affentrader-readout-tmp`;
  await fs.writeFile(temporary, source, "utf8"); await fs.rename(temporary, file);
}
if (changes.length) process.stdout.write(`Vela readout: adapted ${changes.length} pinned bundles.\n`);
