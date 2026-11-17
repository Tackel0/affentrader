import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url), dist = path.dirname(require.resolve("@luxalgo/vela"));
const info = JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8"));
if (info.version !== "0.9.0") throw new Error(`Review settings-navigation adapter for Vela ${info.version}.`);
const bundle = await build({ entryPoints: ["lib/chart/settingsRail.ts"], bundle: true, write: false, format: "iife", globalName: "affentraderSettingsNavigation", minify: true, target: "es2020" });
const begin = "/* Affentrader settings navigation begin */", end = "/* Affentrader settings navigation end */";
const helper = `${begin}${bundle.outputFiles[0].text.trim()}${end}`;
const oldToggle = `      this.toggleRail = (open) => {
        const on = open ?? !rail.classList.contains("open");
        rail.classList.toggle("open", on);
        railScrim?.classList.toggle("open", on);
      };`;
const oldEscape = 'onEscapeKeyDown: (event) => { if (isPopoverOpen()) event.preventDefault(); },';
const newEscape = `onEscapeKeyDown: (event) => { /* Affentrader settings rail Escape */
        if (isPopoverOpen()) { event.preventDefault(); return; }
        const settings = document.activeElement?.closest(".vela-dialog--settings");
        if (settings?.querySelector(".vela-sd-rail.open")) {
          event.preventDefault(); settings.querySelector(".vela-sd-burger")?.click();
        }
      },`;
const changes = []; let settings = 0, escapes = 0;
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name), original = await fs.readFile(file, "utf8"); let source = original;
  const indent = name === "vela.global.js" ? "    " : "  ";
  const normalized = value => value.replaceAll("\n  ", `\n${indent}`);
  const replace = (before, after) => {
    before = normalized(before); after = normalized(after);
    if (source.includes(after)) return;
    if (source.split(before).length !== 2) throw new Error(`Unexpected settings-navigation anchor in ${name}: ${before.slice(0, 65)}`);
    source = source.replace(before, after);
  };
  if (source.includes("var SettingsDialog = class {")) {
    settings++;
    if (source.includes(begin)) {
      const start = source.indexOf(begin), finish = source.indexOf(end, start) + end.length;
      if (finish < start || source.split(begin).length !== 2) throw new Error(`Invalid settings helper in ${name}.`);
      source = source.slice(0, start) + helper + source.slice(finish);
    } else replace("var SettingsDialog = class {", `${helper}\nvar SettingsDialog = class {`);
    const parameter = source.match(/this\.toggleRail = \((open\d*)\) =>/)?.[1] ?? "open";
    replace(oldToggle.replace("(open)", `(${parameter})`).replace("on = open ??", `on = ${parameter} ??`), "      /* Affentrader: rail controller is installed after pane creation. */");
    replace("    const panes = [];\n    let current = null;", `    if (mobile) this.toggleRail = affentraderSettingsNavigation.installSettingsRail(rail, paneHost, ui.positioner.querySelector(".vela-sd-burger"), railScrim);\n    const panes = [];\n    let current = null;`);
    replace('        p.tab.classList.toggle("on", i === idx);', '        p.tab.classList.toggle("on", i === idx);\n        p.tab.setAttribute("aria-current", i === idx ? "page" : "false");');
  }
  if (source.includes(oldEscape) || source.includes("/* Affentrader settings rail Escape */")) { escapes++; replace(oldEscape, newEscape); }
  if (source !== original) changes.push({ file, source });
}
if (settings !== 5 || escapes !== 6) throw new Error(`Expected five settings and six dialog bundles; found ${settings}/${escapes}.`);
for (const { file, source } of changes) { const temporary = `${file}.affentrader-nav-tmp`; await fs.writeFile(temporary, source, "utf8"); await fs.rename(temporary, file); }
if (changes.length) process.stdout.write(`Vela settings navigation: adapted ${changes.length} pinned bundles.\n`);
