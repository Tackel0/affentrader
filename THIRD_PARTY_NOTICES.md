# Third-party notices

## Vela

Vela
Copyright (c) 2026 LuxAlgo
https://velacharts.dev

This product includes the Vela charting library, developed by LuxAlgo.

ATTRIBUTION REQUIREMENT

Any product, website, or application that displays charts rendered by this
software must show a visible attribution to the Vela project on every page or
screen where such a chart is displayed.

The library satisfies this requirement automatically: it renders an attribution
mark (the project logomark linking to the Vela project page) on the chart
itself, enabled by default. You may restyle or reposition this mark to fit your
design.

You may disable the built-in mark (renderer feature `attribution`) ONLY if you
display an equivalent visible attribution — the name "Vela" together with a
link to the project page above — elsewhere on the same page or screen, in a
place available to your users.

Removing, hiding, or obscuring the attribution without providing the
equivalent notice described above is not permitted.

This file constitutes the NOTICE file described in Section 4(d) of the Apache
License, Version 2.0: redistributions of this software, in source or binary
form, must include a readable copy of these attribution notices.

The renderer-neutral drawing alert adapter in `lib/alerts/drawing.ts` follows Vela 0.9.0 drawing geometry and native regression/VWAP formulas (LuxAlgo, 2026), adapted by Affentrader, 2026-10-25. Vela retains its Apache-2.0 license and NOTICE and its visible chart attribution.

Affentrader modifies the pinned Vela0.9.0 bundles through the reproducible `scripts/patch-vela-viewport.mjs` and `scripts/patch-vela-readout.mjs` build steps. The modifications adapt native viewport framing, bounded historical legend/data-window reads, stable indicator identities and separate plot surfaces, keyboard announcement clearing, current settings snapshots during responsive re-presentation, and settled theme-dialog presentation after synchronous host canvas restoration (Affentrader, 2026-10-27). The scripts retain upstream attribution, validate known source anchors and replace package entries safely; corresponding modification source ships in those scripts. See `docs/native-chart-type.md`, `docs/chart-appearance.md` and the preceding readout/viewport verification documents.

`lib/drawings/fibonacciPlugin.ts` extends the public Vela drawing registry at runtime. Its trend-extension line formatting follows Vela 0.9.0 (LuxAlgo, 2026); shared logarithmic construction and per-chart persistence are Affentrader additions, 2026-10-25. Native classes, painter and settings remain in use; no upstream package source is replaced.


Affentrader also modifies the six pinned Vela 0.9.0 UI bundles using `scripts/patch-vela-color-picker.mjs` (2026-10-27). `lib/chart/colorPickerEnhancement.ts` supplies exact hex entry, accessible palette navigation and opacity controls; the adapter fixes layered Escape dismissal and focus restoration. The reproducible adapter checks version and source anchors before replacing package entries and retains upstream licensing and attribution.

## PineTS and Vela-PineTS

PineTS and Vela-PineTS are licensed under AGPL-3.0. See their package LICENSE files and upstream repositories linked in README.md.

The strategy worker uses a locally modified PineTS 0.13.0 broker. The modification walks verified lower-timeframe OHLC paths through the existing order engine and extends its excursion coordinates. Copyright (C) 2026 LuxAlgo; local modifications by Affentrader, 2026-10-24, under AGPL-3.0.

Corresponding modification source and reproducible build instructions are in `scripts/pinets-magnifier-patch.mjs`, `scripts/build-strategy-runtime.mjs` and `docs/strategy-tester.md`. The generator reconstructs the original TypeScript from the installed package source map, checks every patch location, and writes the complete modified source, runtime and original license to `.generated/`. Package installation does not modify upstream files in `node_modules`.

Saved Pine alerts execute the same pinned PineTS runtime in QuickJS via `quickjs-emscripten-core` and `@jitl/quickjs-singlefile-browser-release-sync` 0.32.0 (MIT). Their original license files are included in the installed packages. Interpreter execution, provider bridges and alert adapters are in `lib/alerts/pineSandbox.ts`, `pineGuest.ts` and `pineSession.ts`; `scripts/build-pine-alert-runtime.mjs` reproduces the generated PineTS guest bundle.

The host alert adapter installs a recorded observation clock and seeded JavaScript random source inside each QuickJS context for deterministic journal replay. Observation recording, integrity verification and recovery are implemented in `lib/alerts/pineJournal.ts`; original PineTS package files remain unchanged. IndexedDB transaction tests use fake-indexeddb 6.2.6 (Apache-2.0), with its original license in the installed package.

Native strategy order-fill event hooks, observed-price live execution, preservation of order alert fields and optional live strategy callbacks are local PineTS modifications by Affentrader, 2026-10-25, under AGPL-3.0. Corresponding modification source is `scripts/pinets-alert-patch.mjs`; `scripts/build-strategy-runtime.mjs` applies strict source/version checks before rebuilding. Unmodified package files and original licenses remain in `node_modules`.

## OPNB — Open Bloomberg Terminal

The terminal CAPM regression in `lib/terminal/capm.ts` adapts `src/lib/quant.ts` from [OPNB at e98f841](https://github.com/kindermerendero/open-bloomberg-terminal/tree/e98f8410327ade867cab41447bb4c43b129a18d9). Affentrader aligns both endpoints of each return, converts the effective risk-free rate to log units and uses the existing daily data adapter.

```text
MIT License

Copyright (c) 2026 Massimo Merenda

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```


## Added Open-Source Libraries & Public Feeds (AffenTerminal)

- **fast-xml-parser** (MIT) — parses SEC EDGAR Form 4 ownership XML filings (`transactionCode="P"` open-market purchases).
- **cheerio** (MIT) — structured HTML/XML parsing for OpenInsider clusters, Finviz valuation/analyst tables, and Maritime Logistics RSS feeds.
- **yahoo-finance2** (MIT) — retrieves public Yahoo Finance `quoteSummary` valuation, recommendation trends, broker upgrade/downgrade history, and earnings surprises.
- **simple-statistics** (ISC) — statistical median valuation, regression slopes, Sortino downside deviation, Value-at-Risk (VaR 95%), and annualized volatility metrics.
- **trading-signals** (MIT) — institutional technical momentum & volatility calculations (`RSI`, `ADX`, `ATR`, `BollingerBands`, `MACD`).
- **technicalindicators** (MIT) — Money Flow Index (`MFI`), Williams %R, and automated Japanese candlestick reversal pattern detection (Hammer, Engulfing, Morning/Evening Star, Piercing Line, Tweezer Bottom, Dragonfly Doji, Shooting Star).
- **d3-geo** (ISC), **topojson-client** (ISC), **world-atlas** (ISC, Natural Earth TopoJSON) — interactive offline vector basemap for the live OSINT Maritime Oil Tanker (Digitraffic Marine AIS, CC BY 4.0), Maritime Chokepoint Sea-State (Open-Meteo Marine, CC BY 4.0), Aviation Flightradar (`adsb.lol` + OpenSky Network public state vectors), and Maritime Logistics RSS advisories.
- **Keyless Public Macro & Fundamental Feeds** — FRED CSV series (`FEDFUNDS`, `T10Y2Y`, `BAMLH0A0HYM2`, `VIXCLS`, `DCOILWTICO`), Alternative.me Crypto Fear & Greed Index, Nasdaq Public Analyst Ratings API, SEC EDGAR XBRL `companyfacts`, TradingView Public Scanner, OpenInsider, and Finviz.
