# AffenTerminal Testing Infrastructure & Dual-Track Methodology

## 1. Overview & Architecture

The AffenTerminal testing framework implements a **Dual-Track Testing Methodology** combining fast backend/algorithmic validation in Node.js with React DOM component and integration testing in JSDOM.

```
+-----------------------------------------------------------------------------+
|                      AffenTerminal Test Infrastructure                      |
+-----------------------------------------------------------------------------+
                                       |
        +------------------------------+------------------------------+
        |                                                             |
        v                                                             v
+-------------------------------+             +-------------------------------+
|     Track A: Node Runtime     |             |     Track B: JSDOM Runtime    |
| (248 test files / 2,578 tests)|             |  (7 UI test files / 70 tests) |
| - Mathematical algorithms     |             | - Terminal Command Bar & Orders|
| - SEC XML / XBRL parsers      |             | - Multi-Pane Layout & Headers |
| - Pine / Vela runtime engines |             | - AffenTerminal Window Shell  |
| - API route handlers          |             | - CAPM Regression Panel       |
| - Command & order parsers     |             | - Analytical Sub-Panels (6)   |
| - Orderflow & security gates  |             | - OrderFlow & Footprint UI    |
+-------------------------------+             +-------------------------------+
        |                                                             |
        +------------------------------+------------------------------+
                                       |
                                       v
                     +-----------------------------------+
                     |      Vitest Runner v3.2.7         |
                     | - Node environment by default     |
                     | - Per-file `// @vitest-env jsdom` |
                     | - Per-test `cleanup()` isolation  |
                     +-----------------------------------+
```

### Performance & Isolation Invariant
- **Default Environment**: `"node"` in `vitest.config.ts`. The 248 Node test files run strictly in Node.js with `tests/setup-dom.ts` guarded behind `if (typeof window !== "undefined")`.
- **Component Environment**: Specified explicitly per-file via `// @vitest-environment jsdom` at the top of each `.test.tsx` file (`jsdom` 31.0.1 + `@testing-library/react` 16.3.3).
- **Cleanup & Storage Isolation**: Because `vitest.config.ts` does not enable `globals: true`, every `.test.tsx` suite explicitly invokes `cleanup()` in `afterEach` and clears `localStorage`/`sessionStorage` (including `affentrader-terminal-history`) plus Zustand stores in `beforeEach`.
- **Path Aliasing**: `@/` maps to the repository root directory.

---

## 2. Dual-Track Four-Tier Test Coverage Matrix

### Tier 1: Feature Coverage (Core Functionality & Happy Paths)
- **Terminal Command Bar & Parser (`tests/research-terminal-command-bar.test.tsx`)**:
  - Single-token and two-token Bloomberg commands (`OPPS`, `FA`, `DES`, `QUOTE`, `WEI`, `HELP`, `MACRO`, `NEWS`, `HEATMAP`, `OSINT`, `MARKETS`, `COMPARE`, `CAPM`, `AAPL <GO>`, `NVDA FA`, `TSLA CAPM`).
  - Layout & pane commands (`SPLIT 1/2/3`, `1-PANE`/`2-PANE`/`3-PANE`, `GRID`, `PANE 1/2/3`, `CLEAR`/`CLS`/`RESET`).
  - Paper Trading order staging (`BUY`/`SELL <TICKER> [QTY] [@ PRICE]` and ticker-first syntax) via `usePaperStore`.
  - Autocomplete dropdown (`role="listbox"` / `role="option"`) filtering plus `ArrowDown`/`ArrowUp`, `Tab`, `Enter`, and `mouseDown` selection.
- **Multi-Pane Workspace Layout (`tests/research-terminal-layout.test.tsx`)**:
  - Layout switching via segmented buttons (`1-Pane`, `2-Pane`, `3-Pane Grid`) and `SPLIT` / `PANE` commands.
  - `TerminalTileHeader` per-pane `<select>` view switchers, `Maximize pane` / `Restore pane`, and `Close pane` (`p2` promotion from `p3`, `p3` -> `split-2`).
- **AffenTerminal Window Shell (`tests/affen-terminal-window.test.tsx`)**:
  - Header brand badge, live `HH:MM:SS UTC` clock, link group radio selector (`off`, `red`, `green`, `blue`, `yellow`), Light/Dark theme toggling, `Chart Workspace` button (`window.open` / `window.opener.focus()`), `?ticker=` query parameter initialization, and macro pulse ribbon.
- **CAPM Panel (`tests/terminal-capm-panel.test.tsx`)**:
  - Ticker, benchmark, and risk-free rate submission plus regression output (`Beta`, `Jensen alpha`, `R²`, `Annual volatility`, `Model return`, `Sharpe`).
- **Analytical Sub-Panels (`tests/terminal-panels.test.tsx`)**:
  - Realistic mocked fetch rendering and interactions across `FundamentalsPanel`, `OpportunitiesHub`, `OsintMapPanel`, `NewsPanel`, `HeatmapPanel`, and `CalendarPanel`.

### Tier 2: Boundary & Corner Cases (Edge Conditions & Error Handling)
- **Order & Input Validation**:
  - Empty/whitespace commands ignored; unrecognized tokens and malformed tickers (`$$$ FA`, `BUY ???`) surface inline errors without crashing.
  - Non-tradeable cash indices (`BUY ^GSPC 100`) rejected cleanly via `resolveOrderExecution` without mutating `usePaperStore.getState().ticket`.
  - Zero/negative order quantities (`BUY AAPL 0`, `BUY AAPL -5`) rejected cleanly.
  - CAPM annual risk-free rate strictly bounded to `[-20, 50]` (`−25%` / `55%` rejected).
- **Keyboard, History & DOM Resilience**:
  - Persistent deduplicated `localStorage` command history (`affentrader-terminal-history`) + `ArrowUp`/`ArrowDown` boundary clamping across component remounts.
  - Global `Alt+K` input focus, 3-stage `Escape` (close autocomplete -> clear text -> blur input), and `F1`–`F12` Bloomberg hotkeys (including `F12` fullscreen toggle via `requestFullscreen` / `exitFullscreen` polyfills).
  - Clean loading placeholders, empty filter results (`No stories match.`, `No events match.`, `No data.`), and `.error-message.screener-error` alerts on API failures across all sub-panels.

### Tier 3: Cross-Feature Integration (State Synchronization & Lifecycle)
- **FA View Split-Pane Preservation**:
  - Switching primary pane `P1` to `FA` preserves `.terminal-secondary-pane` with `GLOBAL MARKETS` in `split-2` and `MACRO CALENDAR` in `split-3` rather than collapsing multi-pane or duplicating FA.
- **Active Pane Focus & Command Routing**:
  - Focus switching via tile click, `Ctrl+1/2/3`, `Tab` (outside editable fields), and `PANE 1/2/3` commands updates `.active-pane` and routes subsequent commands (`NEWS`, `F10`) specifically to the focused pane.
- **Cross-Panel Store Synchronization**:
  - Clicking opportunities (`OpportunitiesHub`), market chips (`CalendarPanel` / `AffenTerminalWindow`), coin chips (`NewsPanel`), treemap sectors (`HeatmapPanel`), or correlated OSINT assets (`OsintMapPanel`) synchronizes `useChartStore` and callbacks; staging bracket orders populates `usePaperStore`.

### Tier 4: Real-World Scenarios
- End-to-end Bloomberg workflows: command bar -> autocomplete order staging -> layout expansion -> `Ctrl+2`/`Ctrl+3` active-pane navigation -> maximized tile inspection -> European `SAP.DE` / `xetra` CAPM calculation -> multi-panel screening and macro calendar inspection.

---

## 3. Test File Layout

```
tests/
├── setup-dom.ts                              # JSDOM polyfills (ResizeObserver, matchMedia, BroadcastChannel, scrollIntoView, Fullscreen API) & terminal API mocks
├── research-terminal-command-bar.test.tsx    # Tier 1-4 tests (20 tests): commands, orders, ^GSPC rejection, autocomplete, history, Alt+K/Escape/F1-F12
├── research-terminal-layout.test.tsx         # Tier 1-4 tests (13 tests): 1/2/3-pane grids, FA split preservation, tile headers, maximize/close, active-pane routing
├── affen-terminal-window.test.tsx            # Tier 1-4 tests (14 tests): shell header, UTC clock, link groups, ?ticker= sync, Chart Workspace button, pulse ribbon
├── terminal-capm-panel.test.tsx              # Tier 1-4 tests (11 tests): CAPM form, stats, validation bounds, loading/reset/error states, SAP.DE workflow
├── terminal-panels.test.tsx                  # Tier 1-4 tests (7 tests): FundamentalsPanel, OpportunitiesHub, OsintMapPanel, NewsPanel, HeatmapPanel, CalendarPanel
├── orderflow-ui.test.tsx                     # OrderFlowPanel & FootprintInspector JSDOM UI regression (2 tests): rows, diagonal ratios, non-looping autoFollow, Footprint/TPO toggles
├── app-quality-ui.test.tsx                   # App quality UI regression (3 tests): FundamentalsPanel initialTicker reload, OsintMapPanel abort/502, TradingWorkspace Ctrl+/ guard
├── orderflow-regression.test.ts              # Orderflow & Footprint engine regression (10 tests): fractional exhaustion, trapped participants, flat-plateau delta div, stripVenue, sub-cent signal step, Replay clipping, log-scale text, sub-minute magnifier, surface coalescing, row metrics
└── app-quality-regression.test.ts            # Reverse-proxy security & server resilience (7 tests): proxy.ts HTTPS/Host/PUBLIC_PWA_PATHS, /api/alpaca origin, accessKey/JsonStore concurrency, setBoundedCache, mergeAnalystConsensus, decodeEntities, tvCache non-poisoning, API error fallbacks
```

---

## 4. Execution & Verification Commands

Run all commands in PowerShell with the Windows Codex runtime PATH prefix:

```powershell
$r = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$env:PATH = "$r\node\bin;$r\bin\fallback;$r\native\git\cmd;$r\native\git\mingw64\bin;$env:PATH"

# 1. Verify strict TypeScript compilation (0 errors)
pnpm typecheck

# 2. Run all 7 JSDOM UI component & panel test suites (70 tests)
pnpm exec vitest run tests/research-terminal-command-bar.test.tsx tests/research-terminal-layout.test.tsx tests/affen-terminal-window.test.tsx tests/terminal-capm-panel.test.tsx tests/terminal-panels.test.tsx tests/orderflow-ui.test.tsx tests/app-quality-ui.test.tsx

# 3. Run full test suite (255 files, 2,648 tests)
pnpm test
```
