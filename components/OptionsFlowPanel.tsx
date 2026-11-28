"use client";
import { useEffect, useMemo, useState } from "react";
import { BellPlus, Layers, RefreshCw } from "lucide-react";
import { optionsBiasLabels, optionsFlowTicker } from "@/lib/market/optionsFlow";
import {
  formatCompactCount,
  formatCompactUsd,
  resolveOptionsTarget,
  type OptionsAnalytics,
  type StrikeLadderRow,
} from "@/lib/market/optionsAnalytics";
import { useOptionsChain } from "@/hooks/useOptionsChain";
import { useOptionsFlow } from "@/hooks/useOptionsFlow";
import { useAlpacaStore } from "@/stores/useAlpacaStore";
import { useChartStore } from "@/stores/useChartStore";
import { formatPrice } from "@/lib/symbols";

type OptionsTab = "walls" | "unusual" | "chain" | "opra";
type ProfileMetric = "oi" | "gex" | "volume";

const QUICK_TICKERS = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "MSFT", "BTC", "ETH"];

function fmtStrike(price: number): string {
  return price >= 1000
    ? `$${Math.round(price).toLocaleString("en-US")}`
    : `$${price.toFixed(price % 1 === 0 ? 0 : 2)}`;
}

function fmtSignedPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function fmtIv(iv: number | null): string {
  return iv !== null && iv > 0 ? `${(iv * 100).toFixed(1)}%` : "—";
}

function fmtGreek(v: number | null, digits = 2): string {
  return v !== null && Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function toChartSymbol(analytics: OptionsAnalytics): string {
  if (analytics.assetClass === "crypto") return `${analytics.display}USDT`;
  return `YF:${analytics.ticker}`;
}

function StrikeProfileChart({
  data,
  metric,
}: {
  data: OptionsAnalytics;
  metric: ProfileMetric;
}) {
  const rows = useMemo(() => {
    // Show up to 24 strikes closest to spot, descending (highest strike at top like an orderbook/price ladder)
    const active = data.strikes.filter((r) =>
      metric === "oi"
        ? r.callOi > 0 || r.putOi > 0
        : metric === "volume"
          ? r.callVol > 0 || r.putVol > 0
          : Math.abs(r.callGexUsd) > 0 || Math.abs(r.putGexUsd) > 0,
    );
    const pool = active.length ? active : data.strikes;
    let slice = pool;
    if (pool.length > 22) {
      const idx = Math.max(
        0,
        pool.findIndex((r) => r.strike >= data.spot),
      );
      const start = Math.max(0, Math.min(idx - 11, pool.length - 22));
      slice = pool.slice(start, start + 22);
    }
    return [...slice].reverse();
  }, [data.spot, data.strikes, metric]);

  if (!rows.length) {
    return <p className="form-help">Keine Strike-Daten für diese Metrik vorhanden.</p>;
  }

  const maxMagnitude = Math.max(
    1,
    ...rows.map((r) =>
      metric === "oi"
        ? Math.max(r.callOi, r.putOi)
        : metric === "volume"
          ? Math.max(r.callVol, r.putVol)
          : Math.max(Math.abs(r.netGexUsd), Math.abs(r.callGexUsd), Math.abs(r.putGexUsd)),
    ),
  );

  const rowH = 22;
  const topPad = 24;
  const bottomPad = 14;
  const svgW = 640;
  const svgH = topPad + rows.length * rowH + bottomPad;
  const centerX = 320;
  const halfBarW = 215;

  const callWallK = data.callWall?.strike ?? null;
  const putWallK = data.putWall?.strike ?? null;
  const maxPainK = data.maxPain;

  // Find closest row index to spot for reference line
  let spotY = topPad + (rows.length * rowH) / 2;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].strike <= data.spot) {
      if (i === 0) {
        spotY = topPad + 4;
      } else {
        const hi = rows[i - 1].strike;
        const lo = rows[i].strike;
        const frac = hi > lo ? (hi - data.spot) / (hi - lo) : 0.5;
        spotY = topPad + (i - 1 + Math.min(Math.max(frac, 0), 1)) * rowH + rowH / 2;
      }
      break;
    }
    if (i === rows.length - 1) spotY = topPad + rows.length * rowH - 4;
  }

  return (
    <div className="options-profile-wrap">
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="options-profile-svg"
        role="img"
        aria-label={`${data.display} Strike-Profil (${metric.toUpperCase()})`}
      >
        <text x={centerX - 10} y={14} textAnchor="end" className="options-svg-head put">
          {metric === "gex" ? "← Neg. GEX (Puts)" : `← Puts (${metric === "oi" ? "OI" : "Vol"})`}
        </text>
        <text x={centerX} y={14} textAnchor="middle" className="options-svg-head strike">
          Strike
        </text>
        <text x={centerX + 10} y={14} textAnchor="start" className="options-svg-head call">
          {metric === "gex" ? "Pos. GEX (Calls) →" : `Calls (${metric === "oi" ? "OI" : "Vol"}) →`}
        </text>

        <line x1={centerX - 38} y1={topPad} x2={centerX - 38} y2={svgH - bottomPad} className="options-svg-axis" />
        <line x1={centerX + 38} y1={topPad} x2={centerX + 38} y2={svgH - bottomPad} className="options-svg-axis" />

        {rows.map((row: StrikeLadderRow, idx: number) => {
          const y = topPad + idx * rowH;
          const barY = y + 4;
          const barH = rowH - 8;
          const isCallWall = callWallK === row.strike;
          const isPutWall = putWallK === row.strike;
          const isMaxPain = maxPainK === row.strike;

          const leftVal = metric === "oi" ? row.putOi : metric === "volume" ? row.putVol : Math.abs(row.putGexUsd);
          const rightVal = metric === "oi" ? row.callOi : metric === "volume" ? row.callVol : Math.abs(row.callGexUsd);
          const leftW = Math.max(0, (leftVal / maxMagnitude) * halfBarW);
          const rightW = Math.max(0, (rightVal / maxMagnitude) * halfBarW);

          return (
            <g key={row.strike}>
              {(isCallWall || isPutWall || isMaxPain) && (
                <rect
                  x={4}
                  y={y + 1}
                  width={svgW - 8}
                  height={rowH - 2}
                  rx={4}
                  className={
                    isCallWall
                      ? "options-svg-highlight call"
                      : isPutWall
                        ? "options-svg-highlight put"
                        : "options-svg-highlight pain"
                  }
                />
              )}
              {leftW > 0.5 && (
                <rect
                  x={centerX - 40 - leftW}
                  y={barY}
                  width={leftW}
                  height={barH}
                  rx={3}
                  className={`options-svg-bar put${isPutWall ? " wall" : ""}`}
                />
              )}
              {rightW > 0.5 && (
                <rect
                  x={centerX + 40}
                  y={barY}
                  width={rightW}
                  height={barH}
                  rx={3}
                  className={`options-svg-bar call${isCallWall ? " wall" : ""}`}
                />
              )}
              <text x={centerX} y={y + 15} textAnchor="middle" className="options-svg-strike">
                {row.strike >= 1000 ? Math.round(row.strike) : row.strike}
              </text>
              {leftVal > 0 && (
                <text
                  x={Math.max(8, centerX - 44 - leftW)}
                  y={y + 14.5}
                  textAnchor={leftW > halfBarW - 44 ? "start" : "end"}
                  className="options-svg-val"
                >
                  {metric === "gex" ? formatCompactUsd(-leftVal) : formatCompactCount(leftVal)}
                </text>
              )}
              {rightVal > 0 && (
                <text
                  x={Math.min(svgW - 8, centerX + 44 + rightW)}
                  y={y + 14.5}
                  textAnchor={rightW > halfBarW - 44 ? "end" : "start"}
                  className="options-svg-val"
                >
                  {metric === "gex" ? formatCompactUsd(rightVal) : formatCompactCount(rightVal)}
                </text>
              )}
              {isCallWall && (
                <text x={svgW - 10} y={y + 14.5} textAnchor="end" className="options-svg-tag call">
                  CW
                </text>
              )}
              {isPutWall && (
                <text x={10} y={y + 14.5} textAnchor="start" className="options-svg-tag put">
                  PW
                </text>
              )}
            </g>
          );
        })}

        <line
          x1={8}
          y1={spotY}
          x2={svgW - 8}
          y2={spotY}
          stroke="#ff9e00"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        <rect x={centerX - 36} y={Math.max(topPad, spotY - 8)} width={72} height={16} rx={4} fill="#ff9e00" />
        <text
          x={centerX}
          y={Math.max(topPad, spotY - 8) + 11.5}
          textAnchor="middle"
          fill="#07090e"
          fontSize="10"
          fontWeight="700"
        >
          SPOT {data.spot >= 1000 ? Math.round(data.spot) : data.spot.toFixed(2)}
        </text>
      </svg>
    </div>
  );
}

export function OptionsFlowPanel({
  initialTicker,
  onTickerSelect,
}: {
  initialTicker: string;
  onTickerSelect?: (ticker: string) => void;
}) {
  const defaultTicker = resolveOptionsTarget(initialTicker)?.display ?? "SPY";
  const [input, setInput] = useState(defaultTicker);
  const [ticker, setTicker] = useState(defaultTicker);
  const [expiry, setExpiry] = useState("near");
  const [tab, setTab] = useState<OptionsTab>("walls");
  const [metric, setMetric] = useState<ProfileMetric>("oi");

  useEffect(() => {
    const resolved = resolveOptionsTarget(initialTicker);
    if (resolved) {
      setInput(resolved.display);
      setTicker(resolved.display);
      setExpiry("near");
    }
  }, [initialTicker]);

  const pendingTarget = resolveOptionsTarget(input);
  const { data, loading, error, refresh } = useOptionsChain(ticker, expiry, true);

  // Optional Alpaca OPRA live tape (kept cleanly for users with Alpaca OPRA credentials)
  const opraTicker = optionsFlowTicker(`YF:${ticker}`);
  const { enabled: alpacaEnabled, sample: opraSample } = useOptionsFlow(
    tab === "opra" && opraTicker ? [opraTicker] : [],
  );
  const opraData = opraTicker ? opraSample?.result[opraTicker] : undefined;

  const optionsWallsOn = useChartStore((s) => s.optionsWallsOn);
  const chartSymbol = useChartStore((s) => s.symbol);
  const chartMatchesUnderlying = Boolean(data && resolveOptionsTarget(chartSymbol)?.ticker === data.ticker);
  const wallsActiveForTicker = optionsWallsOn && chartMatchesUnderlying;

  const toggleWallsOnChart = () => {
    if (!data) return;
    if (wallsActiveForTicker) {
      useChartStore.getState().set({ optionsWallsOn: false });
    } else if (chartMatchesUnderlying) {
      // Keep the user's active tokenized chart (e.g. HL:xyz:NVDA, HL:xyz:XYZ100, BYBIT:LINEAR:TSLAUSDT)
      useChartStore.getState().set({ optionsWallsOn: true });
      useChartStore
        .getState()
        .toast(
          `Options Walls aktiv (${data.display})`,
          `Übernommen auf ${chartSymbol} · Call Wall ${data.callWall ? fmtStrike(data.callWall.strike) : "—"} · Put Wall ${data.putWall ? fmtStrike(data.putWall.strike) : "—"}`,
          "success",
        );
    } else {
      const nextSymbol = toChartSymbol(data);
      useChartStore.getState().set({ symbol: nextSymbol, optionsWallsOn: true });
      useChartStore
        .getState()
        .toast(
          `Options Walls aktiv (${data.display})`,
          `Call Wall ${data.callWall ? fmtStrike(data.callWall.strike) : "—"} · Put Wall ${data.putWall ? fmtStrike(data.putWall.strike) : "—"}`,
          "success",
        );
    }
  };

  const createLevelAlert = (label: string, price: number) => {
    if (!data) return;
    const sym = chartMatchesUnderlying ? chartSymbol : toChartSymbol(data);
    useChartStore.getState().set({
      alertDraft: {
        symbol: sym,
        name: `${data.display} ${label} (${fmtStrike(price)})`,
        price,
        source: "manual",
      },
    });
  };

  const applyTicker = (next: string) => {
    const target = resolveOptionsTarget(next);
    if (!target) return;
    setInput(target.display);
    setTicker(target.display);
    setExpiry("near");
    if (target.assetClass === "equity") onTickerSelect?.(target.display);
  };

  const skewLabel =
    data?.skew25 === null || data?.skew25 === undefined
      ? "—"
      : data.skew25 > 0.025
        ? "Put-Skew (Crash-Schutz)"
        : data.skew25 < -0.02
          ? "Call-Skew (Upside-Chase)"
          : "Ausgeglichen";

  return (
    <section className="terminal-research-list options-suite" aria-label="Optionsflow">
      <form
        className="screener-toolbar options-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          if (pendingTarget) applyTicker(pendingTarget.ticker);
        }}
      >
        <label>
          Ticker (US / BTC / ETH)
          <input
            aria-label="US-Ticker"
            value={input}
            maxLength={28}
            placeholder="SPY, NVDA, XYZ100, HL:xyz:TSLA, BTC…"
            onChange={(event) => setInput(event.target.value.toUpperCase())}
          />
        </label>
        <label>
          Verfall
          <select value={expiry} onChange={(event) => setExpiry(event.target.value)} aria-label="Verfallstermin">
            <option value="near">Nahe Verfälle (3× Aggregiert)</option>
            <option value="nearest">Nächster Verfall (0DTE / Front)</option>
            {(data?.availableExpirations ?? []).map((exp) => (
              <option key={exp} value={exp}>
                {exp}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" type="submit" aria-label="Optionsflow anzeigen" disabled={!pendingTarget}>
          Laden
        </button>
        {data && (
          <button
            type="button"
            className={`button${wallsActiveForTicker ? " primary" : ""}`}
            aria-pressed={wallsActiveForTicker}
            onClick={toggleWallsOnChart}
          >
            <Layers size={14} />
            <span>{wallsActiveForTicker ? "Walls im Chart ✓" : "Walls im Chart"}</span>
          </button>
        )}
        <button type="button" className="button" aria-label="Aktualisieren" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} />
        </button>
      </form>

      <div className="options-quick-bar">
        <div className="options-quick-chips" role="group" aria-label="Schnellauswahl">
          {QUICK_TICKERS.map((sym) => (
            <button
              key={sym}
              type="button"
              className={`options-chip${ticker === sym ? " active" : ""}`}
              onClick={() => applyTicker(sym)}
            >
              {sym}
            </button>
          ))}
        </div>
        <span className="options-source-pill">
          {data ? data.source : "Yahoo Finance / Deribit · Kein API-Key nötig"}
        </span>
      </div>

      {loading && !data && <p role="status">Lade Optionskette, Put/Call Walls &amp; GEX für {ticker}…</p>}
      {error && !data && <p role="status">{error}</p>}

      {data && (
        <>
          <div className="options-kpi-grid">
            <article className="options-kpi-card call">
              <header>
                <span>Call Wall (Widerstand)</span>
                {data.callWall && (
                  <button
                    type="button"
                    className="options-alert-btn"
                    title="Preis-Alert auf Call Wall setzen"
                    aria-label="Alert auf Call Wall setzen"
                    onClick={() => createLevelAlert("Call Wall", data.callWall!.strike)}
                  >
                    <BellPlus size={13} />
                  </button>
                )}
              </header>
              <strong className="mono">{data.callWall ? fmtStrike(data.callWall.strike) : "—"}</strong>
              <p className="mono">
                {data.callWall
                  ? `${fmtSignedPct(data.callWall.distancePct)} · ${formatCompactCount(data.callWall.openInterest)} OI`
                  : "Keine Call-Daten"}
              </p>
            </article>

            <article className="options-kpi-card put">
              <header>
                <span>Put Wall (Support)</span>
                {data.putWall && (
                  <button
                    type="button"
                    className="options-alert-btn"
                    title="Preis-Alert auf Put Wall setzen"
                    aria-label="Alert auf Put Wall setzen"
                    onClick={() => createLevelAlert("Put Wall", data.putWall!.strike)}
                  >
                    <BellPlus size={13} />
                  </button>
                )}
              </header>
              <strong className="mono">{data.putWall ? fmtStrike(data.putWall.strike) : "—"}</strong>
              <p className="mono">
                {data.putWall
                  ? `${fmtSignedPct(data.putWall.distancePct)} · ${formatCompactCount(data.putWall.openInterest)} OI`
                  : "Keine Put-Daten"}
              </p>
            </article>

            <article className="options-kpi-card gamma">
              <header>
                <span>Gamma Flip / Net GEX</span>
                {data.gammaFlip !== null && (
                  <button
                    type="button"
                    className="options-alert-btn"
                    title="Preis-Alert auf Gamma Flip setzen"
                    aria-label="Alert auf Gamma Flip setzen"
                    onClick={() => createLevelAlert("Gamma Flip", data.gammaFlip!)}
                  >
                    <BellPlus size={13} />
                  </button>
                )}
              </header>
              <strong className="mono">{data.gammaFlip !== null ? fmtStrike(data.gammaFlip) : formatCompactUsd(data.netGexUsd)}</strong>
              <p>
                <span className={`options-regime-badge ${data.gammaRegime}`}>
                  {data.gammaRegime === "positive"
                    ? "Pos. Gamma (Pinning)"
                    : data.gammaRegime === "negative"
                      ? "Neg. Gamma (Vol-Trend)"
                      : "Neutral"}
                </span>{" "}
                <span className="mono">{formatCompactUsd(data.netGexUsd)}</span>
              </p>
            </article>

            <article className="options-kpi-card pain">
              <header>
                <span>Max Pain</span>
                {data.maxPain !== null && (
                  <button
                    type="button"
                    className="options-alert-btn"
                    title="Preis-Alert auf Max Pain setzen"
                    aria-label="Alert auf Max Pain setzen"
                    onClick={() => createLevelAlert("Max Pain", data.maxPain!)}
                  >
                    <BellPlus size={13} />
                  </button>
                )}
              </header>
              <strong className="mono">{data.maxPain !== null ? fmtStrike(data.maxPain) : "—"}</strong>
              <p className="mono">
                {data.maxPainDistancePct !== null ? `${fmtSignedPct(data.maxPainDistancePct)} zum Spot` : "—"}
              </p>
            </article>

            <article className="options-kpi-card em">
              <header>
                <span>Expected Move (±1σ)</span>
              </header>
              <strong className="mono">
                {data.expectedMovePct !== null && data.expectedMoveUsd !== null
                  ? `±${data.expectedMovePct.toFixed(1)}% (±$${data.expectedMoveUsd.toFixed(data.expectedMoveUsd >= 100 ? 0 : 2)})`
                  : "—"}
              </strong>
              <p className="mono">
                {data.expectedLow !== null && data.expectedHigh !== null
                  ? `${fmtStrike(data.expectedLow)} – ${fmtStrike(data.expectedHigh)}`
                  : "—"}
              </p>
            </article>

            <article className="options-kpi-card">
              <header>
                <span>P/C Ratio · IV · 25Δ Skew</span>
              </header>
              <strong className="mono">
                {data.pcRatioOi !== null ? `OI ${data.pcRatioOi.toFixed(2)}` : "OI —"} · IV {fmtIv(data.atmIv)}
              </strong>
              <p>
                Vol P/C <span className="mono">{data.pcRatioVol !== null ? data.pcRatioVol.toFixed(2) : "—"}</span> ·{" "}
                {skewLabel}
                {data.skew25 !== null ? ` (${data.skew25 >= 0 ? "+" : ""}${(data.skew25 * 100).toFixed(1)}pp)` : ""}
              </p>
            </article>
          </div>

          <div className="options-tabs" role="tablist" aria-label="Options-Ansichten">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "walls"}
              className={tab === "walls" ? "active" : ""}
              onClick={() => setTab("walls")}
            >
              Walls &amp; GEX Profil
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "unusual"}
              className={tab === "unusual" ? "active" : ""}
              onClick={() => setTab("unusual")}
            >
              Unusual Activity ({data.unusual.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "chain"}
              className={tab === "chain" ? "active" : ""}
              onClick={() => setTab("chain")}
            >
              Optionskette &amp; Greeks
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "opra"}
              className={tab === "opra" ? "active" : ""}
              onClick={() => setTab("opra")}
            >
              OPRA Live-Tape
            </button>
          </div>

          {tab === "walls" && (
            <div className="options-walls-view">
              <div className="options-metric-switch" role="group" aria-label="Profil-Metrik">
                <button
                  type="button"
                  className={metric === "oi" ? "active" : ""}
                  onClick={() => setMetric("oi")}
                >
                  Open Interest (Walls)
                </button>
                <button
                  type="button"
                  className={metric === "gex" ? "active" : ""}
                  onClick={() => setMetric("gex")}
                >
                  Dealer GEX ($)
                </button>
                <button
                  type="button"
                  className={metric === "volume" ? "active" : ""}
                  onClick={() => setMetric("volume")}
                >
                  Tagesvolumen
                </button>
                <span className="form-help">
                  Verfälle: {data.includedExpirations.join(", ")} · {data.contractCount} Kontrakte · Spot{" "}
                  {fmtStrike(data.spot)}
                </span>
              </div>

              <StrikeProfileChart data={data} metric={metric} />

              <div className="options-walls-breakdown">
                <article className="terminal-research-card">
                  <header>
                    <strong>Top Call Walls (Widerstand)</strong>
                    <span className="mono">{formatCompactCount(data.totalCallOi)} Total Call OI</span>
                  </header>
                  <ul className="options-wall-list">
                    {data.topCallWalls.map((w, i) => (
                      <li key={w.strike}>
                        <span className="mono">
                          #{i + 1} <strong>{fmtStrike(w.strike)}</strong> ({fmtSignedPct(w.distancePct)})
                        </span>
                        <span className="mono">
                          {formatCompactCount(w.openInterest)} OI · {formatCompactCount(w.volume)} Vol ·{" "}
                          {formatCompactUsd(w.gexUsd)} GEX
                        </span>
                      </li>
                    ))}
                  </ul>
                  {data.callVolumeWall && (
                    <p className="form-help">
                      Aktivster Call-Strike heute: <strong className="mono">{fmtStrike(data.callVolumeWall.strike)}</strong> (
                      {formatCompactCount(data.callVolumeWall.volume)} Vol)
                    </p>
                  )}
                </article>

                <article className="terminal-research-card">
                  <header>
                    <strong>Top Put Walls (Support)</strong>
                    <span className="mono">{formatCompactCount(data.totalPutOi)} Total Put OI</span>
                  </header>
                  <ul className="options-wall-list">
                    {data.topPutWalls.map((w, i) => (
                      <li key={w.strike}>
                        <span className="mono">
                          #{i + 1} <strong>{fmtStrike(w.strike)}</strong> ({fmtSignedPct(w.distancePct)})
                        </span>
                        <span className="mono">
                          {formatCompactCount(w.openInterest)} OI · {formatCompactCount(w.volume)} Vol ·{" "}
                          {formatCompactUsd(w.gexUsd)} GEX
                        </span>
                      </li>
                    ))}
                  </ul>
                  {data.putVolumeWall && (
                    <p className="form-help">
                      Aktivster Put-Strike heute: <strong className="mono">{fmtStrike(data.putVolumeWall.strike)}</strong> (
                      {formatCompactCount(data.putVolumeWall.volume)} Vol)
                    </p>
                  )}
                </article>
              </div>
            </div>
          )}

          {tab === "unusual" && (
            <div className="options-table-wrap">
              <p className="form-help">
                Kontrakte mit hohem Volumen/OI-Verhältnis oder höchster Tagesprämie (Notional) — ohne API-Key aus der
                öffentlichen Optionskette berechnet.
              </p>
              {data.unusual.length === 0 ? (
                <p role="status">Aktuell keine auffälligen Vol/OI-Spitzen in den gewählten Verfällen.</p>
              ) : (
                <table className="options-table">
                  <thead>
                    <tr>
                      <th>Typ</th>
                      <th>Strike</th>
                      <th>Verfall</th>
                      <th>Vol</th>
                      <th>OI</th>
                      <th>Vol/OI</th>
                      <th>IV</th>
                      <th>Δ</th>
                      <th>Prämie ($)</th>
                      <th>Lage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unusual.map((item) => (
                      <tr key={item.contractSymbol}>
                        <td>
                          <span className={`options-side-badge ${item.optionType}`}>
                            {item.optionType === "call" ? "CALL" : "PUT"}
                          </span>
                        </td>
                        <td className="mono">
                          <strong>{fmtStrike(item.strike)}</strong>
                        </td>
                        <td className="mono">{item.expiration}</td>
                        <td className="mono">{formatCompactCount(item.volume)}</td>
                        <td className="mono">{formatCompactCount(item.openInterest)}</td>
                        <td className="mono">{item.volOiRatio.toFixed(1)}×</td>
                        <td className="mono">{fmtIv(item.iv)}</td>
                        <td className="mono">{fmtGreek(item.delta, 2)}</td>
                        <td className="mono">{formatCompactUsd(item.notionalUsd).replace(/^\+/, "")}</td>
                        <td className="mono">{item.moneyness}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === "chain" && (
            <div className="options-table-wrap">
              <p className="form-help">
                Black-Scholes-Greeks (Δ, Γ, Θ) direkt aus Spot, IV und Restlaufzeit berechnet. Grüne/rote Markierung =
                Call/Put Wall.
              </p>
              <table className="options-table chain">
                <thead>
                  <tr>
                    <th colSpan={5} className="call-head">
                      CALLS
                    </th>
                    <th className="strike-head">STRIKE</th>
                    <th colSpan={5} className="put-head">
                      PUTS
                    </th>
                  </tr>
                  <tr>
                    <th>OI</th>
                    <th>Vol</th>
                    <th>IV</th>
                    <th>Δ</th>
                    <th>Mid</th>
                    <th>K</th>
                    <th>Mid</th>
                    <th>Δ</th>
                    <th>IV</th>
                    <th>Vol</th>
                    <th>OI</th>
                  </tr>
                </thead>
                <tbody>
                  {data.strikes.map((row) => {
                    const isCW = data.callWall?.strike === row.strike;
                    const isPW = data.putWall?.strike === row.strike;
                    const isMP = data.maxPain === row.strike;
                    return (
                      <tr
                        key={row.strike}
                        className={isCW ? "row-cw" : isPW ? "row-pw" : isMP ? "row-mp" : ""}
                      >
                        <td className={`mono${row.callInTheMoney ? " itm" : ""}`}>
                          {row.callOi ? formatCompactCount(row.callOi) : "—"}
                        </td>
                        <td className={`mono${row.callInTheMoney ? " itm" : ""}`}>
                          {row.callVol ? formatCompactCount(row.callVol) : "—"}
                        </td>
                        <td className={`mono${row.callInTheMoney ? " itm" : ""}`}>{fmtIv(row.callIv)}</td>
                        <td className={`mono${row.callInTheMoney ? " itm" : ""}`}>{fmtGreek(row.callDelta, 2)}</td>
                        <td className={`mono${row.callInTheMoney ? " itm" : ""}`}>
                          {row.callMid !== null ? row.callMid.toFixed(row.callMid >= 10 ? 2 : 3) : "—"}
                        </td>
                        <td className="mono strike-col">
                          <strong>{row.strike >= 1000 ? Math.round(row.strike) : row.strike}</strong>
                          {isCW ? <em className="mini-tag call">CW</em> : null}
                          {isPW ? <em className="mini-tag put">PW</em> : null}
                          {isMP ? <em className="mini-tag pain">MP</em> : null}
                        </td>
                        <td className={`mono${row.putInTheMoney ? " itm" : ""}`}>
                          {row.putMid !== null ? row.putMid.toFixed(row.putMid >= 10 ? 2 : 3) : "—"}
                        </td>
                        <td className={`mono${row.putInTheMoney ? " itm" : ""}`}>{fmtGreek(row.putDelta, 2)}</td>
                        <td className={`mono${row.putInTheMoney ? " itm" : ""}`}>{fmtIv(row.putIv)}</td>
                        <td className={`mono${row.putInTheMoney ? " itm" : ""}`}>
                          {row.putVol ? formatCompactCount(row.putVol) : "—"}
                        </td>
                        <td className={`mono${row.putInTheMoney ? " itm" : ""}`}>
                          {row.putOi ? formatCompactCount(row.putOi) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === "opra" && (
            <div className="options-opra-tab">
              <p className="form-help">
                Optionales Echtzeit-OPRA-Tape (Alpaca-Verbindung nur für klassifizierte Bid/Ask-Einzelausführungen nötig
                — alle Put/Call Walls, GEX, Max Pain &amp; Greeks oben funktionieren komplett ohne API-Key).
              </p>
              {!alpacaEnabled ? (
                <div className="options-opra-connect">
                  <p role="status">Alpaca OPRA ist optional. Verbinde einen Key nur, falls du zusätzlich Live-Prints sehen möchtest.</p>
                  <button
                    className="button"
                    type="button"
                    onClick={() => useAlpacaStore.setState({ open: true })}
                  >
                    Alpaca optional verbinden
                  </button>
                </div>
              ) : (
                <>
                  {!opraSample && opraTicker && <p role="status">OPRA-Tape wird abgerufen…</p>}
                  {opraTicker && opraSample?.unavailable[opraTicker] && (
                    <p role="status">{opraSample.unavailable[opraTicker]}</p>
                  )}
                  {opraData && (
                    <>
                      <p role="status">
                        <strong>
                          {opraData.ticker} · {optionsBiasLabels[opraData.bias]}
                        </strong>{" "}
                        · {opraData.classified} klassifiziert · {opraData.contracts} Kontrakte
                        {opraData.truncated ? " · Teilabdeckung" : ""}
                      </p>
                      <div className="terminal-research-cards">
                        {opraData.prints.map((print) => (
                          <article className="terminal-research-card" key={print.contract}>
                            <header>
                              <strong>{print.contract}</strong>
                              <span>{print.option === "call" ? "Call" : "Put"}</span>
                            </header>
                            <p className="mono">
                              {print.side === "buy" ? "Am Brief" : "Am Geld"} · {print.size} ×{" "}
                              {formatPrice(print.price)} USD
                            </p>
                            <p className="form-help">{new Date(print.time).toLocaleTimeString("de-DE")}</p>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
