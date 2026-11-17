import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { defaultFootprint } from "../lib/orderflow/footprint";
import { planFootprintText, paintFootprintText, footprintNumber } from "../lib/orderflow/footprintText";
import type { FootprintLevel } from "../types/trading";
const source = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8"), hash = createHash("sha256").update(source).digest("hex");
assert.equal(hash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
function block(at: number) { assert.ok(at >= 0); let n = 1, end = source.indexOf("{", at) + 1; for (; n && end < source.length; end++) { if (source[end] === "{") n++; else if (source[end] === "}") n--; } assert.equal(n, 0); return source.slice(at, end); }
const names = ["tk", "tS", "tA", "tC", "tM", "tE", "tT", "tN", "tj", "ic", "iu", "ig", "iy", "ib", "iv"];
const helpers = names.map(name => block(source.indexOf(`function ${name}(`, 1097000))).join("\n");
const ladderStart = source.indexOf("if(o<.6||i.x1-i.x0<22||0===e.textPx)return;let d=", 1114500), ladderEnd = source.indexOf('}(h);break;case"volume"', ladderStart);
assert.ok(ladderStart > 0 && ladderEnd > ladderStart);
const ladder = `function(e){let{ctx:t,slot:i,bar:r,style:n,geom:a,theme:s,opacity:o}=e,p=(i.x0+i.x1)/2;${source.slice(ladderStart, ladderEnd)}}`;
const reference = runInNewContext(`${helpers}\n({format:tS,plan:iu,paint:iv,ladder:${ladder}})`, Object.create(null), { timeout: 1000 });
function canvas() {
  const text: unknown[] = []; const ctx = { font: "", textAlign: "left", fillStyle: "", textBaseline: "middle", measureText(value: string) { return { width: [...value].reduce((sum, c) => sum + (c === "." ? .25 : c === "1" ? .35 : .6), 0) * parseFloat(this.font) }; }, fillText(value: string, x: number, y: number, maxWidth?: number) { text.push({ value, x, y, font: this.font, align: this.textAlign, color: this.fillStyle, maxWidth }); } }; return { text, ctx: ctx as unknown as CanvasRenderingContext2D };
}
const modes = [["bid-ask", "bidAskProfile"], ["bid-ask-ladder", "bidAskLadder"], ["total", "volume"], ["delta", "delta"], ["absolute-delta", "deltaAbs"]] as const;
const values = [["auto", "auto"], ["bid-ask", "bidAsk"], ["total", "volume"], ["delta", "delta"], ["trades", "trades"], ["bid-ask-trades", "bidAskTrades"]] as const;
const rows: FootprintLevel[] = [
  { price: 100, upperPrice: 101, buyVolume: 12345, sellVolume: 111, buyCount: 3, sellCount: 111, buyImbalance: true, sellImbalance: false, imbalance: null },
  { price: 101, upperPrice: 102, buyVolume: 2, sellVolume: 1200, buyCount: 2, sellCount: 40, buyImbalance: false, sellImbalance: true, imbalance: null },
  { price: 102, upperPrice: 103, buyVolume: 0, sellVolume: 2, buyCount: 0, sellCount: 2, buyImbalance: false, sellImbalance: false, imbalance: null },
];
let comparisons = 0, formats = 0;
for (const n of [-1234567, -10000, -1000, -1.11, -.001, 0, .001, .01, .1, 1, 1.11, 99.99, 100, 999, 1000, 9999, 10000, 1234567]) { assert.equal(footprintNumber(n), reference.format(n)); formats++; }
for (const [mode, refMode] of modes) for (const [cellValues, refValue] of values) for (const textAutoSize of [false, true]) for (const textFit of [false, true]) for (const textSize of [6, 11, 20, 40]) for (const width of [22, 40, 90, 180]) for (const height of [13, 14, 15, 29, 39, 59]) for (const opacity of [.59, .6, 1]) for (const averageTradeSize of [false, true]) {
  const style = { ...defaultFootprint(), volumeMode: mode, cellValues, textAutoSize, textFit, textSize, averageTradeSize, imbalanceRecolor: true };
  const refRows = rows.map(row => { const buy = averageTradeSize ? row.buyVolume / (row.buyCount || 1) : row.buyVolume, sell = averageTradeSize ? row.sellVolume / (row.sellCount || 1) : row.sellVolume; return { price: row.price, buy, sell, total: buy + sell, delta: buy - sell, buyVol: row.buyVolume, sellVol: row.sellVolume, buyN: row.buyCount, sellN: row.sellCount, visible: !row.filtered, askImb: row.buyImbalance, bidImb: row.sellImbalance }; });
  const maxSide = Math.max(...refRows.flatMap(r => [r.buy, r.sell])), maxTotal = Math.max(...refRows.map(r => r.total)), maxAbsDelta = Math.max(...refRows.map(r => Math.abs(r.delta)));
  const maximum = mode === "total" ? maxTotal : mode === "delta" || mode === "absolute-delta" ? maxAbsDelta : maxSide;
  const slot = { left: 100 - width / 2, right: 100 + width / 2, axis: 100 }, refSlot = { x0: slot.left, x1: slot.right, axisX: slot.axis };
  const actual = canvas(), expected = canvas(), family = "Test Font", geom = { yOf: (p: number) => (110 - p) * (height + 1), tick: 1 };
  const refStyle = { mode: refMode, displayValue: refValue, text: { autoSize: textAutoSize, fitText: textFit, sizePx: textSize, color: "#112233" }, imbalance: { highlightText: true, textAskColor: style.imbalanceTextAskColor, textBidColor: style.imbalanceTextBidColor } };
  const actualPlan = planFootprintText(actual.ctx, style, rows, slot, () => height, family), refPlan = reference.plan(expected.ctx, refStyle, refRows, refSlot, geom, family);
  const key = JSON.stringify({ mode, cellValues, textAutoSize, textFit, textSize, width, height, opacity, averageTradeSize }); assert.equal(actualPlan, refPlan, key);
  for (const row of rows) paintFootprintText(actual.ctx, row, style, slot, height, (geom.yOf(row.price) + geom.yOf(row.price + 1)) / 2, maximum, family, "#112233", opacity, actualPlan);
  (mode === "bid-ask-ladder" ? reference.ladder : reference.paint)({ ctx: expected.ctx, style: refStyle, bar: { rows: refRows, maxSide, maxTotal, maxAbsDelta }, slot: refSlot, geom, theme: { fontFamily: family }, opacity, textPx: refPlan });
  assert.deepEqual(actual.text, expected.text, key); comparisons++;
}
const report = { checkedAt: new Date().toISOString(), sourceHash: hash, comparisons, formats, scope: "Actual reviewed hash-pinned Vela text planner/row painters/formatter versus production helpers on ordinary coordinates and known counts. Deterministic proportional glyph metrics; excludes complete browser pixels, unknown-count reference gaps and inverted-reference behavior." };
await writeFile("artifacts/footprint-text-reference.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
