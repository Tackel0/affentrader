import type { TimeSalesCluster } from "@/types/trading";
import { timeSalesClusterPage } from "@/lib/orderflow/timeSalesClusters";

export function TapeClusterTable({ rows, page, onPage }: { rows: readonly TimeSalesCluster[]; page: number; onPage(page: number): void }) {
  const view = timeSalesClusterPage(rows, page);
  return <>
    <div className="filtered-tape-table tape-cluster-table"><table aria-label="Observed tape clusters"><thead><tr>
      <th>UTC window start</th><th>Observations</th><th>Underlying prints</th><th>Buy qty</th><th>Sell qty</th><th>Delta</th><th>Low</th><th>High</th><th>Weighted price</th>
    </tr></thead><tbody>{view.rows.map(row => <tr key={row.start}>
      <td title={`Exclusive end ${new Date(row.end).toISOString()}; observed ${new Date(row.first).toISOString()} to ${new Date(row.last).toISOString()}`}>{new Date(row.start).toISOString()}</td>
      <td title={`${row.buys} buy observations / ${row.sells} sell observations`}>{row.count}</td><td title="Sum of provider counts when known for every observation">{row.underlyingTradeCount ?? "—"}</td><td className="positive">{row.buyQuantity}</td><td className="negative">{row.sellQuantity}</td>
      <td className={row.delta === "0" ? "" : row.delta.startsWith("-") ? "negative" : "positive"}>{row.delta}</td><td>{String(row.low)}</td><td>{String(row.high)}</td>
      <td>{row.weightedPrice?.toLocaleString("en-US", { maximumSignificantDigits: 12 }) ?? "—"}</td>
    </tr>)}</tbody></table></div>
    {!rows.length && <p className="form-help">No observed clusters match these execution filters. Missing windows are unknown.</p>}
    <div className="tape-pagination"><button className="button small" type="button" disabled={!view.page} onClick={() => onPage(view.page - 1)}>Previous clusters</button>
      <span>Page {view.page + 1} of {view.pages} · 100 clusters per page</span><button className="button small" type="button" disabled={view.page + 1 >= view.pages} onClick={() => onPage(view.page + 1)}>Next clusters</button></div>
  </>;
}
