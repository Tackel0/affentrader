"use client";
import { useEffect, useState } from "react";
import { IEX_TICKER } from "@/lib/symbolId";
import { optionsBiasLabels } from "@/lib/market/optionsFlow";
import { useOptionsFlow } from "@/hooks/useOptionsFlow";
import { useAlpacaStore } from "@/stores/useAlpacaStore";
import { formatPrice } from "@/lib/symbols";

export function OptionsFlowPanel({ initialTicker }: { initialTicker: string }) {
  const [input, setInput] = useState(initialTicker);
  const [ticker, setTicker] = useState(initialTicker);
  useEffect(() => { setInput(initialTicker); setTicker(initialTicker); }, [initialTicker]);
  const { enabled, sample } = useOptionsFlow(IEX_TICKER.test(ticker) ? [ticker] : []);
  const data = sample?.result[ticker];
  return <section className="terminal-research-list" aria-label="Optionsflow">
    <form className="screener-toolbar" onSubmit={event => { event.preventDefault(); if (IEX_TICKER.test(input.trim())) setTicker(input.trim()); }}>
      <label>US-Ticker <input value={input} maxLength={15} onChange={event => setInput(event.target.value.toUpperCase())} /></label>
      <button className="button primary" type="submit" disabled={!IEX_TICKER.test(input.trim())}>Optionsflow anzeigen</button>
      {!enabled && <button className="button" type="button" onClick={() => useAlpacaStore.setState({ open: true })}>Alpaca verbinden</button>}
    </form>
    <p className="form-help">Alpaca OPRA · Stichprobe letzter Ausführungen je Kontrakt in 15 Minuten, Verfall bis 21 Tage. Klassifiziert am vorherigen Geld-/Briefkurs. Absicherung und Mehrbeinstrategien können dieselbe Richtung zeigen.</p>
    {!enabled && <p role="status">Eine Alpaca-Verbindung mit OPRA-Zugang ist erforderlich.</p>}
    {enabled && !sample && IEX_TICKER.test(ticker) && <p role="status">Optionsdaten werden abgerufen…</p>}
    {sample?.unavailable[ticker] && <p role="status">{sample.unavailable[ticker]}</p>}
    {data && <>
      <p role="status"><strong>{data.ticker} · {optionsBiasLabels[data.bias]}</strong> · {data.classified} klassifiziert · {data.contracts} Kontrakte{data.truncated ? " · Teilabdeckung" : ""}</p>
      <p className="form-help">Abruf {new Date(data.asOf).toLocaleString("de-DE")}{data.newestTrade ? ` · Letzte klassifizierte Ausführung ${new Date(data.newestTrade).toLocaleString("de-DE")}` : ""}</p>
      <div className="terminal-research-cards">
        {data.prints.map(print => <article className="terminal-research-card" key={print.contract}>
          <header><strong>{print.contract}</strong><span>{print.option === "call" ? "Call" : "Put"}</span></header>
          <p className="mono">{print.side === "buy" ? "Am Brief" : "Am Geld"} · {print.size} × {formatPrice(print.price)} USD</p>
          <p className="form-help">{new Date(print.time).toLocaleTimeString("de-DE")}</p>
        </article>)}
      </div>
    </>}
  </section>;
}
