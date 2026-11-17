import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { buildBookView, bookDepthPaths, bookShare } from "../lib/orderflow/bookView";
const source = await readFile("artifacts/vela-dom-reference/0kh_muujoeolo.js", "utf8");
const hash = createHash("sha256").update(source).digest("hex");
assert.equal(hash, "42f2ea4bd3efd7d848ef453f8648616c6fd3469feeaddc70f9ed51c763278c6a");
const start = source.indexOf("let N=e=>"), end = source.indexOf(",z=(e,t)=>", start);
assert.ok(start > 0 && end > start);
const ref = runInNewContext(`(()=>{${source.slice(start, end)};return {M,T}})()`, {}, { timeout: 1000 });
const svgStart = source.indexOf("function td(e)"), svgEnd = source.indexOf("function tc(e)", svgStart);
assert.ok(svgStart > 0 && svgEnd > svgStart);
const jsx = (_tag: string, props: unknown) => props;
const svg = runInNewContext(`(()=>{${source.slice(svgStart, svgEnd)};return td})()`, { r: { c: (n: number) => Array(n) }, n: { jsx, jsxs: jsx } }, { timeout: 1000 });
let rowComparisons = 0, pathComparisons = 0;
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
for (const tick of [.01, .1, .25, 1]) for (const group of [1, 5, 10, 50]) for (const limit of [1, 3, 10, 50]) for (const unit of ["base", "quote"] as const) {
  const book = { symbol: "FIXTURE", simulated: false, time: 0, bids: Array.from({ length: 60 }, (_, i) => ({ price: Number((10000 - i * tick).toFixed(8)), quantity: (i % 7 + 1) / 10 })), asks: Array.from({ length: 60 }, (_, i) => ({ price: Number((10001 + i * tick).toFixed(8)), quantity: (i % 5 + 1) / 10 })) };
  const step = tick * group, actual = buildBookView(book, step, unit, limit);
  const expected: Record<string, { price: number; size: number; total: number }[]> = {};
  for (const [name, direction] of [["bids", "bid"], ["asks", "ask"]] as const) {
    const grouped = ref.M(book[name].map(l => ({ price: l.price, size: l.quantity })), step, direction, limit);
    const rows = ref.T(grouped.map((r: { price: number; size: number }) => ({ price: r.price, size: unit === "quote" ? r.price * r.size : r.size })));
    expected[name] = rows; assert.equal(actual[name].length, rows.length);
    let base = 0, notional = 0;
    for (let i = 0; i < rows.length; i++) {
      assert.equal(actual[name][i].price, rows[i].price); near(actual[name][i].size, rows[i].size); near(actual[name][i].total, rows[i].total);
      base += grouped[i].size; notional += grouped[i].price * grouped[i].size;
      near(actual[name][i].baseTotal, base); near(actual[name][i].averagePrice, notional / base); rowComparisons++;
    }
  }
  for (const mode of ["cumulative", "level"] as const) for (const [name, direction] of [["bids", "bid"], ["asks", "ask"]] as const) {
    const denominator = mode === "cumulative" ? Math.max(expected.bids.at(-1)?.total ?? 0, expected.asks.at(-1)?.total ?? 0) : Math.max(...expected.bids.map(r => r.size), ...expected.asks.map(r => r.size));
    const shares = expected[name].map(r => (mode === "cumulative" ? r.total : r.size) / denominator);
    actual[name].forEach((row, i) => near(bookShare(row, mode, actual), shares[i]));
    // Compare exact SVG strings using identical shares, isolating path arithmetic
    // from floating-point quantity summation differences.
    for (const rowHeight of [14, 20, 30]) {
      const paths = bookDepthPaths(shares, direction, rowHeight), rendered = svg({ shares, side: direction, style: "outline", height: paths.height, rowHeight });
      assert.equal(paths.area, rendered.children[0].d); assert.equal(paths.line, rendered.children[1].d); pathComparisons += 2;
    }
  }
}
const report = { checkedAt: new Date().toISOString(), sourceHash: hash, rowComparisons, pathComparisons, differences: 0, numericTolerance: "1e-10 relative for quantity/weighted sums; exact grouped prices and SVG strings", scope: "Pinned actual public Book grouping, totals, inspection average and SVG step renderer. Excludes full component layout, formatter, resize and interaction parity." };
await writeFile("artifacts/book-reference.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
