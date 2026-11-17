# TEST_READY: AffenTerminal Bloomberg UI & Regression Suite

## 1. Executive Summary

The automated test infrastructure and JSDOM UI/panel test suites for **AffenTerminal** are implemented, verified, and passing after the final core and panel updates (**0 failures, 0 errors**).

- **Total Test Files**: 255 files (248 Node suites + 7 JSDOM UI suites)
- **Total Passing Tests**: 2,648 tests (2,578 Node tests + 70 JSDOM UI tests)
- **TypeScript Typecheck**: 0 errors (`pnpm typecheck` / `tsc --noEmit` under `"strict": true`)
- **Full Suite Execution Time**: 25.11s across the complete repository

---

## 2. Test Runner & Environment Configuration

### Vitest Dual-Track Architecture
- **Runner**: Vitest v3.2.7
- **Default Environment**: `"node"` configured in `vitest.config.ts` (`testTimeout: 30000`, `@` alias to repo root).
- **Component Test Environment**: `// @vitest-environment jsdom` specified at the top of each `.test.tsx` file (`jsdom` 31.0.1 + `@testing-library/react` 16.3.3).
- **DOM Test Setup (`tests/setup-dom.ts`)**:
  - Polyfills guarded for JSDOM (`typeof window !== "undefined"`): `ResizeObserver`, `window.matchMedia`, `BroadcastChannel`, `window.scrollTo`, `Element.prototype.scrollIntoView`, `HTMLElement.prototype.requestFullscreen`, `Document.prototype.exitFullscreen`, and `HTMLCanvasElement.getContext("2d")`.
  - Default `fetch` mock responses for `/api/terminal-opportunities`, `/api/terminal-fundamentals`, `/api/terminal-markets`, `/api/feeds` (`news`, `macro`, `yields`), `/api/osint-map`, `/api/stock-heatmap`, `/api/terminal-capm`, `/api/hyperliquid`, `/api/market`.
- **State Isolation**: Each `.test.tsx` calls `cleanup()` from `@testing-library/react` in `afterEach` and clears `localStorage` / resets Zustand stores (`useChartStore`, `useLinkStore`, `usePaperStore`, `useWatchlistStore`) in `beforeEach`.

---

## 3. Coverage Matrix by Tier

### Tier 1: Feature Coverage (Core Functionality & Happy Paths)
- **`tests/research-terminal-command-bar.test.tsx`**:
  - Pure `parseTerminalCommand` and `resolveOrderExecution` assertions for `SPLIT 1/2/3`, `1-PANE`/`2-PANE`/`3-PANE`, `GRID`, `PANE 1/2/3`, `CLEAR`/`CLS`/`RESET`, `QUOTE`, `DES`, `WEI`, `HELP`/`?`, and `BUY`/`SELL` order syntax.
  - End-to-end command execution (`OPPS`, `FA`, `NVDA FA`, `MSFT <GO>`, `QUOTE MSFT`, `DES NVDA`, `WEI`, `HELP`, `CLEAR`), paper order staging into `usePaperStore` (clearing stale limit `price` on subsequent market orders), and autocomplete dropdown (`ArrowDown`/`ArrowUp`, `Tab`, `Enter`, `mouseDown`).
- **`tests/research-terminal-layout.test.tsx`**:
  - Embedded (`split-2`) vs. external (`split-3`) defaults, segmented layout switching (`1-Pane`, `2-Pane`, `3-Pane`), module tab switching (`onViewChange`), and `TerminalTileHeader` view `<select>` switches across panes.
- **`tests/affen-terminal-window.test.tsx`**:
  - Header title/badges, `HH:MM:SS UTC` clock, link group radio selector (`off`, `red`, `green`, `blue`, `yellow`) with `sessionStorage` persistence check, `Chart Workspace` button (`window.open` / `window.opener.focus()`), `?ticker=` query sync, theme toggle, and macro pulse ribbon.
- **`tests/terminal-capm-panel.test.tsx`**:
  - Configuration form submission, regression statistics (`Beta`, `Jensen alpha`, `R²`, `Annual volatility`, `Model return`, `Sharpe`), and loading indicator.
- **`tests/terminal-panels.test.tsx`**:
  - Core analytical sub-panel rendering and controls across `FundamentalsPanel` (valuation, consensus ratings table, 210D quant metrics, Form 4 filings, chart open button), `OpportunitiesHub`, `OsintMapPanel`, `NewsPanel`, `HeatmapPanel` (Binance spot + GICS US Sectors), and `CalendarPanel` (`Economic`, `Earnings`, `Dividends`, `Treasury yields`, `FRED & Macro`).

### Tier 2: Boundary & Corner Cases (Input Validation & Error Handling)
- **`tests/research-terminal-command-bar.test.tsx`**:
  - Empty/whitespace input ignored; invalid syntax, unknown commands, zero/negative order quantities (`BUY AAPL 0`, `BUY AAPL -5`), and non-tradeable cash indices (`BUY ^GSPC 100`) rejected without mutating `usePaperStore`.
  - Deduplicated persisted `localStorage` command history (`affentrader-terminal-history`) across component remounts + `ArrowUp`/`ArrowDown` bounds, `Alt+K` focus, 3-step `Escape` (close dropdown -> clear input -> blur), and `F1`–`F12` hotkeys.
- **`tests/research-terminal-layout.test.tsx`**:
  - Pane unmounting in `single` / `split-2` / `split-3`, `Maximize pane` / `Restore pane`, `Close pane p2` (promoting `p3` view in `split-3` -> `split-2`), and `Close pane p3`.
- **`tests/affen-terminal-window.test.tsx`**:
  - Offline macro feed resilience without layout crash; `OpportunitiesHub` pagination (`Gruppe 1 von 2` / `Gruppe 2 von 2`, `Nächste Gruppe`, `Vorherige Gruppe`, `Gruppe 2 erneut scannen`).
- **`tests/terminal-capm-panel.test.tsx`**:
  - Strict `[-20%, 50%]` risk-free rate bounds, invalid ticker rejection (`$$$INVALID`), API errors, and stats reset on ticker or benchmark changes.
- **`tests/terminal-panels.test.tsx`**:
  - Loading placeholders, empty search/filter/table states (`No stories match.`, `No data.`, `No events match.`, `Keine Trade-Möglichkeiten für diese Filterkombination gefunden`), and `.error-message.screener-error` API error alerts.

### Tier 3 & Tier 4: Integration & Institutional Workflows
- **FA Split-Pane Preservation (`tests/research-terminal-layout.test.tsx`)**: Selecting `FA` preserves `.terminal-secondary-pane` (`GLOBAL MARKETS` in `split-2`, `MACRO CALENDAR` in `split-3`) without collapsing or duplicating FA.
- **Active Pane Focus & Routing (`tests/research-terminal-layout.test.tsx`)**: Focus tracking via click, `Ctrl+1/2/3`, `Tab`, and `PANE 1/2/3` routes subsequent commands (`NEWS`, `F10`) to the active pane; `PANE 3` auto-expands from `single` layout.
- **Cross-Panel Sync (`tests/terminal-panels.test.tsx`)**: Selecting an opportunity updates `useChartStore` and stages bracket orders into `usePaperStore`; clicking news coin chips, heatmap sectors, OSINT correlated assets, and macro cross-asset chips syncs the active chart symbol.

---

## 4. Test File Inventory

| Path | Tiers Covered | Tests | Status |
|---|---|---|---|
| `tests/research-terminal-command-bar.test.tsx` | T1, T2, T3, T4 | 20 | PASS |
| `tests/affen-terminal-window.test.tsx` | T1, T2, T3, T4 | 14 | PASS |
| `tests/research-terminal-layout.test.tsx` | T1, T2, T3, T4 | 13 | PASS |
| `tests/terminal-capm-panel.test.tsx` | T1, T2, T3, T4 | 11 | PASS |
| `tests/terminal-panels.test.tsx` | T1, T2, T3, T4 | 7 | PASS |
| `tests/app-quality-ui.test.tsx` | T1, T2, T3 | 3 | PASS |
| `tests/orderflow-ui.test.tsx` | T1, T2, T3 | 2 | PASS |
| **JSDOM UI Component & Panel Suites (7 files)** | **All 4 Tiers** | **70** | **PASS (100%)** |
| **Node Backend & Algorithmic Suites (248 files, incl. `orderflow-regression.test.ts` [10] & `app-quality-regression.test.ts` [7])** | **Regression Suite** | **2,578** | **PASS (100%)** |
| **Combined Total (255 files)** | **Full Repository** | **2,648** | **PASS (100%)** |

---

## 5. Verification Commands

```powershell
$r = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$env:PATH = "$r\node\bin;$r\bin\fallback;$r\native\git\cmd;$r\native\git\mingw64\bin;$env:PATH"

# 1. Typecheck (Expected: 0 errors)
pnpm typecheck

# 2. Run all 7 JSDOM UI test suites (70 tests)
pnpm exec vitest run tests/research-terminal-command-bar.test.tsx tests/research-terminal-layout.test.tsx tests/affen-terminal-window.test.tsx tests/terminal-capm-panel.test.tsx tests/terminal-panels.test.tsx tests/orderflow-ui.test.tsx tests/app-quality-ui.test.tsx

# 3. Run full test suite (255 files, 2,648 tests)
pnpm test
```
