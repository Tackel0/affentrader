# Handoff Report: AffenTerminal UI Architecture & Visual Presentation Survey

## Executive Summary
This survey maps the current UI architecture, visual styling, layout constraints, and aesthetic flaws of AffenTerminal in the `affentrader` codebase. The existing codebase possesses a solid functional foundation (11 modules, command bar, multi-pane splitting, headless Chrome E2E test suite, 2552 passing tests, 0 TypeScript errors). However, its visual presentation exhibits significant "AI-slop" characteristics: pill-shaped bubble chips (`border-radius: 999px`), inconsistent corner roundings (4px to 8px), generic lavender/purple web-SaaS accents (`#9695ff`, `#7775e8`), verbose tutorial-style text blurbs between controls, low data density (~8–12 table rows per screen), and layout shifts caused by flex wrapping and an aggressive 1120px media query collapse. A transformation toward an institutional Bloomberg Terminal / OpenBB standard (pitch black/charcoal canvas, sharp hairline dividers, amber `<GO>` command bar, cyan/green/amber telemetry, monospace tabular numbers, dense pane tiles) is cleanly achievable without breaking existing routes or test assertions.

---

## 1. Observation

### 1.1 Page Routes and Workspace Integration
- **Standalone Terminal Route:**
  - File: `app/terminal/page.tsx:1-44`
  - URL: `/terminal` supporting query parameters: `?view=` (validated against `VALID_VIEWS` in lines 8-20: `opps`, `fa`, `scan`, `markets`, `compare`, `capm`, `macro`, `news`, `heatmap`, `osint`, `help`), `?ticker=` (defaults to `QCOM`), and `?link=` (window sync group).
  - Isolated into popout scope via `popoutId()` (`lib/windowScope.ts:16-24`), preventing chart store collision with the main chart window.
- **Main Workspace Entry Point:**
  - File: `app/page.tsx:1-5` mounting `<TradingWorkspace />`.
  - File: `components/WorkspaceToolbar.tsx:71-80`:
    ```tsx
    <button
      type="button"
      className="toolbar-button affen-terminal-launch"
      aria-label="AffenTerminal extern öffnen"
      title="AffenTerminal GUI im externen Fenster öffnen"
      onClick={launchTerminalWindow}
    >
      <ExternalLink size={15} />
      <span>AffenTerminal ↗</span>
    </button>
    ```
- **API Endpoints:**
  - `app/api/terminal-opportunities/route.ts` (GET / POST - multi-strategy scan)
  - `app/api/terminal-fundamentals/route.ts` (GET - valuation, multiples, SEC Form 4, quant momentum)
  - `app/api/terminal-markets/route.ts` (GET - global multi-asset 1/5/20 session matrix)
  - `app/api/terminal-compare/route.ts` (GET - paired relative performance & FX conversion)
  - `app/api/terminal-capm/route.ts` (GET - paired daily regression)
  - `app/api/osint-map/route.ts` (GET - maritime AIS, aviation ADS-B, chokepoint sea-state)
  - `app/api/stock-heatmap/route.ts` (GET - GICS stock sector heatmap)
  - `app/api/stock-base/route.ts` (GET / POST - structural bases)
  - `app/api/feeds/route.ts` (GET - macro, economic calendar, RSS news, yields)

### 1.2 Component Hierarchy & Structure
- **Shell & Window Frame:**
  - `components/AffenTerminalWindow.tsx:88-201`:
    - Header (lines 90-147): brand title, `affen-badge` ("INSTITUTIONAL GUI · {VIEW}"), sync symbol display, window link radio group (`LINK_GROUPS`), UTC clock, theme toggle ("Dark"/"Light"), and "Chart Workspace" focus button.
    - Macro Ribbon (lines 149-188): conditional `affen-macro-ribbon` with `Activity` icon, `PULSE` label, cross-asset chips (`macro.crossAssets`), and Fear & Greed index.
    - Window Body (lines 190-201): wraps `<ResearchTerminal externalWindow ... />`.
- **Core Workspace & Command Bar:**
  - `components/ResearchTerminal.tsx:48-543`:
    - Command Form (lines 239-320): `<form className="terminal-command">` with input field, history stack (`history`, `ArrowUp`/`ArrowDown`), `<GO>` submit button, external window button, and segmented layout switch (`1-Pane`, `2-Pane (OPPS + FA)`, `3-Pane Grid`).
    - Module Tabs (lines 322-336): `.panel-tabs` rendering 11 tabs (`opps`, `fa`, `scan`, `markets`, `compare`, `capm`, `macro`, `news`, `heatmap`, `osint`, `help`).
    - Multi-Pane Grid (lines 344-541):
      - Primary pane: hosts currently active view.
      - Secondary pane (`terminal-secondary-pane`): automatically renders `<FundamentalsPanel initialTicker={ticker} />` synchronized with ticker when `layoutMode !== "single"` and `view !== "fa"`.
      - Tertiary pane (`terminal-tertiary-pane`): stacks `<TerminalMarkets openChart={openChart} />` and `<NewsPanel />` when `layoutMode === "split-3"`.
- **Sub-Panels:**
  - `components/OpportunitiesHub.tsx`: Multi-strategy trade scanner, table with 11 columns, inline SVG candlestick key-levels chart (`OpportunityMiniChart`), detailed evidence breakdown.
  - `components/FundamentalsPanel.tsx`: Valuation multiples, sector median comparison, analyst consensus bar, bank rating actions table, Quant momentum/risk metrics grid, SEC Form 4 insider filings table.
  - `components/StockBaseScanner.tsx`: Base forming scanner, candidate table, canvas base chart (`StockBaseChart`), CSV download.
  - `components/TerminalMarkets.tsx`: Multi-asset table for indices, commodities, FX, crypto across 1, 5, 20 sessions.
  - `components/TerminalCompare.tsx`: Paired asset return and drawdown comparison with SVG chart (`ComparisonChart`) and FX currency conversion matrix.
  - `components/CalendarPanel.tsx`: Economic calendar, corporate earnings/dividends, US Treasury yield curve, FRED macro metrics.
  - `components/NewsPanel.tsx`: Filterable RSS news stories.
  - `components/HeatmapPanel.tsx`: Squarified treemap for crypto and equities sectors.
  - `components/OsintMapPanel.tsx`: D3 world map projection (`geoNaturalEarth1`) with live vessel pins, flights, chokepoints, sea-state telemetry.

### 1.3 Existing Visual Styles & Tokens
- **Theme Variables in `app/globals.css:9-21`:**
  - `--bg: #10141c` (dark blue/navy, not black)
  - `--surface: #141922`
  - `--surface2: #1b2230`
  - `--border: #252c39`
  - `--text: #d7dce7`
  - `--muted: #778297`
  - `--accent: #9695ff` (pastel lavender/purple)
  - `--green: #32b99b`
  - `--red: #ed6675`
  - `--amber: #f7b955`
- **Typography:**
  - Proportional: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 12px;` (`globals.css:29-36`).
  - Monospace: `"SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 11px; tabular-nums;` (`globals.css:122-126`).
- **Pill Badges in `app/features.css:1048-1057`:**
  ```css
  .chip {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 11px;
  }
  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  ```
- **Primary Button in `app/globals.css:183-190`:**
  ```css
  .button.primary {
    background: #7775e8;
    color: #fff;
    border-color: #8582f3;
    box-shadow: 0 2px 6px #0002;
  }
  ```
- **Panel Tabs in `app/globals.css:1833-1866`:**
  ```css
  .panel-tabs {
    display: flex;
    gap: 18px;
    padding: 0 15px;
    height: 40px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .panel-tabs > button.active {
    color: #aaa2f7;
  }
  .panel-tabs > button.active:after {
    background: #9a90ef;
  }
  ```

### 1.4 Test Suite & Automated Verification Baseline
- Command: `$env:PATH = ...; pnpm test`
  - Result: **246 test files passed, 2552 passed (0 failed)** in 17.63s.
- Command: `$env:PATH = ...; pnpm typecheck`
  - Result: **0 TypeScript errors** (`tsc --noEmit` clean).
- Command: `$env:PATH = ...; node scripts/verify-terminal-e2e-browser.mjs`
  - Result: **HEADLESS CHROME E2E PASS** (verified on `/` and `/terminal`, verifying overlay pixel diffs, d3-geo OSINT map, storage isolation `affentrader-chart-v1@affen-terminal`, and view switching).
- Existing Terminal-Specific Vitest Tests:
  - `tests/affen-terminal-opportunities.test.ts` (392 lines: tests command parser, opportunities engine, CSV export, API validation).
  - `tests/terminal-compare.test.ts` (84 lines: tests FX normalization, matched retest dates, API validation).
  - Note: There are currently **no dedicated unit/component tests for `ResearchTerminal.tsx` or `AffenTerminalWindow.tsx`** in Vitest (`tests/`); GUI rendering is currently only checked via the headless Chrome CDP script (`scripts/verify-terminal-e2e-browser.mjs`).

---

## 2. Logic Chain

### 2.1 From Observations to Visual Style & "AI-Slop" Assessment
1. **Observation 1.3** establishes that `.chip` uses `border-radius: 999px` (pill shape), buttons use `border-radius: 5px`, cards use `6px`, and inputs use `4px`.
2. **Inference:** Pill-shaped tags (`border-radius: 999px`) and mismatched roundings are hallmarks of generic consumer web templates. Professional financial terminals (Bloomberg, Refinitiv Eikon, OpenBB) use crisp 0px or 1px square corners to maximize rectangular screen estate and align pane borders seamlessly.
3. **Observation 1.3** shows that `--accent: #9695ff`, primary buttons use `#7775e8` with drop shadows (`box-shadow: 0 2px 6px #0002`), and active tabs use lavender underlines (`#9a90ef`).
4. **Inference:** The lavender/purple palette is typical of AI-generated SaaS themes. Real institutional terminals strictly use amber/orange (`#ff9e00` / `#f59e0b`) for active commands and prompts, cyan (`#00e5ff`) for labels/headers, and signal green/red for price changes on deep black/charcoal backgrounds.
5. **Observation 1.2** records verbose explanatory text blocks in `OpportunitiesHub.tsx:334-338`, `StockBaseScanner.tsx:120`, `TerminalMarkets.tsx:48`, and `TerminalCompare.tsx:113-122`.
6. **Inference:** Sprawling multi-sentence explanatory text between toolbars and tables degrades vertical density and looks like an AI tutorial/demo page. Institutional workstations place status metadata in single-line telemetry ribbons or tooltips.
7. **Observation 1.3** shows proportional Inter font (12px) used across table headers, cards, and metadata, while `.mono` is only selectively applied.
8. **Inference:** Tabular financial data without fixed-width monospace alignment leads to fluctuating column widths and ragged numerical columns when numbers update.

### 2.2 From Observations to Layout Shifts & Responsive Constraints
1. **Observation 1.2** identifies `app/features.css:1776-1780`:
   ```css
   @media (max-width: 1120px) {
     .affen-terminal .terminal-workspace-grid {
       grid-template-columns: 1fr !important;
     }
   }
   ```
2. **Inference:** Any desktop user tiling two windows side-by-side on a 1920x1080 display (each window width ~960px) triggers this media query. The multi-pane 2-Pane and 3-Pane grid immediately collapses into a single-column vertical stack, completely disabling side-by-side fundamental or market analysis.
3. **Observation 1.2** identifies `OpportunitiesHub.tsx:291-332` having a flex-wrap toolbar containing 8 input/select/button elements.
4. **Inference:** As pane widths change (e.g. switching from 1-Pane to 2-Pane or resizing the window), the toolbar wraps from 1 row to 2 or 3 rows, causing an immediate 50–80px Cumulative Layout Shift (CLS) of the data table underneath.
5. **Observation 1.2** notes that in 3-Pane mode (`ResearchTerminal.tsx:535-540`), the tertiary pane stacks `<TerminalMarkets />` and `<NewsPanel />` without a bounded height container or independent scroll overflow.
6. **Inference:** The tertiary pane expands freely, forcing the entire page into a long outer vertical scrollbar and misaligning the headers of the primary and secondary panes.

---

## 3. Caveats
- No changes to underlying trading math, indicators, or public data parsers are required; the survey is strictly UI/UX, styling, and architectural.
- Headless Chrome test script `scripts/verify-terminal-e2e-browser.mjs` and `tests/browser/terminal-overlays-e2e.ts` inspect specific DOM text nodes:
  - Text: `"Trade-Setups aktiv"` (in OpportunitiesHub)
  - Text: `"Off"` (link chip in AffenTerminalWindow)
  - Text: `"Baltic"` and SVG paths (in OsintMapPanel)
  - Tab button texts: `"Trade-M"` and `"OSINT"`
  These selectors and strings must remain functional during any UI redesign to maintain full E2E test compliance.
- Network mode: Live external APIs (SEC EDGAR, Yahoo, TradingView) require fair-access pacing; automated unit tests must use mocked data fixtures as already demonstrated in `tests/affen-terminal-opportunities.test.ts`.

---

## 4. Conclusion & Recommended Action Plan

### Core Assessment
AffenTerminal has complete and working functional subsystems. The primary shortcoming is aesthetic: it looks like a consumer web-app built with generic Tailwind/SaaS templates rather than an institutional trading workstation. 

### Concrete Recommendations for Implementation:
1. **Institutional Palette & Framing (Zero AI-Slop):**
   - Canvas: Switch terminal background to deep pitch charcoal (`#0a0b0e` / `#000000`) and panels to `#0f1117` / `#13161f`.
   - Borders: Replace rounded 4-8px corners with crisp 0px or 1px hairline borders (`1px solid #1e222d`).
   - Badges: Replace pill-shaped `.chip` (`border-radius: 999px`) with dense rectangular security badges (`border-radius: 1px`, uppercase, tabular monospace font).
   - Accents: Replace pastel purple (`#9695ff`, `#7775e8`) with Bloomberg Amber (`#ff9e00` / `#f59e0b`) for commands and `<GO>`, Cyan (`#00e5ff` / `#38bdf8`) for telemetry headers, and high-visibility signal green (`#00e676` / `#22c55e`) and red (`#ff3b30` / `#ef4444`).
2. **Unified High-Density Command Ribbon:**
   - Merge the top header, clock, sync block, and macro ribbon into a unified, high-density Bloomberg ribbon (max 32px height).
   - Redesign the command bar into a signature Bloomberg prompt: amber prompt symbol `AFT: >`, monospace input, amber `<GO>` key button, and clear function key tags (`[F1 OPPS]`, `[F2 FA]`, `[F3 SCAN]`, `[F4 MKT]`, etc.).
3. **Pane Splitting & Multi-Pane Layout Stability:**
   - Remove the disruptive `@media (max-width: 1120px) { grid-template-columns: 1fr !important; }` collapse. Replace with a desktop-resilient CSS grid or flex layout where split panes maintain side-by-side visibility down to 800px with independent overflow containers.
   - Encapsulate each pane in a distinct terminal tile with a compact header bar (e.g. `1: OPPORTUNITIES SCANNER`, `2: FUNDAMENTALS (QCOM)`, `3: GLOBAL MARKETS & NEWS`), eliminate loose padding, and ensure each tile scrolls independently (`overflow-y: auto`).
4. **Data Density & Typography:**
   - Enforce tabular monospace typography across all numeric cells, tickers, timestamps, and metrics (`font-mono tabular-nums`).
   - Reduce table row heights from ~38px down to 24px with compact padding (`padding: 3px 8px`).
   - Remove verbose tutorial paragraphs and replace with concise telemetry chips or status bars.
5. **Testing Expansion (Requirement R2):**
   - Add new automated Vitest component tests in `tests/` covering:
     - `ResearchTerminal.tsx` rendering across 1-Pane, 2-Pane, and 3-Pane modes.
     - Command bar execution and history navigation.
     - `AffenTerminalWindow.tsx` sync group switching and theme consistency.

---

## 5. Verification Method

To independently verify all observations and validate subsequent UI changes:

1. **Vitest Unit & Integration Suite:**
   ```powershell
   $r = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
   $env:PATH = "$r\node\bin;$r\bin\fallback;$r\native\git\cmd;$r\git\cmd;$env:PATH"
   pnpm test
   ```
   *Expected: All 246 test files and 2552 tests pass without failure.*

2. **TypeScript Typecheck:**
   ```powershell
   $r = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
   $env:PATH = "$r\node\bin;$r\bin\fallback;$r\native\git\cmd;$r\git\cmd;$env:PATH"
   pnpm typecheck
   ```
   *Expected: 0 TypeScript errors (`tsc --noEmit` exits with code 0).*

3. **Headless Chrome E2E Route & Visual Overlay Verification:**
   ```powershell
   $r = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
   $env:PATH = "$r\node\bin;$r\bin\fallback;$r\native\git\cmd;$r\git\cmd;$env:PATH"
   node scripts/verify-terminal-e2e-browser.mjs
   ```
   *Expected: Output reports `HEADLESS CHROME E2E PASS` with 0 pixel restoration errors and validated `/terminal` view switches.*

4. **Production Build Verification:**
   ```powershell
   $r = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
   $env:PATH = "$r\node\bin;$r\bin\fallback;$r\native\git\cmd;$r\git\cmd;$env:PATH"
   pnpm run build
   ```
   *Expected: Next.js production build succeeds with code 0.*

5. **Invalidation Conditions:**
   - Any modification that removes or renames DOM buttons expected by `tests/browser/terminal-overlays-e2e.ts` (e.g. `"Off"`, `"Trade-M"`, `"OSINT"`) without updating the test assertions will invalidate E2E verification.
   - Any style change that leaves pill badges (`border-radius: 999px`) or lavender button gradients will fail acceptance criteria for Bloomberg-style professional aesthetics.
