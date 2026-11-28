import YahooFinance from "yahoo-finance2";
import {
  computeOptionsAnalytics,
  resolveOptionsTarget,
  type OptionsAnalytics,
  type RawOptionContract,
} from "@/lib/market/optionsAnalytics";
import { setBoundedCache } from "./cache";
import { HttpError } from "./security";

const CACHE_TTL_MS = 90_000;
const chainCache = new Map<string, { at: number; data: OptionsAnalytics }>();

let yfClient: InstanceType<typeof YahooFinance> | null = null;
function getYahooClient() {
  if (!yfClient) {
    yfClient = new YahooFinance({
      validation: { logErrors: false },
      suppressNotices: ["yahooSurvey"],
      versionCheck: false,
    });
  }
  return yfClient;
}

export function clearOptionsChainCache(): void {
  chainCache.clear();
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DERIBIT_MONTHS: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

function toIsoDate(value: Date | number | string | undefined): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10);
  }
  return "";
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const clean = v.replace(/[$,%\s]/g, "").replace(/,/g, "");
    if (!clean || clean === "--" || clean === "N/A") return 0;
    const n = Number(clean);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Parses Deribit instrument names like `BTC-26MAR27-40000-C` or `ETH-4DEC26-3200-P`. */
export function parseDeribitInstrument(name: string): {
  currency: string;
  expiration: string;
  strike: number;
  optionType: "call" | "put";
} | null {
  const m = /^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-([CP])$/.exec(name);
  if (!m) return null;
  const month = DERIBIT_MONTHS[m[3]];
  if (!month) return null;
  const day = m[2].padStart(2, "0");
  const year = `20${m[4]}`;
  const strike = Number(m[5]);
  if (!(strike > 0)) return null;
  return {
    currency: m[1],
    expiration: `${year}-${month}-${day}`,
    strike,
    optionType: m[6] === "C" ? "call" : "put",
  };
}

interface DeribitBookRow {
  instrument_name?: string;
  open_interest?: number;
  volume?: number;
  mark_iv?: number;
  bid_price?: number | null;
  ask_price?: number | null;
  mark_price?: number | null;
  last?: number | null;
  underlying_price?: number | null;
}

async function fetchDeribitOptions(
  currency: string,
  display: string,
  expiryParam: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  now: number,
): Promise<OptionsAnalytics> {
  const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${encodeURIComponent(currency)}&kind=option`;
  const res = await fetcher(url, {
    headers: { accept: "application/json", "user-agent": "AffenTerminal/1.0" },
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new HttpError(502, `Deribit antwortete mit HTTP ${res.status}.`);
  const json = (await res.json()) as { result?: DeribitBookRow[] };
  const rows = Array.isArray(json?.result) ? json.result : [];
  if (!rows.length) throw new HttpError(404, `Keine Optionskette für ${display} gefunden.`);

  const allContracts: RawOptionContract[] = [];
  const expirySet = new Set<string>();
  const spotSamples: number[] = [];

  for (const row of rows) {
    if (!row.instrument_name) continue;
    const parsed = parseDeribitInstrument(row.instrument_name);
    if (!parsed) continue;
    if (typeof row.underlying_price === "number" && row.underlying_price > 0) {
      spotSamples.push(row.underlying_price);
    }
    expirySet.add(parsed.expiration);
    const ivDec = num(row.mark_iv) / 100;
    allContracts.push({
      contractSymbol: row.instrument_name,
      optionType: parsed.optionType,
      strike: parsed.strike,
      expiration: parsed.expiration,
      openInterest: num(row.open_interest),
      volume: num(row.volume),
      impliedVolatility: ivDec,
      bid: num(row.bid_price),
      ask: num(row.ask_price),
      lastPrice: num(row.mark_price) || num(row.last),
    });
  }

  const availableExpirations = [...expirySet].sort();
  if (!availableExpirations.length) {
    throw new HttpError(404, `Keine aktiven Verfallstermine für ${display} gefunden.`);
  }

  // Median spot from nearest expiration rows (avoids far futures contango skew)
  const nearestExp = availableExpirations[0];
  const nearestSpotRows = rows
    .filter((r) => r.instrument_name && parseDeribitInstrument(r.instrument_name)?.expiration === nearestExp)
    .map((r) => r.underlying_price)
    .filter((p): p is number => typeof p === "number" && p > 0);
  const spotSource = nearestSpotRows.length ? nearestSpotRows : spotSamples;
  spotSource.sort((a, b) => a - b);
  const spot = spotSource[Math.floor(spotSource.length / 2)] ?? 0;
  if (!(spot > 0)) throw new HttpError(502, `Spot-Kurs für ${display} fehlt.`);

  let includedExpirations: string[];
  let selectedExpiration = expiryParam;
  if (ISO_DATE.test(expiryParam) && expirySet.has(expiryParam)) {
    includedExpirations = [expiryParam];
  } else if (expiryParam === "nearest") {
    includedExpirations = [availableExpirations[0]];
    selectedExpiration = availableExpirations[0];
  } else {
    // Aggregate up to 3 nearest expirations (or next 14 days) for meaningful dealer walls
    includedExpirations = availableExpirations.slice(0, Math.min(3, availableExpirations.length));
    selectedExpiration = "near";
  }

  const includedSet = new Set(includedExpirations);
  const filtered = allContracts.filter((c) => includedSet.has(c.expiration));

  return computeOptionsAnalytics({
    ticker: currency,
    display,
    assetClass: "crypto",
    source: "Deribit Public (Kein API-Key)",
    spot,
    multiplier: 1,
    contracts: filtered,
    selectedExpiration,
    includedExpirations,
    availableExpirations: availableExpirations.slice(0, 14),
    asOf: now,
  });
}

interface YahooOptionRow {
  contractSymbol?: string;
  strike?: number;
  openInterest?: number;
  volume?: number;
  impliedVolatility?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  inTheMoney?: boolean;
  expiration?: Date | number | string;
}

interface YahooOptionsResult {
  quote?: { regularMarketPrice?: number; regularMarketPreviousClose?: number };
  expirationDates?: Array<Date | number | string>;
  options?: Array<{
    expirationDate?: Date | number | string;
    calls?: YahooOptionRow[];
    puts?: YahooOptionRow[];
  }>;
}

function mapYahooLeg(rows: YahooOptionRow[] | undefined, optionType: "call" | "put", fallbackExp: string): RawOptionContract[] {
  if (!Array.isArray(rows)) return [];
  const out: RawOptionContract[] = [];
  for (const r of rows) {
    const strike = num(r.strike);
    if (!(strike > 0)) continue;
    const exp = toIsoDate(r.expiration) || fallbackExp;
    out.push({
      contractSymbol: String(r.contractSymbol ?? `${optionType[0].toUpperCase()}-${strike}-${exp}`),
      optionType,
      strike,
      expiration: exp,
      openInterest: num(r.openInterest),
      volume: num(r.volume),
      impliedVolatility: num(r.impliedVolatility),
      bid: num(r.bid),
      ask: num(r.ask),
      lastPrice: num(r.lastPrice),
      inTheMoney: Boolean(r.inTheMoney),
    });
  }
  return out;
}

async function fetchYahooEquityOptions(
  ticker: string,
  display: string,
  expiryParam: string,
  now: number,
): Promise<OptionsAnalytics> {
  const yf = getYahooClient();
  const requestedDate = ISO_DATE.test(expiryParam) ? new Date(`${expiryParam}T00:00:00Z`) : undefined;

  const first = (await yf.options(
    ticker,
    requestedDate ? { date: requestedDate } : undefined,
  )) as YahooOptionsResult;

  const spot = num(first?.quote?.regularMarketPrice) || num(first?.quote?.regularMarketPreviousClose);
  const rawExps = Array.isArray(first?.expirationDates) ? first.expirationDates : [];
  const expPairs = rawExps
    .map((d) => ({ raw: d, iso: toIsoDate(d) }))
    .filter((e) => ISO_DATE.test(e.iso));

  const availableExpirations = [...new Set(expPairs.map((e) => e.iso))].sort();
  if (!(spot > 0) || !availableExpirations.length) {
    throw new HttpError(404, `Keine Optionskette für ${display} verfügbar.`);
  }

  const firstBlock = first.options?.[0];
  const firstExpIso = toIsoDate(firstBlock?.expirationDate) || availableExpirations[0];

  const contracts: RawOptionContract[] = [
    ...mapYahooLeg(firstBlock?.calls, "call", firstExpIso),
    ...mapYahooLeg(firstBlock?.puts, "put", firstExpIso),
  ];
  const includedExpirations = [firstExpIso];
  let selectedExpiration = expiryParam;

  if (ISO_DATE.test(expiryParam)) {
    selectedExpiration = firstExpIso;
  } else if (expiryParam === "nearest") {
    selectedExpiration = firstExpIso;
  } else {
    selectedExpiration = "near";
    // Aggregate up to 2 additional near-term expirations in parallel (great for daily SPY/QQQ & weekly walls)
    const extraDates = expPairs
      .filter((e) => e.iso > firstExpIso)
      .slice(0, 2);

    if (extraDates.length) {
      const settled = await Promise.allSettled(
        extraDates.map(async (exp) => {
          const dt = exp.raw instanceof Date ? exp.raw : new Date(`${exp.iso}T00:00:00Z`);
          const res = (await yf.options(ticker, { date: dt })) as YahooOptionsResult;
          const blk = res?.options?.[0];
          const iso = toIsoDate(blk?.expirationDate) || exp.iso;
          return {
            iso,
            contracts: [
              ...mapYahooLeg(blk?.calls, "call", iso),
              ...mapYahooLeg(blk?.puts, "put", iso),
            ],
          };
        }),
      );
      for (const item of settled) {
        if (item.status === "fulfilled" && item.value.contracts.length) {
          includedExpirations.push(item.value.iso);
          contracts.push(...item.value.contracts);
        }
      }
    }
  }

  if (!contracts.length) {
    throw new HttpError(404, `Optionskette für ${display} enthält keine Kontrakte.`);
  }

  return computeOptionsAnalytics({
    ticker,
    display,
    assetClass: "equity",
    source: "Yahoo Finance (Kein API-Key)",
    spot,
    multiplier: 100,
    contracts,
    selectedExpiration,
    includedExpirations,
    availableExpirations: availableExpirations.slice(0, 14),
    asOf: now,
  });
}

interface NasdaqOptionRow {
  expiryDate?: string;
  expirygroup?: string;
  strike?: string;
  c_Last?: string;
  c_Bid?: string;
  c_Ask?: string;
  c_Volume?: string;
  c_Openinterest?: string;
  p_Last?: string;
  p_Bid?: string;
  p_Ask?: string;
  p_Volume?: string;
  p_Openinterest?: string;
}

function parseNasdaqExpiry(text: string | undefined, now: number): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (ISO_DATE.test(trimmed)) return trimmed;
  // Formats like "Dec 04" or "Dec 04, 2026"
  const withYear = /\d{4}/.test(trimmed) ? trimmed : `${trimmed}, ${new Date(now).getUTCFullYear()}`;
  const parsed = Date.parse(withYear);
  if (!Number.isFinite(parsed)) return "";
  const d = new Date(parsed);
  if (parsed < now - 14 * 86_400_000 && !/\d{4}/.test(trimmed)) {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Fallback zero-API-key equity options chain fetcher via Nasdaq's public option-chain endpoint.
 */
async function fetchNasdaqFallbackOptions(
  ticker: string,
  display: string,
  expiryParam: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  now: number,
): Promise<OptionsAnalytics> {
  const cleanTicker = ticker.replace(/^\^/, "");
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(cleanTicker)}/option-chain?assetclass=stocks&limit=400&fromdate=all&todate=all&excode=oprac&callput=callput&money=all&type=all`;
  const res = await fetcher(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      accept: "application/json",
    },
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new HttpError(502, `Nasdaq Options antwortete mit HTTP ${res.status}.`);
  const json = (await res.json()) as {
    data?: {
      lastTrade?: string;
      table?: { rows?: NasdaqOptionRow[] };
    };
  };
  const spotMatch = /\$([\d,.]+)/.exec(json?.data?.lastTrade ?? "");
  const spot = spotMatch ? num(spotMatch[1]) : 0;
  const rows = json?.data?.table?.rows ?? [];
  if (!(spot > 0) || !rows.length) {
    throw new HttpError(404, `Keine Optionsdaten für ${display} gefunden.`);
  }

  let currentExp = "";
  const allContracts: RawOptionContract[] = [];
  const expirySet = new Set<string>();

  for (const r of rows) {
    if (r.expirygroup) {
      const parsed = parseNasdaqExpiry(r.expirygroup, now);
      if (parsed) currentExp = parsed;
      continue;
    }
    const exp = parseNasdaqExpiry(r.expiryDate, now) || currentExp;
    const strike = num(r.strike);
    if (!exp || !(strike > 0)) continue;
    expirySet.add(exp);

    const callOi = num(r.c_Openinterest);
    const callVol = num(r.c_Volume);
    const callBid = num(r.c_Bid);
    const callAsk = num(r.c_Ask);
    const callLast = num(r.c_Last);
    if (callOi > 0 || callVol > 0 || callAsk > 0 || callLast > 0) {
      allContracts.push({
        contractSymbol: `${cleanTicker}${exp.replace(/-/g, "").slice(2)}C${Math.round(strike * 1000)}`,
        optionType: "call",
        strike,
        expiration: exp,
        openInterest: callOi,
        volume: callVol,
        impliedVolatility: 0.3, // Fallback baseline when Nasdaq summary omits IV
        bid: callBid,
        ask: callAsk,
        lastPrice: callLast,
      });
    }

    const putOi = num(r.p_Openinterest);
    const putVol = num(r.p_Volume);
    const putBid = num(r.p_Bid);
    const putAsk = num(r.p_Ask);
    const putLast = num(r.p_Last);
    if (putOi > 0 || putVol > 0 || putAsk > 0 || putLast > 0) {
      allContracts.push({
        contractSymbol: `${cleanTicker}${exp.replace(/-/g, "").slice(2)}P${Math.round(strike * 1000)}`,
        optionType: "put",
        strike,
        expiration: exp,
        openInterest: putOi,
        volume: putVol,
        impliedVolatility: 0.3,
        bid: putBid,
        ask: putAsk,
        lastPrice: putLast,
      });
    }
  }

  const availableExpirations = [...expirySet].sort();
  if (!availableExpirations.length) throw new HttpError(404, `Keine Verfallstermine für ${display} gefunden.`);

  let includedExpirations: string[];
  let selectedExpiration = expiryParam;
  if (ISO_DATE.test(expiryParam) && expirySet.has(expiryParam)) {
    includedExpirations = [expiryParam];
  } else if (expiryParam === "nearest") {
    includedExpirations = [availableExpirations[0]];
    selectedExpiration = availableExpirations[0];
  } else {
    includedExpirations = availableExpirations.slice(0, Math.min(3, availableExpirations.length));
    selectedExpiration = "near";
  }

  const includedSet = new Set(includedExpirations);
  return computeOptionsAnalytics({
    ticker,
    display,
    assetClass: "equity",
    source: "Nasdaq Public (Kein API-Key)",
    spot,
    multiplier: 100,
    contracts: allContracts.filter((c) => includedSet.has(c.expiration)),
    selectedExpiration,
    includedExpirations,
    availableExpirations: availableExpirations.slice(0, 14),
    asOf: now,
  });
}

export async function optionsChainRequest(
  symbol: string,
  expiry = "near",
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<OptionsAnalytics> {
  const target = resolveOptionsTarget(symbol);
  if (!target) {
    throw new HttpError(
      400,
      "Optionsketten ohne API-Key werden für US-Aktien/ETFs/Indizes (z. B. SPY, QQQ, NVDA, AAPL, TSLA) sowie BTC, ETH & SOL unterstützt.",
    );
  }

  const normalizedExpiry =
    expiry === "nearest" || ISO_DATE.test(expiry) ? expiry : "near";

  const cacheKey = `${target.assetClass}:${target.ticker}:${normalizedExpiry}`;
  const cached = chainCache.get(cacheKey);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(14_000)])
    : AbortSignal.timeout(14_000);

  let data: OptionsAnalytics;
  if (target.assetClass === "crypto") {
    data = await fetchDeribitOptions(target.ticker, target.display, normalizedExpiry, deadline, fetcher, now);
  } else {
    try {
      data = await fetchYahooEquityOptions(target.ticker, target.display, normalizedExpiry, now);
    } catch {
      data = await fetchNasdaqFallbackOptions(
        target.ticker,
        target.display,
        normalizedExpiry,
        deadline,
        fetcher,
        now,
      );
    }
  }

  setBoundedCache(chainCache, cacheKey, { at: now, data }, 120);
  return data;
}
