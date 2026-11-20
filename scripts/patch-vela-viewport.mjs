import {promises as fs} from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),dist=path.dirname(require.resolve("@luxalgo/vela"));
const info=JSON.parse(await fs.readFile(path.join(dist,"../package.json"),"utf8"));
if(info.version!=="0.9.0")throw new Error(`Review the native viewport adapter before using Vela ${info.version}.`);
const original="var MIN_BAR_SPACING = 0.5;",legacy="/* Affentrader: fit the bounded 20000-bar window on narrow charts. */ var MIN_BAR_SPACING = 0.01;",patched="/* Affentrader: fit the bounded 20000-bar window on narrow charts. */ var MIN_BAR_SPACING = 0.001;";
const changes=[];let found=0;
for(const name of await fs.readdir(dist)){
  if(!/\.(?:js|cjs)$/.test(name)||name.endsWith(".min.js"))continue;
  const file=path.join(dist,name),source=await fs.readFile(file,"utf8");
  const count=source.split(original).length-1,ready=source.split(patched).length-1,previous=source.split(legacy).length-1;
  if(count+ready+previous===0)continue;
  if(count+ready+previous!==1)throw new Error(`Unexpected viewport anchor count in ${name}.`);
  found++;if(count||previous)changes.push({file,source:source.replace(count?original:legacy,patched)});
}
if(found!==5)throw new Error(`Expected five Vela 0.9 viewport bundles; found ${found}.`);
for(const {file,source} of changes){
  // Replace the directory entry instead of modifying a potentially shared package hardlink.
  const temporary=`${file}.affentrader-tmp`;
  await fs.writeFile(temporary,source,"utf8");await fs.rename(temporary,file);
}
if(changes.length)process.stdout.write(`Vela viewport: adapted ${changes.length} pinned bundles.\n`);
await import("./patch-vela-readout.mjs");
await import("./patch-vela-color-picker.mjs");
await import("./patch-vela-fixed-profile.mjs");
await import("./patch-vela-anchored-vwap.mjs");
await import("./patch-vela-settings-navigation.mjs");
await import("./patch-vela-profile-worker.mjs");
await import("./patch-vela-profile-caption.mjs");
await import("./patch-vela-readout-time.mjs");
await import("./patch-vela-study-axis-labels.mjs");
await import("./patch-vela-drawing-paint.mjs");
await import("./patch-vela-layer-animation.mjs");
await import("./patch-vela-count-readout.mjs");
await import("./patch-vela-count-axis.mjs");
await import("./patch-vela-candle-repair.mjs");
await import("./patch-vela-request-paint.mjs");
await import("./patch-pine-worker-lifecycle.mjs");
