import { resolveAssetIconKey, type AssetIconCategory, type AssetIconDescriptor } from "../assetIcon";

export interface ResolvedAssetIcon {
  body: Buffer;
  contentType: "image/svg+xml; charset=utf-8" | "image/png" | "image/webp";
  /** True when a real brand/asset icon was resolved (long 7-day browser cache); false for transient fallback (10m cache). */
  authentic: boolean;
}

const TV_LOGO_BASE = "https://s3-symbol-logo.tradingview.com";
const MAX_CACHE_ENTRIES = 800;
const AUTHENTIC_TTL_MS = 24 * 60 * 60 * 1000;
const FALLBACK_TTL_MS = 10 * 60 * 1000;
const MAX_UPSTREAM_BYTES = 96 * 1024;
const FETCH_TIMEOUT_MS = 3500;

interface CacheEntry {
  icon: ResolvedAssetIcon;
  expiresAt: number;
}

const iconCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ResolvedAssetIcon>>();

/** Pre-verified TradingView logoids for preset US equities, ETFs, and major global listings (0ms lookup). */
const STOCK_LOGOIDS: Record<string, string> = {
  // Magnificent 7 & Mega-Cap Tech
  AAPL: "apple",
  MSFT: "microsoft",
  GOOGL: "alphabet",
  GOOG: "alphabet",
  NVDA: "nvidia",
  AMZN: "amazon",
  META: "meta-platforms",
  TSLA: "tesla",
  // Semiconductors
  AVGO: "broadcom",
  AMD: "advanced-micro-devices",
  TSM: "taiwan-semiconductor",
  MU: "micron-technology",
  INTC: "intel",
  QCOM: "qualcomm",
  ASML: "asml",
  ARM: "arm",
  AMAT: "applied-materials",
  LRCX: "lam-research",
  KLAC: "kla-tencor",
  TXN: "texas-instruments",
  ADI: "analog-devices",
  MRVL: "marvell-tech",
  NXPI: "nxp-semiconductors",
  ON: "on-semiconductor",
  SMCI: "super-micro-computer",
  // Software & Internet
  PLTR: "palantir",
  NFLX: "netflix",
  ORCL: "oracle",
  CRM: "salesforce",
  NOW: "servicenow",
  UBER: "uber",
  ADBE: "adobe",
  CRWD: "crowdstrike",
  PANW: "palo-alto-networks",
  COIN: "coinbase",
  HOOD: "robinhood",
  MSTR: "microstrategy",
  SHOP: "shopify",
  SPOT: "spotify-technology",
  SNOW: "snowflake",
  DDOG: "datadog",
  NET: "cloudflare",
  PYPL: "paypal",
  RDDT: "reddit",
  APP: "applovin",
  SOFI: "sofi-technologies",
  // Financials
  JPM: "jpmorgan-chase",
  "BRK.B": "berkshire-hathaway",
  "BRK.A": "berkshire-hathaway",
  BAC: "bank-of-america",
  WFC: "wells-fargo",
  C: "citigroup",
  GS: "golden-sachs-etf-trust-goldman",
  MS: "morgan-stanley",
  V: "visa",
  MA: "mastercard",
  // Consumer & Healthcare
  WMT: "walmart",
  COST: "costco-wholesale",
  HD: "home-depot",
  MCD: "mcdonalds",
  KO: "coca-cola",
  PEP: "pepsico",
  NKE: "nike",
  LLY: "eli-lilly",
  UNH: "unitedhealth",
  JNJ: "johnson-and-johnson",
  ABBV: "abbvie",
  MRK: "merck-and-co",
  // Energy, Mining & Industrials
  XOM: "exxon",
  CVX: "chevron",
  COP: "conocophillips",
  SLB: "schlumberger",
  OXY: "occidental-petroleum",
  FCX: "freeport-mcmoran",
  NEM: "newmont",
  GE: "ge-aerospace",
  CAT: "caterpillar",
  BA: "boeing",
  RTX: "raytheon",
  // ETFs & ETPs
  SPY: "spdr-sandp500-etf-tr",
  DIA: "spdr-sandp500-etf-tr",
  XLK: "spdr-sandp500-etf-tr",
  XLF: "spdr-sandp500-etf-tr",
  XLE: "spdr-sandp500-etf-tr",
  GLD: "spdr-sandp500-etf-tr",
  QQQ: "invesco",
  VOO: "vanguard",
  IWM: "ishares",
  SOXX: "ishares",
  TLT: "ishares",
  SLV: "ishares",
  SMH: "vaneck",
  USO: "uscf-fund",
  UNG: "uscf-fund",
  // Major European / DAX / FTSE / Global
  SAP: "sap",
  SIE: "siemens",
  ALV: "allianz",
  DTE: "deutsche-telekom",
  AIR: "airbus",
  MBG: "mercedes-benz-group",
  BMW: "bayerische-motoren-werke",
  VOW3: "volkswagen",
  BAS: "basf",
  IFX: "infineon-technologies",
  RHM: "rheinmetall",
  ADS: "adidas",
  MUV2: "munich-re",
  DBK: "deutsche-bank",
  SHEL: "shell",
  AZN: "astrazeneca",
  HSBA: "hsbc",
  BP: "bp",
  BABA: "alibaba",
  PDD: "pinduoduo",
  NIO: "nio",
  RIVN: "rivian",
};

const COMMODITY_LOGOIDS: Record<string, string> = {
  GOLD: "metal/gold",
  SILVER: "metal/silver",
  OIL: "crude-oil",
  GAS: "natural-gas",
  COPPER: "metal/copper",
  PLATINUM: "metal/platinum",
};

const INDEX_LOGOIDS: Record<string, string> = {
  SPX: "indices/s-and-p-500",
  NDX: "indices/nasdaq-100",
  DJI: "indices/dow-30",
  DAX: "indices/dax",
  N225: "indices/nikkei-225",
  RUT: "indices/russell-2000",
};

const FX_COLORS: Record<string, { bg: string; fg: string; ring: string }> = {
  EUR: { bg: "#003399", fg: "#FFCC00", ring: "#2958C7" },
  USD: { bg: "#1B3B6F", fg: "#FFFFFF", ring: "#D62828" },
  GBP: { bg: "#012169", fg: "#FFFFFF", ring: "#C8102E" },
  JPY: { bg: "#F4F6FA", fg: "#BC002D", ring: "#BC002D" },
  CHF: { bg: "#D52B1E", fg: "#FFFFFF", ring: "#FFFFFF" },
  AUD: { bg: "#00247D", fg: "#FFFFFF", ring: "#F7B500" },
  CAD: { bg: "#C8102E", fg: "#FFFFFF", ring: "#FFFFFF" },
  NZD: { bg: "#00247D", fg: "#FFFFFF", ring: "#CC142B" },
  SEK: { bg: "#006AA7", fg: "#FECC00", ring: "#FECC00" },
  NOK: { bg: "#BA0C2F", fg: "#FFFFFF", ring: "#00205B" },
  CNH: { bg: "#DE2910", fg: "#FFDE00", ring: "#FFDE00" },
};

const PALETTE: readonly [string, string][] = [
  ["#2962FF", "#1538A6"],
  ["#089981", "#055B4C"],
  ["#F7931A", "#B56207"],
  ["#7C3AED", "#4C1D95"],
  ["#E11D48", "#881337"],
  ["#0284C7", "#075985"],
  ["#D97706", "#92400E"],
  ["#16A34A", "#14532D"],
  ["#DB2777", "#831843"],
  ["#4F46E5", "#312E81"],
];

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hashCode(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Validate and normalize upstream SVG (blocks active content and ensures viewBox so <img> scales cleanly). */
export function sanitizeAndNormalizeSvg(raw: string): string | null {
  const cleaned = raw.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!cleaned.startsWith("<svg") || !cleaned.includes("</svg>")) return null;
  if (/<(?:script|foreignObject|iframe|object|embed|audio|video|animate|set)\b/i.test(cleaned)) return null;
  if (/\son[a-z]+\s*=/i.test(cleaned)) return null;
  if (/javascript\s*:|data\s*:\s*text\/html|xlink:href\s*=\s*["']\s*https?:/i.test(cleaned)) return null;
  if (/\shref\s*=\s*["']\s*https?:/i.test(cleaned)) return null;

  // TradingView SVGs ship with width="56" height="56" and no viewBox; inject viewBox so small <img> badges scale instead of cropping.
  const openTagMatch = cleaned.match(/^<svg\b[^>]*>/i);
  if (!openTagMatch) return null;
  const openTag = openTagMatch[0];
  if (!/\bviewBox\s*=/i.test(openTag)) {
    const w = openTag.match(/\bwidth\s*=\s*["'](\d+(?:\.\d+)?)["']/i)?.[1] ?? "56";
    const h = openTag.match(/\bheight\s*=\s*["'](\d+(?:\.\d+)?)["']/i)?.[1] ?? "56";
    const patched = openTag.replace(/^<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`);
    return patched + cleaned.slice(openTag.length);
  }
  return cleaned;
}

/** Bespoke crisp local vector icons for agricultural commodities, specialized indices, and Forex pairs. */
function builtInArtworkSvg(desc: AssetIconDescriptor): string | null {
  if (desc.category === "commodity") {
    if (desc.code === "CORN") {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#B45309"/></linearGradient></defs><rect width="56" height="56" fill="url(#g)"/><ellipse cx="28" cy="24" rx="8.5" ry="13.5" fill="#FDE68A" stroke="#92400E" stroke-width="1.6"/><path d="M23 18h10M21.5 23h13M22 28h12M28 11v25" stroke="#D97706" stroke-width="1.3"/><path d="M28 38c-7 0-12-5-13-12 5 2 9 5 13 12zm0 0c7 0 12-5 13-12-5 2-9 5-13 12z" fill="#15803D"/><path d="M28 37v8" stroke="#14532D" stroke-width="2.6" stroke-linecap="round"/></svg>`;
    }
    if (desc.code === "WHEAT") {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#D97706"/><stop offset="100%" stop-color="#78350F"/></linearGradient></defs><rect width="56" height="56" fill="url(#g)"/><path d="M28 11v34" stroke="#FEF3C7" stroke-width="2.4" stroke-linecap="round"/><g fill="#FDE68A"><ellipse cx="22.5" cy="18" rx="3.2" ry="5.5" transform="rotate(-32 22.5 18)"/><ellipse cx="33.5" cy="18" rx="3.2" ry="5.5" transform="rotate(32 33.5 18)"/><ellipse cx="22" cy="26" rx="3.3" ry="5.5" transform="rotate(-32 22 26)"/><ellipse cx="34" cy="26" rx="3.3" ry="5.5" transform="rotate(32 34 26)"/><ellipse cx="22.5" cy="34" rx="3.2" ry="5.5" transform="rotate(-32 22.5 34)"/><ellipse cx="33.5" cy="34" rx="3.2" ry="5.5" transform="rotate(32 33.5 34)"/></g></svg>`;
    }
    if (desc.code === "SOY") {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#16A34A"/><stop offset="100%" stop-color="#14532D"/></linearGradient></defs><rect width="56" height="56" fill="url(#g)"/><path d="M16 37c4-14 14-21 24-21-1 11-8 21-24 21z" fill="#86EFAC"/><circle cx="24" cy="31" r="3.4" fill="#15803D"/><circle cx="30.5" cy="26" r="3.4" fill="#15803D"/><circle cx="36" cy="21" r="2.8" fill="#15803D"/></svg>`;
    }
  }

  if (desc.category === "index") {
    if (desc.code === "FTSE") {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#012169"/><path d="M0 0l56 56M56 0L0 56" stroke="#FFF" stroke-width="6" opacity=".35"/><path d="M28 0v56M0 28h56" stroke="#C8102E" stroke-width="8" opacity=".45"/><text x="28" y="34" text-anchor="middle" fill="#FFF" font-family="system-ui,-apple-system,sans-serif" font-weight="800" font-size="16">UK100</text></svg>`;
    }
    if (desc.code === "VIX") {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#EF4444"/><stop offset="100%" stop-color="#7F1D1D"/></linearGradient></defs><rect width="56" height="56" fill="url(#g)"/><polyline points="7,31 16,31 22,16 29,40 35,22 40,31 49,31" fill="none" stroke="#FFF" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (desc.code === "DXY") {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#15803D"/><stop offset="100%" stop-color="#052E16"/></linearGradient></defs><rect width="56" height="56" fill="url(#g)"/><text x="28" y="36" text-anchor="middle" fill="#FDE68A" font-family="system-ui,-apple-system,sans-serif" font-weight="800" font-size="25">$</text></svg>`;
    }
  }

  if (desc.category === "forex" && desc.code.length === 6) {
    const a = desc.code.slice(0, 3);
    const b = desc.code.slice(3, 6);
    const ca = FX_COLORS[a] ?? { bg: "#1E3A8A", fg: "#FFFFFF", ring: "#60A5FA" };
    const cb = FX_COLORS[b] ?? { bg: "#0F766E", fg: "#FFFFFF", ring: "#5EEAD4" };
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="${ca.bg}"/><polygon points="56,0 56,56 0,56" fill="${cb.bg}"/><line x1="0" y1="56" x2="56" y2="0" stroke="rgba(255,255,255,0.45)" stroke-width="2"/><text x="16" y="23" text-anchor="middle" fill="${ca.fg}" font-family="system-ui,-apple-system,sans-serif" font-weight="800" font-size="13">${escapeXml(a)}</text><text x="40" y="43" text-anchor="middle" fill="${cb.fg}" font-family="system-ui,-apple-system,sans-serif" font-weight="800" font-size="13">${escapeXml(b)}</text></svg>`;
  }

  return null;
}

/** Deterministic high-contrast vector monogram fallback (guarantees HTTP 200 and zero broken images). */
export function buildMonogramSvg(desc: AssetIconDescriptor): string {
  const [c1, c2] = PALETTE[hashCode(desc.key) % PALETTE.length];
  const label = (desc.monogram || desc.code || "?").slice(0, 3).toUpperCase();
  const fontSize = label.length === 1 ? 26 : label.length === 2 ? 20 : 15;
  const accent =
    desc.category === "crypto"
      ? `<circle cx="44" cy="12" r="4" fill="rgba(255,255,255,0.32)"/>`
      : desc.category === "commodity"
        ? `<polygon points="44,8 48,14 44,20 40,14" fill="rgba(255,255,255,0.34)"/>`
        : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="56" height="56" fill="url(#bg)"/>${accent}<text x="28" y="35" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-weight="700" font-size="${fontSize}" letter-spacing="-0.4">${escapeXml(label)}</text></svg>`;
}

async function fetchIconUrl(url: string, fetcher: typeof fetch): Promise<ResolvedAssetIcon | null> {
  try {
    const res = await fetcher(url, {
      headers: { Accept: "image/svg+xml,image/png,image/webp,*/*;q=0.5" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const rawCt = (res.headers.get("content-type") ?? "").toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_UPSTREAM_BYTES) return null;

    if (rawCt.includes("svg") || url.endsWith(".svg")) {
      const normalized = sanitizeAndNormalizeSvg(buf.toString("utf8"));
      if (!normalized) return null;
      return { body: Buffer.from(normalized, "utf8"), contentType: "image/svg+xml; charset=utf-8", authentic: true };
    }
    if (rawCt.includes("png")) {
      return { body: buf, contentType: "image/png", authentic: true };
    }
    if (rawCt.includes("webp")) {
      return { body: buf, contentType: "image/webp", authentic: true };
    }
    return null;
  } catch {
    return null;
  }
}

async function lookupTradingViewEquityLogoid(
  code: string,
  suffix: string | undefined,
  fetcher: typeof fetch,
): Promise<string | null> {
  const region =
    suffix === ".DE" || suffix === ".F"
      ? "germany"
      : suffix === ".L"
        ? "uk"
        : !suffix
          ? "america"
          : "global";
  try {
    const res = await fetcher(`https://scanner.tradingview.com/${region}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: [{ left: "name", operation: "equal", right: code }],
        columns: ["name", "logoid", "market_cap_basic"],
        sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
        range: [0, 3],
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ d?: unknown[] }> };
    for (const row of json.data ?? []) {
      const logoid = row.d?.[1];
      if (typeof logoid === "string" && /^[a-z0-9/_-]+$/i.test(logoid)) {
        return logoid;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveUncached(desc: AssetIconDescriptor, fetcher: typeof fetch): Promise<ResolvedAssetIcon> {
  const builtIn = builtInArtworkSvg(desc);

  if (desc.category === "commodity") {
    const tvId = COMMODITY_LOGOIDS[desc.code];
    if (tvId) {
      const hit = await fetchIconUrl(`${TV_LOGO_BASE}/${tvId}--big.svg`, fetcher);
      if (hit) return hit;
    }
    if (builtIn) return { body: Buffer.from(builtIn, "utf8"), contentType: "image/svg+xml; charset=utf-8", authentic: true };
  }

  if (desc.category === "index") {
    const tvId = INDEX_LOGOIDS[desc.code];
    if (tvId) {
      const hit = await fetchIconUrl(`${TV_LOGO_BASE}/${tvId}--big.svg`, fetcher);
      if (hit) return hit;
    }
    if (builtIn) return { body: Buffer.from(builtIn, "utf8"), contentType: "image/svg+xml; charset=utf-8", authentic: true };
  }

  if (desc.category === "forex" && builtIn) {
    return { body: Buffer.from(builtIn, "utf8"), contentType: "image/svg+xml; charset=utf-8", authentic: true };
  }

  if (desc.category === "crypto") {
    const safeCode = desc.code.replace(/[^A-Z0-9]/g, "");
    if (safeCode) {
      const tvHit = await fetchIconUrl(`${TV_LOGO_BASE}/crypto/XTVC${encodeURIComponent(safeCode)}--big.svg`, fetcher);
      if (tvHit) return tvHit;
      const ccHit = await fetchIconUrl(`https://assets.coincap.io/assets/icons/${encodeURIComponent(safeCode.toLowerCase())}@2x.png`, fetcher);
      if (ccHit) return ccHit;
    }
  }

  if (desc.category === "equity") {
    const knownId = STOCK_LOGOIDS[desc.code] ?? STOCK_LOGOIDS[desc.code.replace(/-/g, ".")];
    if (knownId) {
      const tvHit = await fetchIconUrl(`${TV_LOGO_BASE}/${knownId}--big.svg`, fetcher);
      if (tvHit) return tvHit;
    }
    const dynamicId = await lookupTradingViewEquityLogoid(desc.code, desc.suffix, fetcher);
    if (dynamicId) {
      const tvHit = await fetchIconUrl(`${TV_LOGO_BASE}/${dynamicId}--big.svg`, fetcher);
      if (tvHit) return tvHit;
    }
    if (!desc.suffix && /^[A-Z0-9.-]{1,10}$/.test(desc.code)) {
      const fmpHit = await fetchIconUrl(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(desc.code)}.png`, fetcher);
      if (fmpHit) return fmpHit;
    }
  }

  return {
    body: Buffer.from(buildMonogramSvg(desc), "utf8"),
    contentType: "image/svg+xml; charset=utf-8",
    authentic: false,
  };
}

function setCached(key: string, icon: ResolvedAssetIcon) {
  if (iconCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = iconCache.keys().next().value;
    if (oldest) iconCache.delete(oldest);
  }
  iconCache.set(key, {
    icon,
    expiresAt: Date.now() + (icon.authentic ? AUTHENTIC_TTL_MS : FALLBACK_TTL_MS),
  });
}

function parseDescriptorParam(param: string): AssetIconDescriptor | null {
  const trimmed = param.trim();
  if (!trimmed || trimmed.length > 48) return null;
  if (trimmed.includes("..") || trimmed.startsWith("/") || trimmed.endsWith("/")) return null;
  if (!/^[A-Za-z0-9:._^=\/-]+$/.test(trimmed)) return null;

  // Support both canonical keys ("crypto:BTC", "equity:NVDA", "commodity:GOLD") and raw symbol IDs ("BTCUSDT", "YF:AAPL").
  const canonical = trimmed.match(/^(crypto|equity|commodity|index|forex):([A-Za-z0-9._-]+)$/);
  if (canonical) {
    const category = canonical[1] as AssetIconCategory;
    const rawCode = canonical[2].toUpperCase();
    if (category === "equity") {
      const dot = rawCode.match(/^([A-Z0-9-]+)(\.[A-Z]{1,4})$/);
      if (dot && !(dot[2].length === 2 && (dot[1] === "BRK" || dot[1] === "BF"))) {
        return { key: `equity:${rawCode}`, category, code: dot[1], suffix: dot[2], monogram: dot[1].slice(0, 3) };
      }
      return { key: `equity:${rawCode}`, category, code: rawCode, monogram: rawCode.replace(/\..*$/, "").slice(0, 3) };
    }
    return {
      key: `${category}:${rawCode}`,
      category,
      code: rawCode,
      monogram: category === "forex" ? rawCode.slice(0, 3) : rawCode.slice(0, 3),
    };
  }
  return resolveAssetIconKey(trimmed);
}

/** Resolve and cache an asset icon by canonical key or symbol ID. Always returns a valid image (never throws). */
export async function resolveAssetIcon(
  input: string,
  fetcher: typeof fetch = fetch,
): Promise<ResolvedAssetIcon | null> {
  const desc = parseDescriptorParam(input);
  if (!desc) return null;

  const now = Date.now();
  const cached = iconCache.get(desc.key);
  if (cached && cached.expiresAt > now) {
    iconCache.delete(desc.key);
    iconCache.set(desc.key, cached);
    return cached.icon;
  }

  const pending = inFlight.get(desc.key);
  if (pending) return pending;

  const task = resolveUncached(desc, fetcher)
    .then((icon) => {
      setCached(desc.key, icon);
      return icon;
    })
    .finally(() => {
      inFlight.delete(desc.key);
    });
  inFlight.set(desc.key, task);
  return task;
}

export function clearAssetIconCache() {
  iconCache.clear();
  inFlight.clear();
}
