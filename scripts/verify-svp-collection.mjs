import { build } from "esbuild";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
await fs.mkdir("artifacts", { recursive: true });
await build({ stdin: { contents: 'export {ProfileTradeCollection} from "./lib/orderflow/profileTradeCollection"; export {buildSessionVolumeProfiles} from "./lib/orderflow/volumeProfileModel"; export {defaultVolumeProfile} from "./lib/orderflow/volumeProfileSettings";', resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "cjs", outfile: "artifacts/svp-collection-runtime.cjs" });
const { ProfileTradeCollection, buildSessionVolumeProfiles, defaultVolumeProfile } = createRequire(import.meta.url)("../artifacts/svp-collection-runtime.cjs");
const style = { ...defaultVolumeProfile(), rowSize: 1 }, collector = new ProfileTradeCollection();
const trades = Array.from({ length: 100000 }, (_, i) => ({ id: `probe-${i}`, symbol: "HL:BTC", time: 1793203200000 + i * 100, price: 100 + i % 100, quantity: 1, side: i % 2 ? "buy" : "sell", simulated: true }));
const start = performance.now(); collector.add(trades.slice(0, 5000));
for (const tick of trades.slice(5000)) collector.add([tick]);
const ingestMs = performance.now() - start, timings = []; let model;
for (let i = 0; i < 5; i++) { const at = performance.now(); model = buildSessionVolumeProfiles(collector.snapshot(), style, "HL:BTC"); timings.push(performance.now() - at); }
const volume = model.sessions.reduce((sum, session) => sum + session.valueArea.total, 0);
if (collector.size !== 100000 || model.retained !== 100000 || volume !== 100000) throw new Error("Collected session accounting failed.");
const report = { simulated: true, inputTrades: trades.length, ingestMs, modelMs: timings, retained: model.retained, volume, sessions: model.sessions.length };
await fs.writeFile("artifacts/svp-collection-performance.json", JSON.stringify(report, null, 2)); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
