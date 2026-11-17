export interface OsintVessel {
  id: string;
  mmsi: number;
  name: string;
  category: "oil-tanker" | "lng-cargo" | "cargo";
  shipType: number;
  lat: number;
  lon: number;
  sogKnots: number;
  cogDeg: number;
  destination: string;
  updatedAt: number;
  source: string;
}

export interface OsintFlight {
  id: string;
  icao: string;
  callsign: string;
  category: "military-tanker" | "cargo-air" | "commercial";
  aircraftType: string;
  lat: number;
  lon: number;
  altitudeFt: number;
  speedKnots: number;
  headingDeg: number;
  country: string;
  source: string;
}

export interface EnergyChokepoint {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  shareGlobalOilPct: string;
  flowSummary: string;
  correlatedSymbols: Array<{ symbol: string; label: string }>;
}

export interface OsintTradeRoute {
  id: string;
  name: string;
  commodity: "crude" | "lng" | "container";
  coordinates: Array<[number, number]>; // [lon, lat]
}

export interface OsintMapPayload {
  generatedAt: number;
  vessels: OsintVessel[];
  flights: OsintFlight[];
  chokepoints: EnergyChokepoint[];
  routes: OsintTradeRoute[];
  correlatedTickers: Array<{ symbol: string; label: string; sector: string }>;
  feedStatus: {
    ais: { ok: boolean; count: number; provider: string; error?: string };
    adsb: { ok: boolean; count: number; provider: string; error?: string };
  };
}

export const GLOBAL_ENERGY_CHOKEPOINTS: EnergyChokepoint[] = [
  {
    id: "hormuz",
    name: "Strait of Hormuz",
    region: "Persian Gulf",
    lat: 26.5667,
    lon: 56.25,
    shareGlobalOilPct: "~20% global petroleum & LNG",
    flowSummary: "VLCC crude carriers & Qatari LNG transit hub connecting Persian Gulf to Arabian Sea.",
    correlatedSymbols: [
      { symbol: "YF:BZ=F", label: "Brent Crude" },
      { symbol: "YF:CL=F", label: "WTI Crude" },
      { symbol: "YF:FRO", label: "Frontline Tankers" },
      { symbol: "YF:XOM", label: "ExxonMobil" },
    ],
  },
  {
    id: "suez",
    name: "Suez Canal & Red Sea",
    region: "Egypt / Bab el-Mandeb",
    lat: 30.58,
    lon: 32.27,
    shareGlobalOilPct: "~12% seaborne trade & 8% LNG",
    flowSummary: "Europe–Asia crude, refined product tankers, and container shipping corridor.",
    correlatedSymbols: [
      { symbol: "YF:STNG", label: "Scorpio Tankers" },
      { symbol: "YF:ZIM", label: "ZIM Shipping" },
      { symbol: "YF:BZ=F", label: "Brent Crude" },
    ],
  },
  {
    id: "bab-el-mandeb",
    name: "Bab el-Mandeb Strait",
    region: "Red Sea / Gulf of Aden",
    lat: 12.58,
    lon: 43.33,
    shareGlobalOilPct: "~8.8 mb/d crude & refined",
    flowSummary: "Strategic chokepoint governing Cape of Good Hope rerouting and tanker day-rates.",
    correlatedSymbols: [
      { symbol: "YF:FRO", label: "Frontline" },
      { symbol: "YF:INSW", label: "Intl Seaways" },
      { symbol: "YF:BZ=F", label: "Brent Crude" },
    ],
  },
  {
    id: "malacca",
    name: "Strait of Malacca",
    region: "Southeast Asia",
    lat: 1.43,
    lon: 102.89,
    shareGlobalOilPct: "~22% seaborne crude oil",
    flowSummary: "Primary Asia-Pacific crude & LNG supply artery to China, Japan, and South Korea.",
    correlatedSymbols: [
      { symbol: "YF:CL=F", label: "WTI Crude" },
      { symbol: "YF:TTE", label: "TotalEnergies" },
      { symbol: "YF:LNG", label: "Cheniere LNG" },
    ],
  },
  {
    id: "rotterdam",
    name: "Port of Rotterdam / North Sea",
    region: "Northwest Europe",
    lat: 51.92,
    lon: 4.14,
    shareGlobalOilPct: "Europe #1 crude/product hub",
    flowSummary: "ARA refined product pricing hub, Baltic/North Sea tanker terminal & LNG regas.",
    correlatedSymbols: [
      { symbol: "YF:SHEL", label: "Shell" },
      { symbol: "YF:EQNR", label: "Equinor" },
      { symbol: "YF:DHT", label: "DHT Tankers" },
    ],
  },
  {
    id: "houston",
    name: "Houston Ship Channel / USGC",
    region: "US Gulf Coast",
    lat: 29.73,
    lon: -95.02,
    shareGlobalOilPct: "#1 US crude & LNG export hub",
    flowSummary: "WTI Houston crude exports, Sabine Pass / Corpus Christi LNG tanker departures.",
    correlatedSymbols: [
      { symbol: "YF:CL=F", label: "WTI Crude" },
      { symbol: "YF:LNG", label: "Cheniere LNG" },
      { symbol: "YF:SLB", label: "SLB" },
      { symbol: "YF:CVX", label: "Chevron" },
    ],
  },
  {
    id: "panama",
    name: "Panama Canal",
    region: "Central America",
    lat: 9.08,
    lon: -79.68,
    shareGlobalOilPct: "~5% global maritime trade",
    flowSummary: "USGC-to-Asia LPG/LNG and container transit bottleneck affected by Gatun water levels.",
    correlatedSymbols: [
      { symbol: "YF:FLNG", label: "FLEX LNG" },
      { symbol: "YF:FDX", label: "FedEx Cargo" },
      { symbol: "YF:UPS", label: "UPS" },
    ],
  },
  {
    id: "bosporus",
    name: "Bosporus & Turkish Straits",
    region: "Black Sea / Mediterranean",
    lat: 41.12,
    lon: 29.08,
    shareGlobalOilPct: "~3 mb/d Caspian/Black Sea",
    flowSummary: "CPC/Black Sea crude & grain export chokepoint into the Mediterranean.",
    correlatedSymbols: [
      { symbol: "YF:BZ=F", label: "Brent Crude" },
      { symbol: "YF:ADM", label: "ADM Agri" },
    ],
  },
];

export const GLOBAL_TRADE_ROUTES: OsintTradeRoute[] = [
  {
    id: "gulf-asia",
    name: "Persian Gulf → Malacca → East Asia (VLCC)",
    commodity: "crude",
    coordinates: [
      [56.25, 26.57],
      [63.0, 20.5],
      [77.0, 7.5],
      [95.0, 5.5],
      [102.89, 1.43],
      [114.2, 22.3],
      [129.0, 35.1],
    ],
  },
  {
    id: "gulf-europe",
    name: "Persian Gulf → Suez → Rotterdam (Crude/LNG)",
    commodity: "crude",
    coordinates: [
      [56.25, 26.57],
      [54.0, 14.5],
      [43.33, 12.58],
      [32.27, 30.58],
      [14.5, 36.2],
      [-5.6, 36.0],
      [4.14, 51.92],
    ],
  },
  {
    id: "usgc-europe",
    name: "US Gulf Coast → Atlantic → ARA Europe (WTI & LNG)",
    commodity: "lng",
    coordinates: [
      [-95.02, 29.73],
      [-80.0, 25.0],
      [-50.0, 38.0],
      [-10.0, 48.0],
      [4.14, 51.92],
    ],
  },
  {
    id: "baltic-northsea",
    name: "Baltic / Finland → North Sea (Digitraffic AIS Corridor)",
    commodity: "crude",
    coordinates: [
      [25.5, 60.1],
      [19.2, 57.5],
      [11.5, 57.7],
      [4.14, 51.92],
    ],
  },
];

export const OSINT_CORRELATED_TICKERS = [
  { symbol: "YF:BZ=F", label: "Brent Crude", sector: "Energy Futures" },
  { symbol: "YF:CL=F", label: "WTI Crude", sector: "Energy Futures" },
  { symbol: "YF:FRO", label: "Frontline", sector: "Crude Tankers" },
  { symbol: "YF:STNG", label: "Scorpio Tankers", sector: "Product Tankers" },
  { symbol: "YF:LNG", label: "Cheniere Energy", sector: "LNG Export" },
  { symbol: "YF:XOM", label: "ExxonMobil", sector: "Integrated Oil" },
  { symbol: "YF:UAL", label: "United Airlines", sector: "Aviation" },
  { symbol: "YF:LMT", label: "Lockheed Martin", sector: "Defense / Aerospace" },
];

/**
 * Classify AIS vessel type codes (ITU-R M.1371):
 *   80–89: Tankers (crude oil, chemical, LNG/LPG)
 *   70–79: Cargo / Bulk / Container
 */
export function classifyAisShipType(shipType: number): OsintVessel["category"] | null {
  if (shipType >= 80 && shipType <= 89) {
    return shipType === 84 ? "lng-cargo" : "oil-tanker";
  }
  if (shipType >= 70 && shipType <= 79) return "cargo";
  return null;
}

export function parseDigitrafficAis(
  locationsJson: unknown,
  vesselsJson?: unknown,
  limit = 140,
): OsintVessel[] {
  const features = Array.isArray((locationsJson as { features?: unknown[] } | null)?.features)
    ? ((locationsJson as { features: Array<Record<string, unknown>> }).features)
    : [];
  const metaByMmsi = new Map<number, { name: string; shipType: number; destination: string }>();
  if (Array.isArray(vesselsJson)) {
    for (const v of vesselsJson as Array<Record<string, unknown>>) {
      const mmsi = Number(v?.mmsi);
      if (!Number.isFinite(mmsi)) continue;
      metaByMmsi.set(mmsi, {
        name: typeof v.name === "string" && v.name.trim() ? v.name.trim() : `MMSI ${mmsi}`,
        shipType: typeof v.shipType === "number" ? v.shipType : 0,
        destination: typeof v.destination === "string" ? v.destination.trim() : "",
      });
    }
  }

  const out: OsintVessel[] = [];
  for (const feat of features) {
    const geom = feat.geometry as { coordinates?: unknown } | undefined;
    const props = feat.properties as Record<string, unknown> | undefined;
    const mmsi = Number(feat.mmsi ?? props?.mmsi);
    const coords = Array.isArray(geom?.coordinates) ? geom.coordinates : [];
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(mmsi) || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lat < -85 || lat > 85 || lon < -180 || lon > 180) continue;

    const meta = metaByMmsi.get(mmsi);
    const shipType = meta?.shipType || (typeof props?.shipType === "number" ? props.shipType : 0);
    // Keep verified Tankers & Cargo first; if metadata didn't resolve yet, require known tanker/cargo shipType
    const category = classifyAisShipType(shipType);
    if (!category) continue;

    const sog = typeof props?.sog === "number" && Number.isFinite(props.sog) ? Math.round(props.sog * 10) / 10 : 0;
    const cog = typeof props?.cog === "number" && Number.isFinite(props.cog) ? Math.round(props.cog) : 0;
    const ts = typeof props?.timestampExternal === "number" ? props.timestampExternal : Date.now();

    out.push({
      id: `ais-${mmsi}`,
      mmsi,
      name: meta?.name ?? `Vessel ${mmsi}`,
      category,
      shipType,
      lat,
      lon,
      sogKnots: sog,
      cogDeg: cog,
      destination: meta?.destination ?? "",
      updatedAt: ts,
      source: "Digitraffic Marine AIS",
    });
  }

  // Prioritize oil tankers & LNG carriers first, then moving vessels.
  out.sort((a, b) => {
    const rank = (c: OsintVessel["category"]) => (c === "oil-tanker" ? 0 : c === "lng-cargo" ? 1 : 2);
    return rank(a.category) - rank(b.category) || b.sogKnots - a.sogKnots;
  });
  return out.slice(0, limit);
}

export function parseAdsbLolFlights(
  json: unknown,
  defaultCategory: OsintFlight["category"] = "military-tanker",
  limit = 160,
): OsintFlight[] {
  const ac = Array.isArray((json as { ac?: unknown[] } | null)?.ac)
    ? ((json as { ac: Array<Record<string, unknown>> }).ac)
    : [];
  const out: OsintFlight[] = [];

  for (const row of ac) {
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const icao = typeof row.hex === "string" ? row.hex.trim().toUpperCase() : "";
    if (!icao) continue;
    const callsign = typeof row.flight === "string" && row.flight.trim() ? row.flight.trim() : icao;
    const typeCode = typeof row.t === "string" ? row.t.trim().toUpperCase() : "";
    const alt = typeof row.alt_baro === "number" ? Math.round(row.alt_baro) : 0;
    const speed = typeof row.gs === "number" && Number.isFinite(row.gs) ? Math.round(row.gs) : 0;
    const heading = typeof row.track === "number" && Number.isFinite(row.track) ? Math.round(row.track) : 0;
    const isCargo = /^(B74|B77F|B76|MD11|A30|C17|C130|A400)/.test(typeCode) || /^(FDX|UPS|GTI|CLX|DHL)/.test(callsign);

    out.push({
      id: `adsb-${icao}`,
      icao,
      callsign,
      category: defaultCategory === "military-tanker" ? "military-tanker" : isCargo ? "cargo-air" : "commercial",
      aircraftType: typeCode || "ADS-B",
      lat,
      lon,
      altitudeFt: alt,
      speedKnots: speed,
      headingDeg: heading,
      country: typeof row.r === "string" ? row.r : "",
      source: "adsb.lol Open ADS-B",
    });
    if (out.length >= limit) break;
  }
  return out;
}

const osintCache = new Map<string, { at: number; data: OsintMapPayload }>();

export function clearOsintCache(): void {
  osintCache.clear();
}

export async function fetchOsintMapData(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<OsintMapPayload> {
  const cached = osintCache.get("global");
  if (cached && now - cached.at < 90_000) return cached.data;

  const sinceMs = now - 2 * 3600_000;
  const aisHeaders = { Accept: "application/json", "Digitraffic-User": "AffenTerminal/1.0" };

  const [aisLocationsRes, aisVesselsRes, adsbMilRes, adsbEuropeRes, adsbGulfRes] = await Promise.allSettled([
    fetcher(`https://meri.digitraffic.fi/api/ais/v1/locations?from=${sinceMs}`, {
      headers: aisHeaders,
      signal: AbortSignal.timeout(7_000),
    }),
    fetcher("https://meri.digitraffic.fi/api/ais/v1/vessels", {
      headers: aisHeaders,
      signal: AbortSignal.timeout(7_000),
    }),
    fetcher("https://api.adsb.lol/v2/mil", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6_500),
    }),
    fetcher("https://api.adsb.lol/v2/lat/50.1/lon/8.6/dist/250", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6_500),
    }),
    fetcher("https://api.adsb.lol/v2/lat/26.5/lon/56.2/dist/250", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6_500),
    }),
  ]);

  let vessels: OsintVessel[] = [];
  let aisOk = false;
  let aisError: string | undefined;
  try {
    if (aisLocationsRes.status === "fulfilled" && aisLocationsRes.value.ok) {
      const locs = await aisLocationsRes.value.json();
      const meta =
        aisVesselsRes.status === "fulfilled" && aisVesselsRes.value.ok
          ? await aisVesselsRes.value.json().catch(() => [])
          : [];
      vessels = parseDigitrafficAis(locs, meta, 150);
      aisOk = true;
    } else {
      aisError = "Digitraffic AIS temporarily unavailable";
    }
  } catch {
    aisError = "Digitraffic AIS parse failed";
  }

  const flightById = new Map<string, OsintFlight>();
  let adsbOk = false;
  let adsbError: string | undefined;

  const consumeAdsb = async (
    settled: PromiseSettledResult<Response>,
    category: OsintFlight["category"],
    limit: number,
  ) => {
    if (settled.status !== "fulfilled" || !settled.value.ok) return;
    try {
      const json = await settled.value.json();
      const parsed = parseAdsbLolFlights(json, category, limit);
      if (parsed.length) adsbOk = true;
      for (const f of parsed) {
        if (!flightById.has(f.id)) flightById.set(f.id, f);
      }
    } catch {
      // Ignore single hub parse failure
    }
  };

  await Promise.all([
    consumeAdsb(adsbMilRes, "military-tanker", 90),
    consumeAdsb(adsbGulfRes, "commercial", 60),
    consumeAdsb(adsbEuropeRes, "commercial", 80),
  ]);

  const flights = [...flightById.values()].slice(0, 210);
  if (!adsbOk) adsbError = "Public ADS-B feed temporarily unavailable";

  const payload: OsintMapPayload = {
    generatedAt: now,
    vessels,
    flights,
    chokepoints: GLOBAL_ENERGY_CHOKEPOINTS,
    routes: GLOBAL_TRADE_ROUTES,
    correlatedTickers: OSINT_CORRELATED_TICKERS,
    feedStatus: {
      ais: { ok: aisOk, count: vessels.length, provider: "Digitraffic Marine AIS (Open CC BY 4.0)", ...(aisError ? { error: aisError } : {}) },
      adsb: { ok: adsbOk, count: flights.length, provider: "adsb.lol Community ADS-B", ...(adsbError ? { error: adsbError } : {}) },
    },
  };

  if (aisOk || adsbOk) {
    osintCache.set("global", { at: now, data: payload });
  }
  return payload;
}
