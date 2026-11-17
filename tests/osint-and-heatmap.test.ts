import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyAisShipType,
  clearOsintCache,
  fetchOsintMapData,
  parseAdsbLolFlights,
  parseDigitrafficAis,
} from "@/lib/server/osint";
import {
  clearOsintTelemetryCache,
  fetchChokepointMarineConditions,
  parseMaritimeAdvisoriesRss,
  parseOpenSkyStates,
} from "@/lib/server/osintTelemetry";
import { GET as getOsintMap } from "@/app/api/osint-map/route";
import { parseTerminalCommand } from "@/lib/terminal/commands";
import { affenTerminalUrl, popoutUrl } from "@/lib/windowScope";

describe("OSINT maritime oil tanker & aviation ADS-B feeds + external window URLs", () => {
  beforeEach(() => {
    clearOsintCache();
  });

  it("classifies ITU AIS ship types and parses Digitraffic GeoJSON + vessel metadata", () => {
    expect(classifyAisShipType(80)).toBe("oil-tanker");
    expect(classifyAisShipType(84)).toBe("lng-cargo");
    expect(classifyAisShipType(71)).toBe("cargo");
    expect(classifyAisShipType(30)).toBeNull();

    const vessels = parseDigitrafficAis(
      {
        features: [
          { mmsi: 230001111, geometry: { coordinates: [24.5, 59.8] }, properties: { sog: 13.4, cog: 215, timestampExternal: 1770000000000 } },
          { mmsi: 230002222, geometry: { coordinates: [21.1, 60.1] }, properties: { sog: 9.2, cog: 90, timestampExternal: 1770000000000 } },
          { mmsi: 230003333, geometry: { coordinates: [25.0, 60.2] }, properties: { sog: 4.1, cog: 10 } }, // fishing vessel excluded
        ],
      },
      [
        { mmsi: 230001111, name: "NORDIC CRUDE", shipType: 81, destination: "ROTTERDAM" },
        { mmsi: 230002222, name: "BALTIC TRADER", shipType: 70, destination: "HAMBURG" },
        { mmsi: 230003333, name: "TRAWLER ONE", shipType: 30, destination: "HELSINKI" },
      ],
    );

    expect(vessels).toHaveLength(2);
    expect(vessels[0]).toMatchObject({
      mmsi: 230001111,
      name: "NORDIC CRUDE",
      category: "oil-tanker",
      destination: "ROTTERDAM",
      sogKnots: 13.4,
    });
    expect(vessels[1].category).toBe("cargo");
  });

  it("parses adsb.lol live aircraft JSON for military tankers, cargo and commercial flights", () => {
    const flights = parseAdsbLolFlights({
      ac: [
        { hex: "ae1234", flight: "RCH901 ", t: "KC135", lat: 51.2, lon: 7.4, alt_baro: 31000, gs: 445, track: 95 },
        { hex: "4ca999", flight: "DLH400", t: "B748", lat: 50.1, lon: 8.6, alt_baro: 36000, gs: 485, track: 270 },
      ],
    });
    expect(flights).toHaveLength(2);
    expect(flights[0]).toMatchObject({ icao: "AE1234", callsign: "RCH901", category: "military-tanker", altitudeFt: 31000 });
  });

  it("aggregates AIS, ADS-B, global energy chokepoints, and gracefully degrades if a feed is down", async () => {
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/locations")) {
        return new Response(
          JSON.stringify({
            features: [{ mmsi: 230999000, geometry: { coordinates: [22.0, 59.9] }, properties: { sog: 12.1, cog: 180 } }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/vessels")) {
        return new Response(JSON.stringify([{ mmsi: 230999000, name: "STENA TANKER", shipType: 80, destination: "GDANSK" }]), { status: 200 });
      }
      if (url.includes("/v2/mil")) {
        return new Response(JSON.stringify({ ac: [{ hex: "ae5555", flight: "HOBO12", t: "KC46", lat: 26.5, lon: 56.2, alt_baro: 28000, gs: 430, track: 120 }] }), { status: 200 });
      }
      return new Response("{}", { status: 503 });
    }) as unknown as typeof fetch;

    const payload = await fetchOsintMapData(fetcher, 500_000);
    expect(payload.vessels).toHaveLength(1);
    expect(payload.flights).toHaveLength(1);
    expect(payload.chokepoints.some((c) => c.id === "hormuz")).toBe(true);
    expect(payload.feedStatus.ais.ok).toBe(true);
    expect(payload.feedStatus.adsb.ok).toBe(true);
  });

  it("routes OSINT, TANKER, FLIGHTS, MAP terminal commands to osint while preserving HEATMAP", () => {
    expect(parseTerminalCommand("HEATMAP")).toEqual({ kind: "view", view: "heatmap" });
    expect(parseTerminalCommand("OSINT")).toEqual({ kind: "view", view: "osint" });
    expect(parseTerminalCommand("TANKER")).toEqual({ kind: "view", view: "osint" });
    expect(parseTerminalCommand("FLIGHTS")).toEqual({ kind: "view", view: "osint" });
    expect(parseTerminalCommand("MAP")).toEqual({ kind: "view", view: "osint" });
  });

  it("builds /terminal external GUI window URLs with window link params intact", () => {
    vi.stubGlobal("window", { location: { href: "https://terminal.local/?foo=bar" } });
    const url = new URL(affenTerminalUrl("osint", "YF:FRO", "red"));
    expect(url.pathname).toBe("/terminal");
    expect(url.searchParams.get("link")).toBe("red");
    expect(url.searchParams.get("view")).toBe("osint");
    expect(url.searchParams.get("ticker")).toBe("FRO");
    expect(url.searchParams.get("window")).toBeTruthy();
    expect(new URL(popoutUrl("win-1", "blue")).pathname).toBe("/");
    vi.unstubAllGlobals();
  });

  it("parses OpenSky Network flight vectors, Open-Meteo marine sea-states, and cheerio RSS maritime advisories", async () => {
    clearOsintTelemetryCache();

    const flights = parseOpenSkyStates({
      states: [
        ["abc123", "RCH401 ", "United States", 0, 0, 32.5, 29.8, 10000, false, 230, 145],
        ["def456", "GND1", "Germany", 0, 0, 8.5, 50.0, 100, true, 5, 90], // onGround skipped
      ],
    });
    expect(flights).toHaveLength(1);
    expect(flights[0]).toMatchObject({
      icao: "ABC123",
      callsign: "RCH401",
      category: "military-tanker",
      source: "OpenSky Network",
    });

    const advisories = parseMaritimeAdvisoriesRss(
      `<rss><channel><item>
        <title>Red Sea Tanker Rerouting Alert</title>
        <link>https://example.com/alert-1</link>
        <pubDate>Thu, 12 Mar 2026 10:00:00 GMT</pubDate>
      </item></channel></rss>`,
      "gCaptain",
    );
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatchObject({
      title: "Red Sea Tanker Rerouting Alert",
      link: "https://example.com/alert-1",
      source: "gCaptain",
    });

    const marineFetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify([
          { current: { wave_height: 3.4, swell_wave_height: 2.1, ocean_current_velocity: 0.9 } },
          { current: { wave_height: 1.8, swell_wave_height: 1.2, ocean_current_velocity: 0.4 } },
        ]),
        { status: 200 },
      );
    const sea = await fetchChokepointMarineConditions(marineFetcher);
    expect(sea.length).toBeGreaterThanOrEqual(7);
    expect(sea[0].severity).toBe("rough");
    expect(sea[1].severity).toBe("moderate");
  });

  it("queries offshore Port Said coords for Suez, converts km/h currents to m/s, and merges /api/osint-map ADS-B status accurately", async () => {
    clearOsintCache();
    clearOsintTelemetryCache();

    let capturedMarineUrl = "";
    const unitFetcher: typeof fetch = async (input) => {
      capturedMarineUrl = String(input);
      return new Response(
        JSON.stringify(
          Array.from({ length: 8 }, () => ({
            current_units: { ocean_current_velocity: "km/h" },
            current: { wave_height: 1.1, swell_wave_height: 0.8, ocean_current_velocity: 3.6 },
          })),
        ),
        { status: 200 },
      );
    };
    const converted = await fetchChokepointMarineConditions(unitFetcher);
    expect(capturedMarineUrl).toContain("31.45");
    expect(capturedMarineUrl).toContain("32.35");
    expect(converted[0].currentSpeedMs).toBe(1);

    clearOsintCache();
    clearOsintTelemetryCache();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("meri.digitraffic.fi/api/ais/v1/locations")) {
        return new Response(
          JSON.stringify({
            features: [{ mmsi: 211000100, geometry: { coordinates: [12.1, 54.4] }, properties: { sog: 12, cog: 90 } }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("meri.digitraffic.fi/api/ais/v1/vessels")) {
        return new Response(JSON.stringify([{ mmsi: 211000100, name: "MT NORDIC", shipType: 80, callSign: "DNOR" }]), {
          status: 200,
        });
      }
      if (url.includes("opensky-network.org")) {
        return new Response(
          JSON.stringify({
            states: [["abc999", "RCH999 ", "United States", 0, 0, 32.5, 29.8, 10000, false, 230, 145]],
          }),
          { status: 200 },
        );
      }
      if (url.includes("marine-api.open-meteo.com")) {
        return new Response(
          JSON.stringify([{ current_units: { ocean_current_velocity: "km/h" }, current: { wave_height: 1.2, swell_wave_height: 0.7, ocean_current_velocity: 1.8 } }]),
          { status: 200 },
        );
      }
      if (url.includes("gcaptain.com")) {
        return new Response(`<rss><channel><item><title>Gulf Tanker Update</title><link>https://example.com/1</link></item></channel></rss>`, { status: 200 });
      }
      // adsb.lol endpoints intentionally fail so OpenSky recovery is exercised
      return new Response("upstream down", { status: 503 });
    });

    try {
      const response = await getOsintMap();
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        flights: Array<{ icao: string }>;
        feedStatus: { adsb: { ok: boolean; count: number; error?: string } };
        adsbSources: string[];
        aisSources: string[];
      };
      expect(body.flights.some((f) => f.icao === "ABC999")).toBe(true);
      expect(body.feedStatus.adsb.ok).toBe(true);
      expect(body.feedStatus.adsb.count).toBe(body.flights.length);
      expect(body.feedStatus.adsb.error).toBeUndefined();
      expect(body.aisSources).toEqual(["Digitraffic Marine AIS (Baltic)"]);
      expect(body.adsbSources).toContain("OpenSky Network");
      expect(body.adsbSources).not.toContain("adsb.lol (/v2/mil, FRA, Hormuz)");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
