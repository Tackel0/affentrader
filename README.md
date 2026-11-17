# Affentrader

A self-hosted charting workspace for crypto, stocks from 18 exchanges, ETFs, indices, forex and Hyperliquid perpetual futures, built with Next.js App Router, TypeScript, Tailwind CSS, Zustand, Vela 0.9.0 and Vela-PineTS 0.3.0. The interface follows the observed TradingView chart layout and design language, with its own Affentrader identity. The [parity audit](docs/tradingview-parity.md) lists every TradingView capability against what is implemented, how it was checked, and what cannot be delivered from a repository (native mobile apps, user accounts, hosted infrastructure, third-party protected scripts).

## Run

Current work prioritizes the core chart and TradingView layout: navigation, market data, indicators, drawings, watchlists and alerts. Live broker trading and social features are deferred. See the [core verification record](docs/core-functions.md) for actual tests, browser checks and remaining limits.

```powershell
pnpm install
pnpm dev
```

Open [localhost:3000](http://localhost:3000). On Windows, double-click `Start-Affentrader.cmd` to run the production build. The launcher reports the URL if Affentrader is already running. For a production build manually:

```powershell
pnpm build
pnpm start
```

Node.js 20.9 or newer is required. No exchange account, API key, or browser login is needed.

### Server key

Features that store data on, or send requests from, the server (server-side alerts, webhooks, push subscriptions, publishing scripts) require an access key. It is created on first use (or by `Start-Affentrader.cmd`, which prints it) and stored in `.data/access-key.txt`. Paste it into the **Server** field of the alert form or the Community scripts dialog. Keep `.data/` private and out of version control; it holds the key, alert rules, VAPID push keys, synced workspaces and published scripts. Set `AFFENTRADER_DATA` to move it.

If you expose the app beyond your own machine, put it behind HTTPS and an authenticating proxy: reading shared scripts and the sync endpoint are protected only by unguessable keys, not by user accounts.

## Beyond the original charting core

- **Intervals and history:** any second, minute, hour, day, week, month or tick interval (`45s`, `7m`, `3D`, `2W`, `1M`, `100T`), favourites, up to 20,000 bars of history, and session and dividend-adjustment settings for stocks.
- **Chart styles:** bars, candles, hollow, volume candles, line variants, area, HLC area, baseline, columns, high-low, Heikin Ashi, Renko, line break, range bars, Kagi, Point & Figure, footprint and TPO.
- **Analysis:** compare overlays with formulas and spreads (`{YF:AAPL}/BTCUSDT`), indicators on indicators, candlestick and chart-pattern detection, an object tree with groups, strategy analytics and retrospective intrabar audit. Optional **Bar magnifier** feeds real lower-candle paths into the broker during execution, with up to 200,000 candles and explicit coverage/fallback reporting. See [execution and reproducible runtime details](docs/strategy-tester.md#bar-magnifier).
- **Markets:** Binance spot; Hyperliquid perpetuals (`HL:BTC`, `HL:xyz:TSLA`) with real-time candles, trades, depth and footprints, covering crypto, equities, metals and indices from its builder-deployed markets; Yahoo Finance (`YF:` symbols, delayed and unofficial) for stocks on US, London, Xetra, Paris, Amsterdam, Milan, Madrid, Swiss, Stockholm, Toronto, Tokyo, Hong Kong, Shanghai, Korea, India, Australia, Singapore and São Paulo exchanges, ETFs, indices and forex. Futures are served by Hyperliquid, which is free and real time; there are no CME/ICE futures. A virtualized watchlist holds up to 1,000 symbols with flags, columns and import/export.
- **Time zones:** UTC, local, exchange time or any of 30 named zones for the time axis, crosshair and clock.
- **Overview tools:** market heatmaps (treemap by 24h volume, coloured by change), a technicals gauge (oscillators and moving averages) for the charted symbol and interval.
- **Trading simulation:** paper account with market, limit and stop orders, brackets, DOM and chart trading, a separate replay account, and a portfolio tracker. Nothing connects to a real broker.
- **Screeners and feeds:** technical screener over Binance, Hyperliquid and curated large-cap lists for 18 stock exchanges, Pine screener, news, economic, earnings and dividend calendars, treasury yields.
- **Alerts:** composite condition trees evaluated in the browser, optionally on the server with signed webhooks and Web Push. Explicit trigger frequencies, UTC expiration and dynamic watchlist membership with independent per-symbol completion are implemented; see [scheduling semantics and limits](docs/alert-scheduling.md). [Movement operators](docs/alert-movement.md) compare price or indicator lines in absolute units or percent over a chosen bar lookback, with deeper-history loading and confirmed-close support.
- **Automatic alert stops:** [durable rolling limits](docs/alert-rate-limits.md) stop regular alerts or individual watchlist members at 15 triggers in three minutes, and a whole watchlist at 1,000. The manager displays stop reasons and supports explicit whole-alert/member restarts without clearing unrelated members' state.
- **Saved Pine alerts:** [independent subscriptions](docs/pine-alerts.md) freeze source, inputs and libraries; select named `alertcondition()` signals, script-owned `alert()` calls, strategy order fills or combined calls/fills. A bounded, verified observation journal restores variables, pending orders and live-only positions after a local cold restart, with atomic delivery cursors and visible storage/runtime errors. Order fills use the native broker emulator and are labeled; they do not execute at an exchange. Recovery needs matching local journals; portable runtime backup and distributed ownership remain open.
- **Drawing alerts:** [linked drawing subscriptions](docs/drawing-alerts.md) follow native lines, enabled Fib levels/zones, channels, rectangles and Anchored VWAP. Native Fibonacci tools have optional logarithmic construction shared with alerts, plus independently persisted chart log axes. Geometry/axis edits retain trigger counts and timing gates; missing drawings or disabled targets stop visibly. Browser/server calculations share matching prior price/geometry observations and authenticated geometry updates reject stale revisions.
- **Multiple browser tabs:** [exclusive browser alert ownership](docs/browser-alert-ownership.md) gives one main tab responsibility for alert evaluation and notifications, with automatic takeover when it leaves. Standby tabs can edit through serialized, atomic alert writes. Older drawing revisions are rejected rather than adopted silently.
- **Chart trading:** red Sell / blue Buy legend controls stage a fresh market ticket for the clicked chart. Native Trading settings control visibility and optional instant paper placement, with quantity entry and Replay separation; see [behavior and limits](docs/chart-trading.md).
- **Reverse positions:** chart, table and DOM controls submit one double-size opposite market order. Post-fill margin checks, protective-exit cancellation, changed-position guards and storage rollback are covered; Replay stays local. See [position management](docs/paper-trading.md#reverse-position).
- **Entry exit levels:** new order tickets and working-entry editors prepare up to four independently sized OCO exits, persisted with pending orders and activated on fill. Applying settings is separate from submitting an order. Legacy accounts migrate on their next serialized write to a guarded format; see [entry exits](docs/entry-exit-levels.md).
- **Position protection:** chart/table/DOM TP/SL dialogs configure up to four independently sized OCO exit levels on an open position, with coverage, replacement review, stale-order guards and atomic rollback. See [position protection](docs/position-protection.md).
- **Partial position closes:** with instant placement off, chart/table/DOM close controls preview the quantity, execution, fees and remaining exposure. Partial closes retain entry orders and cap protection, with changed-position guards and atomic rollback. See [reviewed closes](docs/paper-trading.md#reviewed-full-and-partial-position-closes).
- **Modify working orders:** chart, table and DOM editors change limit/stop prices, quantity and entry brackets with stale-revision/context guards, atomic persistence and immediate matching. Working chart lines now have direct edit/cancel controls; dragging proposes a price for review, including separate stop/limit legs. Protective OCO quantities stay paired; reduce-only exits recheck remaining exposure. See [order modifications](docs/paper-trading.md#working-order-modifications).
- **Paper trading across tabs:** [one live matcher and serialized account commands](docs/paper-trading.md) preserve fills, OCO brackets and cancellations across concurrent tabs. Replay accounts and tickets remain local; historical order times and incremental forming-bar matching avoid reusing earlier extrema for newer Replay orders. Tickets and fill history distinguish public prices, offline simulation and synthetic Replay; older fills retain unknown provenance. Fresh matching depth executes buys at ask and sells at bid, displays the spread, and marks long/short positions on the liquidation side; absent depth explicitly uses the last/bar-price model. Fill price bases are stored separately from feed provenance. Matching details distinguish local preparation from waiting and expose browser-reported access counts without assuming another holder is processing fills.
- **Alert lifetime:** [durable activity tracking](docs/alert-lifecycle.md) expires inactive browser/server subscriptions after over a year without saved edits or triggers. Legacy alerts receive a tracking grace period; expiry is checked again before delayed results can notify, and the manager explains how to renew an alert.
- **Sharing:** cross-device workspace sync via a secret key, community script library (public or invite-only), pop-out windows linked by colour group, and an installable PWA.

Known limits: Hyperliquid keeps only the latest 5,000 candles per interval, and tick-bar history is built from the live stream because only Binance offers trade backfill; Yahoo markets stream no trades, so depth, time & sales and footprints exist on Binance and Hyperliquid only; tick, range and Renko axes count bars rather than time; the server alert loop polls every 15 s and evaluates Binance, Hyperliquid and Yahoo markets (Yahoo data is delayed); Yahoo intraday history is limited by the provider; push notifications need HTTPS or localhost; sync, the script library and server alerts work through this server only.

## Core capabilities

Chart snapshots open a frozen preview before PNG download, with active-chart or visible-layout scope. Multi-chart PNGs preserve up to eight visible chart cells, with separate source/symbol/interval headers and a common UTC capture time. The image includes working-order price/quantity labels; Replay and synthetic inputs remain identified. Snapshot images stay out of local preferences and workspace backups. See [snapshot behavior and limits](docs/chart-snapshots.md).

- A compact single top toolbar, light/dark themes, matching chart colors and typography, dense watchlist rows, drawing rail, utility rail and a resizable details sidebar.
- Seven layouts from one to eight independent charts, active-pane toolbar routing, maximizing/restoring panes, and selectable symbol/interval/crosshair/time-range synchronization. Chart histories and classified trades are isolated by symbol.
- Named layout snapshots and indicator templates, persisted locally and included in validated workspace backup files. Default state can be exported before any LocalStorage keys exist.
- Actual Vela Bar Replay: historical start/seek, single stepping, play/pause, five speeds and exit to live mode. Study recomputation uses Vela's native replay pipeline; replay does not synthesize historical order flow or trigger Pine live signals.
- Searchable access to the installed Vela drawing catalog, PNG chart snapshots and OHLCV CSV exports from the active chart.
- A functional Pine strategy tester in a dedicated worker: Binance, Hyperliquid and Yahoo historical adapters; provider currencies, contract point values and explicit tick/quantity overrides; custom time intervals; configurable capital, size, margin, pyramiding, slippage and commissions; frozen history; equity/drawdown curves, analytics, report comparison, trade/chart links and CSV/JSON exports. Provider history caps, estimated rules, missing funding and session-close precision are disclosed. See [strategy tester semantics](docs/strategy-tester.md).
- Native responsive Vela canvas, pan/zoom, crosshair readouts and a Zustand crosshair synchronization channel.
- Twenty chart types, from candles and Heikin Ashi to Renko, Kagi, Point & Figure, Bid × Ask footprint and TPO (see the list above).
- All studies exposed by the installed Vela native catalog, with multiple instances where supported, persistent inputs, source selection, visibility, colors and line widths. Ichimoku runs through PineTS.
- An actual PineTS Web Worker, Pine v5/v6 editor, file import/export, user library registration through the official `importResolver`, runtime diagnostics and separately saved Pine alert subscriptions.
- Original, executable example scripts for structure/BOS, previous-candle order-block zones, FVGs, liquidity sweeps, k-NN momentum, Ichimoku and an EMA crossover.
- Public Binance historical REST data through a constrained Next.js route, combined trade/24-hour quote/depth WebSocket streams, exponential reconnect, trade-ID deduplication, stale-stream recovery and labeled offline simulation.
- Any second, minute, hour, day, week, month or tick interval, aggregated live from trades (or from candles on markets without a trade stream).
- Multiple named watchlists, create/rename/delete, drag ordering, price/change sorting, remove/add symbols, debounced exchange symbol search, categories, price pulses and recent tick sparklines.
- Price alerts: crossing, crossing up/down and entering/exiting band; Only once / Every time policies; technical rules also support once per bar, confirmed close or rolling minute. UTC expiration, pause/edit/delete, persistent trigger logs, visible threshold lines, chime, toast and optional browser notifications are included. Existing transition/close records retain their settings.
- Click or right-click the price scale to start an alert at that price.
- Native trendlines, horizontal rays, Fibonacci retracement, risk/reward positions, anchored VWAP, fixed-range profiles, undo/redo and per-symbol persisted drawings.
- Full native drawing rail: 79 registered tools in seven groups, a searchable catalog, floating favorites, magnet/stay modes, measure/eraser, native style settings and named templates. Preferences survive reload and workspace import; symbol archives retain complete provider-prefixed IDs. Bottom panels use a single-line strip with keyboard-accessible overflow. See [drawing workspace details](docs/drawing-workspace.md).
- [Date navigation](docs/chart-navigation.md) offers 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y and All with reference-matched standard intervals, a chart-zone date/custom-range dialog with explicit DST occurrence selection and Alt+G. Native dense framing fits the bounded loaded series; recent-view reset preserves the interval and revealed Replay cursor. All loads as many bars as the venue serves, up to 20,000 (Hyperliquid serves at most 5,000 per interval); this remains a bounded provider history window.
- Local workspace persistence and validated JSON backup import/export, including imported Pine libraries.

## Data semantics

For Binance spot (quoted in USDT) and Hyperliquid perpetuals (quoted in USD) the live source streams individual trades. Aggressor buy volume comes from trades whose buyer is not the maker; aggressor sell volume comes from trades whose buyer is the maker. Exchange depth is independent of trade classification.

Footprints, session profiles and CVD use the latest **5,000 classified trades per monitored symbol collected in this connection**. They do not invent historical bid/ask volume from OHLCV. CVD starts at the first collected bar. Footprint rows use diagonal 3:1 imbalances and adapt their price bucket size to the visible range. The active chart zooms to recent candles when entering footprint mode. Every chart's Pine `request.footprint()` receives its own classified levels through the shared bridge adapter. Replay only uses order-flow records at or before its historical cursor; unavailable historical footprints remain absent.

The native visible/fixed-range volume profiles distribute OHLCV volume and are estimates; the separate session profile uses actual collected trades. TPO counts unique 30-minute periods whose observed bar ranges cover a price row, grouped by UTC day. It uses chart bars of 15 minutes or finer, automatically switching coarser intervals to 15m.

Simulation is synthetic, uses seed prices, and is marked per chart, in quote details, the footer and alert logs. Select the data mode in Main menu. Auto mode allows an initial connection grace period and never invents trades for an idle symbol while the exchange socket is healthy. Its synthetic high/low/change/volume statistics describe the simulated session. Historical real and simulated series are reset when their source changes, and alerts seed a new comparison sequence at that boundary. The service can display collected real candles if streaming works while historical REST is unavailable. An unavailable secondary series requested by a live script stays empty instead of silently becoming synthetic. No synthetic order book is presented as exchange depth.

Browser alerts run only while the tab is open. Server-side alerts (Binance, Hyperliquid and Yahoo markets) keep running while the server process runs, but this is a single local process, not a hosted, redundant notification service. Sound requires a user gesture, and operating-system notifications require the browser’s permission. Logs retain the most recent 200 triggers. Collected trades are session-only; workspace preferences, drawings, libraries, watchlists and alerts persist in LocalStorage.

## Pine compatibility and study provenance

The included structure, order-block-zone, FVG, liquidity and k-NN scripts are original Affentrader implementations. They are not the proprietary LuxAlgo SMC or paid indicator products. To use a LuxAlgo script, import/paste its available source and register any `Author/Library/Version` dependencies in **Pine editor → Manage Pine libraries**. PineTS compatibility determines which Pine features execute; arbitrary protected or unavailable source cannot be reproduced by a charting bridge.

The k-NN example uses RSI distance to classify historical next-bar outcomes; the training samples begin two bars back. Swing structure confirms pivots after the configured right-hand bars. The ZigZag’s unfinished leg and Ichimoku’s displaced plots retain their normal indicator semantics.

## Architecture

| Path                                                   | Responsibility                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `types/trading.ts`                                     | Complete shared market, watchlist, study, orderflow and alert contracts                     |
| `stores/`                                              | Persisted chart/workspace, watchlist and alert state                                        |
| `types/workspace.ts`, `stores/useWorkspaceStore.ts`    | Multi-chart configuration, synchronization, named templates, appearance and replay commands |
| `components/ChartGrid.tsx`, `components/ReplayBar.tsx` | Independent Vela instances and real native replay controls                                  |
| `lib/chart/`                                           | Shared theme and per-canvas market context                                                  |
| `lib/indicators/engineOptions.ts`                      | Identical Pine import/footprint adapters for every chart                                    |
| `lib/market/`                                          | Feed lifecycle, aggregation and simulation                                                  |
| `app/api/market/route.ts`                              | Allowlisted public exchange REST proxy                                                      |
| `lib/alerts/`                                          | Pure condition evaluator and browser notification/audio adapters                            |
| `lib/orderflow/`                                       | Classified-trade math and Vela native renderer plugins                                      |
| `lib/indicators/`                                      | Native study definitions and complete Pine sources                                          |
| `hooks/useVelaChart.ts`                                | Chart lifecycle, engine registration, studies, drawing persistence and scale interaction    |
| `hooks/useMarketData.ts`                               | Shared subscription orchestration and alert pipeline                                        |
| `components/`                                          | Application shell, watchlists, search, alerts, settings and Pine editor                     |
| `lib/workspace.ts`                                     | Workspace backup validation before writing persistent state                                 |
| `lib/ta/`, `lib/patterns/`, `lib/screener/`            | Pure indicator, pattern and screener logic shared by the browser, workers and server        |
| `lib/market/`, `lib/chart/`                            | Intervals, aggregation, Yahoo and Binance loading; chart styles, transforms, overlays       |
| `lib/trading/`, `lib/portfolio.ts`                     | Paper broker (orders, brackets, path-walking fills) and portfolio maths                     |
| `lib/server/`, `instrumentation-node.ts`               | Durable JSON storage, alert runner, webhooks, push, sync and script-library back end        |
| `app/api/`                                             | Market, Yahoo, feeds, screener, alerts, push, sync and library routes                       |
| `lib/windowScope.ts`, `hooks/useWindowLink.ts`         | Pop-out windows, per-window storage, colour-group linking                                   |

## Verification

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Verification commands above run the current suite; exact dated counts and browser evidence are recorded in `artifacts/verification.md`. Coverage includes technical indicators, chart transforms, compare formulas, patterns, alert rules and server evaluation, webhooks, push, sync, the script library, paper trading, DOM, portfolios, screeners, feeds, drawings, strategy analytics, multi-market strategy currencies/multipliers and window linking. The actual PineTS runtime is exercised for bundled scripts, library imports, order fills and strategy reports. Passing this suite does not establish full TradingView/Premium equivalence; the parity audit keeps the remaining work explicit.

## Upstream and attribution

- [Vela source and documentation](https://github.com/luxalgo/vela) — Apache-2.0, attribution retained on every chart and in the footer. The upstream notice is included in `THIRD_PARTY_NOTICES.md`.
- [Vela-PineTS](https://github.com/LuxAlgo/Vela-pinets) and [PineTS](https://github.com/LuxAlgo/PineTS) — AGPL-3.0.
- [Binance spot market streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams) and [public market-data endpoints](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints).

This application provides the implemented charting workspace; it does not reproduce TradingView’s proprietary infrastructure, brokerage integrations or private script catalog.
