import * as cheerio from "cheerio";
import { GLOBAL_ENERGY_CHOKEPOINTS, parseAdsbLolFlights, type OsintFlight } from "./osint";

export interface ChokepointMarineCondition {
  chokepointId: string;
  name: string;
  waveHeightM: number | null;
  swellHeightM: number | null;
  currentSpeedMs: number | null;
  severity: "calm" | "moderate" | "rough";
}

export interface MaritimeAdvisory {
  id: string;
  title: string;
  link: string;
  publishedAt: number;
  source: string;
}

export interface ExtendedOsintTelemetry {
  extraFlights: OsintFlight[];
  marineConditions: ChokepointMarineCondition[];
  advisories: MaritimeAdvisory[];
  aisSources: string[];
  adsbSources: string[];
}

const GLOBAL_ADS_B_CORRIDORS = [
  { name: "Rotterdam / North Sea", lat: 51.9, lon: 4.5, distNm: 250 },
  { name: "Suez / Red Sea", lat: 29.9, lon: 32.5, distNm: 250 },
  { name: "Bab el-Mandeb", lat: 12.6, lon: 43.3, distNm: 250 },
  { name: "Malacca / Singapore", lat: 1.3, lon: 103.8, distNm: 250 },
  { name: "US Gulf / Houston", lat: 29.3, lon: -94.8, distNm: 250 },
  { name: "Panama Canal", lat: 9.1, lon: -79.7, distNm: 250 },
];

/**
 * Parses OpenSky Network public `/api/states/all` array response into standardized
 * OsintFlight objects as a global ADS-B fallback when corridor queries return sparse data.
 */
export function parseOpenSkyStates(payload: unknown, limit = 60): OsintFlight[] {
  const states = (payload as { states?: unknown[] } | null)?.states;
  if (!Array.isArray(states)) return [];

  const out: OsintFlight[] = [];
  for (const row of states) {
    if (!Array.isArray(row) || row.length < 11) continue;
    const icao = typeof row[0] === "string" ? row[0].trim().toUpperCase() : "";
    const callsign = typeof row[1] === "string" ? row[1].trim().toUpperCase() : icao;
    const lon = typeof row[5] === "number" ? row[5] : Number.NaN;
    const lat = typeof row[6] === "number" ? row[6] : Number.NaN;
    const baroAltM = typeof row[7] === "number" ? row[7] : null;
    const onGround = row[8] === true;
    const velMs = typeof row[9] === "number" ? row[9] : 0;
    const heading = typeof row[10] === "number" ? row[10] : 0;

    if (onGround || !icao || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    out.push({
      id: `opensky-${icao}`,
      icao,
      callsign: callsign || icao,
      aircraftType: typeof row[2] === "string" ? row[2].slice(0, 14) : "OPENSKY",
      category: callsign.startsWith("RCH") || callsign.startsWith("NATO") ? "military-tanker" : "commercial",
      lat,
      lon,
      altitudeFt: baroAltM !== null && Number.isFinite(baroAltM) ? Math.round(baroAltM * 3.28084) : 0,
      speedKnots: Number((velMs * 1.94384).toFixed(1)),
      headingDeg: Math.round(heading),
      country: typeof row[2] === "string" && row[2] ? row[2] : "Global",
      source: "OpenSky Network",
    });
    if (out.length >= limit) break;
  }
  return out;
}

const MARINE_OFFSHORE_OVERRIDES: Record<string, { lat: number; lon: number }> = {
  suez: { lat: 31.45, lon: 32.35 }, // Offshore Port Said approach avoids landlocked canal null cell
};

/**
 * Fetches live Open-Meteo Marine sea-state (wave height, swell, current speed) for every
 * monitored global crude oil & LNG chokepoint in a single batch HTTP call (keyless).
 */
export async function fetchChokepointMarineConditions(
  fetcher: typeof fetch = fetch,
): Promise<ChokepointMarineCondition[]> {
  try {
    const lats = GLOBAL_ENERGY_CHOKEPOINTS.map((c) => MARINE_OFFSHORE_OVERRIDES[c.id]?.lat ?? c.lat).join(",");
    const lons = GLOBAL_ENERGY_CHOKEPOINTS.map((c) => MARINE_OFFSHORE_OVERRIDES[c.id]?.lon ?? c.lon).join(",");
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&current=wave_height,swell_wave_height,ocean_current_velocity`;
    const res = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_500),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    const items = Array.isArray(json) ? json : [json];

    return GLOBAL_ENERGY_CHOKEPOINTS.map((cp, idx) => {
      const entry = items[idx] as {
        current?: Record<string, unknown>;
        current_units?: Record<string, unknown>;
      } | undefined;
      const current = entry?.current ?? {};
      const currentUnit = String(entry?.current_units?.ocean_current_velocity ?? "").toLowerCase();
      const waveHeightM = typeof current.wave_height === "number" ? Number(current.wave_height.toFixed(2)) : null;
      const swellHeightM =
        typeof current.swell_wave_height === "number" ? Number(current.swell_wave_height.toFixed(2)) : null;
      const rawSpeed = typeof current.ocean_current_velocity === "number" ? current.ocean_current_velocity : null;
      const speedMs = rawSpeed === null ? null : currentUnit === "km/h" ? rawSpeed / 3.6 : rawSpeed;
      const currentSpeedMs = speedMs !== null ? Number(speedMs.toFixed(2)) : null;
      const maxWave = Math.max(waveHeightM ?? 0, swellHeightM ?? 0);
      const severity: ChokepointMarineCondition["severity"] =
        maxWave >= 3.0 ? "rough" : maxWave >= 1.5 ? "moderate" : "calm";
      return {
        chokepointId: cp.id,
        name: cp.name,
        waveHeightM,
        swellHeightM,
        currentSpeedMs,
        severity,
      };
    });
  } catch {
    return [];
  }
}

function safeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (parsed.username || parsed.password) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

/**
 * Parses public maritime security & energy supply RSS advisories (e.g., gCaptain / Maritime Executive).
 */
export function parseMaritimeAdvisoriesRss(xml: string, source: string, limit = 8): MaritimeAdvisory[] {
  if (!xml.trim()) return [];
  const $ = cheerio.load(xml, { xmlMode: true });
  const items: MaritimeAdvisory[] = [];
  $("item").each((idx, el) => {
    if (items.length >= limit) return false;
    const title = $(el).find("title").first().text().trim();
    const link = safeHttpUrl($(el).find("link").first().text());
    const pubDate = $(el).find("pubDate").first().text().trim();
    const guid = $(el).find("guid").first().text().trim() || link || `${source}-${idx}`;
    if (!title) return;
    const parsedTime = Date.parse(pubDate);
    items.push({
      id: guid,
      title: title.slice(0, 140),
      link,
      publishedAt: Number.isFinite(parsedTime) ? parsedTime : Date.now(),
      source,
    });
  });
  return items;
}

let cachedTelemetry: { expiresAt: number; payload: ExtendedOsintTelemetry } | null = null;

export function clearOsintTelemetryCache(): void {
  cachedTelemetry = null;
}

export async function fetchExtendedOsintTelemetry(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<ExtendedOsintTelemetry> {
  if (cachedTelemetry && cachedTelemetry.expiresAt > now) {
    return cachedTelemetry.payload;
  }

  const corridorPromises = GLOBAL_ADS_B_CORRIDORS.map((hub) =>
    fetcher(`https://api.adsb.lol/v2/lat/${hub.lat}/lon/${hub.lon}/dist/${hub.distNm}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4_800),
    }).then(async (res) => ({
      name: hub.name,
      ok: res.ok,
      json: res.ok ? ((await res.json()) as unknown) : null,
    })),
  );

  const [corridorsSettled, marineConditions, maritimeRssRes] = await Promise.all([
    Promise.allSettled(corridorPromises),
    fetchChokepointMarineConditions(fetcher),
    fetcher("https://gcaptain.com/feed/", {
      headers: { "User-Agent": "AffenTerminal/1.0" },
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null),
  ]);

  const flightMap = new Map<string, OsintFlight>();
  const adsbSources: string[] = [];

  for (const item of corridorsSettled) {
    if (item.status === "fulfilled" && item.value.ok && item.value.json) {
      const parsed = parseAdsbLolFlights(item.value.json, "commercial", 35);
      if (parsed.length) adsbSources.push(item.value.name);
      for (const f of parsed) {
        if (!flightMap.has(f.icao)) flightMap.set(f.icao, f);
      }
    }
  }

  // Fallback to bounded OpenSky North Atlantic / Red Sea state vectors if regional hubs returned sparse coverage
  if (flightMap.size < 12) {
    try {
      const osRes = await fetcher(
        "https://opensky-network.org/api/states/all?lamin=10&lomin=-10&lamax=56&lomax=65",
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4_500) },
      );
      if (osRes.ok) {
        const parsedOs = parseOpenSkyStates(await osRes.json(), 40);
        if (parsedOs.length) adsbSources.push("OpenSky Network");
        for (const f of parsedOs) {
          if (!flightMap.has(f.icao)) flightMap.set(f.icao, f);
        }
      }
    } catch {
      /* OpenSky anonymous rate-limit is safe to ignore cleanly */
    }
  }

  let advisories: MaritimeAdvisory[] = [];
  if (maritimeRssRes && maritimeRssRes.ok) {
    const xml = await maritimeRssRes.text().catch(() => "");
    advisories = parseMaritimeAdvisoriesRss(xml, "gCaptain Maritime", 6);
  }

  const payload: ExtendedOsintTelemetry = {
    extraFlights: [...flightMap.values()].slice(0, 140),
    marineConditions,
    advisories,
    aisSources: [],
    adsbSources,
  };

  cachedTelemetry = { expiresAt: now + 90_000, payload };
  return payload;
}
