import { build } from "esbuild";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
await fs.mkdir("artifacts", { recursive: true });
await build({ entryPoints: ["lib/orderflow/footprintHistory.ts"], bundle: true, platform: "node", format: "cjs", outfile: "artifacts/footprint-history-runtime.cjs" });
const { FootprintHistory } = createRequire(import.meta.url)("../artifacts/footprint-history-runtime.cjs");
const history = new FootprintHistory("1m"), settings = { step: .1, ratio: 3 };
const trade = i => ({ id: `probe-${i}`, symbol: "HL:BTC", time: i * 10, price: 100 + i % 100 / 10, quantity: 1, side: i % 2 ? "buy" : "sell", simulated: true });
let start = performance.now(); history.add(Array.from({ length: 100000 }, (_, i) => trade(i))); history.read(settings);
const initialMs = performance.now() - start, updates = [];
for (let i = 100000; i < 100500; i++) { start = performance.now(); history.add([trade(i)]); history.read(settings); updates.push(performance.now() - start); }
const bars = history.read(settings), retainedVolume = bars.reduce((sum, bar) => sum + bar.volume, 0), coverage = history.coverage;
if (retainedVolume !== coverage.trades || coverage.trades > 100000 || coverage.dropped === 0) throw new Error("Retained whole-bar accounting failed.");
updates.sort((a, b) => a - b);
const report = { simulated: true, inputTrades: 100500, initialMs, updateMedianMs: updates[Math.floor(updates.length / 2)], updateP99Ms: updates[Math.floor(updates.length * .99)],
  updateMaxMs: updates.at(-1), retainedVolume, coverage };
await fs.writeFile("artifacts/footprint-history-performance.json", JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
