import fs from "node:fs";
import assert from "node:assert/strict";

const [jsonPath, csvPath, reportPath = "artifacts/footprint-inspection-export-check.json", archivePath] = process.argv.slice(2);
if (!jsonPath || !csvPath) throw new Error("Usage: node scripts/verify-footprint-inspection-export.mjs snapshot.json snapshot.csv [report.json] [trade-archive.json]");
const snapshot = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
function parseCsv(text) {
  const records = []; let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && [",", "\n", "\r"].includes(char)) {
      row.push(field); field = "";
      if (char !== ",") { records.push(row); row = []; if (char === "\r" && text[i + 1] === "\n") i++; }
    } else field += char;
  }
  assert.equal(quoted, false, "Unclosed CSV field");
  if (field || row.length) { row.push(field); records.push(row); }
  return records;
}
const [header, ...csv] = parseCsv(fs.readFileSync(csvPath, "utf8")), rows = snapshot.rows;
assert.equal(csv.length, rows.length);
const fields = { lower: "lower", upper: "upper_exclusive", bid: "bid_sells", ask: "ask_buys", total: "total", delta: "delta", buyImbalance: "buy_imbalance", sellImbalance: "sell_imbalance", poc: "poc", buyStack: "buy_stack", sellStack: "sell_stack" };
rows.forEach((row, index) => {
  for (const [key, column] of Object.entries(fields)) assert.equal(csv[index][header.indexOf(column)], String(row[key]), `${index}:${key}`);
  assert.equal(csv[index][header.indexOf("symbol")], snapshot.symbol);
  assert.equal(csv[index][header.indexOf("coverage")], snapshot.coverage);
  if (snapshot.deltaPath) {
    for (const [key, column] of Object.entries({ high: "observed_delta_max", low: "observed_delta_min", close: "ordered_delta_close", executions: "observed_executions", ordering: "execution_ordering" })) {
      assert.equal(csv[index][header.indexOf(column)], String(snapshot.deltaPath[key]));
    }
  }
});
// An independent decimal integer oracle over the exported Number model, not the
// original venue quantity strings. The tolerance covers model summation rounding.
const scale = 10n ** 400n;
const decimal = value => {
  const [mantissa, exponent = "0"] = String(value).split("e"), fraction = (mantissa.split(".")[1] || "").length;
  return BigInt(mantissa.replace(".", "")) * 10n ** BigInt(400 + Number(exponent) - fraction);
};
const abs = value => value < 0n ? -value : value;
const tolerance = decimal(Math.max(1e-10, Math.abs(snapshot.volume) * 1e-12));
const sum = key => rows.reduce((total, row) => total + decimal(row[key]), 0n);
assert.ok(abs(sum("total") - decimal(snapshot.volume)) <= tolerance);
assert.ok(abs(sum("delta") - decimal(snapshot.delta)) <= tolerance);
const byPrice = new Map(rows.map(row => [String(decimal(row.lower)), row]));
const step = decimal(snapshot.settings.step), ratio = decimal(snapshot.settings.ratio);
for (const row of rows) {
  const price = decimal(row.lower), below = byPrice.get(String(price - step)), above = byPrice.get(String(price + step));
  const imbalance = (own, other) => own > 0 && own >= snapshot.settings.minimumVolume &&
    (!snapshot.settings.ignoreZeroOpposite || other > 0) && decimal(own) * scale >= decimal(other) * ratio;
  assert.equal(row.buyImbalance, imbalance(row.ask, below?.bid || 0));
  assert.equal(row.sellImbalance, imbalance(row.bid, above?.ask || 0));
  assert.ok(abs(decimal(row.total) - decimal(row.bid) - decimal(row.ask)) <= tolerance);
  assert.ok(abs(decimal(row.delta) - decimal(row.ask) + decimal(row.bid)) <= tolerance);
}
const stacks = [];
for (const side of ["buy", "sell"]) {
  let run = [];
  const finish = () => {
    const eligible = run.length >= snapshot.settings.minimumStackRows;
    for (const row of run) assert.equal(row[`${side}Stack`], eligible);
    if (eligible) stacks.push({ side, from: run[0].lower, to: run.at(-1).upper, rows: run.length });
    run = [];
  };
  for (const row of rows) {
    if (!row[`${side}Imbalance`]) { finish(); assert.equal(row[`${side}Stack`], false); continue; }
    if (run.length && decimal(row.lower) - decimal(run.at(-1).lower) !== step) finish();
    run.push(row);
  }
  finish();
}
assert.deepEqual(stacks, snapshot.stacks);
const report = { rows: rows.length, csvRows: csv.length, volume: snapshot.volume, delta: snapshot.delta, stacks: stacks.length,
  allCsvFieldsMatch: true, independentDiagonalChecks: true, independentStackChecks: true, sumChecks: true, capturedAt: snapshot.capturedAt };
if (archivePath) {
  const archive = JSON.parse(fs.readFileSync(archivePath, "utf8"));
  const interval = /^(\d+)(s|m|h|D|W)$/.exec(snapshot.timeframe);
  assert.ok(interval, "Archive oracle needs a fixed-duration candle interval");
  const duration = Number(interval[1]) * { s: 1000, m: 60000, h: 3600000, D: 86400000, W: 604800000 }[interval[2]];
  const cutoff = Math.min(snapshot.time + duration, snapshot.replayThrough ?? Infinity);
  const selected = archive.trades.filter(trade => trade.symbol === snapshot.symbol && !trade.simulated && trade.time >= snapshot.time && trade.time < cutoff);
  const expected = new Map();
  for (const trade of selected) {
    const price = decimal(trade.price); let index = price / step;
    if (price < 0n && price % step !== 0n) index--;
    const key = String(index * step), row = expected.get(key) || { bid: 0n, ask: 0n };
    assert.ok(["buy", "sell"].includes(trade.side));
    row[trade.side === "buy" ? "ask" : "bid"] += decimal(trade.quantity);
    expected.set(key, row);
  }
  assert.equal(expected.size, rows.length);
  for (const row of rows) {
    const oracle = expected.get(String(decimal(row.lower))); assert.ok(oracle);
    assert.ok(abs(oracle.bid - decimal(row.bid)) <= tolerance);
    assert.ok(abs(oracle.ask - decimal(row.ask)) <= tolerance);
  }
  report.archive = { executions: archive.trades.length, completedCandleExecutions: selected.length,
    exclusiveCutoff: new Date(cutoff).toISOString(), everyBidAskRowMatches: true,
    laterExecutionsExcluded: archive.trades.filter(trade => trade.symbol === snapshot.symbol && trade.time >= cutoff).length };
  if (snapshot.deltaPath) {
    const ordered = [...selected].sort((a, b) => a.time - b.time ||
      (Number.isSafeInteger(a.seq) ? a.seq : Number.MAX_VALUE) - (Number.isSafeInteger(b.seq) ? b.seq : Number.MAX_VALUE) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let close = 0n, high = 0n, low = 0n;
    for (const trade of ordered) { close += decimal(trade.quantity) * (trade.side === "buy" ? 1n : -1n); high = close > high ? close : high; low = close < low ? close : low; }
    assert.ok(abs(high - decimal(snapshot.deltaPath.high)) <= tolerance);
    assert.ok(abs(low - decimal(snapshot.deltaPath.low)) <= tolerance);
    assert.ok(abs(close - decimal(snapshot.deltaPath.close)) <= tolerance);
    assert.equal(snapshot.deltaPath.executions, selected.length);
    assert.equal(snapshot.deltaPath.first, ordered[0].time); assert.equal(snapshot.deltaPath.last, ordered.at(-1).time);
    report.archive.deltaPath = { high: snapshot.deltaPath.high, low: snapshot.deltaPath.low, close: snapshot.deltaPath.close, independentOrderedPrefixCheck: true };
  }
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(report);
