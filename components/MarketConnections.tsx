"use client";
import { useState } from "react";
import { useAlpacaStore } from "@/stores/useAlpacaStore";
import { iexSymbol, sipSymbol, IEX_TICKER } from "@/lib/symbolId";
import { useChartStore } from "@/stores/useChartStore";
import { Modal } from "./ui";
export function MarketConnections() {
  const open = useAlpacaStore((s) => s.open);
  if (!open) return null;
  return <MarketConnectionsBody />;
}
function MarketConnectionsBody() {
  const state = useAlpacaStore(), [key, setKey] = useState(""), [secret, setSecret] = useState(""), [ticker, setTicker] = useState("AAPL"), [error, setError] = useState("");
  const close = () => { setKey(""); setSecret(""); setError(""); useAlpacaStore.setState({ open: false }); };
  const openChart = (feed: "iex" | "sip") => {
    if (!IEX_TICKER.test(ticker.trim())) {
      setError("Enter a valid US ticker such as AAPL or BRK.B.");
      return;
    }
    const chart = useChartStore.getState();
    const symbol = feed === "sip" ? sipSymbol(ticker) : iexSymbol(ticker);
    chart.set({ symbol, ...(!["1m", "5m", "15m", "1h", "4h", "1D"].includes(chart.timeframe) ? { timeframe: "5m" } : {}) });
    close();
  };
  return <Modal title="Market data connections" onClose={close} className="market-connections-modal">
    <div className="form-body">
      <h3>Alpaca · US stocks & ETFs</h3>
      <p className="form-help">Open a delayed SIP chart for consolidated US market history. The active chart checks for new unadjusted bars once per minute with a 16-minute cutoff.</p>
      <p className="form-help">The free Alpaca Basic plan provides real-time IEX data for US-listed stocks. An Alpaca API key is required. This is IEX exchange activity only, not the consolidated Nasdaq/NYSE market or full US volume.</p>
      <p className="form-help">Options flow uses the same Alpaca connection and requires OPRA access.</p>
      <p className="form-help">Charts use unadjusted IEX bars, including available extended hours. The Yahoo session and dividend controls do not apply. Minute and longer intervals are supported; the stream updates completed minute bars. IEX has no aggressor-side or Level 2 data here: Bid × Ask Footprint, delta/CVD and DOM are unavailable.</p>
      <p className="form-help">Each history request uses at most 20,000 source minute or day bars. Longer intervals can therefore return fewer candles. Minutes without eligible IEX trades stay absent. Watchlist changes and ranges are observed since connection, not consolidated 24-hour statistics.</p>
      <p role="status">Connection: <strong>{state.status}</strong>{state.symbols.length ? ` · ${state.symbols.length}/30 symbols` : ""}</p>
      {state.message && <p role="alert" className="negative">{state.message}</p>}
      {state.omitted.length > 0 && <p role="alert">Subscription limit: {state.omitted.join(", ")} have no live IEX subscription. Select a chart or reduce watchlist symbols.</p>}
      {!state.enabled ? <form id="iex-connect" onSubmit={event => {
        event.preventDefault(); setError("");
        try { state.connect({ key: key.trim(), secret: secret.trim() }); setKey(""); setSecret(""); } catch (error) { setError(error instanceof Error ? error.message : "Unable to connect."); }
      }}>
        <label>API key<input aria-label="Alpaca API key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} required /></label>
        <label>Secret key<input aria-label="Alpaca secret key" type="password" autoComplete="off" value={secret} onChange={event => setSecret(event.target.value)} required /></label>
        <p className="form-help">Credentials are held only in this tab's memory and cleared on disconnect or reload. REST history passes through this app's server to Alpaca's data API; streaming authenticates directly with Alpaca. No credentials are saved in workspace files.</p>
      </form> : <p className="form-help">Closing this dialog keeps the tab's connection active. Reloading requires reconnecting. Browser alerts need this tab and connection; server alerts cannot use these session credentials.</p>}
      <label>US ticker<input aria-label="IEX chart ticker" value={ticker} onChange={event => setTicker(event.target.value.toUpperCase())} maxLength={15} /></label>
      {error && <p role="alert" className="negative">{error}</p>}
      <p className="form-help"><a href="https://docs.alpaca.markets/us/docs/about-market-data-api" target="_blank" rel="noreferrer">Alpaca data coverage</a></p>
    </div>
    <div className="modal-actions">
      {state.enabled ? <><button className="button" onClick={() => state.reconnect()}>Reconnect</button><button className="button" onClick={() => { state.disconnect(); setKey(""); setSecret(""); }}>Disconnect</button></> : <button className="button primary" form="iex-connect" type="submit">Connect IEX</button>}
      <button className="button" onClick={() => openChart("iex")}>Open IEX chart</button>
      <button className="button" onClick={() => openChart("sip")}>Open delayed SIP chart</button>
    </div>
  </Modal>;
}
