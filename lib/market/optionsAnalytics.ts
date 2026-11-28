import type { OverlayHLine } from "@/lib/chart/overlays";
import { exchangeOfTicker } from "@/lib/markets";
import { IEX_TICKER } from "@/lib/symbolId";

export type OptionsAssetClass = "equity" | "crypto";

export interface OptionsTarget {
  assetClass: OptionsAssetClass;
  /** Upstream symbol (e.g. "SPY", "AAPL", "^SPX", or "BTC"). */
  ticker: string;
  /** Clean display label (e.g. "SPY", "SPX", "BTC"). */
  display: string;
}

export interface RawOptionContract {
  contractSymbol: string;
  optionType: "call" | "put";
  strike: number;
  expiration: string; // YYYY-MM-DD
  openInterest: number;
  volume: number;
  impliedVolatility: number; // decimal, e.g. 0.24 = 24%
  bid: number;
  ask: number;
  lastPrice: number;
  inTheMoney?: boolean;
  /** Optional exchange-provided Greeks (computed via Black-Scholes when absent). */
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

export interface ComputedGreeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  vanna: number;
}

export interface OptionWallLevel {
  strike: number;
  openInterest: number;
  volume: number;
  gexUsd: number;
  distancePct: number;
}

export interface StrikeLadderRow {
  strike: number;
  callOi: number;
  putOi: number;
  callVol: number;
  putVol: number;
  callGexUsd: number;
  putGexUsd: number;
  netGexUsd: number;
  callIv: number | null;
  putIv: number | null;
  callDelta: number | null;
  putDelta: number | null;
  callGamma: number | null;
  putGamma: number | null;
  callTheta: number | null;
  putTheta: number | null;
  callBid: number | null;
  callAsk: number | null;
  putBid: number | null;
  putAsk: number | null;
  callMid: number | null;
  putMid: number | null;
  callInTheMoney: boolean;
  putInTheMoney: boolean;
}

export interface UnusualOptionItem {
  contractSymbol: string;
  optionType: "call" | "put";
  strike: number;
  expiration: string;
  volume: number;
  openInterest: number;
  volOiRatio: number;
  mid: number;
  notionalUsd: number;
  iv: number;
  delta: number;
  moneyness: "ITM" | "ATM" | "OTM";
}

export type GammaRegime = "positive" | "negative" | "neutral";

export interface OptionsAnalytics {
  ticker: string;
  display: string;
  assetClass: OptionsAssetClass;
  source: string;
  asOf: number;
  spot: number;
  multiplier: number;
  selectedExpiration: string; // "near" or YYYY-MM-DD
  includedExpirations: string[];
  availableExpirations: string[];
  contractCount: number;
  // Core walls
  callWall: OptionWallLevel | null;
  putWall: OptionWallLevel | null;
  callVolumeWall: OptionWallLevel | null;
  putVolumeWall: OptionWallLevel | null;
  topCallWalls: OptionWallLevel[];
  topPutWalls: OptionWallLevel[];
  majorPositiveGex: OptionWallLevel | null;
  majorNegativeGex: OptionWallLevel | null;
  // Dealer Gamma & Pinning
  netGexUsd: number;
  callGexUsd: number;
  putGexUsd: number;
  gammaRegime: GammaRegime;
  gammaFlip: number | null;
  netDeltaExposureUsd: number;
  // Max Pain
  maxPain: number | null;
  maxPainDistancePct: number | null;
  // Expected Move (+/- 1 sigma)
  expectedMoveUsd: number | null;
  expectedMovePct: number | null;
  expectedHigh: number | null;
  expectedLow: number | null;
  // Ratios & Volatility Surface
  totalCallOi: number;
  totalPutOi: number;
  totalCallVol: number;
  totalPutVol: number;
  pcRatioOi: number | null;
  pcRatioVol: number | null;
  atmIv: number | null; // decimal e.g. 0.22
  put25Iv: number | null;
  call25Iv: number | null;
  skew25: number | null; // put25Iv - call25Iv (decimal)
  // Detailed ladder & unusual activity
  strikes: StrikeLadderRow[];
  unusual: UnusualOptionItem[];
}

export interface OptionsWallsOverlayConfig {
  showWalls: boolean;
  showGammaFlip: boolean;
  showMaxPain: boolean;
  showExpectedMove: boolean;
  expiryMode: "near" | "nearest";
}

export const DEFAULT_OPTIONS_WALLS_CONFIG: OptionsWallsOverlayConfig = {
  showWalls: true,
  showGammaFlip: true,
  showMaxPain: true,
  showExpectedMove: true,
  expiryMode: "near",
};

const CRYPTO_OPTIONS_BASES = new Set(["BTC", "ETH", "SOL"]);
const INDEX_OPTION_MAP: Record<string, { ticker: string; display: string }> = {
  "^GSPC": { ticker: "^SPX", display: "SPX" },
  "^SPX": { ticker: "^SPX", display: "SPX" },
  SPX: { ticker: "^SPX", display: "SPX" },
  "^NDX": { ticker: "^NDX", display: "NDX" },
  NDX: { ticker: "^NDX", display: "NDX" },
  "^IXIC": { ticker: "QQQ", display: "QQQ" },
  "^VIX": { ticker: "^VIX", display: "VIX" },
  VIX: { ticker: "^VIX", display: "VIX" },
  "^RUT": { ticker: "^RUT", display: "RUT" },
  RUT: { ticker: "^RUT", display: "RUT" },
};

/**
 * Resolves any AffenTerminal chart symbol (Yahoo, IEX, SIP, Binance, Bybit, Hyperliquid, or plain ticker)
 * into a free zero-API-key options target (US Equity/ETF/Index or Deribit Crypto).
 */
export function resolveOptionsTarget(symbol: string): OptionsTarget | null {
  const trimmed = symbol.trim().toUpperCase();
  if (!trimmed) return null;

  // Strip known venue prefixes
  const bare = trimmed.replace(/^(?:YF|IEX|SIP|BINANCE|BYBIT|HL|HYPERLIQUID|COINBASE|OKX):/, "");

  // Check index mappings first (^GSPC -> ^SPX, ^VIX, etc.)
  const indexHit = INDEX_OPTION_MAP[bare];
  if (indexHit) {
    return { assetClass: "equity", ticker: indexHit.ticker, display: indexHit.display };
  }

  // Check crypto pairs (BTCUSDT, ETHUSD, BTC-USD, SOLPERP, BTC, ETH, SOL)
  const cryptoMatch = /^(BTC|ETH|SOL)(?:[-/]?(?:USDT|USDC|USD|PERP|BUSD))?$/.exec(bare);
  if (cryptoMatch && CRYPTO_OPTIONS_BASES.has(cryptoMatch[1])) {
    const base = cryptoMatch[1];
    return { assetClass: "crypto", ticker: base, display: base };
  }

  // Reject other crypto quote pairs (e.g. DOGEUSDT, XRPUSDC) and forex pairs (e.g. EURUSD, USDJPY, EURUSD=X)
  if (/(?:USDT|USDC|BUSD|PERP|=X|=F)$/.test(bare)) return null;
  if (/^(?:EUR|USD|GBP|JPY|CHF|AUD|CAD|NZD){2}$/.test(bare)) return null;

  // Check US equities / ETFs (1-5 letter US symbols, plus optional share class like BRK.B / BF.A)
  if (IEX_TICKER.test(bare) && /^[A-Z]{1,5}(?:\.[AB])?$/.test(bare)) {
    if (trimmed.startsWith("YF:") && exchangeOfTicker(bare).id !== "us") return null;
    return { assetClass: "equity", ticker: bare, display: bare };
  }

  return null;
}

const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/** Standard normal probability density function phi(x). */
export function normalPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

/** Standard normal cumulative distribution function Phi(x) (Abramowitz & Stegun 7.1.26). */
export function normalCdf(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * absX);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-absX * absX);
  return 0.5 * (1 + sign * erf);
}

/**
 * Computes Black-Scholes first & second order Greeks for European/standard option approximation.
 */
export function blackScholesGreeks(params: {
  spot: number;
  strike: number;
  timeYears: number;
  iv: number;
  rate?: number;
  type: "call" | "put";
}): ComputedGreeks {
  const { spot, strike, type } = params;
  const r = params.rate ?? 0.045;
  const T = Math.max(params.timeYears, 1 / 3650); // floor at ~2.4 hours to avoid div-by-zero on 0DTE
  const sigma = Math.min(Math.max(params.iv, 0.01), 5.0);

  if (!(spot > 0) || !(strike > 0)) {
    return { delta: 0, gamma: 0, vega: 0, theta: 0, vanna: 0 };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdfD1 = normalPdf(d1);

  const delta = type === "call" ? normalCdf(d1) : normalCdf(d1) - 1;
  const gamma = pdfD1 / (spot * sigma * sqrtT);
  const vega = (spot * pdfD1 * sqrtT) / 100; // per 1% IV move
  const term1 = -(spot * pdfD1 * sigma) / (2 * sqrtT);
  const discount = Math.exp(-r * T);
  const thetaAnnual =
    type === "call"
      ? term1 - r * strike * discount * normalCdf(d2)
      : term1 + r * strike * discount * normalCdf(-d2);
  const theta = thetaAnnual / 365; // per calendar day
  const vanna = (-pdfD1 * d2) / sigma;

  return {
    delta: Number.isFinite(delta) ? delta : 0,
    gamma: Number.isFinite(gamma) ? gamma : 0,
    vega: Number.isFinite(vega) ? vega : 0,
    theta: Number.isFinite(theta) ? theta : 0,
    vanna: Number.isFinite(vanna) ? vanna : 0,
  };
}

function yearsToExpiry(expirationIso: string, nowMs: number): number {
  // Options expire ~16:00 ET (20:00 UTC) for US equities, 08:00 UTC for Deribit
  const expMs = Date.parse(`${expirationIso}T20:00:00Z`);
  if (!Number.isFinite(expMs)) return 7 / 365;
  const diffMs = Math.max(expMs - nowMs, 3_600_000);
  return diffMs / (365 * 86_400_000);
}

function contractMid(c: RawOptionContract): number {
  if (c.bid > 0 && c.ask > 0 && c.ask >= c.bid) return (c.bid + c.ask) / 2;
  if (c.lastPrice > 0) return c.lastPrice;
  if (c.ask > 0) return c.ask;
  if (c.bid > 0) return c.bid;
  return 0;
}

function normalizedIv(rawIv: number): number {
  if (!Number.isFinite(rawIv) || rawIv <= 0) return 0;
  // Protect against erroneous extreme Yahoo 0.00001 or >500% quotes
  return rawIv > 5 ? rawIv / 100 : rawIv;
}

/**
 * Computes institutional dealer Net Gamma Exposure at an arbitrary hypothetical spot price S.
 * Dealer convention: long calls (+GEX), short puts (-GEX).
 * Units: USD delta-hedge flow per 1% spot move.
 */
function aggregateNetGexAtSpot(
  contracts: ReadonlyArray<{
    optionType: "call" | "put";
    strike: number;
    openInterest: number;
    iv: number;
    timeYears: number;
  }>,
  testSpot: number,
  multiplier: number,
): number {
  let netGex = 0;
  for (const c of contracts) {
    if (c.openInterest <= 0 || c.iv <= 0.01) continue;
    const { gamma } = blackScholesGreeks({
      spot: testSpot,
      strike: c.strike,
      timeYears: c.timeYears,
      iv: c.iv,
      type: c.optionType,
    });
    const gex = gamma * c.openInterest * multiplier * testSpot * testSpot * 0.01;
    netGex += c.optionType === "call" ? gex : -gex;
  }
  return netGex;
}

/**
 * Finds the Zero Gamma / Gamma Flip spot level where dealer net GEX transitions across 0.
 * Sweeps a 65-point grid around spot (±22%) and linearly interpolates the crossing nearest to spot.
 */
function findGammaFlip(
  contracts: ReadonlyArray<{
    optionType: "call" | "put";
    strike: number;
    openInterest: number;
    iv: number;
    timeYears: number;
  }>,
  spot: number,
  multiplier: number,
): number | null {
  if (!contracts.length || !(spot > 0)) return null;
  const lo = spot * 0.78;
  const hi = spot * 1.22;
  const steps = 64;
  const step = (hi - lo) / steps;

  let bestFlip: number | null = null;
  let bestDist = Infinity;

  let prevS = lo;
  let prevG = aggregateNetGexAtSpot(contracts, prevS, multiplier);

  for (let i = 1; i <= steps; i++) {
    const s = lo + i * step;
    const g = aggregateNetGexAtSpot(contracts, s, multiplier);
    if ((prevG <= 0 && g >= 0) || (prevG >= 0 && g <= 0)) {
      const denom = g - prevG;
      const frac = Math.abs(denom) > 1e-9 ? -prevG / denom : 0.5;
      const cross = prevS + Math.min(Math.max(frac, 0), 1) * (s - prevS);
      const dist = Math.abs(cross - spot);
      if (dist < bestDist) {
        bestDist = dist;
        bestFlip = cross;
      }
    }
    prevS = s;
    prevG = g;
  }

  return bestFlip !== null && Number.isFinite(bestFlip) ? bestFlip : null;
}

/**
 * Computes exact Max Pain strike: the strike minimizing aggregate intrinsic payout at expiration.
 */
export function computeMaxPain(
  strikes: ReadonlyArray<{ strike: number; callOi: number; putOi: number }>,
): number | null {
  const populated = strikes.filter((s) => s.callOi > 0 || s.putOi > 0);
  if (populated.length < 2) return null;

  let bestStrike = populated[0].strike;
  let minPayout = Infinity;

  for (const candidate of populated) {
    const k = candidate.strike;
    let payout = 0;
    for (const row of populated) {
      if (k > row.strike && row.callOi > 0) payout += (k - row.strike) * row.callOi;
      if (k < row.strike && row.putOi > 0) payout += (row.strike - k) * row.putOi;
    }
    if (payout < minPayout) {
      minPayout = payout;
      bestStrike = k;
    }
  }
  return bestStrike;
}

export function computeOptionsAnalytics(params: {
  ticker: string;
  display: string;
  assetClass: OptionsAssetClass;
  source: string;
  spot: number;
  multiplier?: number;
  contracts: readonly RawOptionContract[];
  selectedExpiration: string;
  includedExpirations: string[];
  availableExpirations: string[];
  asOf?: number;
}): OptionsAnalytics {
  const now = params.asOf ?? Date.now();
  const spot = params.spot;
  const multiplier = params.multiplier ?? (params.assetClass === "crypto" ? 1 : 100);

  // Filter out broken contracts and normalize IV / Greeks
  const enriched: Array<
    RawOptionContract & {
      mid: number;
      cleanIv: number;
      timeYears: number;
      greeks: ComputedGreeks;
      gexUsd: number;
    }
  > = [];

  for (const c of params.contracts) {
    if (!(c.strike > 0)) continue;
    const cleanIv = normalizedIv(c.impliedVolatility);
    const timeYears = yearsToExpiry(c.expiration, now);
    const bs =
      cleanIv > 0.01
        ? blackScholesGreeks({
            spot,
            strike: c.strike,
            timeYears,
            iv: cleanIv,
            type: c.optionType,
          })
        : { delta: 0, gamma: 0, vega: 0, theta: 0, vanna: 0 };

    const greeks: ComputedGreeks = {
      delta: Number.isFinite(c.delta) ? c.delta! : bs.delta,
      gamma: Number.isFinite(c.gamma) ? c.gamma! : bs.gamma,
      theta: Number.isFinite(c.theta) ? c.theta! : bs.theta,
      vega: Number.isFinite(c.vega) ? c.vega! : bs.vega,
      vanna: bs.vanna,
    };

    const oi = Math.max(0, Number.isFinite(c.openInterest) ? c.openInterest : 0);
    const vol = Math.max(0, Number.isFinite(c.volume) ? c.volume : 0);
    const rawGex = greeks.gamma * oi * multiplier * spot * spot * 0.01;
    const gexUsd = c.optionType === "call" ? rawGex : -rawGex;

    enriched.push({
      ...c,
      openInterest: oi,
      volume: vol,
      mid: contractMid(c),
      cleanIv,
      timeYears,
      greeks,
      gexUsd: Number.isFinite(gexUsd) ? gexUsd : 0,
    });
  }

  // Group by strike
  const byStrike = new Map<
    number,
    {
      strike: number;
      callOi: number;
      putOi: number;
      callVol: number;
      putVol: number;
      callGexUsd: number;
      putGexUsd: number;
      callIvWeighted: number;
      callIvWeight: number;
      putIvWeighted: number;
      putIvWeight: number;
      callDelta: number | null;
      putDelta: number | null;
      callGamma: number | null;
      putGamma: number | null;
      callTheta: number | null;
      putTheta: number | null;
      callBid: number | null;
      callAsk: number | null;
      putBid: number | null;
      putAsk: number | null;
      callMid: number | null;
      putMid: number | null;
    }
  >();

  let totalCallOi = 0;
  let totalPutOi = 0;
  let totalCallVol = 0;
  let totalPutVol = 0;
  let callGexUsd = 0;
  let putGexUsd = 0;
  let netDeltaExposureUsd = 0;

  // Earliest expiration for clean ATM straddle / skew measurement
  const primaryExp = params.includedExpirations[0] ?? enriched[0]?.expiration ?? "";

  for (const c of enriched) {
    let row = byStrike.get(c.strike);
    if (!row) {
      row = {
        strike: c.strike,
        callOi: 0,
        putOi: 0,
        callVol: 0,
        putVol: 0,
        callGexUsd: 0,
        putGexUsd: 0,
        callIvWeighted: 0,
        callIvWeight: 0,
        putIvWeighted: 0,
        putIvWeight: 0,
        callDelta: null,
        putDelta: null,
        callGamma: null,
        putGamma: null,
        callTheta: null,
        putTheta: null,
        callBid: null,
        callAsk: null,
        putBid: null,
        putAsk: null,
        callMid: null,
        putMid: null,
      };
      byStrike.set(c.strike, row);
    }

    const ivWeight = Math.max(1, c.openInterest + c.volume);
    if (c.optionType === "call") {
      row.callOi += c.openInterest;
      row.callVol += c.volume;
      row.callGexUsd += c.gexUsd;
      totalCallOi += c.openInterest;
      totalCallVol += c.volume;
      callGexUsd += c.gexUsd;
      netDeltaExposureUsd += c.greeks.delta * c.openInterest * multiplier * spot;
      if (c.cleanIv > 0.01) {
        row.callIvWeighted += c.cleanIv * ivWeight;
        row.callIvWeight += ivWeight;
      }
      if (c.expiration === primaryExp || row.callMid === null) {
        row.callDelta = c.greeks.delta;
        row.callGamma = c.greeks.gamma;
        row.callTheta = c.greeks.theta;
        row.callBid = c.bid > 0 ? c.bid : null;
        row.callAsk = c.ask > 0 ? c.ask : null;
        row.callMid = c.mid > 0 ? c.mid : null;
      }
    } else {
      row.putOi += c.openInterest;
      row.putVol += c.volume;
      row.putGexUsd += c.gexUsd;
      totalPutOi += c.openInterest;
      totalPutVol += c.volume;
      putGexUsd += c.gexUsd;
      netDeltaExposureUsd += c.greeks.delta * c.openInterest * multiplier * spot;
      if (c.cleanIv > 0.01) {
        row.putIvWeighted += c.cleanIv * ivWeight;
        row.putIvWeight += ivWeight;
      }
      if (c.expiration === primaryExp || row.putMid === null) {
        row.putDelta = c.greeks.delta;
        row.putGamma = c.greeks.gamma;
        row.putTheta = c.greeks.theta;
        row.putBid = c.bid > 0 ? c.bid : null;
        row.putAsk = c.ask > 0 ? c.ask : null;
        row.putMid = c.mid > 0 ? c.mid : null;
      }
    }
  }

  const allStrikes: StrikeLadderRow[] = [...byStrike.values()]
    .sort((a, b) => a.strike - b.strike)
    .map((r) => ({
      strike: r.strike,
      callOi: r.callOi,
      putOi: r.putOi,
      callVol: r.callVol,
      putVol: r.putVol,
      callGexUsd: r.callGexUsd,
      putGexUsd: r.putGexUsd,
      netGexUsd: r.callGexUsd + r.putGexUsd,
      callIv: r.callIvWeight > 0 ? r.callIvWeighted / r.callIvWeight : null,
      putIv: r.putIvWeight > 0 ? r.putIvWeighted / r.putIvWeight : null,
      callDelta: r.callDelta,
      putDelta: r.putDelta,
      callGamma: r.callGamma,
      putGamma: r.putGamma,
      callTheta: r.callTheta,
      putTheta: r.putTheta,
      callBid: r.callBid,
      callAsk: r.callAsk,
      putBid: r.putBid,
      putAsk: r.putAsk,
      callMid: r.callMid,
      putMid: r.putMid,
      callInTheMoney: r.strike < spot,
      putInTheMoney: r.strike > spot,
    }));

  const distPct = (strike: number) => (spot > 0 ? ((strike - spot) / spot) * 100 : 0);

  // Restrict primary walls to sensible ±35% band around spot when possible (avoids far-OTM lottery LEAPS noise)
  const nearSpotStrikes = allStrikes.filter(
    (r) => spot > 0 && r.strike >= spot * 0.65 && r.strike <= spot * 1.35,
  );
  const wallPool = nearSpotStrikes.length >= 4 ? nearSpotStrikes : allStrikes;

  const toWall = (r: StrikeLadderRow, side: "call" | "put"): OptionWallLevel => ({
    strike: r.strike,
    openInterest: side === "call" ? r.callOi : r.putOi,
    volume: side === "call" ? r.callVol : r.putVol,
    gexUsd: side === "call" ? r.callGexUsd : r.putGexUsd,
    distancePct: distPct(r.strike),
  });

  // Top Call Walls (by OI, fallback to volume if OI is zero)
  const callCandidates = [...wallPool].filter((r) => r.callOi > 0 || r.callVol > 0);
  const hasCallOi = callCandidates.some((r) => r.callOi > 0);
  callCandidates.sort((a, b) =>
    hasCallOi ? b.callOi - a.callOi || b.callVol - a.callVol : b.callVol - a.callVol,
  );
  const topCallWalls = callCandidates.slice(0, 3).map((r) => toWall(r, "call"));
  const callWall = topCallWalls[0] ?? null;

  // Top Put Walls (by OI, fallback to volume if OI is zero)
  const putCandidates = [...wallPool].filter((r) => r.putOi > 0 || r.putVol > 0);
  const hasPutOi = putCandidates.some((r) => r.putOi > 0);
  putCandidates.sort((a, b) =>
    hasPutOi ? b.putOi - a.putOi || b.putVol - a.putVol : b.putVol - a.putVol,
  );
  const topPutWalls = putCandidates.slice(0, 3).map((r) => toWall(r, "put"));
  const putWall = topPutWalls[0] ?? null;

  // Intraday Volume Walls
  const callVolSorted = [...wallPool].filter((r) => r.callVol > 0).sort((a, b) => b.callVol - a.callVol);
  const putVolSorted = [...wallPool].filter((r) => r.putVol > 0).sort((a, b) => b.putVol - a.putVol);
  const callVolumeWall = callVolSorted[0] ? toWall(callVolSorted[0], "call") : null;
  const putVolumeWall = putVolSorted[0] ? toWall(putVolSorted[0], "put") : null;

  // Major Positive / Negative GEX strikes
  const posGexRow = [...wallPool].filter((r) => r.netGexUsd > 0).sort((a, b) => b.netGexUsd - a.netGexUsd)[0];
  const negGexRow = [...wallPool].filter((r) => r.netGexUsd < 0).sort((a, b) => a.netGexUsd - b.netGexUsd)[0];
  const majorPositiveGex = posGexRow ? toWall(posGexRow, "call") : null;
  const majorNegativeGex = negGexRow ? toWall(negGexRow, "put") : null;

  // Net GEX & Regime
  const netGexUsd = callGexUsd + putGexUsd;
  const absGexTotal = Math.abs(callGexUsd) + Math.abs(putGexUsd);
  const gammaRegime: GammaRegime =
    absGexTotal <= 0
      ? "neutral"
      : netGexUsd / absGexTotal > 0.05
        ? "positive"
        : netGexUsd / absGexTotal < -0.05
          ? "negative"
          : "neutral";

  // Gamma Flip / Zero Gamma
  const gexContracts = enriched
    .filter((c) => c.openInterest > 0 && c.cleanIv > 0.01 && Math.abs(c.strike - spot) <= spot * 0.4)
    .map((c) => ({
      optionType: c.optionType,
      strike: c.strike,
      openInterest: c.openInterest,
      iv: c.cleanIv,
      timeYears: c.timeYears,
    }));
  const gammaFlip = findGammaFlip(gexContracts, spot, multiplier);

  // Max Pain
  const maxPain = computeMaxPain(wallPool);
  const maxPainDistancePct = maxPain !== null ? distPct(maxPain) : null;

  // ATM IV, 25-Delta Skew & Expected Move (from primary expiration)
  const primaryContracts = enriched.filter((c) => !primaryExp || c.expiration === primaryExp);
  let atmRow: StrikeLadderRow | null = null;
  let atmDist = Infinity;
  for (const r of allStrikes) {
    const d = Math.abs(r.strike - spot);
    if (d < atmDist) {
      atmDist = d;
      atmRow = r;
    }
  }

  let atmIv: number | null = null;
  if (atmRow) {
    const ivs = [atmRow.callIv, atmRow.putIv].filter((v): v is number => v !== null && v > 0.01);
    if (ivs.length) atmIv = ivs.reduce((a, b) => a + b, 0) / ivs.length;
  }

  // 25-delta call & put IV for Skew
  const callsWithDelta = primaryContracts.filter(
    (c) => c.optionType === "call" && c.cleanIv > 0.01 && c.greeks.delta > 0.05 && c.greeks.delta < 0.95,
  );
  const putsWithDelta = primaryContracts.filter(
    (c) => c.optionType === "put" && c.cleanIv > 0.01 && c.greeks.delta < -0.05 && c.greeks.delta > -0.95,
  );
  const call25 = callsWithDelta.sort(
    (a, b) => Math.abs(a.greeks.delta - 0.25) - Math.abs(b.greeks.delta - 0.25),
  )[0];
  const put25 = putsWithDelta.sort(
    (a, b) => Math.abs(a.greeks.delta + 0.25) - Math.abs(b.greeks.delta + 0.25),
  )[0];
  const call25Iv = call25 ? call25.cleanIv : null;
  const put25Iv = put25 ? put25.cleanIv : null;
  const skew25 = put25Iv !== null && call25Iv !== null ? put25Iv - call25Iv : null;

  // Expected Move (+/- 1 sigma)
  let expectedMoveUsd: number | null = null;
  if (atmRow && atmRow.callMid && atmRow.putMid && params.assetClass === "equity") {
    // 0.85 * ATM straddle is the standard 1-sigma expected move approximation
    expectedMoveUsd = (atmRow.callMid + atmRow.putMid) * 0.85;
  } else if (atmIv && primaryExp) {
    // For crypto (Deribit mark_price is in BTC/ETH) or missing quotes, use ATM IV * Spot * sqrt(T)
    expectedMoveUsd = spot * atmIv * Math.sqrt(yearsToExpiry(primaryExp, now));
  } else if (atmIv) {
    expectedMoveUsd = spot * atmIv * Math.sqrt(7 / 365);
  }
  const expectedMovePct = expectedMoveUsd !== null && spot > 0 ? (expectedMoveUsd / spot) * 100 : null;
  const expectedHigh = expectedMoveUsd !== null ? spot + expectedMoveUsd : null;
  const expectedLow = expectedMoveUsd !== null ? Math.max(0, spot - expectedMoveUsd) : null;

  // Unusual Activity (high Vol/OI & notional premium)
  const unusual: UnusualOptionItem[] = enriched
    .filter((c) => {
      if (c.volume < 25) return false;
      const ratio = c.volume / Math.max(c.openInterest, 1);
      return ratio >= 1.1 || c.volume >= 500;
    })
    .map((c) => {
      const priceUsd = params.assetClass === "crypto" ? c.mid * spot : c.mid;
      const notionalUsd = c.volume * priceUsd * multiplier;
      const diff = Math.abs(c.strike - spot) / Math.max(spot, 1);
      const moneyness: "ITM" | "ATM" | "OTM" =
        diff <= 0.015
          ? "ATM"
          : (c.optionType === "call" && c.strike < spot) || (c.optionType === "put" && c.strike > spot)
            ? "ITM"
            : "OTM";
      return {
        contractSymbol: c.contractSymbol,
        optionType: c.optionType,
        strike: c.strike,
        expiration: c.expiration,
        volume: c.volume,
        openInterest: c.openInterest,
        volOiRatio: c.volume / Math.max(c.openInterest, 1),
        mid: priceUsd,
        notionalUsd,
        iv: c.cleanIv,
        delta: c.greeks.delta,
        moneyness,
      };
    })
    .sort((a, b) => b.notionalUsd - a.notionalUsd || b.volOiRatio - a.volOiRatio)
    .slice(0, 12);

  // Trim strike ladder to the most relevant window centered around spot (up to 36 strikes)
  let ladder = allStrikes;
  if (allStrikes.length > 36) {
    const centerIdx = Math.max(
      0,
      allStrikes.findIndex((r) => r.strike >= spot),
    );
    const start = Math.max(0, Math.min(centerIdx - 18, allStrikes.length - 36));
    ladder = allStrikes.slice(start, start + 36);
  }

  return {
    ticker: params.ticker,
    display: params.display,
    assetClass: params.assetClass,
    source: params.source,
    asOf: now,
    spot,
    multiplier,
    selectedExpiration: params.selectedExpiration,
    includedExpirations: params.includedExpirations,
    availableExpirations: params.availableExpirations,
    contractCount: enriched.length,
    callWall,
    putWall,
    callVolumeWall,
    putVolumeWall,
    topCallWalls,
    topPutWalls,
    majorPositiveGex,
    majorNegativeGex,
    netGexUsd,
    callGexUsd,
    putGexUsd,
    gammaRegime,
    gammaFlip,
    netDeltaExposureUsd,
    maxPain,
    maxPainDistancePct,
    expectedMoveUsd,
    expectedMovePct,
    expectedHigh,
    expectedLow,
    totalCallOi,
    totalPutOi,
    totalCallVol,
    totalPutVol,
    pcRatioOi: totalCallOi > 0 ? totalPutOi / totalCallOi : null,
    pcRatioVol: totalCallVol > 0 ? totalPutVol / totalCallVol : null,
    atmIv,
    put25Iv,
    call25Iv,
    skew25,
    strikes: ladder,
    unusual,
  };
}

export function formatCompactCount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(Math.round(value));
}

export function formatCompactUsd(value: number): string {
  const sign = value < 0 ? "-" : value > 0 ? "+" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${Math.round(abs)}`;
}

/**
 * Builds crisp horizontal price-level overlays (Put Wall, Call Wall, Gamma Flip, Max Pain, Expected Move ±1σ)
 * for direct rendering on the main Vela price chart.
 */
export function optionsWallOverlays(
  analytics: OptionsAnalytics,
  config: OptionsWallsOverlayConfig = DEFAULT_OPTIONS_WALLS_CONFIG,
): OverlayHLine[] {
  const lines: OverlayHLine[] = [];
  const fmtK = (p: number) => (p >= 1000 ? Math.round(p).toLocaleString("en-US") : p.toFixed(p % 1 === 0 ? 0 : 2));

  if (config.showWalls) {
    if (analytics.callWall) {
      const w = analytics.callWall;
      const metric = w.openInterest > 0 ? `${formatCompactCount(w.openInterest)} OI` : `${formatCompactCount(w.volume)} Vol`;
      lines.push({
        kind: "hline",
        id: "opt-call-wall",
        price: w.strike,
        color: "#22c55e",
        width: 2,
        dash: [],
        label: `CALL WALL $${fmtK(w.strike)} · ${metric}`,
      });
    }
    if (analytics.putWall) {
      const w = analytics.putWall;
      const metric = w.openInterest > 0 ? `${formatCompactCount(w.openInterest)} OI` : `${formatCompactCount(w.volume)} Vol`;
      lines.push({
        kind: "hline",
        id: "opt-put-wall",
        price: w.strike,
        color: "#ef4444",
        width: 2,
        dash: [],
        label: `PUT WALL $${fmtK(w.strike)} · ${metric}`,
      });
    }
  }

  if (config.showGammaFlip && analytics.gammaFlip !== null) {
    lines.push({
      kind: "hline",
      id: "opt-gamma-flip",
      price: analytics.gammaFlip,
      color: "#f59e0b",
      width: 1.5,
      dash: [6, 4],
      label: `GAMMA FLIP $${fmtK(analytics.gammaFlip)}`,
    });
  }

  if (config.showMaxPain && analytics.maxPain !== null) {
    lines.push({
      kind: "hline",
      id: "opt-max-pain",
      price: analytics.maxPain,
      color: "#a855f7",
      width: 1.5,
      dash: [4, 4],
      label: `MAX PAIN $${fmtK(analytics.maxPain)}`,
    });
  }

  if (config.showExpectedMove && analytics.expectedHigh !== null && analytics.expectedLow !== null) {
    const pct = analytics.expectedMovePct !== null ? ` ±${analytics.expectedMovePct.toFixed(1)}%` : "";
    lines.push({
      kind: "hline",
      id: "opt-em-high",
      price: analytics.expectedHigh,
      color: "#38bdf8",
      width: 1,
      dash: [2, 4],
      label: `EM +1σ $${fmtK(analytics.expectedHigh)}${pct}`,
    });
    lines.push({
      kind: "hline",
      id: "opt-em-low",
      price: analytics.expectedLow,
      color: "#38bdf8",
      width: 1,
      dash: [2, 4],
      label: `EM -1σ $${fmtK(analytics.expectedLow)}${pct}`,
    });
  }

  return lines;
}
