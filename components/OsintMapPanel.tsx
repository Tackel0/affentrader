"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldCountries from "world-atlas/countries-110m.json";
import { Anchor, Globe, Navigation, Plane, RefreshCw, ShieldAlert, Waves, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import type { EnergyChokepoint, OsintFlight, OsintMapPayload, OsintVessel } from "@/lib/server/osint";
import type { ChokepointMarineCondition, MaritimeAdvisory } from "@/lib/server/osintTelemetry";
import { useChartStore } from "@/stores/useChartStore";

interface ExtendedOsintPayload extends OsintMapPayload {
  marineConditions?: ChokepointMarineCondition[];
  advisories?: MaritimeAdvisory[];
  aisSources?: string[];
  adsbSources?: string[];
}

interface Props {
  onSelectSymbol?: (symbol: string) => void;
}

type RegionPreset = "global" | "gulf" | "europe" | "usgc" | "asia";

const REGION_PRESETS: Record<
  RegionPreset,
  { label: string; center: [number, number]; scale: number }
> = {
  global: { label: "Global", center: [15, 16], scale: 165 },
  gulf: { label: "Gulf & Red Sea", center: [48, 22], scale: 620 },
  europe: { label: "N. Europe", center: [14, 54], scale: 640 },
  usgc: { label: "US Gulf", center: [-86, 20], scale: 560 },
  asia: { label: "Malacca / APAC", center: [110, 15], scale: 520 },
};

type SelectedEntity =
  | { kind: "vessel"; data: OsintVessel }
  | { kind: "flight"; data: OsintFlight }
  | { kind: "chokepoint"; data: EnergyChokepoint }
  | null;

const MAP_W = 880;
const MAP_H = 420;

let cachedCountriesGeo: ReturnType<typeof feature> | null = null;
function getCountriesGeo() {
  if (cachedCountriesGeo) return cachedCountriesGeo;
  const topology = worldCountries as unknown as Parameters<typeof feature>[0];
  const countriesObj = topology.objects?.countries;
  cachedCountriesGeo = countriesObj ? feature(topology, countriesObj) : null;
  return cachedCountriesGeo;
}

export function OsintMapPanel({ onSelectSymbol }: Props) {
  const [data, setData] = useState<ExtendedOsintPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [region, setRegion] = useState<RegionPreset>("global");
  const [showTankers, setShowTankers] = useState(true);
  const [showCargo, setShowCargo] = useState(true);
  const [showFlights, setShowFlights] = useState(true);
  const [showChokepoints, setShowChokepoints] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const [dragging, setDragging] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const [selected, setSelected] = useState<SelectedEntity>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = mapWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => {
        const next = e.deltaY < 0 ? z * 1.15 : z / 1.15;
        return Math.max(1, Math.min(6, Number(next.toFixed(2))));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const selectSymbol = useCallback(
    (sym: string) => {
      if (onSelectSymbol) onSelectSymbol(sym);
      else useChartStore.getState().set({ symbol: sym });
    },
    [onSelectSymbol],
  );

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch("/api/osint-map", { signal: controller.signal });
      const json = (await res.json().catch(() => ({}))) as ExtendedOsintPayload & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "OSINT map unavailable");
      if (controller.signal.aborted) return;
      const payload = json as ExtendedOsintPayload;
      setData(payload);
      setError("");
      setSelected((prev) =>
        prev ?? (payload.chokepoints?.length ? { kind: "chokepoint", data: payload.chokepoints[0] } : null),
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 120_000);
    return () => {
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [load]);

  const { landPath, graticulePath, projection } = useMemo(() => {
    const preset = REGION_PRESETS[region];
    const proj = geoNaturalEarth1()
      .center(preset.center)
      .scale(preset.scale)
      .translate([MAP_W / 2, MAP_H / 2]);
    const pathGen = geoPath(proj);
    const countriesGeo = getCountriesGeo();
    const land = countriesGeo ? pathGen(countriesGeo) ?? "" : "";
    const grat = pathGen(geoGraticule10()) ?? "";
    return { landPath: land, graticulePath: grat, projection: proj };
  }, [region]);

  const cleanSearch = search.trim().toUpperCase();

  const visibleVessels = useMemo(() => {
    if (!data) return [];
    return data.vessels.filter((v) => {
      const catOk = v.category === "cargo" ? showCargo : showTankers;
      if (!catOk) return false;
      if (!cleanSearch) return true;
      return (
        v.name.toUpperCase().includes(cleanSearch) ||
        String(v.mmsi).includes(cleanSearch) ||
        v.destination.toUpperCase().includes(cleanSearch)
      );
    });
  }, [data, showTankers, showCargo, cleanSearch]);

  const visibleFlights = useMemo(() => {
    if (!showFlights || !data) return [];
    if (!cleanSearch) return data.flights;
    return data.flights.filter(
      (f) =>
        f.callsign.toUpperCase().includes(cleanSearch) ||
        f.icao.toUpperCase().includes(cleanSearch) ||
        f.aircraftType.toUpperCase().includes(cleanSearch),
    );
  }, [data, showFlights, cleanSearch]);

  const mapTransform = `translate(${(MAP_W / 2 + pan[0]).toFixed(1)}, ${(MAP_H / 2 + pan[1]).toFixed(1)}) scale(${zoom.toFixed(2)}) translate(${(-MAP_W / 2).toFixed(1)}, ${(-MAP_H / 2).toFixed(1)})`;

  return (
    <div style={{ display: "grid", gap: 6, padding: "2px 0" }}>
      <div className="screener-toolbar" style={{ flexWrap: "wrap", gap: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          <Globe size={13} /> Global OSINT · Chokepoints, ADS-B &amp; Baltic Live AIS
        </span>
        <span className="terminal-telemetry-chip mono">
          {loading ? "SYNCING FEED" : `${visibleVessels.length} VESSELS · ${visibleFlights.length} FLIGHTS`}
        </span>
        <div className="segmented">
          {(Object.entries(REGION_PRESETS) as Array<[RegionPreset, { label: string }]>).map(([id, cfg]) => (
            <button
              key={id}
              type="button"
              className={region === id ? "active" : ""}
              onClick={() => {
                setRegion(id);
                setZoom(1);
                setPan([0, 0]);
              }}
            >
              {cfg.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter vessel / flight / port…"
          aria-label="OSINT filter"
          style={{ flex: "0 1 165px", minWidth: 120 }}
        />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button type="button" className={`button small mono ${showTankers ? "primary" : ""}`} onClick={() => setShowTankers((v) => !v)}>
            <Anchor size={11} /> Tanker ({data?.vessels.filter((v) => v.category !== "cargo").length ?? 0})
          </button>
          <button type="button" className={`button small mono ${showCargo ? "primary" : ""}`} onClick={() => setShowCargo((v) => !v)}>
            Cargo ({data?.vessels.filter((v) => v.category === "cargo").length ?? 0})
          </button>
          <button type="button" className={`button small mono ${showFlights ? "primary" : ""}`} onClick={() => setShowFlights((v) => !v)}>
            <Plane size={11} /> Flights ({data?.flights.length ?? 0})
          </button>
          <button type="button" className={`button small ${showChokepoints ? "primary" : ""}`} onClick={() => setShowChokepoints((v) => !v)}>
            <ShieldAlert size={11} /> Chokepoints
          </button>
          <button type="button" className={`button small ${showRoutes ? "primary" : ""}`} onClick={() => setShowRoutes((v) => !v)}>
            <Navigation size={11} /> Routes
          </button>
          <button type="button" className="button small" onClick={() => setZoom((z) => Math.min(6, Number((z * 1.35).toFixed(2))))} title="Zoom in">
            <ZoomIn size={11} />
          </button>
          <button type="button" className="button small" onClick={() => setZoom((z) => Math.max(1, Number((z / 1.35).toFixed(2))))} title="Zoom out">
            <ZoomOut size={11} />
          </button>
          <button type="button" className="button small" onClick={() => { setZoom(1); setPan([0, 0]); }} title="Reset view">
            <RotateCcw size={11} />
          </button>
          <button type="button" className="button small" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={11} className={loading ? "spin" : ""} /> Sync
          </button>
        </div>
      </div>

      {error ? <p className="error-message screener-error">{error}</p> : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "start" }}>
        <div
          ref={mapWrapRef}
          style={{
            flex: "999 1 360px",
            minWidth: 0,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 1,
            overflow: "hidden",
            position: "relative",
            cursor: dragging ? "grabbing" : "grab",
          }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("g[data-entity]")) return;
            setDragging({ x: e.clientX, y: e.clientY, px: pan[0], py: pan[1] });
          }}
          onPointerMove={(e) => {
            if (!dragging) return;
            setPan([dragging.px + (e.clientX - dragging.x), dragging.py + (e.clientY - dragging.y)]);
          }}
          onPointerUp={() => setDragging(null)}
          onPointerLeave={() => setDragging(null)}
          onPointerCancel={() => setDragging(null)}
        >
          <svg
            viewBox={`0 0 ${MAP_W} ${MAP_H}`}
            style={{ width: "100%", height: "auto", display: "block", maxHeight: 420 }}
            role="img"
            aria-label="Global Energy Chokepoints, ADS-B Flights, and Baltic Live AIS Map"
          >
            <rect width={MAP_W} height={MAP_H} fill="var(--bg, #07090d)" />
            <g transform={mapTransform}>
              <path d={graticulePath} fill="none" stroke="rgba(148,163,184,0.14)" strokeWidth={0.6 / zoom} />
              <path d={landPath} fill="var(--surface2, #18202c)" stroke="var(--border-strong, #2c384a)" strokeWidth={0.65 / zoom} />

            {showRoutes &&
              data?.routes.map((route) => {
                const pts = route.coordinates
                  .map((coord) => projection(coord))
                  .filter((p): p is [number, number] => Array.isArray(p));
                if (pts.length < 2) return null;
                const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
                return (
                  <path
                    key={route.id}
                    d={d}
                    fill="none"
                    stroke={route.commodity === "lng" ? "rgba(56,189,248,0.45)" : "rgba(245,158,11,0.42)"}
                    strokeWidth={1.4 / zoom}
                    strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                  />
                );
              })}

            {visibleVessels.map((v) => {
              const pt = projection([v.lon, v.lat]);
              if (!pt) return null;
              const isTanker = v.category !== "cargo";
              const isActive = selected?.kind === "vessel" && selected.data.id === v.id;
              return (
                <g
                  key={v.id}
                  data-entity="true"
                  transform={`translate(${pt[0].toFixed(1)},${pt[1].toFixed(1)}) scale(${(1 / Math.sqrt(zoom)).toFixed(3)})`}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelected({ kind: "vessel", data: v })}
                >
                  <circle
                    r={isActive ? 5 : isTanker ? 3.2 : 2.3}
                    fill={isTanker ? "#f97316" : "#38bdf8"}
                    stroke={isActive ? "var(--text, #ffffff)" : "var(--bg, #090d14)"}
                    strokeWidth={isActive ? 1.5 : 0.7}
                    opacity={0.9}
                  />
                </g>
              );
            })}

            {visibleFlights.map((f) => {
              const pt = projection([f.lon, f.lat]);
              if (!pt) return null;
              const isActive = selected?.kind === "flight" && selected.data.id === f.id;
              const color = f.category === "military-tanker" ? "#a855f7" : f.category === "cargo-air" ? "#facc15" : "#22c55e";
              return (
                <g
                  key={f.id}
                  data-entity="true"
                  transform={`translate(${pt[0].toFixed(1)},${pt[1].toFixed(1)}) scale(${(1 / Math.sqrt(zoom)).toFixed(3)}) rotate(${f.headingDeg})`}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelected({ kind: "flight", data: f })}
                >
                  <polygon
                    points="0,-4 2.8,3.2 0,1.6 -2.8,3.2"
                    fill={color}
                    stroke={isActive ? "var(--text, #ffffff)" : "var(--bg, #090d14)"}
                    strokeWidth={isActive ? 1.2 : 0.5}
                    opacity={0.9}
                  />
                </g>
              );
            })}

            {showChokepoints &&
              data?.chokepoints.map((cp) => {
                const pt = projection([cp.lon, cp.lat]);
                if (!pt) return null;
                const isActive = selected?.kind === "chokepoint" && selected.data.id === cp.id;
                return (
                  <g
                    key={cp.id}
                    data-entity="true"
                    transform={`translate(${pt[0].toFixed(1)},${pt[1].toFixed(1)}) scale(${(1 / Math.sqrt(zoom)).toFixed(3)})`}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelected({ kind: "chokepoint", data: cp })}
                  >
                    <circle r={isActive ? 9 : 6.5} fill="rgba(239,68,68,0.22)" stroke="#ef4444" strokeWidth={1.3} />
                    <circle r={2.4} fill="#ef4444" />
                    <text
                      x={8}
                      y={3}
                      fontSize={9.5}
                      fill="var(--text, #e2e8f0)"
                      stroke="var(--bg, #07090d)"
                      strokeWidth={2}
                      fontWeight={isActive ? 700 : 500}
                      style={{ pointerEvents: "none", paintOrder: "stroke" }}
                    >
                      {cp.name.split("/")[0].trim()}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          <div
            className="mono"
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              padding: "5px 8px",
              fontSize: 10,
              color: "var(--muted)",
              background: "var(--surface)",
              borderTop: "1px solid var(--border)",
              flexWrap: "wrap",
            }}
          >
            <span>
              <strong style={{ color: "#f97316" }}>●</strong> Tanker (Baltic/N. Europe AIS) &nbsp;
              <strong style={{ color: "#38bdf8" }}>●</strong> Cargo (Baltic AIS) &nbsp;
              <strong style={{ color: "#22c55e" }}>▲</strong> Commercial &nbsp;
              <strong style={{ color: "#a855f7" }}>▲</strong> Mil/Tanker ADS-B &nbsp;
              <strong style={{ color: "#ef4444" }}>◎</strong> Chokepoint ({zoom.toFixed(1)}×)
            </span>
            <span>
              Baltic / N. Europe AIS: {data?.feedStatus.ais.ok ? `${data.vessels.length} vessels (Digitraffic)` : data?.feedStatus.ais.error ?? "loading"} ·
              Global ADS-B: {data?.flights.length ? `${data.flights.length} flights` : data?.feedStatus.adsb.error ?? "loading"}
            </span>
          </div>
        </div>

        <aside
          style={{
            flex: "1 1 260px",
            minWidth: 0,
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 1,
            padding: 8,
            display: "grid",
            gap: 8,
            fontSize: 11,
          }}
        >
          {selected?.kind === "chokepoint" ? (() => {
            const marine = data?.marineConditions?.find((m) => m.chokepointId === selected.data.id);
            return (
            <div>
              <div style={{ color: "var(--red, #ef4444)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Energy Chokepoint · {selected.data.region}
              </div>
              <h4 style={{ margin: "2px 0 6px", fontSize: 12 }}>{selected.data.name}</h4>
              <p style={{ margin: "0 0 6px", color: "var(--muted)" }}>{selected.data.flowSummary}</p>
              <div className="mono" style={{ fontSize: 11, marginBottom: 6 }}>
                <strong>Flow Share:</strong> {selected.data.shareGlobalOilPct}
              </div>
              {marine ? (
                <div className="mono" style={{ fontSize: 11, marginBottom: 8, display: "flex", alignItems: "center", gap: 6, color: marine.severity === "rough" ? "var(--amber, #f59e0b)" : "var(--muted)" }}>
                  <Waves size={12} />
                  <span>
                    Sea: <strong>{marine.waveHeightM ?? "—"} m</strong> · Swell {marine.swellHeightM ?? "—"} m · Current {marine.currentSpeedMs ?? "—"} m/s ({marine.severity})
                  </span>
                </div>
              ) : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {selected.data.correlatedSymbols.map((sym) => (
                  <button key={sym.symbol} type="button" className="chip" onClick={() => selectSymbol(sym.symbol)}>
                    {sym.label} ({sym.symbol.replace(/^YF:/, "")})
                  </button>
                ))}
              </div>
            </div>
            );
          })() : selected?.kind === "vessel" ? (
            <div>
              <div style={{ color: "#f97316", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Baltic / Northern Europe Live AIS · {selected.data.category}
              </div>
              <h4 style={{ margin: "2px 0 6px", fontSize: 12 }}>{selected.data.name}</h4>
              <dl className="mono" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", margin: 0, fontSize: 11 }}>
                <dt style={{ color: "var(--muted)" }}>MMSI</dt>
                <dd style={{ margin: 0 }}>{selected.data.mmsi}</dd>
                <dt style={{ color: "var(--muted)" }}>Speed / Course</dt>
                <dd style={{ margin: 0 }}>
                  {selected.data.sogKnots} kn · {selected.data.cogDeg}°
                </dd>
                <dt style={{ color: "var(--muted)" }}>Destination</dt>
                <dd style={{ margin: 0 }}>{selected.data.destination || "N/A"}</dd>
                <dt style={{ color: "var(--muted)" }}>Position</dt>
                <dd style={{ margin: 0 }}>
                  {selected.data.lat.toFixed(2)}°, {selected.data.lon.toFixed(2)}°
                </dd>
                <dt style={{ color: "var(--muted)" }}>Source</dt>
                <dd style={{ margin: 0 }}>{selected.data.source}</dd>
              </dl>
              <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                <button type="button" className="chip" onClick={() => selectSymbol("YF:BZ=F")}>
                  Brent Crude (BZ=F)
                </button>
                <button type="button" className="chip" onClick={() => selectSymbol("YF:FRO")}>
                  Frontline (FRO)
                </button>
              </div>
            </div>
          ) : selected?.kind === "flight" ? (
            <div>
              <div style={{ color: "var(--green, #22c55e)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                ADS-B Live Flight · {selected.data.category}
              </div>
              <h4 style={{ margin: "2px 0 6px", fontSize: 12 }}>{selected.data.callsign}</h4>
              <dl className="mono" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", margin: 0, fontSize: 11 }}>
                <dt style={{ color: "var(--muted)" }}>ICAO / Type</dt>
                <dd style={{ margin: 0 }}>
                  {selected.data.icao} · {selected.data.aircraftType}
                </dd>
                <dt style={{ color: "var(--muted)" }}>Alt / Speed</dt>
                <dd style={{ margin: 0 }}>
                  {selected.data.altitudeFt.toLocaleString("en-US")} ft · {selected.data.speedKnots} kt
                </dd>
                <dt style={{ color: "var(--muted)" }}>Heading</dt>
                <dd style={{ margin: 0 }}>{selected.data.headingDeg}°</dd>
                <dt style={{ color: "var(--muted)" }}>Source</dt>
                <dd style={{ margin: 0 }}>{selected.data.source}</dd>
              </dl>
              <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                <button type="button" className="chip" onClick={() => selectSymbol("YF:UAL")}>
                  United (UAL)
                </button>
                <button type="button" className="chip" onClick={() => selectSymbol("YF:LMT")}>
                  Lockheed (LMT)
                </button>
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)" }}>Select a tanker, flight, or chokepoint marker on the map.</p>
          )}

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 5 }}>
              Correlated Macro &amp; Freight
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {(data?.correlatedTickers ?? []).map((item) => (
                <button
                  key={item.symbol}
                  type="button"
                  className="chip"
                  title={`${item.label} (${item.sector})`}
                  onClick={() => selectSymbol(item.symbol)}
                >
                  {item.symbol.replace(/^YF:/, "")} · {item.label.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>

          {data?.advisories?.length ? (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 4 }}>
                Maritime Logistics Feed
              </div>
              <ul style={{ margin: 0, paddingLeft: 14, display: "grid", gap: 4, fontSize: 11 }}>
                {data.advisories.slice(0, 4).map((adv) => (
                  <li key={adv.id}>
                    {adv.link ? (
                      <a href={adv.link} target="_blank" rel="noreferrer" style={{ color: "var(--text)" }}>
                        {adv.title}
                      </a>
                    ) : (
                      <span>{adv.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
