import { logError } from "@/lib/server/logger";
import { fetchOsintMapData, type OsintFlight } from "@/lib/server/osint";
import { fetchExtendedOsintTelemetry } from "@/lib/server/osintTelemetry";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET() {
  try {
    const [base, telemetry] = await Promise.all([
      fetchOsintMapData(),
      fetchExtendedOsintTelemetry().catch(() => null),
    ]);
    if (!telemetry) {
      return Response.json({
        ...base,
        marineConditions: [],
        advisories: [],
        aisSources: base.feedStatus.ais.ok ? ["Digitraffic Marine AIS (Baltic)"] : [],
        adsbSources: base.feedStatus.adsb.ok ? ["adsb.lol (/v2/mil, FRA, Hormuz)"] : [],
      });
    }

    const flightByIcao = new Map<string, OsintFlight>();
    for (const f of [...base.flights, ...telemetry.extraFlights]) {
      if (!flightByIcao.has(f.icao)) flightByIcao.set(f.icao, f);
    }
    const mergedFlights = [...flightByIcao.values()];
    const adsbOk = base.feedStatus.adsb.ok || telemetry.extraFlights.length > 0;
    const aisSources = base.feedStatus.ais.ok ? ["Digitraffic Marine AIS (Baltic)"] : [];
    const adsbSources = [
      ...(base.feedStatus.adsb.ok ? ["adsb.lol (/v2/mil, FRA, Hormuz)"] : []),
      ...telemetry.adsbSources,
    ];

    return Response.json({
      ...base,
      flights: mergedFlights,
      feedStatus: {
        ...base.feedStatus,
        adsb: {
          ...base.feedStatus.adsb,
          ok: adsbOk,
          count: mergedFlights.length,
          ...(adsbOk ? { error: undefined } : {}),
        },
      },
      marineConditions: telemetry.marineConditions,
      advisories: telemetry.advisories,
      aisSources,
      adsbSources,
    });
  } catch (error) {
    logError("api.osintMap.error", error);
    return Response.json({ error: "OSINT map feed unavailable." }, { status: 503 });
  }
}
