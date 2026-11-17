"use client";
import { openTpoFollowingAlert, openTpoSnapshotAlert, useChartReadout } from "@/hooks/useChartReadout";
import { useChartStore } from "@/stores/useChartStore";
import { describeSymbol } from "@/lib/symbols";
import { FootprintInspector } from "./FootprintInspector";
const depthQuantity = new Intl.NumberFormat("en-US", { useGrouping: false, maximumSignificantDigits: 15 });

export function DataWindow() {
  const view = useChartReadout();
  const indicators = useChartStore(state => state.indicators);
  if (!view) return <section className="data-window" aria-label="Chart data window"><p role="status" className="form-help">Loading chart data…</p></section>;
  const about = describeSymbol(view.symbol), readout = view.readout;
  return <section className="data-window" aria-label="Chart data window">
    <header><strong>{about.title}</strong><span className="muted">{view.timeframe} · {about.venue}</span></header>
    <p className="data-window-context">{view.replay ? "REPLAY · " : ""}{view.zone}</p>
    {view.status !== "ready" || !readout ? <p className="form-help" role="status">{
      view.status === "recovering" ? "Waiting for uninterrupted candle history." : view.status === "error" ? "Chart data is unavailable while history has an error."
        : view.status === "loading" ? "Loading chart data…" : "Move the crosshair over a loaded candle to inspect its values."}</p> : <>
      <dl className="data-window-values"><div><dt>Date</dt><dd>{readout.date || "—"}</dd></div><div><dt>Time</dt><dd>{readout.time || "—"}</dd></div></dl>
      {readout.ohlc && <dl className={`data-window-values data-window-ohlc ${readout.ohlc.up ? "positive" : "negative"}`}>
        {[["Open", readout.ohlc.o], ["High", readout.ohlc.h], ["Low", readout.ohlc.l], ["Close", readout.ohlc.c], ...(readout.ohlc.vol !== undefined ? [["Volume", readout.ohlc.vol]] : [])].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}
      </dl>}
      {view.footprint && <section className="data-window-study data-window-footprint" aria-label="Footprint values">
        <h3>Footprint</h3>
        <p className="form-help" role="status">{view.footprint.message}</p>
        {!!view.footprint.rows.length && <dl className="data-window-values">{view.footprint.rows.map(row =>
          <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
        <FootprintInspector target={view.footprint.inspectionTarget}/>
      </section>}
      {view.depth === null && <section className="data-window-study" aria-label="Liquidity heatmap coverage">
        <h3>Liquidity heatmap</h3>
        <p className="form-help">No order-book sample for this candle.</p>
      </section>}
      {view.depth && view.depth.bid === undefined && <section className="data-window-study" aria-label="Liquidity heatmap coverage">
        <h3>Liquidity heatmap</h3>
        <p className="form-help">No sampled liquidity at the crosshair price. The latest sample spans {view.depth.lowest} to &lt; {view.depth.highest}, with possible gaps between rows.</p>
        <dl className="data-window-values">
          <div><dt>Received (UTC)</dt><dd>{new Date(view.depth.receivedAt).toISOString()}</dd></div>
          {view.depth.topBid && <div><dt>Highest bid row</dt><dd>{view.depth.topBid.lower} to &lt; {view.depth.topBid.upper}</dd></div>}
          {view.depth.topBid && <div><dt>Bid row quantity</dt><dd>{depthQuantity.format(view.depth.topBid.bid)}</dd></div>}
          {view.depth.topAsk && <div><dt>Lowest ask row</dt><dd>{view.depth.topAsk.lower} to &lt; {view.depth.topAsk.upper}</dd></div>}
          {view.depth.topAsk && <div><dt>Ask row quantity</dt><dd>{depthQuantity.format(view.depth.topAsk.ask)}</dd></div>}
        </dl>
      </section>}
      {view.depth && view.depth.bid !== undefined && <section className="data-window-study" aria-label="Liquidity heatmap values">
        <h3>Liquidity heatmap</h3>
        <p className="form-help">Latest observed sample in the selected candle at the crosshair price. The display interval is capped at three seconds.</p>
        <dl className="data-window-values">
          <div><dt>Received (UTC)</dt><dd>{new Date(view.depth.receivedAt).toISOString()}</dd></div>
          <div><dt>Displayed until (UTC)</dt><dd>{new Date(view.depth.displayedUntil).toISOString()}</dd></div>
          <div><dt>Price row</dt><dd>{view.depth.lower} to &lt; {view.depth.upper}</dd></div>
          <div><dt>Bid quantity</dt><dd>{depthQuantity.format(view.depth.bid)}</dd></div>
          <div><dt>Ask quantity</dt><dd>{depthQuantity.format(view.depth.ask)}</dd></div>
        </dl>
      </section>}
      {readout.groups.filter(group => group.rows.length).map((group, index) => {
        const instance = indicators.find(indicator => view.indicatorIds?.[indicator.id] === group.id);
        const title = `${group.name}${typeof instance?.inputs.length === "number" ? ` (${instance.inputs.length})` : ""}`;
        return <section className="data-window-study" key={group.id ?? `${index}-${group.name}`} aria-label={title}>
          <h3>{title}</h3><dl className="data-window-values">{group.rows.map((row, rowIndex) => <div key={`${rowIndex}-${row.label}`}><dt><i style={{ backgroundColor: row.color }} />{row.label}</dt><dd>{row.value || "—"}</dd></div>)}</dl>
        </section>;
      })}
      {view.sessionProfiles?.map(profile => <section className="data-window-study data-window-profile" key={profile.id} aria-label={profile.title}>
        <h3>{profile.title}</h3><p className="form-help" role="status">{profile.message}</p>
        {!!profile.rows.length && <dl className="data-window-values">{profile.rows.map(row =>
          <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
      </section>)}
      {view.visibleProfiles?.map(profile => <section className="data-window-study data-window-profile" key={profile.id} aria-label={profile.title}>
        <h3>{profile.title}</h3><p className="form-help" role="status">{profile.message}</p>
        {!!profile.rows.length && <dl className="data-window-values">{profile.rows.map(row =>
          <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
      </section>)}
      {view.tpoOverlays?.map(profile => <section className="data-window-study data-window-profile" key={profile.id} aria-label={profile.title}>
        <h3>{profile.title}</h3><p className="form-help" role="status">{profile.message}</p>
        {!!profile.rows.length && <dl className="data-window-values">{profile.rows.map(row =>
          <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
      </section>)}
      {view.footprintOverlays?.map(profile => <section className="data-window-study data-window-profile" key={profile.id} aria-label={profile.title}>
        <h3>{profile.title}</h3><p className="form-help" role="status">{profile.message}</p>
        {!!profile.rows.length && <dl className="data-window-values">{profile.rows.map(row =>
          <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
        {profile.inspectionTarget && <FootprintInspector target={profile.inspectionTarget}/>}
      </section>)}
      {view.tpo && <section className="data-window-study data-window-profile" aria-label="TPO session values">
        <h3>TPO / Market Profile</h3><p className="form-help" role="status">{view.tpo.message}</p>
        {view.tpo.status === "ready" && !view.replay && <div className="tpo-alert-actions"><button className="button" type="button" onClick={openTpoFollowingAlert}>Follow latest completed TPO…</button></div>}
        {!!view.tpo.alertCandidates?.length && <>
          <p className="form-help">Create an alert on a fixed completed-profile price. New profiles do not update the threshold.</p>
          <div className="tpo-alert-actions">{view.tpo.alertCandidates.map(candidate => <button type="button" className="button" key={candidate.level}
            onClick={() => openTpoSnapshotAlert(candidate)}>Alert on {candidate.level.toUpperCase()} snapshot</button>)}</div>
        </>}
        {!!view.tpo.rows.length && <dl className="data-window-values">{view.tpo.rows.map(row =>
          <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
      </section>}
      <p className="form-help">Values follow the crosshair. Off the plot, the latest chart bar is shown.</p>
    </>}
  </section>;
}
