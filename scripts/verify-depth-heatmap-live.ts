import { writeFile } from "node:fs/promises";
import { DepthHeatmapCollection, defaultDepthHeatmap, depthHeatmapCells } from "../lib/orderflow/depthHeatmap";
import { parseBook } from "../lib/market/hyperliquid";
const settings = defaultDepthHeatmap(), collection = new DepthHeatmapCollection("HL:BTC"), started = Date.now();
const report = { source: "Hyperliquid public l2Book BTC", started: new Date(started).toISOString(), received: 0, accepted: 0, rejected: 0, parseFailures: 0,
  minAgeMs: Infinity, maxAgeMs: -Infinity, minGapMs: Infinity, maxGapMs: 0, lastReceived: 0, levels: [] as number[], errors: [] as string[] };
const socket = new WebSocket("wss://api.hyperliquid.xyz/ws");
socket.addEventListener("open", () => socket.send(JSON.stringify({ method: "subscribe", subscription: { type: "l2Book", coin: "BTC" } })));
socket.addEventListener("message", event => {
  try {
    const message = JSON.parse(String(event.data)); if (message.channel !== "l2Book") return;
    const observedAt = Date.now(), book = parseBook(message.data); report.received++;
    if (!book) { report.parseFailures++; return; }
    const age = observedAt - book.time; report.minAgeMs = Math.min(report.minAgeMs, age); report.maxAgeMs = Math.max(report.maxAgeMs, age);
    if (report.lastReceived) { const gap = observedAt - report.lastReceived; report.minGapMs = Math.min(report.minGapMs, gap); report.maxGapMs = Math.max(report.maxGapMs, gap); }
    report.lastReceived = observedAt; report.levels.push(book.bids.length + book.asks.length);
    if (collection.add({ symbol: "HL:BTC", time: book.time, bids: book.bids, asks: book.asks, simulated: false }, observedAt, settings)) report.accepted++; else report.rejected++;
  } catch (error) { report.errors.push(error instanceof Error ? error.message : "Invalid depth event"); }
});
socket.addEventListener("error", () => report.errors.push("Public depth socket error"));
await new Promise(resolve => setTimeout(resolve, 20000));
socket.close();
const finished = Date.now(), columns = collection.read(finished, settings), model = depthHeatmapCells(columns, finished, settings);
const output = { ...report, finished: new Date(finished).toISOString(), durationMs: finished - started, sampledColumns: columns.length, cells: model.cells.length, rowSize: model.step,
  maxOfferedQuantity: model.max, firstObserved: columns[0]?.observedAt, lastObserved: columns.at(-1)?.observedAt,
  maxPaintHoldMs: Math.max(0, ...model.cells.map(cell => cell.to - cell.from)), futureCells: model.cells.filter(cell => cell.to > finished || cell.to <= cell.from).length };
await writeFile("artifacts/depth-heatmap-live.json", JSON.stringify(output, (_key, value) => typeof value === "number" && !Number.isFinite(value) ? null : value, 2));
console.log(JSON.stringify({ received: output.received, accepted: output.accepted, rejected: output.rejected, sampledColumns: output.sampledColumns, cells: output.cells, minAgeMs: output.minAgeMs, maxAgeMs: output.maxAgeMs, maxGapMs: output.maxGapMs }));
if (!output.accepted || !output.cells || output.futureCells || output.maxPaintHoldMs > 3000 || output.errors.length) process.exitCode = 1;
