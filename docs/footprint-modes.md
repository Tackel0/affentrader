# Footprint cell volume modes

The Footprint chart now supports Bid × Ask, Total volume and Delta (Ask − Bid) through the native **Cell volume** selector. The chart catalog, native type label, bottom-panel entry and watermark use the general Footprint name rather than identifying every mode as Bid × Ask.

## Behavior

- Bid × Ask retains separate classified sell/buy quantities and side histograms.
- Total volume shows one centered `buy + sell` value per row. Its neutral histogram starts at the cell's left edge and is normalized to the largest combined row volume in that bar. Neutral coloring avoids implying that total volume is buy or sell volume.
- Delta shows one signed `buy - sell` value per row. Positive histograms extend right from the center and negative histograms left; widths use that bar's largest absolute row delta. Positive/negative text uses the configured Buy/Sell colors; zero uses the theme or custom neutral text color. All-balanced bars draw neutral zeros without dividing by zero.
- POC remains the highest **total-volume** row in all modes. Diagonal Bid/Ask imbalances and stacked zones retain their original calculations. Total/Delta rows mark Buy/Sell imbalances at the right/left edge; the native Calculation hint explains the distinction.
- The histogram switch works independently of text, POC, zones, side candles and bar statistics. The existing color controls apply to their named sides and delta signs. Histogram normalization no longer imposes a fixed quantity epsilon, so tiny valid quantities retain proportional widths.
- The visible source footer identifies both the selected mode and partial collected-trade history. Historical OHLC candle volume is not used to fabricate classified row volume. Replay continues to show actual price candles and the unavailable recorded-bid/ask-history notice.

## Persistence

`FootprintVolumeMode` is defined in `types/trading.ts`. The optional `volumeMode` preference accepts only `bid-ask`, `total` or `delta`. Original twelve-field and previous seventeen-field bags remain valid and resolve to Bid × Ask. Invalid explicitly supplied modes are rejected by strict workspace validation. The native config binding carries the choice through per-cell preferences, named layouts and backup/import without modifying the underlying trades or indicator data.

## Evidence

The full suite passes **1,350 tests across 113 files**, together with production build and TypeScript checks. Logs: `artifacts/footprint-modes-tests.log`, `footprint-modes-build.log`, `footprint-modes-typecheck.log`.

The real painter tests cover combined-volume normalization, signed left/right delta geometry, independent total-volume POC, tiny quantity proportions, zero-delta bars, inverted projection, histogram visibility, strict mode validation, legacy defaults and cell/layout/backup persistence.

Production browser verification used public Hyperliquid BTC perpetual trades:

- Desktop Delta and Total rendering, native selection and source captions: `artifacts/footprint-modes-delta.jpg`, `footprint-modes-total.jpg`, `footprint-modes-settings.jpg`.
- Delta selection, row size 10 and bar statistics retained after reload: `artifacts/footprint-modes-reload.txt`.
- At 375 × 812, Total rendering and native Delta selection with the histogram disabled; Delta and visibility retained after reload: `artifacts/footprint-modes-mobile-total.jpg`, `footprint-modes-mobile-delta.jpg`, `footprint-modes-mobile-reload.txt`.
- Delta-configured Replay rendered historical price candles and the explicit unavailable bid/ask-history notice, without delta cells or trade statistics: `artifacts/footprint-modes-replay.jpg`.
- Browser warnings/errors are recorded in `artifacts/footprint-modes-browser-errors.json`. Defaults were restored, Replay exited, Candles selected, recent view restored and the temporary viewport override removed.

This does not establish full TradingView/Vela feature or pixel parity. Complete historical executions, licensed Nasdaq real-time/US depth, price-grid precision at extreme scales and the separate older-native-candle issue remain open. Mobile chart-header overlap can still cover high price cells; it is not resolved by adding cell volume modes.
