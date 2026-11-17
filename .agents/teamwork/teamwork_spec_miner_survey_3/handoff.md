# Survey Report: Testing Infrastructure, Typecheck, Build Setup & CODEX Continuity

**Survey Miner**: Survey Spec Miner 3  
**Working Directory**: `c:\Users\Niklas\Desktop\affentrader\.agents\teamwork\teamwork_spec_miner_survey_3\`  
**Date**: 2026-11-14T18:47:00Z  

---

## 1. Observation

### A. Environment & Windows Runtime Configuration
- On this Windows machine, standard system `PATH` does not contain Node, pnpm, or Git:
  ```powershell
  node -v; pnpm -v
  # Error: The term 'node' is not recognized as the name of a cmdlet...
  # Error: The term 'pnpm' is not recognized as the name of a cmdlet...
  ```
- As documented in `CODEX_HANDOFF.md` (lines 79–82), the local runtime must be prepended:
  ```powershell
  $r = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
  $env:PATH = "$r\node\bin;$r\bin\fallback;$r\native\git\cmd;$r\git\cmd;$env:PATH"
  ```
  Result with prepended path:
  - Node: `v24.22.1`
  - pnpm: `11.25.0`
  - Git: `2.56.0.windows.4`

### B. Package Scripts & Pre-build Pipeline (`package.json`)
- In `package.json` (lines 5–11):
  ```json
  "scripts": {
    "dev": "node scripts/patch-vela-viewport.mjs && node scripts/build-strategy-runtime.mjs && node scripts/build-pine-alert-runtime.mjs && next dev --hostname 0.0.0.0",
    "build": "node scripts/patch-vela-viewport.mjs && node scripts/build-strategy-runtime.mjs && node scripts/build-pine-alert-runtime.mjs && next build --webpack",
    "start": "next start --hostname 0.0.0.0",
    "typecheck": "node scripts/patch-vela-viewport.mjs && node scripts/build-strategy-runtime.mjs && node scripts/build-pine-alert-runtime.mjs && tsc --noEmit",
    "test": "node scripts/patch-vela-viewport.mjs && node scripts/build-strategy-runtime.mjs && node scripts/build-pine-alert-runtime.mjs && vitest run"
  }
  ```
- All lifecycle commands execute a 3-step patch & compilation sequence before Next.js / TypeScript / Vitest:
  1. `node scripts/patch-vela-viewport.mjs`: dynamically patches `@luxalgo/vela` in `node_modules` (viewport bounds, readout, color picker, etc.).
  2. `node scripts/build-strategy-runtime.mjs`: decompiles `pinets` 0.13.0 source map, applies intrabar magnifier & alert patches, and bundles `.generated/strategy-runtime.js`.
  3. `node scripts/build-pine-alert-runtime.mjs`: bundles `.generated/pine-alert-code.js` via esbuild.

### C. Existing Test Suite (`vitest.config.ts`, `tests/`)
- `vitest.config.ts`:
  ```typescript
  import { defineConfig } from "vitest/config";
  import { fileURLToPath } from "node:url";
  export default defineConfig({
    resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"],
      testTimeout: 30000,
    },
  });
  ```
- Test execution output (`pnpm test`):
  ```
  RUN  v3.2.7 C:/Users/Niklas/Desktop/affentrader
  Test Files  246 passed (246)
       Tests  2552 passed (2552)
    Duration  17.85s
  ```
  - Vitest is v3.2.7 (bundled via `@vitest/runner` 3.2.7).
  - 246 test files, 2,552 passing tests, 0 failures.
  - Environment is strictly `"node"`.
  - Matching pattern is `tests/**/*.test.ts` (does NOT match `.test.tsx`).
- Current AffenTerminal test coverage in `tests/`:
  - `tests/affen-terminal-opportunities.test.ts` (13 tests):
    - `parseTerminalCommand`: single-token (`OPPS`, `SCAN`, `VALUE`, `FA`, `FLOW`, `CHART`, `MACRO`, `NEWS`, `MARKETS`, `COMPARE`, `HEATMAP`, `HELP`) and two-token (`AAPL <GO>`, `NVDA GP`, `QCOM FA`, `SAP.DE VALUE`, `FA UNH`, `AAPL CAPM`, `TSLA FLOW`, `INVALID COMMAND EXTRA`, `$$$ FA`).
    - Opportunity detection algorithms: `detectStructuralBottomOpportunity`, `detectValueGarpOpportunity`, `detectHighConvictionOpportunities`.
    - Mathematical volume indicators: `computeObv`, `computeAccumulationDistribution`.
    - Opportunities CSV export: `opportunitiesToCsv`.
    - API route handlers: `GET /api/terminal-opportunities`, `POST /api/terminal-opportunities`, `GET /api/terminal-fundamentals`.
  - `tests/terminal-compare.test.ts` (5 tests):
    - Currency conversion & normalization (GBp/Pence vs GBP vs USD).
    - Compounded relative performance and drawdown matching against exact benchmark retest close.
    - Handling missing FX sessions and unique instrument dates.
  - `tests/osint-and-heatmap.test.ts`:
    - Commands: `HEATMAP`, `OSINT`, `TANKER`, `FLIGHTS`, `MAP`.
    - API endpoints: `/api/stock-heatmap`, `/api/osint-map`.
- Browser E2E Test Suite (`tests/browser/terminal-overlays-e2e.ts` & `scripts/verify-terminal-e2e-browser.mjs`):
  - Directly launches Chrome via Chrome DevTools Protocol (`C:\Program Files\Google\Chrome\Application\chrome.exe`).
  - Runs esbuild bundles of `tests/browser/terminal-overlays-e2e.ts`.
  - Mounts `AffenTerminalWindow` and `OsintMapPanel` via React 19 `createRoot`.
  - Verifies `/terminal` route storage scoping (`popoutId() === "affen-terminal"`, `scopedKey === "affentrader-chart-v1@affen-terminal"`).
  - Verifies link group "Off" button state and persistence across reload.
  - Verifies tab navigation between Fundamentals, Trade-Möglichkeiten, and OSINT (d3-geo SVG path count >= 3).
  - Verifies canvas pixel differences for native chart overlays (`af-volume-nodes`: 3034 px, `af-orderflow-signals`: 3960 px, `af-delta-divergence`: 1880 px, `STRUCTURE_SCRIPT`: 78072 px).
  - Run output: `HEADLESS CHROME E2E PASS` in ~8.0s.

### D. Existing Typecheck Setup (`tsconfig.json`)
- `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["dom", "dom.iterable", "esnext"],
      "allowJs": true,
      "skipLibCheck": true,
      "strict": true,
      "noEmit": true,
      "esModuleInterop": true,
      "module": "esnext",
      "moduleResolution": "bundler",
      "resolveJsonModule": true,
      "isolatedModules": true,
      "jsx": "react-jsx",
      "incremental": true,
      "plugins": [{ "name": "next" }],
      "paths": { "@/*": ["./*"] }
    },
    "include": [
      "next-env.d.ts",
      "**/*.ts",
      "**/*.tsx",
      ".next/types/**/*.ts",
      ".next/dev/types/**/*.ts"
    ],
    "exclude": ["node_modules", ".generated"]
  }
  ```
- Command `pnpm run typecheck` execution output:
  - Exit code: 0
  - Output: `$ node scripts/patch-vela-viewport.mjs && node scripts/build-strategy-runtime.mjs && node scripts/build-pine-alert-runtime.mjs && tsc --noEmit`
  - Total TypeScript errors: **0** (strictly passes under `"strict": true`).

### E. Build & Deployment Configuration
- Next.js 16.4.3 & React 19.2.0:
  - `next.config.ts`:
    ```typescript
    import type { NextConfig } from "next";
    const config: NextConfig = {
      reactStrictMode: true,
      transpilePackages: ["@luxalgo/vela", "@luxalgo/vela-pinets"],
      serverExternalPackages: ["yahoo-finance2", "fast-xml-parser"],
      devIndicators: false,
    };
    export default config;
    ```
  - `pnpm run build`: Uses `next build --webpack` (webpack bundler is required due to custom loaders/runtime patches in Vela/PineTS).
  - Build execution results:
    - Prerendered Static routes: `/` (Static), `/_not-found` (Static), `/terminal` (Static client boundary), `/manifest.webmanifest`.
    - Serverless Dynamic API routes: 19 routes including `/api/terminal-opportunities`, `/api/terminal-fundamentals`, `/api/terminal-compare`, `/api/terminal-markets`, `/api/terminal-capm`, `/api/stock-heatmap`, `/api/osint-map`, `/api/stock-base`, `/api/yahoo`, `/api/feeds`, `/api/market`, `/api/hyperliquid`.
    - Static generation for `/terminal` succeeded without de-opting because `TerminalRouteContent` wraps `useSearchParams()` inside `<Suspense fallback={...}>`.
- Netlify Configuration (`netlify.toml`):
  - `[build] command = "pnpm run build"`, `publish = ".next"`
  - `[build.environment] NODE_VERSION = "22"`, `PNPM_VERSION = "11.25.0"`
  - `[functions] node_bundler = "esbuild"`
  - Netlify Scheduled Function in `netlify/functions/alerts.ts` (`schedule: "* * * * *"`).
- Packaging Script (`scripts/package-netlify.ps1`):
  - Execution result: Creates `artifacts/affentrader-netlify.zip` (904 files, 2,054,755 bytes).
  - Validates that mandatory files exist: `package.json`, `netlify.toml`, `pnpm-lock.yaml`, `CODEX_HANDOFF.md`, `scripts/build-strategy-runtime.mjs`, `netlify/functions/alerts.ts`, `docs/netlify-upload.md`.
  - Excludes `.env*`, `.data`, `.netlify*`, `node_modules`, `artifacts`, `.generated`, `.next`.

### F. CODEX_HANDOFF.md Structure & Conventions
- Located at root (`CODEX_HANDOFF.md`), 107 lines.
- Structure:
  1. `Completed Modules & Current Status`: Covers external window isolation (`/terminal`, `openAffenTerminalWindow`, `useWindowLink`, `BroadcastChannel("affentrader-link")`), pulse ribbon, command bar navigation, multi-pane layout (1-Pane, 2-Pane, 3-Pane), trade setup categories (structural bottom, value GARP, high-conviction), and zero-bloat TradingView core + footprint orderflow.
  2. `Connected Public & Open-Source Data Sources`: 9 public/unauthenticated data providers (TradingView, SEC EDGAR Form 4 XML + SEC XBRL History, Nasdaq Analyst API, OpenInsider & Finviz, Yahoo Finance, Maritime AIS + Aviation ADS-B OSINT, FRED CSV + Crypto Fear & Greed, Binance & Hyperliquid L1, open quant libraries).
  3. `Build, Verification & Netlify Deployment Protocol`: Prepend PATH command for Windows Codex runtime, exact verification commands, live SSR probes, Netlify deployment details.
  4. `Next Steps for Codex`: Multi-target OCO scaling legs, optional authenticated equities tape, authenticated full-route browser smoke.

---

## 2. Logic Chain

1. **Test Infrastructure Analysis**:
   - Observation: `vitest.config.ts` sets `environment: "node"` and `include: ["tests/**/*.test.ts"]`.
   - Observation: There are 0 `.tsx` test files in `tests/`, and `@testing-library/react` / `jsdom` are not installed in `node_modules`.
   - Inference: The existing test suite of 2552 tests is strictly a Node.js unit/integration test suite covering backend logic, mathematical algorithms, data parsers, and API route handlers.
   - Inference: Any React component UI testing was hitherto performed either manually or via the custom headless Chrome DevTools Protocol harness in `scripts/verify-terminal-e2e-browser.mjs`.
   - Conclusion: Introducing component tests must NOT disrupt the 246 existing Node tests or slow them down. Using Vitest per-file environment directive (`// @vitest-environment jsdom`) or an isolated test project allows existing Node tests to remain blazing fast (~17s) while adding DOM-based component tests.

2. **TypeScript & Build Pipeline Compatibility**:
   - Observation: TypeScript runs in `"strict": true` mode with `moduleResolution: "bundler"`, `paths: { "@/*": ["./*"] }`, and `jsx: "react-jsx"`.
   - Observation: Next.js 16.4.3 uses webpack bundling (`next build --webpack`), and `/terminal` is statically generated with `<Suspense>`.
   - Inference: Any new UI components or test files must adhere to strict type checking with full typings for props, states, and mocked Next.js hooks (`useSearchParams`, `useRouter`).
   - Inference: Client components must maintain `"use client"` directives and proper Suspense boundaries so `next build` continues to generate `/terminal` cleanly.

3. **Packaging & Deployment Constraints**:
   - Observation: `scripts/package-netlify.ps1` explicitly checks for `CODEX_HANDOFF.md`, `netlify.toml`, and files in `tests/`, `components/`, `lib/`, `app/`.
   - Observation: Any new test file added to `tests/` is automatically bundled into `artifacts/affentrader-netlify.zip` by `package-netlify.ps1`.
   - Inference: Tests and test helper files must not contain sensitive credentials, binary blobs, or paths that trip the packaging script's security checks (`.env*`, `.data`, `.netlify*`).
   - Conclusion: Every architectural decision and component expansion must be documented in `CODEX_HANDOFF.md` to satisfy Acceptance Criterion AC R3.

---

## 3. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Test Infrastructure | Vitest Test Suite | Runs 2552 unit/integration tests across 246 files in Node environment | `pnpm test` / `vitest run` | Test results, timing, pass/fail counts | Non-zero exit code on failed assertion | `package.json`, `vitest.config.ts` |
| 2 | Test Infrastructure | Headless Chrome CDP E2E | Zero-dependency browser test runner driving real Chrome via CDP | `node scripts/verify-terminal-e2e-browser.mjs` | JSON report of DOM elements, storage scope, pixel diffs | Throws on console errors, missing DOM elements, or canvas mismatch | `scripts/verify-terminal-e2e-browser.mjs` |
| 3 | Typechecking | TypeScript Strict Typecheck | Strict compile check with bundler module resolution and path aliases | `pnpm run typecheck` (`tsc --noEmit`) | Empty output on success | TypeScript compiler diagnostic errors | `tsconfig.json`, `package.json` |
| 4 | Pre-Build Runtime | Vela & PineTS Patch Pipeline | Dynamic patching of node_modules and esbuild bundling of PineTS alert runtime | `scripts/patch-vela-viewport.mjs`, `scripts/build-strategy-runtime.mjs` | Patched bundles in node_modules and `.generated/` | Throws error if package versions mismatch (Vela 0.9.0, PineTS 0.13.0) | `scripts/*.mjs` |
| 5 | Build & SSR | Next.js 16 Webpack Build | Static prerendering of `/` and `/terminal`, dynamic bundling of 19 API routes | `pnpm run build` (`next build --webpack`) | Static HTML/CSS/JS in `.next/` | Non-zero exit code on build or SSR error | `next.config.ts`, `package.json` |
| 6 | Netlify Deploy | Netlify Function Packaging | Bundles project into deployable zip, verifies essential files | `powershell -File scripts/package-netlify.ps1` | `artifacts/affentrader-netlify.zip` (904 files) | Throws on symlinks, forbidden paths, or missing mandatory files | `scripts/package-netlify.ps1` |
| 7 | Netlify Deploy | Scheduled Alert Evaluator | Cloud-scheduled Netlify serverless function running every minute | Netlify cron trigger (`* * * * *`) | Leased rule execution and push delivery logs | Aborts early if site access unconfigured or lease active | `netlify/functions/alerts.ts` |
| 8 | Terminal GUI | Command Bar Engine | Bloomberg-style command parser with `<GO>` execution and history | Raw command string (e.g. `AAPL <GO>`, `OPPS`, `QCOM FA`) | `ParsedTerminalCommand` object (`view`, `chart`, `flow`, `capm`, `unknown`) | Emits `{ kind: "unknown", raw }` and displays helpful message | `lib/terminal/commands.ts`, `components/ResearchTerminal.tsx` |
| 9 | Terminal GUI | Global Focus Shortcut | Alt+K keyboard shortcut to focus and select command bar anywhere in window | `Alt+K` keydown event | Sets focus on `#terminal-command` input | Safe no-op if input element is unmounted | `components/ResearchTerminal.tsx:101-109` |
| 10 | Terminal GUI | Multi-Pane Workspace Layout | Segmented layout mode switcher (1-Pane, 2-Pane, 3-Pane Grid) | Click on segmented layout buttons | Updates `layoutMode`, applies CSS grid styling | Defaults to `split-3` on external window, `split-2` on embedded | `components/ResearchTerminal.tsx:294-319` |
| 11 | Terminal GUI | Macro Sentiment Pulse Ribbon | Live cross-asset ticker chips and Crypto Fear & Greed telemetry | `/api/feeds?kind=macro` polled every 120s | Rendered chip bar with color-coded change % | Gracefully hidden when macro data is null/offline | `components/AffenTerminalWindow.tsx:149-188` |
| 12 | Terminal GUI | Window Link & Storage Scope | Multi-window link groups (`off`, `red`, `green`, `blue`, `yellow`) and storage isolation | `useLinkStore`, `sessionStorage`, `BroadcastChannel("affentrader-link")` | Syncs symbols across windows without colliding chart localStorage | Defaults to `red` on first launch, preserves `off` across reload | `components/AffenTerminalWindow.tsx:35-47`, `lib/windowScope.ts` |
| 13 | Terminal GUI | Dark/Light Pro Theme Switcher | Instant theme toggle button in terminal header | Click theme toggle button | Toggles `useWorkspaceStore.theme`, sets `dataset.theme` | Defaults to dark theme if unset | `components/AffenTerminalWindow.tsx:123-131` |
| 14 | Terminal Module | Opportunities Hub | Multi-strategy scanner hub (Structural Bottom, Value GARP, High Conviction) | Market filter, sort mode, search query | Scored setups (0-100), key-levels, rationale, CSV export | Shows empty state "Keine Setups gefunden" on empty filter match | `components/OpportunitiesHub.tsx`, `lib/screener/opportunities.ts` |
| 15 | Terminal Module | Fundamentals & Valuation Panel | SEC Form 4 insider clusters, SEC XBRL 6Y median P/E, analyst consensus | Ticker input or synchronized chart symbol | Valuation table, historical chart, quant momentum/risk | Shows error banner on invalid ticker or offline APIs | `components/FundamentalsPanel.tsx`, `/api/terminal-fundamentals` |
| 16 | Terminal Module | Terminal Markets & Compare | Global market returns across 1/5/20 sessions and currency-normalized relative compare | Tickers, benchmark, retest session, FX basis | Returns grid, drawdown comparison table, relative performance | Fallbacks when FX data or retest dates are missing | `components/TerminalMarkets.tsx`, `components/TerminalCompare.tsx` |
| 17 | Terminal Module | OSINT World Map | Interactive D3-geo world map with live Baltic AIS tankers & ADS-B flights | SVG zoom/pan controls, vessel/flight category filters | Rendered geographic projections, chokepoint pins, sea-state telemetry | Gracefully falls back when vessel/flight feeds are unreachable | `components/OsintMapPanel.tsx`, `/api/osint-map` |

---

## 4. Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Command Bar Parser | `"   "` (Whitespace only) | Returns `{ kind: "unknown", raw: "   " }`, does not trigger chart or view change |
| 2 | Command Bar Parser | `"INVALID COMMAND EXTRA"` (>2 tokens) | Returns `{ kind: "unknown", raw }` without throwing |
| 3 | Command Bar Parser | `"$$$ FA"` (Invalid ticker character) | Returns `{ kind: "unknown", raw }` because `isYahooTicker("$$$")` is false |
| 4 | Command Bar Parser | `"AAPL <GO>"` vs `"AAPL GO"` | Strips `<GO>` or `GO` suffix and returns `{ kind: "chart", ticker: "AAPL" }` |
| 5 | Command Bar Parser | `"FA QCOM"` vs `"QCOM FA"` | Both token orders are parsed into `{ kind: "view", view: "fa", ticker: "QCOM" }` |
| 6 | Command Bar History | `ArrowUp` at start of history | Clamps to `history.length - 1`, does not overflow index |
| 7 | Command Bar History | `ArrowDown` at bottom of history | Resets to `-1` and clears input to blank |
| 8 | Multi-Pane Secondary Pane | Active view is `fa` in `split-2` or `split-3` | Secondary pane is conditionally hidden (`view !== "fa"`) to avoid rendering duplicate FA panels |
| 9 | Macro Pulse Ribbon | Fetch `/api/feeds?kind=macro` fails or returns empty | Ribbon renders `null`, header remains silent without layout shifts or console errors |
| 10 | Window Link Persistence | Reload `/terminal` after setting link group to `"Off"` | Preserves `"off"` state in sessionStorage, does not reset to default `"red"` |
| 11 | Terminal Route SearchParams | Visit `/terminal?view=INVALID_VIEW&ticker=MSFT` | Validates against `VALID_VIEWS` set, falls back to `"opps"`, sanitizes ticker to `"MSFT"` |
| 12 | Terminal Route Prerender | `next build` prerendering `/terminal` | Prerenders successfully as static HTML without de-opting because `useSearchParams` is wrapped in `<Suspense>` |
| 13 | Netlify Packaging | Presence of `.env.local` or `.data/` directory | Excluded strictly by whitelist regex; build aborts with error if unauthorized files match |
| 14 | CAPM Calculation | Rate outside `[-20, 50]` or invalid ticker | Rejects immediately with error message "Enter a valid ticker and annual risk-free rate (−20% to 50%)" |

---

## 5. Test Gaps Identified

While the backend logic and API routes have 2552 passing tests, the **AffenTerminal UI components currently have 0 unit/integration tests in Vitest**. The only existing UI testing is a browser CDP script. The following test gaps must be covered:

### Gap 1: Command Bar & Keyboard Navigation
- **Missing Tests**:
  - `Alt+K` global focus handler: test that pressing `Alt+K` focuses and selects the command input.
  - History traversal: test pressing `ArrowUp` and `ArrowDown` cycles through previously entered commands.
  - Submission via Enter / `<GO>` click: test that submitting commands invokes the appropriate state handler (`setView`, `openChart`, `runCapm`, `flow`).
  - Unknown command feedback: test that entering an unrecognized string displays the Bloomberg-style help message (`role="status"`).
  - Ticker synchronization: test that running `<TICKER> <GO>` or `<TICKER> FA` synchronizes the ticker to chart store or parent callback.

### Gap 2: Multi-Pane Workspace Controls
- **Missing Tests**:
  - Rendering 1-Pane, 2-Pane, and 3-Pane modes based on `layoutMode`.
  - Clicking segmented buttons updates layout mode and sets the `.active` class.
  - Verifying the secondary pane (`FundamentalsPanel`) renders in `split-2` and `split-3` when the primary view is not `fa`, and unmounts/hides when primary view is `fa`.
  - Verifying the tertiary pane (`TerminalMarkets` + `NewsPanel`) renders only in `split-3` mode.

### Gap 3: Pulse Ribbon Rendering & Interactions
- **Missing Tests**:
  - Rendering ticker chips with symbol, formatted price, and change % with `positive` or `negative` class.
  - Clicking a pulse chip updates chart store symbol and timeframe to `"1D"`.
  - Rendering Fear & Greed index score and classification.
  - Handling empty or failed macro response gracefully without throwing.

### Gap 4: Header Actions & Theme Switching
- **Missing Tests**:
  - Theme button toggles between `"Dark"` and `"Light"`, updates `useWorkspaceStore`, and updates `document.documentElement.dataset.theme`.
  - Link group radio buttons: clicking color chips (`off`, `red`, etc.) updates `useLinkStore` and toggles `aria-checked` attributes.
  - Clock display updates in UTC format.
  - External launch button is present in embedded mode and absent when `externalWindow={true}`.

### Gap 5: View Module Tab Switching & Routing
- **Missing Tests**:
  - Switching between modules via top tab bar (`OPPS`, `FA`, `SCAN`, `MARKETS`, `COMPARE`, `CAPM`, `MACRO`, `NEWS`, `HEATMAP`, `OSINT`, `HELP`).
  - Active tab highlighting.
  - Calling `onViewChange` callback when the active tab changes.
  - Verifying view preservation or reset when switching tabs.

### Gap 6: Component Loading & Error States
- **Missing Tests**:
  - CAPM form input validation, loading button state, and error message rendering on failure.
  - OpportunitiesHub loading skeleton, filter buttons, and selection event forwarding to `faPreload`.
  - FundamentalsPanel data source badge rendering and fallback state on empty metrics.

---

## 6. Concrete Test Plan with Vitest & React Testing Library

### Phase 1: Environment & Dependency Setup
1. **Dependencies**:
   - Add `@testing-library/react` (v16.x supports React 19) and `@testing-library/jest-dom` (or `@testing-library/dom`) to `devDependencies`.
   - Add `jsdom` (or `happy-dom`) to `devDependencies`.
2. **Vitest Configuration (`vitest.config.ts`)**:
   - Update `include` to cover both `.test.ts` and `.test.tsx`:
     ```typescript
     include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
     ```
   - Keep default `environment: "node"` so the 246 existing server/algorithm test files remain fast and unaltered.
   - For UI component tests, use the per-file directive at the top of each `.test.tsx` file:
     ```typescript
     // @vitest-environment jsdom
     ```
   - Add a test setup file `tests/setup-dom.ts` (conditional on DOM environment) to configure `@testing-library/jest-dom/vitest` matchers and mock browser APIs (`ResizeObserver`, `window.matchMedia`, `BroadcastChannel`).

### Phase 2: Core Terminal Component Test Files
Create the following structured test files under `tests/`:

1. **`tests/research-terminal-command-bar.test.tsx`**:
   - Test `Alt+K` keyboard shortcut triggers input focus.
   - Test command history navigation (`ArrowUp`/`ArrowDown`).
   - Test command execution for single-token views (`OPPS`, `FA`, `MACRO`, `NEWS`, `HEATMAP`, `OSINT`, `HELP`).
   - Test two-token commands (`AAPL <GO>`, `QCOM FA`, `NVDA FLOW`, `AAPL CAPM`).
   - Test unknown command error feedback.
2. **`tests/research-terminal-layout.test.tsx`**:
   - Test default layout mode (`split-2` when embedded, `split-3` when external).
   - Test switching between 1-Pane, 2-Pane, and 3-Pane grid.
   - Test secondary pane lifecycle (rendered in split-2/split-3 when view is not `fa`, hidden when view is `fa`).
   - Test tertiary pane lifecycle (rendered only in split-3).
   - Test tab switching updates active tab styling and invokes `onViewChange`.
3. **`tests/affen-terminal-window.test.tsx`**:
   - Test header brand block, UTC clock, and symbol label.
   - Test link group radio buttons (`off`, `red`, `green`, `blue`, `yellow`) and `aria-checked` attributes.
   - Test theme switcher toggles between dark and light, sets `data-theme` on document element.
   - Test macro pulse ribbon renders cross-asset prices and Fear & Greed status.
   - Test clicking pulse chips triggers symbol selection.
   - Test URL search parameter initialization (`?view=fa&ticker=NVDA`).
4. **`tests/terminal-capm-panel.test.tsx`**:
   - Test rate input validation (rejects `< -20` or `> 50`).
   - Test form submission initiates API fetch with correct query parameters.
   - Test loading state disables submit button and displays loading text.
   - Test display of calculated statistics (Beta, Jensen Alpha, R², Volatility, Sharpe).
   - Test error handling when API returns error response.

### Phase 3: Headless Chrome E2E Verification
- Maintain and expand `scripts/verify-terminal-e2e-browser.mjs` and `tests/browser/terminal-overlays-e2e.ts`.
- Add test assertions for keyboard navigation (`Alt+K`), layout button clicks, and visual dark-theme styling in real Chrome.

---

## 7. Caveats
- No changes to source code or tests were made in this turn (strictly read-only specification survey).
- Node, pnpm, and Git must always be accessed via the prepended runtime path in PowerShell on this machine.
- React 19 is used in this repository (`react: ^19.2.0`). Testing Library packages must be compatible with React 19 (e.g. `@testing-library/react` 16.x).
- Headless Chrome testing relies on Google Chrome being installed at `C:\Program Files\Google\Chrome\Application\chrome.exe` (verified present).

---

## 8. Conclusion
- The repository has an exceptionally solid, fast, and 100% passing test baseline (246 files, 2552 tests, 0 failures, ~18s execution time) and 0 TypeScript errors.
- The build (`pnpm build` via Next.js 16 `--webpack`) and Netlify packaging (`scripts/package-netlify.ps1`) compile cleanly and generate all required artifacts.
- The primary testing gap is that all 2552 existing tests are Node-environment algorithm/server tests; there are currently zero Vitest component tests for the AffenTerminal GUI.
- Adding Vitest DOM component tests using `// @vitest-environment jsdom` and `@testing-library/react` will bridge this gap without affecting the speed or stability of existing tests.

---

## 9. Verification Method
To independently reproduce and verify all findings in this report, run the following commands in PowerShell from the project root:

```powershell
# 1. Prepend runtime dependencies to PATH
$r = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$env:PATH = "$r\node\bin;$r\bin\fallback;$r\native\git\cmd;$r\git\cmd;$env:PATH"

# 2. Verify TypeScript strict typecheck (Expected: 0 errors, exit code 0)
pnpm run typecheck

# 3. Verify complete unit test suite (Expected: 246 files passed, 2552 tests passed, exit code 0)
pnpm test

# 4. Verify Next.js production build (Expected: Compiled successfully, /terminal static route generated, exit code 0)
pnpm run build

# 5. Verify Headless Chrome E2E harness (Expected: HEADLESS CHROME E2E PASS, exit code 0)
node scripts/verify-terminal-e2e-browser.mjs

# 6. Verify Netlify packaging script (Expected: artifacts/affentrader-netlify.zip created, exit code 0)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-netlify.ps1
```
