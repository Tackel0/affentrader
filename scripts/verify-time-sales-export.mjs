import fs from "node:fs";
import assert from "node:assert/strict";
const [input, domPath, output = "artifacts/time-sales-export-check.json", archivePath] = process.argv.slice(2);
if (!input || !domPath) throw new Error("Usage: node scripts/verify-time-sales-export.mjs tape.csv visible-table.txt [report.json] [raw-archive.json]");
function csv(text) {
  const records = []; let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && [",", "\n", "\r"].includes(char)) {
      row.push(field); field = "";
      if (char !== ",") { records.push(row); row = []; if (char === "\r" && text[i + 1] === "\n") i++; }
    } else field += char;
  }
  assert.equal(quoted, false);
  if (field || row.length) { row.push(field); records.push(row); }
  return records;
}
const [headers, ...records] = csv(fs.readFileSync(input, "utf8"));
const rows = records.map(fields => Object.fromEntries(headers.map((header, i) => [header, fields[i]])));
const visible = fs.readFileSync(domPath, "utf8").trim().split(/\r?\n/).slice(1).map(line => line.split("\t"));
const ids = new Set();
for (const [index, row] of rows.entries()) {
  assert.equal(ids.has(row.id), false); ids.add(row.id);
  assert.ok(["buy", "sell"].includes(row.aggressor));
  assert.ok(row.side_filter === "all" || row.aggressor === row.side_filter);
  assert.ok(Number.isFinite(Number(row.price)) && Number(row.price) > 0);
  assert.ok(Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0);
  const size = row.size_unit === "quantity" ? Number(row.quantity) : Number(row.price) * Number(row.quantity);
  assert.ok(size >= Number(row.minimum_size));
  assert.ok(Number.isFinite(Date.parse(row.execution_utc)));
  if (row.recorded_replay === "true") { assert.equal(row.simulated, "false"); assert.ok(Date.parse(row.execution_utc) < Date.parse(row.replay_before_utc)); }
  if (index) assert.ok(Date.parse(rows[index - 1].execution_utc) >= Date.parse(row.execution_utc));
  for (const field of ["symbol", "captured_utc", "simulated", "side_filter", "minimum_size", "size_unit"]) assert.equal(row[field], rows[0][field]);
}
assert.ok(rows.length >= visible.length);
for (const [index, cells] of visible.entries()) {
  const row = rows[index];
  assert.equal(cells[0], cells[0].includes("T") ? row.execution_utc : row.execution_utc.slice(11, 23));
  assert.equal(Number(cells[1].replaceAll(",", "")), Number(row.price));
  assert.equal(Number(cells[2].replaceAll(",", "")), Number(row.quantity));
  assert.equal(cells[3].toLowerCase(), row.aggressor);
}
const report = { exportedRows: rows.length, visibleRows: visible.length, matchingVisibleRows: true, uniqueIds: true,
  symbol: rows[0]?.symbol, sideFilter: rows[0]?.side_filter, minimum: rows[0]?.minimum_size, unit: rows[0]?.size_unit,
  recordedReplay: rows[0]?.recorded_replay === "true", replayBefore: rows[0]?.replay_before_utc || null,
  allRowsPassFilters: true, includesAdditionalPages: rows.length > visible.length };
if (archivePath) {
  assert.ok(rows.length && report.recordedReplay, "A nonempty recorded export is required for the archive comparison");
  const archive = JSON.parse(fs.readFileSync(archivePath, "utf8"));
  const cutoff = Date.parse(report.replayBefore), minimum = Number(report.minimum);
  const expected = archive.trades.filter(trade => trade.symbol === report.symbol && trade.simulated === false && trade.time < cutoff &&
    (report.sideFilter === "all" || trade.side === report.sideFilter) && (report.unit === "quantity" ? trade.quantity : trade.price * trade.quantity) >= minimum);
  assert.equal(expected.length, rows.length);
  const byId = new Map(expected.map(trade => [trade.id, trade]));
  for (const row of rows) {
    const trade = byId.get(row.id); assert.ok(trade);
    assert.equal(row.execution_utc, new Date(trade.time).toISOString()); assert.equal(Number(row.price), trade.price); assert.equal(Number(row.quantity), trade.quantity);
    assert.equal(row.aggressor, trade.side); assert.equal(row.sequence, String(trade.seq ?? ""));
  }
  report.archive = { records: archive.trades.length, expectedFilteredPrefix: expected.length, everyRecordMatches: true,
    observationsAtOrAfterBoundary: archive.trades.filter(trade => trade.symbol === report.symbol && trade.time >= cutoff).length };
}
fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(report);
