import { XMLParser } from "fast-xml-parser";
import type { InsiderFilingSummary } from "@/lib/screener/opportunities";

const SEC_HEADERS = {
  "User-Agent": "AffenTerminal OpenSourceResearch research@affenterminal.local",
  Accept: "application/json, application/xml, text/xml",
};

export const SEC_MIN_INTERVAL_MS = 130;
const SEC_DEFAULT_RETRY_BACKOFF_MS = 650;
const SEC_MAX_RETRY_BACKOFF_MS = 2_500;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: true,
  isArray: (name) =>
    name === "reportingOwner" ||
    name === "nonDerivativeTransaction" ||
    name === "derivativeTransaction",
});

let cikMapCache: { at: number; map: Map<string, string> } | null = null;
let cikInFlight: Promise<void> | null = null;
const CIK_TTL_MS = 24 * 60 * 60_000;

let secNextSlotAt = 0;
let secQueue: Promise<void> = Promise.resolve();

export function clearSecForm4Caches(): void {
  cikMapCache = null;
  cikInFlight = null;
  secNextSlotAt = 0;
}

function makeAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The operation was aborted", "AbortError");
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(makeAbortError(signal));
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeAbortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function acquireSecSlot(signal?: AbortSignal, minIntervalMs = SEC_MIN_INTERVAL_MS): Promise<void> {
  const run = async (): Promise<void> => {
    if (signal?.aborted) throw makeAbortError(signal);
    if (minIntervalMs > 0) {
      while (true) {
        if (signal?.aborted) throw makeAbortError(signal);
        const remaining = secNextSlotAt - Date.now();
        if (remaining <= 0) break;
        await sleepWithAbort(remaining, signal);
      }
      secNextSlotAt = Date.now() + minIntervalMs;
    }
  };
  const ticket = secQueue.then(run, run);
  secQueue = ticket.catch(() => {});
  return ticket;
}

function parseRetryAfterMs(headerVal: string | null): number | null {
  if (!headerVal) return null;
  const trimmed = headerVal.trim();
  if (!trimmed) return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const targetMs = Date.parse(trimmed);
  if (Number.isFinite(targetMs)) {
    return Math.max(0, targetMs - Date.now());
  }
  return null;
}

export interface SecFetchOptions {
  fetcher?: typeof fetch;
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  minIntervalMs?: number;
  maxRetries?: number;
  retryBudgetMs?: number;
}

/**
 * Shared SEC Fair-Access scheduler pacing requests across `www.sec.gov` and `data.sec.gov`
 * (~130ms minimum spacing / <= 7.7 req/s) with a single brief Retry-After backoff on HTTP 429.
 */
export async function secFetch(url: string, options: SecFetchOptions = {}): Promise<Response> {
  const {
    fetcher = fetch,
    headers,
    signal,
    timeoutMs = 5_500,
    minIntervalMs = SEC_MIN_INTERVAL_MS,
    maxRetries = 1,
    retryBudgetMs = SEC_MAX_RETRY_BACKOFF_MS,
  } = options;

  const mergedHeaders = new Headers(SEC_HEADERS);
  if (headers) {
    new Headers(headers).forEach((value, key) => mergedHeaders.set(key, value));
  }

  const startedAt = Date.now();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await acquireSecSlot(signal, minIntervalMs);
    const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    const attemptSignal =
      signal && timeoutSignal
        ? AbortSignal.any([signal, timeoutSignal])
        : (signal ?? timeoutSignal);

    const res = await fetcher(url, {
      headers: mergedHeaders,
      signal: attemptSignal,
    });

    if (res.status !== 429 || attempt >= maxRetries || signal?.aborted) {
      return res;
    }

    const rawRetryAfter = parseRetryAfterMs(res.headers.get("retry-after"));
    if (rawRetryAfter !== null && rawRetryAfter > retryBudgetMs) {
      secNextSlotAt = Math.max(secNextSlotAt, Date.now() + Math.min(rawRetryAfter, retryBudgetMs));
      return res;
    }

    const backoffMs =
      rawRetryAfter !== null
        ? Math.min(retryBudgetMs, Math.max(300, rawRetryAfter))
        : SEC_DEFAULT_RETRY_BACKOFF_MS;

    const elapsedMs = Date.now() - startedAt;
    if (timeoutMs > 0 && elapsedMs + backoffMs >= timeoutMs + retryBudgetMs) {
      return res;
    }

    await res.body?.cancel().catch(() => {});
    secNextSlotAt = Math.max(secNextSlotAt, Date.now() + backoffMs);
  }

  throw new Error("SEC fetch exhausted retries");
}

const asBoolFlag = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "y" || s === "yes";
};

const cleanText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if ("value" in rec) return cleanText(rec.value);
    if ("#text" in rec) return cleanText(rec["#text"]);
  }
  return String(value).replace(/\s+/g, " ").trim();
};

const numVal = (value: unknown): number => {
  const s = cleanText(value);
  if (!s) return 0;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Resolve any US stock ticker to its 10-digit SEC CIK using static fallback first,
 * then querying SEC's live `company_tickers.json` directory (cached 24h, concurrent-deduped).
 */
export async function resolveSecCik(
  ticker: string,
  staticMap: Readonly<Record<string, string>>,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  signal?: AbortSignal,
): Promise<string | null> {
  const clean = ticker.trim().toUpperCase();
  if (!clean) return null;
  if (staticMap[clean]) return staticMap[clean];

  if (!cikMapCache || now - cikMapCache.at > CIK_TTL_MS) {
    if (!cikInFlight) {
      cikInFlight = (async () => {
        try {
          const res = await secFetch("https://www.sec.gov/files/company_tickers.json", {
            fetcher,
            signal,
            headers: { Accept: "application/json" },
            timeoutMs: 8_000,
          });
          if (res.ok) {
            const raw = (await res.json()) as Record<string, { cik_str?: number | string; ticker?: string }>;
            const map = new Map<string, string>();
            for (const entry of Object.values(raw ?? {})) {
              const sym = typeof entry?.ticker === "string" ? entry.ticker.trim().toUpperCase() : "";
              const cikNum = entry?.cik_str !== undefined ? String(entry.cik_str).replace(/\D/g, "") : "";
              if (sym && cikNum) {
                const padded = cikNum.padStart(10, "0");
                map.set(sym, padded);
                if (sym.includes("-")) map.set(sym.replace(/-/g, "."), padded);
              }
            }
            if (map.size > 0) {
              cikMapCache = { at: now, map };
            }
          }
        } catch {
          // Non-fatal: continue with cached/static fallback if SEC directory is unreachable.
        } finally {
          cikInFlight = null;
        }
      })();
    }
    await cikInFlight;
  }

  return cikMapCache?.map.get(clean) ?? cikMapCache?.map.get(clean.replace(/\./g, "-")) ?? null;
}

/**
 * Parse genuine SEC EDGAR Form 4 XML (`<ownershipDocument>`).
 * Strictly filters `transactionCode === "P"` (Open-Market Purchase), ignoring grants ("A"),
 * option exercises ("M"), tax withholdings ("F"), gifts ("G"), and sales ("S").
 */
export function parseForm4Xml(
  xml: string,
  fallbackDate: string,
  formLabel = "SEC Form 4",
): InsiderFilingSummary[] {
  if (!xml || !xml.includes("<")) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = xmlParser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }

  const doc = (parsed.ownershipDocument ?? parsed) as Record<string, unknown> | undefined;
  if (!doc || typeof doc !== "object") return [];

  const ownersRaw = Array.isArray(doc.reportingOwner)
    ? (doc.reportingOwner as Array<Record<string, unknown>>)
    : doc.reportingOwner
      ? [doc.reportingOwner as Record<string, unknown>]
      : [];

  const ownerNames: string[] = [];
  const roles: string[] = [];
  for (const owner of ownersRaw) {
    const idObj = (owner.reportingOwnerId ?? {}) as Record<string, unknown>;
    const relObj = (owner.reportingOwnerRelationship ?? {}) as Record<string, unknown>;
    const name = cleanText(idObj.rptOwnerName);
    if (name) ownerNames.push(name);
    const title = cleanText(relObj.officerTitle);
    const isDirector = asBoolFlag(relObj.isDirector);
    const isOfficer = asBoolFlag(relObj.isOfficer);
    const isTen = asBoolFlag(relObj.isTenPercentOwner);
    const parts: string[] = [];
    if (title) parts.push(title);
    else if (isOfficer) parts.push("Officer");
    if (isDirector) parts.push("Director");
    if (isTen) parts.push("10% Owner");
    if (parts.length) roles.push(parts.join(" / "));
  }

  const insider = ownerNames.join(", ") || "SEC Reporting Insider";
  const role = roles.join(" · ") || "SEC Reporting Person";

  const nonDeriv = (doc.nonDerivativeTable ?? {}) as Record<string, unknown>;
  const txsRaw = Array.isArray(nonDeriv.nonDerivativeTransaction)
    ? (nonDeriv.nonDerivativeTransaction as Array<Record<string, unknown>>)
    : nonDeriv.nonDerivativeTransaction
      ? [nonDeriv.nonDerivativeTransaction as Record<string, unknown>]
      : [];

  const out: InsiderFilingSummary[] = [];
  let aggregatedShares = 0;
  let aggregatedValueUsd = 0;
  let latestTxDate = "";

  for (const tx of txsRaw) {
    if (!tx || typeof tx !== "object") continue;
    const coding = (tx.transactionCoding ?? {}) as Record<string, unknown>;
    const code = cleanText(coding.transactionCode).toUpperCase();
    // Strictly open-market/private purchase ("P"). Ignore awards ("A"), exercises ("M"), sales ("S"), taxes ("F").
    if (code !== "P") continue;

    const amounts = (tx.transactionAmounts ?? {}) as Record<string, unknown>;
    const shares = numVal(amounts.transactionShares);
    if (!(shares > 0)) continue;

    const price = numVal(amounts.transactionPricePerShare);
    const txDate = cleanText(tx.transactionDate).slice(0, 10);
    if (txDate && txDate > latestTxDate) latestTxDate = txDate;

    aggregatedShares += shares;
    if (price > 0) aggregatedValueUsd += shares * price;
  }

  if (aggregatedShares > 0) {
    const weightedPrice =
      aggregatedValueUsd > 0 ? Number((aggregatedValueUsd / aggregatedShares).toFixed(2)) : 0;
    out.push({
      date: latestTxDate || fallbackDate,
      insider,
      role,
      shares: Math.round(aggregatedShares),
      price: weightedPrice,
      valueUsd: Math.round(aggregatedValueUsd),
      form: formLabel,
    });
  }

  return out;
}

/**
 * Strip SEC EDGAR XSLT viewer prefix (`xslF345X05/form4.xml` -> `form4.xml`) so the raw XML is retrieved.
 */
export function buildSecForm4XmlUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  const cikInt = String(Number(cik));
  const accNoDashes = accessionNumber.replace(/-/g, "").trim();
  const docFile = primaryDocument.replace(/^xsl[^/]+\//i, "").replace(/^\/+/, "").trim();
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/${docFile}`;
}

