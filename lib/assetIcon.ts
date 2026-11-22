import { bybitMarket, providerOf, tickerOf } from "./symbolId";

export type AssetIconCategory = "crypto" | "equity" | "commodity" | "index" | "forex";

export interface AssetIconDescriptor {
  /** Stable cache key shared across venues (e.g. BTCUSDT, HL:BTC, KRAKEN:XBTUSD -> "crypto:BTC"). */
  key: string;
  category: AssetIconCategory;
  /** Canonical primary symbol/ticker/code (e.g. "BTC", "NVDA", "GOLD", "SPX", "EURUSD"). */
  code: string;
  /** Optional Yahoo regional suffix (".DE", ".L", ".PA", etc.) for non-US stocks. */
  suffix?: string;
  /** Display monogram fallback (1-3 chars). */
  monogram: string;
}

const COMMODITY_ALIAS: Record<string, { code: string; monogram: string }> = {
  "GC=F": { code: "GOLD", monogram: "AU" },
  GOLD: { code: "GOLD", monogram: "AU" },
  XAU: { code: "GOLD", monogram: "AU" },
  XAUUSD: { code: "GOLD", monogram: "AU" },
  PAXG: { code: "GOLD", monogram: "AU" },
  XAUT: { code: "GOLD", monogram: "AU" },
  "SI=F": { code: "SILVER", monogram: "AG" },
  SILVER: { code: "SILVER", monogram: "AG" },
  XAG: { code: "SILVER", monogram: "AG" },
  XAGUSD: { code: "SILVER", monogram: "AG" },
  "CL=F": { code: "OIL", monogram: "OIL" },
  "BZ=F": { code: "OIL", monogram: "OIL" },
  CL: { code: "OIL", monogram: "OIL" },
  WTI: { code: "OIL", monogram: "OIL" },
  USOIL: { code: "OIL", monogram: "OIL" },
  BRENTOIL: { code: "OIL", monogram: "OIL" },
  BRENT: { code: "OIL", monogram: "OIL" },
  OIL: { code: "OIL", monogram: "OIL" },
  "NG=F": { code: "GAS", monogram: "NG" },
  NATGAS: { code: "GAS", monogram: "NG" },
  NG: { code: "GAS", monogram: "NG" },
  "HG=F": { code: "COPPER", monogram: "CU" },
  COPPER: { code: "COPPER", monogram: "CU" },
  HG: { code: "COPPER", monogram: "CU" },
  "PL=F": { code: "PLATINUM", monogram: "PT" },
  PLATINUM: { code: "PLATINUM", monogram: "PT" },
  PL: { code: "PLATINUM", monogram: "PT" },
  "PA=F": { code: "PLATINUM", monogram: "PD" },
  PALLADIUM: { code: "PLATINUM", monogram: "PD" },
  "ZC=F": { code: "CORN", monogram: "ZC" },
  CORN: { code: "CORN", monogram: "ZC" },
  ZC: { code: "CORN", monogram: "ZC" },
  "ZW=F": { code: "WHEAT", monogram: "ZW" },
  WHEAT: { code: "WHEAT", monogram: "ZW" },
  ZW: { code: "WHEAT", monogram: "ZW" },
  "ZS=F": { code: "SOY", monogram: "ZS" },
  SOY: { code: "SOY", monogram: "ZS" },
  SOYBEAN: { code: "SOY", monogram: "ZS" },
  SOYBEANS: { code: "SOY", monogram: "ZS" },
  ZS: { code: "SOY", monogram: "ZS" },
};

const INDEX_ALIAS: Record<string, { code: string; monogram: string }> = {
  "^GSPC": { code: "SPX", monogram: "SPX" },
  SPX: { code: "SPX", monogram: "SPX" },
  SP500: { code: "SPX", monogram: "SPX" },
  SPX500: { code: "SPX", monogram: "SPX" },
  USA500: { code: "SPX", monogram: "SPX" },
  US500: { code: "SPX", monogram: "SPX" },
  "^NDX": { code: "NDX", monogram: "NDX" },
  "^IXIC": { code: "NDX", monogram: "NDX" },
  NDX: { code: "NDX", monogram: "NDX" },
  NDX100: { code: "NDX", monogram: "NDX" },
  NAS100: { code: "NDX", monogram: "NDX" },
  USTEC: { code: "NDX", monogram: "NDX" },
  US100: { code: "NDX", monogram: "NDX" },
  XYZ100: { code: "NDX", monogram: "NDX" },
  "^DJI": { code: "DJI", monogram: "DOW" },
  DJI: { code: "DJI", monogram: "DOW" },
  US30: { code: "DJI", monogram: "DOW" },
  WS30: { code: "DJI", monogram: "DOW" },
  "^RUT": { code: "RUT", monogram: "RUT" },
  RUT: { code: "RUT", monogram: "RUT" },
  US2000: { code: "RUT", monogram: "RUT" },
  "^GDAXI": { code: "DAX", monogram: "DAX" },
  DAX: { code: "DAX", monogram: "DAX" },
  GER40: { code: "DAX", monogram: "DAX" },
  DE40: { code: "DAX", monogram: "DAX" },
  "^FTSE": { code: "FTSE", monogram: "UK" },
  FTSE: { code: "FTSE", monogram: "UK" },
  UK100: { code: "FTSE", monogram: "UK" },
  "^N225": { code: "N225", monogram: "JP" },
  N225: { code: "N225", monogram: "JP" },
  JP225: { code: "N225", monogram: "JP" },
  "^VIX": { code: "VIX", monogram: "VIX" },
  VIX: { code: "VIX", monogram: "VIX" },
  "DX-Y.NYB": { code: "DXY", monogram: "DXY" },
  DXY: { code: "DXY", monogram: "DXY" },
};

const FX_CURRENCIES = new Set(["EUR", "USD", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "SEK", "NOK", "MXN", "SGD", "HKD", "CNH", "TRY", "ZAR"]);

const CRYPTO_QUOTES = ["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USD", "EUR", "BTC", "ETH", "BNB"];
const KRAKEN_QUOTES = ["USDT", "USDC", "USD", "EUR", "GBP", "XBT", "BTC", "ETH"];

/** Known US stock tickers that may appear on Hyperliquid builder DEXes or tokenized perp venues. */
const KNOWN_EQUITY_TICKERS = new Set([
  "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "TSLA",
  "AVGO", "AMD", "TSM", "MU", "INTC", "QCOM", "ASML", "ARM", "AMAT", "LRCX", "KLAC", "TXN", "ADI", "MRVL", "NXPI", "ON",
  "SPY", "QQQ", "IWM", "DIA", "VOO", "SMH", "SOXX", "XLK", "XLF", "XLE", "TLT", "GLD", "SLV", "USO", "UNG",
  "PLTR", "NFLX", "ORCL", "CRM", "NOW", "UBER", "ADBE", "CRWD", "PANW", "COIN", "HOOD", "MSTR", "SMCI", "RDDT", "APP", "SNOW", "SHOP", "SPOT", "PYPL", "SQ", "SOFI",
  "JPM", "BRK.B", "BRK-B", "BAC", "WFC", "C", "GS", "MS", "V", "MA",
  "WMT", "COST", "HD", "MCD", "KO", "PEP", "NKE", "LLY", "UNH", "JNJ", "ABBV", "MRK",
  "XOM", "CVX", "COP", "SLB", "OXY", "FCX", "NEM", "GE", "CAT", "BA", "RTX",
  "BABA", "PDD", "NIO", "RIVN", "SAP", "SIE", "ALV", "AIR", "RHM",
]);

function stripCryptoQuote(raw: string, quotes: readonly string[] = CRYPTO_QUOTES): string {
  const upper = raw.toUpperCase();
  for (const q of quotes) {
    if (q === "TUSD" && upper.length <= 6) continue;
    if (upper.length > q.length + 1 && upper.endsWith(q)) {
      return upper.slice(0, -q.length);
    }
  }
  return upper;
}

function normalizeCryptoBase(base: string): string {
  const cleaned = base
    .replace(/^k(?=[A-Z]{3,})/, "")
    .toUpperCase()
    .replace(/^1000000|^10000|^1000/, "");
  if (cleaned === "XBT") return "BTC";
  if (cleaned === "XDG") return "DOGE";
  return cleaned || base.toUpperCase();
}

function matchForex(raw: string): AssetIconDescriptor | null {
  const clean = raw.toUpperCase().replace(/=X$/, "").replace(/[/\-_]/g, "");
  if (clean.length !== 6) return null;
  const a = clean.slice(0, 3);
  const b = clean.slice(3, 6);
  if (!FX_CURRENCIES.has(a) || !FX_CURRENCIES.has(b) || a === b) return null;
  return { key: `forex:${a}${b}`, category: "forex", code: `${a}${b}`, monogram: a };
}

/** Resolve any AffenTerminal symbol ID (Binance, Hyperliquid, Bybit, Kraken, Yahoo, Alpaca) to a canonical asset icon key. */
export function resolveAssetIconKey(symbol: string): AssetIconDescriptor {
  const trimmed = (symbol || "BTCUSDT").trim();
  const provider = providerOf(trimmed);

  if (provider === "hyperliquid") {
    const rawCoin = tickerOf(trimmed);
    const colon = rawCoin.indexOf(":");
    const isBuilderDex = colon >= 0;
    const rawUnderlying = (isBuilderDex ? rawCoin.slice(colon + 1) : rawCoin).replace(/-PERP$/i, "");
    const underlying = rawUnderlying.toUpperCase();
    if (COMMODITY_ALIAS[underlying]) {
      const c = COMMODITY_ALIAS[underlying];
      return { key: `commodity:${c.code}`, category: "commodity", code: c.code, monogram: c.monogram };
    }
    if (INDEX_ALIAS[underlying]) {
      const idx = INDEX_ALIAS[underlying];
      return { key: `index:${idx.code}`, category: "index", code: idx.code, monogram: idx.monogram };
    }
    const fx = matchForex(underlying);
    if (fx) return fx;
    if (isBuilderDex || KNOWN_EQUITY_TICKERS.has(underlying)) {
      const eq = underlying.replace(/-/g, ".");
      return { key: `equity:${eq}`, category: "equity", code: eq, monogram: eq.slice(0, 3) };
    }
    const base = normalizeCryptoBase(rawUnderlying);
    return { key: `crypto:${base}`, category: "crypto", code: base, monogram: base.slice(0, 3) };
  }

  if (provider === "bybit") {
    const market = bybitMarket(trimmed);
    const raw = (market?.pair ?? tickerOf(trimmed)).toUpperCase();
    const base = stripCryptoQuote(raw);
    if (COMMODITY_ALIAS[base]) {
      const c = COMMODITY_ALIAS[base];
      return { key: `commodity:${c.code}`, category: "commodity", code: c.code, monogram: c.monogram };
    }
    if (KNOWN_EQUITY_TICKERS.has(base)) {
      return { key: `equity:${base}`, category: "equity", code: base, monogram: base.slice(0, 3) };
    }
    const norm = normalizeCryptoBase(base);
    return { key: `crypto:${norm}`, category: "crypto", code: norm, monogram: norm.slice(0, 3) };
  }

  if (provider === "kraken" || /^KRAKEN:/i.test(trimmed)) {
    const raw = (provider === "kraken" ? tickerOf(trimmed) : trimmed.slice(7)).toUpperCase().replace(/\//g, "");
    const fx = matchForex(raw);
    if (fx) return fx;
    const base = normalizeCryptoBase(stripCryptoQuote(raw, KRAKEN_QUOTES));
    return { key: `crypto:${base}`, category: "crypto", code: base, monogram: base.slice(0, 3) };
  }

  if (provider === "yahoo" || provider === "alpaca") {
    const raw = tickerOf(trimmed).toUpperCase();
    if (COMMODITY_ALIAS[raw]) {
      const c = COMMODITY_ALIAS[raw];
      return { key: `commodity:${c.code}`, category: "commodity", code: c.code, monogram: c.monogram };
    }
    if (INDEX_ALIAS[raw]) {
      const idx = INDEX_ALIAS[raw];
      return { key: `index:${idx.code}`, category: "index", code: idx.code, monogram: idx.monogram };
    }
    const fx = matchForex(raw);
    if (fx) return fx;
    if (/^[A-Z0-9]+-USD$/i.test(raw)) {
      const base = normalizeCryptoBase(raw.slice(0, -4));
      return { key: `crypto:${base}`, category: "crypto", code: base, monogram: base.slice(0, 3) };
    }
    const dotMatch = raw.match(/^([A-Z0-9-]+)(\.[A-Z]{1,4})$/);
    if (dotMatch) {
      const [, stem, suffix] = dotMatch;
      // Preserve US share classes like BRK.B vs regional exchange suffixes (.DE, .L, .PA, .SW, .TO)
      if (suffix.length === 2 && (stem === "BRK" || stem === "BF")) {
        const cls = `${stem}${suffix}`;
        return { key: `equity:${cls}`, category: "equity", code: cls, monogram: stem };
      }
      return { key: `equity:${stem}${suffix}`, category: "equity", code: stem, suffix, monogram: stem.slice(0, 3) };
    }
    const normalized = raw.replace(/^(BRK|BF)-([AB])$/, "$1.$2");
    return { key: `equity:${normalized}`, category: "equity", code: normalized, monogram: normalized.replace(/\..*$/, "").slice(0, 3) };
  }

  // Default: Binance / raw crypto pair (e.g. BTCUSDT, ETHUSDT, PAXGUSDT)
  const upper = trimmed.toUpperCase();
  if (COMMODITY_ALIAS[upper]) {
    const c = COMMODITY_ALIAS[upper];
    return { key: `commodity:${c.code}`, category: "commodity", code: c.code, monogram: c.monogram };
  }
  const fx = matchForex(upper);
  if (fx) return fx;
  const base = stripCryptoQuote(upper);
  if (COMMODITY_ALIAS[base]) {
    const c = COMMODITY_ALIAS[base];
    return { key: `commodity:${c.code}`, category: "commodity", code: c.code, monogram: c.monogram };
  }
  const norm = normalizeCryptoBase(base);
  return { key: `crypto:${norm}`, category: "crypto", code: norm, monogram: norm.slice(0, 3) };
}

/** Same-origin cached URL for any asset icon, deduplicated across venues via canonical key. */
export function assetIconUrl(symbol: string): string {
  const { key } = resolveAssetIconKey(symbol);
  return `/api/asset-icon?k=${encodeURIComponent(key)}`;
}
