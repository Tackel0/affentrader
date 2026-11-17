"use client";
import { useEffect, useRef, useState } from "react";
import type { FundamentalSnapshot } from "@/lib/screener/opportunities";
import type { QuantTechnicalSnapshot } from "@/lib/quant/signals";
import { isYahooTicker } from "@/lib/symbolId";
import { formatPrice } from "@/lib/symbols";
import { useChartStore } from "@/stores/useChartStore";

const fmtNum = (v: number | null | undefined, suffix = "", digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}${suffix}`;

const fmtSigned = (v: number | null | undefined, suffix = "%", digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${suffix}`;

export function FundamentalsPanel({
  initialTicker = "QCOM",
  preloaded,
  onOpenChart,
}: {
  initialTicker?: string;
  preloaded?: { ticker: string; lastClose?: number; fundamentals: FundamentalSnapshot | null } | null;
  onOpenChart?: (ticker: string) => void;
}) {
  const [ticker, setTicker] = useState(preloaded?.ticker ?? initialTicker);
  const [snapshot, setSnapshot] = useState<FundamentalSnapshot | null>(preloaded?.fundamentals ?? null);
  const [quant, setQuant] = useState<QuantTechnicalSnapshot | null>(null);
  const [lastClose, setLastClose] = useState<number>(preloaded?.lastClose ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const lastInitialTickerRef = useRef<string | null>(null);

  useEffect(() => {
    if (preloaded?.ticker) {
      lastInitialTickerRef.current = preloaded.ticker;
      setTicker(preloaded.ticker);
      if (preloaded.fundamentals) {
        abortRef.current?.abort();
        setLoading(false);
        setSnapshot(preloaded.fundamentals);
        setQuant(null);
        if (preloaded.lastClose) setLastClose(preloaded.lastClose);
        setError("");
        return;
      }
      void loadTicker(preloaded.ticker);
      return;
    }
    const cleanInitial = initialTicker.replace(/^YF:/i, "").trim().toUpperCase();
    if (cleanInitial && (lastInitialTickerRef.current !== cleanInitial || !snapshot)) {
      lastInitialTickerRef.current = cleanInitial;
      setTicker(cleanInitial);
      void loadTicker(cleanInitial);
    }
  }, [preloaded, initialTicker]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loadTicker = async (rawSymbol: string) => {
    const clean = rawSymbol.replace(/^YF:/i, "").trim().toUpperCase();
    if (!isYahooTicker(clean)) {
      setError("Enter a valid exchange ticker (e.g. AAPL, QCOM, SAP.DE, SHEL.L).");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/terminal-fundamentals?${new URLSearchParams({ ticker: clean })}`, {
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as {
        ticker?: string;
        lastClose?: number;
        fundamentals?: FundamentalSnapshot;
        quant?: QuantTechnicalSnapshot | null;
        error?: string;
      };
      if (!response.ok || !body.fundamentals) {
        throw new Error(body.error ?? "Fundamentals unavailable.");
      }
      if (!controller.signal.aborted) {
        setTicker(clean);
        setSnapshot(body.fundamentals);
        setQuant(body.quant ?? null);
        setLastClose(body.lastClose ?? 0);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Fundamentals unavailable.");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const peDiscount =
    snapshot?.forwardPe && snapshot.sectorMedianPe
      ? ((snapshot.sectorMedianPe - snapshot.forwardPe) / snapshot.sectorMedianPe) * 100
      : null;
  const evDiscount =
    snapshot?.evToEbitda && snapshot.sectorMedianEvEbitda
      ? ((snapshot.sectorMedianEvEbitda - snapshot.evToEbitda) / snapshot.sectorMedianEvEbitda) * 100
      : null;
  const modelTarget = Math.max(snapshot?.fairValue ?? 0, snapshot?.analystTarget ?? 0);
  const upsidePct =
    lastClose > 0 && modelTarget > 0 ? ((modelTarget - lastClose) / lastClose) * 100 : null;

  return (
    <section className="stock-base-evidence fundamentals-panel" aria-label="Fundamental and Valuation Analysis">
      <form
        className="screener-toolbar"
        onSubmit={e => {
          e.preventDefault();
          void loadTicker(ticker);
        }}
      >
        <label>
          Ticker
          <input
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="QCOM, ADBE, SAP.DE…"
            maxLength={24}
          />
        </label>
        <button type="submit" className="button small primary" disabled={loading}>
          {loading ? "Loading FA…" : "Load FA"}
        </button>
        {snapshot && (
          <button
            type="button"
            className="button small"
            onClick={() => {
              if (onOpenChart) onOpenChart(snapshot.ticker);
              else useChartStore.getState().set({ symbol: `YF:${snapshot.ticker}`, timeframe: "1D" });
            }}
          >
            Open {snapshot.ticker} Chart
          </button>
        )}
        <span className="terminal-telemetry-chip">
          {snapshot ? `SRC: ${snapshot.source} · ${snapshot.sector}` : "FA / VALUE · EDGAR + YAHOO"}
        </span>
      </form>

      {error && <p className="error-message screener-error" role="alert">{error}</p>}

      {!snapshot && !error && (
        <div className="empty-table">
          {loading ? `Loading fundamentals for ${ticker}…` : "Enter an equity ticker (e.g. QCOM, AAPL, SAP.DE) and press Load FA."}
        </div>
      )}

      {snapshot && (
        <>
          <div className="screener-toolbar">
            <strong>
              {snapshot.ticker} · {snapshot.name}
            </strong>
            <span className="chip">{snapshot.sector}</span>
            {snapshot.marketCapBn ? <span className="chip mono">MCap {snapshot.marketCapBn.toFixed(1)}B {snapshot.currency}</span> : null}
            {lastClose > 0 ? (
              <span className="mono">
                Last <strong>{formatPrice(lastClose)} {snapshot.currency}</strong>
              </span>
            ) : null}
            {upsidePct !== null ? (
              <span className={`mono ${upsidePct >= 10 ? "positive" : upsidePct < 0 ? "negative" : ""}`}>
                Fair-Value Upside {fmtSigned(upsidePct)}
              </span>
            ) : null}
            {snapshot.dataSources?.length ? (
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
                {snapshot.dataSources.map((src) => (
                  <span key={src} className="chip">
                    {src}
                  </span>
                ))}
              </span>
            ) : null}
          </div>

          <dl aria-label="Valuation, balance sheet and quality metrics">
            <div>
              <dt>Forward P/E vs. Sector</dt>
              <dd className={`mono ${peDiscount !== null && peDiscount >= 10 ? "positive" : ""}`.trim()}>
                {fmtNum(snapshot.forwardPe, "×")} (Median {fmtNum(snapshot.sectorMedianPe, "×")}
                {peDiscount !== null ? ` · ${peDiscount >= 0 ? `−${peDiscount.toFixed(0)}% disc.` : `+${Math.abs(peDiscount).toFixed(0)}% prem.`}` : ""})
              </dd>
            </div>
            <div>
              <dt>EV / EBITDA vs. Sector</dt>
              <dd className={`mono ${evDiscount !== null && evDiscount >= 10 ? "positive" : ""}`.trim()}>
                {fmtNum(snapshot.evToEbitda, "×")} (Sector {fmtNum(snapshot.sectorMedianEvEbitda, "×")})
              </dd>
            </div>
            <div>
              <dt>Price / FCF &amp; FCF Yield</dt>
              <dd className={`mono ${snapshot.fcfYieldPct && snapshot.fcfYieldPct >= 4 ? "positive" : ""}`.trim()}>
                P/FCF {fmtNum(snapshot.priceToFcf, "×")} · Yield {fmtNum(snapshot.fcfYieldPct, "%")}
              </dd>
            </div>
            <div>
              <dt>PEG Ratio (GARP)</dt>
              <dd className={`mono ${snapshot.pegRatio && snapshot.pegRatio <= 1.25 ? "positive" : ""}`.trim()}>
                {fmtNum(snapshot.pegRatio, "", 2)}
              </dd>
            </div>
            <div>
              <dt>Net Debt / EBITDA</dt>
              <dd className={`mono ${snapshot.netDebtToEbitda !== null && snapshot.netDebtToEbitda <= 1.5 ? "positive" : ""}`.trim()}>
                {snapshot.netDebtToEbitda !== null && snapshot.netDebtToEbitda < 0
                  ? `${snapshot.netDebtToEbitda.toFixed(2)}× (Net Cash)`
                  : fmtNum(snapshot.netDebtToEbitda, "×", 2)}
              </dd>
            </div>
            <div>
              <dt>Operating &amp; Net Margin</dt>
              <dd className="mono">
                Op {fmtNum(snapshot.operatingMarginPct, "%")} · Net {fmtNum(snapshot.netMarginPct, "%")} · ROE {fmtNum(snapshot.roePct, "%")}
              </dd>
            </div>
            <div>
              <dt>Revenue YoY &amp; EPS Rev.</dt>
              <dd className={`mono ${snapshot.epsRevisionPct && snapshot.epsRevisionPct > 0 ? "positive" : ""}`.trim()}>
                Rev {fmtSigned(snapshot.revenueGrowthPct)} · EPS Rev {fmtSigned(snapshot.epsRevisionPct)}
              </dd>
            </div>
            <div>
              <dt>Analyst Target / Fair Value</dt>
              <dd className={`mono ${upsidePct && upsidePct > 10 ? "positive" : ""}`.trim()}>
                Target {snapshot.analystTarget ? `${formatPrice(snapshot.analystTarget)} ${snapshot.currency}` : "—"} · Fair{" "}
                {snapshot.fairValue ? `${formatPrice(snapshot.fairValue)} ${snapshot.currency}` : "—"}
              </dd>
            </div>
            <div>
              <dt>Insider Buys (90D · Form 4 / PDMR)</dt>
              <dd className={`mono ${snapshot.insiderBuys90d >= 2 ? "positive" : ""}`.trim()}>
                {snapshot.insiderBuys90d} buys · Net ${Math.round(snapshot.insiderNetValueUsd / 1000).toLocaleString("en-US")}k
              </dd>
            </div>
            {snapshot.lastEarningsDate && (
              <div>
                <dt>Last Quarterly Report</dt>
                <dd className="mono">
                  {snapshot.lastEarningsDate}
                  {snapshot.earningsSurprisePct !== null ? ` · Surprise ${fmtSigned(snapshot.earningsSurprisePct)}` : ""}
                </dd>
              </div>
            )}
            {(snapshot.historicalMedianPe !== undefined && snapshot.historicalMedianPe !== null) && (
              <div>
                <dt>P/E vs. History (SEC XBRL Median)</dt>
                <dd
                  className={`mono ${
                    snapshot.peVsHistoryPct !== undefined &&
                    snapshot.peVsHistoryPct !== null &&
                    snapshot.peVsHistoryPct <= -10
                      ? "positive"
                      : ""
                  }`.trim()}
                >
                  {fmtNum(snapshot.forwardPe, "×")} vs. Hist {fmtNum(snapshot.historicalMedianPe, "×")}
                  {snapshot.peVsHistoryPct !== undefined && snapshot.peVsHistoryPct !== null
                    ? ` · ${snapshot.peVsHistoryPct < 0 ? `−${Math.abs(snapshot.peVsHistoryPct).toFixed(0)}% disc.` : `+${snapshot.peVsHistoryPct.toFixed(0)}% prem.`}`
                    : ""}
                </dd>
              </div>
            )}
            {snapshot.analystConsensus && (
              <div>
                <dt>Analyst Consensus ({snapshot.analystConsensus.analystCount} Ratings)</dt>
                <dd
                  className={`mono ${
                    snapshot.analystConsensus.ratingLabel.includes("Buy")
                      ? "positive"
                      : snapshot.analystConsensus.ratingLabel.includes("Sell")
                        ? "negative"
                        : ""
                  }`.trim()}
                >
                  <strong>{snapshot.analystConsensus.ratingLabel}</strong> · Buy {snapshot.analystConsensus.buy} / Hold{" "}
                  {snapshot.analystConsensus.hold} / Sell {snapshot.analystConsensus.sell}
                  {snapshot.analystConsensus.targetLow !== null && snapshot.analystConsensus.targetHigh !== null
                    ? ` · Range ${formatPrice(snapshot.analystConsensus.targetLow)}–${formatPrice(snapshot.analystConsensus.targetHigh)} ${snapshot.currency}`
                    : ""}
                </dd>
              </div>
            )}
          </dl>

          {snapshot.analystConsensus && (
            <div style={{ margin: "6px 8px 10px" }}>
              {(() => {
                const c = snapshot.analystConsensus;
                const total = Math.max(1, c.buy + c.hold + c.sell);
                return (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div
                      aria-label="Analyst consensus distribution"
                      style={{
                        display: "flex",
                        height: 6,
                        borderRadius: 1,
                        overflow: "hidden",
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <span style={{ width: `${(c.buy / total) * 100}%`, background: "var(--green, #00c853)" }} />
                      <span style={{ width: `${(c.hold / total) * 100}%`, background: "var(--amber, #ffab00)" }} />
                      <span style={{ width: `${(c.sell / total) * 100}%`, background: "var(--red, #ff3d57)" }} />
                    </div>
                    {(c.recentActions?.length ?? 0) > 0 && (
                      <div className="stock-base-results table-scroll">
                        <table className="data-table" aria-label="Recent analyst rating actions">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Firm</th>
                              <th>Action</th>
                              <th>Rating / Target</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(c.recentActions ?? []).map((act, idx) => (
                              <tr key={`${act.date}-${act.firm}-${idx}`}>
                                <td className="mono">{act.date || "—"}</td>
                                <td>{act.firm}</td>
                                <td>{act.action}</td>
                                <td>{act.toGrade}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {quant && (
            <div className="stock-base-results" style={{ padding: "8px 10px", background: "var(--surface2)", borderRadius: 1, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 6 }}>
                <span>Quant Momentum, Risk &amp; Candlestick Regime (210D)</span>
                <span className="terminal-telemetry-chip">210D REGIME</span>
              </div>
              <div className="metrics-grid">
                <div className="metric"><span>RSI (14)</span><strong className="mono">{fmtNum(quant.rsi14)}</strong></div>
                <div className="metric"><span>MFI (14)</span><strong className="mono">{fmtNum(quant.mfi14)}</strong></div>
                <div className="metric"><span>Williams %R</span><strong className="mono">{fmtNum(quant.willR14)}</strong></div>
                <div className="metric"><span>ADX (14)</span><strong className="mono">{fmtNum(quant.adx14)}</strong></div>
                <div className="metric"><span>BB Squeeze Width</span><strong className="mono">{fmtNum(quant.bollingerWidthPct, "%")}</strong></div>
                <div className="metric"><span>Ann. Vol</span><strong className="mono">{fmtNum(quant.annualizedVolPct, "%")}</strong></div>
                <div className="metric"><span>Sortino Ratio</span><strong className={`mono ${(quant.sortinoRatio ?? 0) >= 1 ? "positive" : ""}`}>{fmtNum(quant.sortinoRatio, "", 2)}</strong></div>
                <div className="metric"><span>Max Drawdown</span><strong className="mono negative">{fmtNum(quant.maxDrawdownPct, "%")}</strong></div>
                <div className="metric"><span>Daily VaR (95%)</span><strong className="mono">{fmtNum(quant.var95Pct, "%")}</strong></div>
                <div className="metric">
                  <span>Candlestick Patterns</span>
                  <strong style={{ fontSize: 11 }}>
                    {quant.candlestickPatterns.length ? quant.candlestickPatterns.join(", ") : "Neutral"}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {snapshot.recentInsiderFilings.length > 0 && (
            <div className="stock-base-results table-scroll">
              <table className="data-table" aria-label="Recent insider filings">
                <thead>
                  <tr>
                    <th>Filing Date</th>
                    <th>Insider</th>
                    <th>Role</th>
                    <th>Form</th>
                    <th>Shares</th>
                    <th>Value (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.recentInsiderFilings.map((f, i) => (
                    <tr key={`${f.date}-${i}`}>
                      <td className="mono">{f.date}</td>
                      <td>{f.insider}</td>
                      <td>{f.role}</td>
                      <td>{f.form}</td>
                      <td className="mono">{f.shares.toLocaleString("en-US")}</td>
                      <td className="mono positive">${f.valueUsd.toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
