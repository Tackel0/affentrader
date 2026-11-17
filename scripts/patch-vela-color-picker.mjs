import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url), dist = path.dirname(require.resolve("@luxalgo/vela"));
const info = JSON.parse(await fs.readFile(path.join(dist, "../package.json"), "utf8"));
if (info.version !== "0.9.0") throw new Error(`Review color-picker adapter for Vela ${info.version}.`);
const bundle = await build({ entryPoints: ["lib/chart/colorPickerEnhancement.ts"], bundle: true, write: false,
  format: "iife", globalName: "affentraderColorPicker", minify: true, target: "es2020" });
const begin = "/* Affentrader color fields begin */", end = "/* Affentrader color fields end */";
const helper = `${begin}${bundle.outputFiles[0].text.trim()}${end}`;
const changes = []; let found = 0;
for (const name of await fs.readdir(dist)) {
  if (!/\.(?:js|cjs)$/.test(name) || name.endsWith(".min.js")) continue;
  const file = path.join(dist, name), original = await fs.readFile(file, "utf8");
  if (!original.includes("function buildColorPicker(color, theme, onChange, options = {})")) continue;
  found++;
  let source = original;
  const indent = name === "vela.global.js" ? "    " : "  ";
  const replace = (before, after) => {
    before = before.replaceAll("\n  ", `\n${indent}`);
    after = after.replaceAll("\n  ", `\n${indent}`);
    if (source.includes(after)) return;
    if (source.split(before).length !== 2) throw new Error(`Unexpected color-picker anchor in ${name}: ${before.slice(0, 70)}`);
    source = source.replace(before, after);
  };
  if (source.includes(begin)) {
    const start = source.indexOf(begin), finish = source.indexOf(end, start) + end.length;
    source = source.slice(0, start) + helper + source.slice(finish);
  } else {
    const parsed = source.slice(source.indexOf("function buildColorPicker(")).match(/const (parsed\d*) = splitColor\(color\);/)?.[1];
    if (!parsed) throw new Error(`Missing native color parser in ${name}.`);
    const anchor = `  const ${parsed} = splitColor(color);\n  let curHex = ${parsed}.hex6;\n  let curAlpha = ${parsed}.alpha;`;
    replace(anchor, `${anchor}\n  ${helper}\n  let enhancedPicker = null;`);
  }
  replace('      sw.style.position = on ? "relative" : "";\n    }\n  };\n  const recentRow', '      sw.style.position = on ? "relative" : "";\n    }\n    enhancedPicker?.sync();\n  };\n  const recentRow');
  replace('      recentSwatches.appendChild(sw);\n    }\n  };', '      recentSwatches.appendChild(sw);\n    }\n    enhancedPicker?.sync();\n  };');
  replace('    pctBox.value = `${Math.round(curAlpha * 100)}%`;\n  };', '    pctBox.value = `${Math.round(curAlpha * 100)}%`;\n    enhancedPicker?.sync();\n  };');
  replace('  root.append(grid, recentRow, opLabel, opRow);\n  return root;', `  root.append(grid, recentRow, opLabel, opRow);\n  enhancedPicker = affentraderColorPicker.installColorPickerFields(root, {\n    swatches, recentSwatches, recentColors: () => recents, track, pctBox, customInput,\n    read: () => ({ hex: curHex, alpha: curAlpha }),\n    commit: ({ hex, alpha }) => {\n      curHex = hex; curAlpha = alpha; customInput.value = hex;\n      paintSelection(); paintOpacity(); addRecent(hex); renderRecents(); emit();\n    }\n  });\n  return root;`);
  replace('      ev.stopPropagation();\n      this.hide();\n    };\n    const onReflow', '      ev.stopImmediatePropagation();\n      this.hide();\n      this.trigger.focus({ preventScroll: true });\n    };\n    const onReflow');
  replace('    onChange(combineColor(curHex, curAlpha));', '    onChange(affentraderColorPicker.explicitPickerColor(combineColor(curHex, curAlpha)));');
  if (!source.includes("/* Affentrader settings rail Escape */")) replace('      closeOnEscape: opts.closeOnEscape ?? true,\n      closeOnInteractOutside: opts.closeOnInteractOutside ?? false,', '      closeOnEscape: opts.closeOnEscape ?? true,\n      onEscapeKeyDown: (event) => { if (isPopoverOpen()) event.preventDefault(); },\n      closeOnInteractOutside: opts.closeOnInteractOutside ?? false,');
  if (source !== original) changes.push({ file, source });
}
if (found !== 6) throw new Error(`Expected six color-picker bundles; found ${found}.`);
for (const { file, source } of changes) {
  const temporary = `${file}.affentrader-color-tmp`;
  await fs.writeFile(temporary, source, "utf8"); await fs.rename(temporary, file);
}
if (changes.length) process.stdout.write(`Vela color picker: adapted ${changes.length} pinned bundles.\n`);
