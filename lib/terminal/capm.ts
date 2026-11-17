// CAPM regression adapted from OPNB, src/lib/quant.ts (MIT).
// Copyright (c) 2026 Massimo Merenda. See THIRD_PARTY_NOTICES.md.
import type { DailyStockBar } from "@/lib/screener/stockBase";

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
function covariance(x: number[], y: number[], mx: number, my: number) {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += (x[i] - mx) * (y[i] - my);
  return sum / (x.length - 1);
}

export function terminalCapm(asset: readonly DailyStockBar[], benchmark: readonly DailyStockBar[], annualRiskFree: number) {
  if (!Number.isFinite(annualRiskFree) || annualRiskFree <= -1) return null;
  const reference = new Map(benchmark.map((bar, i) => [bar.session, i]));
  const assetReturns: number[] = [], marketReturns: number[] = [];
  for (let i = 1; i < asset.length; i++) {
    const marketIndex = reference.get(asset[i].session);
    if (marketIndex === undefined || marketIndex < 1 || benchmark[marketIndex - 1].session !== asset[i - 1].session) continue;
    assetReturns.push(Math.log(asset[i].close / asset[i - 1].close));
    marketReturns.push(Math.log(benchmark[marketIndex].close / benchmark[marketIndex - 1].close));
  }
  if (assetReturns.length < 29) return null;
  const ma = mean(assetReturns), mb = mean(marketReturns), varA = covariance(assetReturns, assetReturns, ma, ma), varB = covariance(marketReturns, marketReturns, mb, mb);
  if (!(varA > 0 && varB > 0)) return null;
  const cov = covariance(assetReturns, marketReturns, ma, mb), beta = cov / varB;
  const rf = Math.log1p(annualRiskFree), assetAnnual = ma * 252, marketAnnual = mb * 252;
  const volatility = Math.sqrt(varA * 252), correlation = cov / Math.sqrt(varA * varB);
  return { beta, alpha: assetAnnual - rf - beta * (marketAnnual - rf), correlation, r2: Math.min(1, correlation ** 2), volatility, capmReturn: Math.expm1(rf + beta * (marketAnnual - rf)), sharpe: (assetAnnual - rf) / volatility, observations: assetReturns.length };
}
