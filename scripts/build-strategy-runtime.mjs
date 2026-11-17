import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { patchMagnifier } from "./pinets-magnifier-patch.mjs";
import { patchStrategyAlerts } from "./pinets-alert-patch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("pinets"));
const packageRoot = path.dirname(dist);
const info = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
if (info.version !== "0.13.0") throw new Error(`Review the intrabar adapter before using PineTS ${info.version}.`);
const mapText = await fs.readFile(path.join(dist, "pinets.min.es.js.map"), "utf8");
const patchText = await fs.readFile(path.join(root, "scripts/pinets-magnifier-patch.mjs"), "utf8");
const alertPatchText = await fs.readFile(path.join(root, "scripts/pinets-alert-patch.mjs"), "utf8");
const ownText = await fs.readFile(fileURLToPath(import.meta.url), "utf8");
const hash = createHash("sha256").update(mapText).update(patchText).update(alertPatchText).update(ownText).digest("hex");
const outputRoot = path.join(root, ".generated");
const manifestFile = path.join(outputRoot, "strategy-runtime.manifest.json");
const out = path.join(outputRoot, "strategy-runtime.js");
try {
  const previous = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  const artifacts = [out, path.join(outputRoot, "strategy-runtime.d.ts"), path.join(outputRoot, "PineTS-LICENSE")];
  if (previous.hash === hash && (await Promise.all(artifacts.map(file => fs.stat(file).then(() => true).catch(() => false)))).every(Boolean)) process.exit(0);
} catch { /* A missing generated artifact is rebuilt below. */ }
const map = JSON.parse(mapText);
const sources = new Map();
for (let i = 0; i < map.sources.length; i++) {
  const name = map.sources[i];
  if (name.startsWith("../src/") && typeof map.sourcesContent[i] === "string") sources.set(name.slice(7), map.sourcesContent[i]);
}
patchMagnifier(sources);
patchStrategyAlerts(sources);
const sourceRoot = path.join(outputRoot, "pinets-source");
const safePath = name => {
  const target = path.resolve(sourceRoot, name);
  if (!target.startsWith(sourceRoot + path.sep)) throw new Error("Unexpected source-map path.");
  return target;
};
for (const [name, content] of sources) {
  const target = safePath(name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}
// Pure export/type barrels have no source-map positions. The published declarations retain them.
async function barrels(directory, prefix = "") {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name), absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) { await barrels(absolute, relative); continue; }
    if (!entry.name.endsWith(".d.ts")) continue;
    const name = relative.replace(/\.d\.ts$/, ".ts").replaceAll(path.sep, "/");
    if (sources.has(name)) continue;
    const content = await fs.readFile(absolute, "utf8");
    const target = safePath(name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}
await barrels(path.join(dist, "types"));
const entry = path.join(sourceRoot, "strategy-entry.ts");
await fs.writeFile(entry, 'export { PineTS } from "./PineTS.class";\nexport { Indicator } from "./Indicator/Indicator.class";\nexport { FunctionImportResolver } from "./imports/Function/FunctionImportResolver.class";\nexport { snapshotStrategyState, restoreStrategyState, processLiveStrategyPoint, processLiveStrategyClose } from "./namespaces/strategy/utils";\n');
const result = await build({ entryPoints: [entry], outfile: out, bundle: true, platform: "browser", format: "esm", target: "es2022",
  minify: true, legalComments: "eof", nodePaths: [path.dirname(packageRoot)], alias: { "@pinets": sourceRoot },
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
  banner: { js: "// SPDX-License-Identifier: AGPL-3.0-only\n// PineTS 0.13.0 Copyright (C) 2026 LuxAlgo. Modified intrabar broker path: Affentrader.\n// Reproducible source: scripts/build-strategy-runtime.mjs and pinets-magnifier-patch.mjs.\n" },
});
if (result.errors.length) throw new Error("Strategy runtime build failed.");
await fs.writeFile(path.join(outputRoot, "strategy-runtime.d.ts"), `import { PineTS as BasePineTS, type Context } from "pinets";
export { Indicator, FunctionImportResolver } from "pinets";
export interface StrategyLedgerSnapshot { fields: Record<string, unknown>; closedtradesLength: number }
export declare function snapshotStrategyState(strategy: Context["strategy"]): StrategyLedgerSnapshot | null;
export declare function restoreStrategyState(strategy: Context["strategy"], snapshot: StrategyLedgerSnapshot | null): void;
export declare function processLiveStrategyPoint(context: Context): number;
export declare function processLiveStrategyClose(context: Context, confirmed: boolean): number;
export declare class PineTS extends BasePineTS {
  setStrategyIntrabarPaths(paths: Map<number, { prices: number[]; gaps: number[] }>): void;
}
`);
await fs.copyFile(path.join(packageRoot, "LICENSE"), path.join(outputRoot, "PineTS-LICENSE"));
await fs.writeFile(manifestFile, JSON.stringify({ version: info.version, hash, license: "AGPL-3.0-only", extension: "intrabar magnifier, observed-price strategy broker and native fill events" }, null, 2));
console.log("[affentrader] Generated PineTS intrabar runtime (0.13.0).");
