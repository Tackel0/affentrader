import type { StockBaseRow, StockBaseScan } from "./stockBase";
import { stockBaseLevelDistance } from "./stockBase";
import { csvEscape } from "@/lib/watchlist";

const horizons = [1, 5, 10];
const outcomeFields = ["through", "stock_pct", "benchmark_pct", "relative_pct", "low_pct", "high_pct", "first_breach"];
const scoreFields = ["base", "stage", "relativeStrength", "contraction", "latestVolume", "higherRetest", "participation"] as const;
const encode = (value: string | number) => typeof value === "string"
  ? csvEscape(/^[\s\uFEFF]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value) ? `'${value.replace(/[\r\n]/g, " ")}` : value.replace(/\r/g, " "))
  : csvEscape(value);

export function pendingRetestsCsv(scan: StockBaseScan) {
  const header = ["symbol", "name", "currency", "benchmark", "benchmark_session", "groups_loaded", "groups_total",
    "first_low_date", "retest_date", "retest_low", "latest_close", "resistance", "recovery_close", "recovery_operator",
    "invalidation", "confirmation_sessions_needed", "waiting_for", "relative_strength_pct", "retest_relative_strength_pct",
    "first_low_price", "prior_drawdown_pct", "prior_peak_session", "prior_peak_price"];
  const records = (scan.pendingRetests ?? []).map(row => [
    row.symbol, row.name, row.currency, scan.benchmark, scan.benchmarkSession, scan.page + 1, scan.pages,
    row.firstLow, row.retest, row.price, row.latestClose, row.resistance, row.recoveryLevel,
    row.recoveryStrict ? ">" : ">=", row.invalidation, row.sessionsNeeded, row.waitingFor ?? "pivot-confirmation",
    row.strength?.window ?? "", row.strength?.sinceRetest ?? "",
    row.firstLowPrice ?? "", row.drawdown ?? "", row.drawdownPeak?.session ?? "", row.drawdownPeak?.price ?? "",
  ].map(encode).join(","));
  return [header.join(","), ...records].join("\r\n") + "\r\n";
}

export function stockBaseCsv(scan: StockBaseScan, rows: readonly StockBaseRow[]) {
  const header = ["symbol", "name", "currency", "benchmark", "benchmark_session", "groups_loaded", "groups_total", "evaluated", "universe", "stage", "status", "score", "first_seen", "last_qualified", "latest_close", "first_low_date", "first_low", "retest_date", "retest_low", "resistance", "invalidation", "first_invalidation", "relative_strength_pct", "retest_return_pct", "retest_relative_strength_pct", ...horizons.flatMap(n => outcomeFields.map(field => `after_${n}_${field}`))];
  const records = rows.map(row => {
    const values = [row.symbol, row.name, row.currency, scan.benchmark, scan.benchmarkSession, scan.page + 1, scan.pages, scan.evaluated, scan.universe, row.stage, row.progress.status, row.score, row.progress.firstSeen, row.session, row.progress.latestClose, row.firstLow.session, row.firstLow.price, row.retest.session, row.retest.price, row.resistance, row.invalidation, row.progress.firstInvalidation, row.relativeStrength, row.retestReturn, row.retestRelativeStrength];
    for (const n of horizons) {
      const outcome = row.followThrough.find(item => item.sessions === n);
      values.push(...(outcome ? [outcome.through, outcome.stockChange, outcome.benchmarkChange, outcome.relativeChange, outcome.lowChange, outcome.highChange, outcome.invalidatedOn ?? ""] : outcomeFields.map(() => "")));
    }
    const evidence = row.breakoutEvidence;
    values.push(evidence?.session ?? "", evidence && evidence.volumeRatio > 0 ? evidence.volumeRatio : "", evidence?.consecutiveCloses ?? "");
    values.push(...scoreFields.map(field => row.scoreComponents[field]));
    values.push(evidence?.confirmedOn ?? "", evidence?.confirmation ?? "", evidence?.threshold ?? "", row.progress.statusSince);
    values.push(row.progress.latestSession, row.close, row.progress.breakoutFailedOn ?? "", row.progress.supportLostOn ?? "");
    values.push(row.drawdown, row.drawdownPeak?.session ?? "", row.drawdownPeak?.price ?? "");
    values.push(stockBaseLevelDistance(row.resistance, row.progress.latestClose), stockBaseLevelDistance(row.invalidation, row.progress.latestClose));
    values.push(row.progress.latestRetestRelativeStrength ?? "");
    return values.map(encode).join(",");
  });
  header.push("breakout_session", "breakout_day_volume_ratio", "breakout_consecutive_closes");
  header.push(...scoreFields.map(field => `score_${field.replace(/[A-Z]/g, letter => "_" + letter.toLowerCase())}`));
  header.push("breakout_confirmed_on", "breakout_confirmation", "breakout_threshold", "status_since");
  header.push("latest_completed_session", "last_qualified_close", "breakout_failed_on", "support_lost_on");
  header.push("prior_drawdown_pct", "prior_peak_session", "prior_peak_price");
  header.push("distance_to_resistance_pct", "distance_to_invalidation_pct");
  header.push("latest_retest_relative_strength_pct");
  return [header.join(","), ...records].join("\r\n") + "\r\n";
}
