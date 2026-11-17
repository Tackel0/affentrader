# AffenTerminal Survey 2: Functional Architecture, Interaction, State & Data Feeds

## 1. Observation

Direct code observations from the codebase investigation:

### 1.1 Command Bar Implementation
- **Files**:
  - `components/ResearchTerminal.tsx` (Lines 64–67, 79–80, 100–109, 157–226, 239–277)
  - `lib/terminal/commands.ts` (Lines 1–128)
- **Direct Observations**:
  - **Parsing**: `parseTerminalCommand(raw: string, currentTicker = "AAPL")` in `lib/terminal/commands.ts:29-127`. Cleans trailing `<GO>` / `GO`, upper-cases, and splits by whitespace up to 2 tokens (`[first, second, extra]`). If `extra` exists, it immediately returns `{ kind: "unknown", raw }` (Line 41).
  - **Supported Single-Token Commands**: `OPPS` / `OPPORTUNITIES` / `SETUPS`, `SCAN` / `BASES`, `VALUE` / `FA` / `FUNDAMENTALS`, `FLOW` / `FOOTPRINT` / `ORDERFLOW`, `CHART` / `GP`, `MACRO` / `CALENDAR` / `YIELDS`, `NEWS`, `MARKETS` / `WEI`, `COMPARE` / `COMP`, `HEATMAP`, `OSINT` / `TANKER` / `AIS` / `FLIGHTS` / `ADSB` / `MAP`, `CAPM` / `BETA`, `HELP` / `?`, or any bare Yahoo ticker (`AAPL`).
  - **Supported Two-Token Commands**: `<TICKER> <ACTION>` or `<ACTION> <TICKER>` where action is in `["FA", "VALUE", "CAPM", "GP", "CHART", "FLOW", "NEWS", "OPPS", "SCAN"]`.
  - **Missing Command Grammar**:
    - No order placement or staging commands (`BUY`, `SELL`, `LIMIT`, `STOP`, `CANCEL`).
    - No workspace layout or pane splitting commands (`SPLIT 1`, `SPLIT 2`, `SPLIT 3`, `PANE 1`, `PANE 2`, `PANE 3`, `GRID`).
    - No quote or instrument summary commands (`QUOTE`, `DES`, `HP`, `DVD`, `SEC`, `PORT`).
    - No terminal cleanup command (`CLEAR`, `CLS`, `RESET`).
  - **Autocomplete**: Completely absent. The `<input>` element in `ResearchTerminal.tsx:247-274` sets `autoComplete="off"` with no datalist, suggestions overlay, or popover.
  - **History**: Initialized in React local state: `const [history, setHistory] = useState<string[]>(["OPPS", "QCOM FA", "OSINT", "HEATMAP", "MARKETS", "AAPL CAPM"]);` (`ResearchTerminal.tsx:65`). Navigated via `ArrowUp` and `ArrowDown` (`ResearchTerminal.tsx:253-268`). Not persisted to `localStorage` or `sessionStorage` (lost on reload).
  - **Action Dispatch**:
    - `{ kind: "view" }`: Sets React state `view` and `ticker`, updates chart store symbol (`ResearchTerminal.tsx:165-174`).
    - `{ kind: "chart" }`: Sets chart store symbol and timeframe `1D` (`ResearchTerminal.tsx:175-180`).
    - `{ kind: "flow" }`: Resolves equity orderflow proxy via `hyperliquidCatalog`, activates Footprint chart, opens bottom panel to orderflow tab, and calls `broadcastWorkspaceAction` (`ResearchTerminal.tsx:181-220`).
    - `{ kind: "capm" }`: Triggers CAPM regression calculation via `/api/terminal-capm` (`ResearchTerminal.tsx:221-224`).
    - `{ kind: "unknown" }`: Sets message `"Unknown command. Enter HELP for available commands..."` (`ResearchTerminal.tsx:225`).
  - **Keyboard Hotkey**: Only `Alt+K` is bound (`ResearchTerminal.tsx:100-109`) to focus the input. `Escape` is not handled.

### 1.2 Multi-Pane Workspace & Layout Management
- **Files**:
  - `components/ResearchTerminal.tsx` (Lines 63, 294–319, 345–541)
  - `app/features.css` (Lines 1773–1780)
- **Direct Observations**:
  - **Layout Mode State**: `const [layoutMode, setLayoutMode] = useState<"single" | "split-2" | "split-3">(externalWindow ? "split-3" : "split-2");` (`ResearchTerminal.tsx:63`).
  - **Grid Specification**:
    ```tsx
    // ResearchTerminal.tsx:350-355
    gridTemplateColumns: layoutMode === "split-3" ? "1.45fr 1fr 0.9fr" : "1.4fr 1fr",
    gap: "12px",
    alignItems: "start",
    ```
  - **Critical Layout Collapse Bug**:
    ```tsx
    // ResearchTerminal.tsx:525-533
    {layoutMode !== "single" && view !== "fa" && (
      <aside className="terminal-secondary-pane" aria-label="Synchronisiertes Fundamental-Panel">
        <FundamentalsPanel
          initialTicker={ticker}
          preloaded={faPreload}
          onOpenChart={openChart}
        />
      </aside>
    )}
    ```
    When `view === "fa"`, the condition `view !== "fa"` evaluates to `false`. As a result, the secondary pane unmounts completely. In `split-2` mode, the layout collapses into a single column with an empty trailing grid track while the segmented button still says `"2-Pane (OPPS + FA)"`. In `split-3` mode, Pane 2 disappears, leaving only Pane 1 and Pane 3.
  - **Hardcoded Pane Contents**:
    - Pane 2 can only ever render `FundamentalsPanel`.
    - Pane 3 (`ResearchTerminal.tsx:535-540`) is hardcoded to render `TerminalMarkets` + `NewsPanel` stacked.
    - Neither Pane 2 nor Pane 3 provides headers, tab switchers, or view selectors.
  - **Resizing**: There are no resizer handles / splitters between panes.
  - **Active Pane Focus**: There is no `activePane` state, no visual border highlighting the active pane, and no ability to direct command bar input to a specific pane.
  - **Keyboard Navigation**:
    - `TAB` does not cycle between panes.
    - `ESC` does not reset pane focus or command bar.
    - `F-keys` (F1–F12) are completely unassigned.

### 1.3 Data Ribbons and Feeds
- **Files**:
  - `components/AffenTerminalWindow.tsx` (Lines 27–28, 59–87, 89–188)
  - `lib/server/macroAndSentimentSources.ts` (Lines 6–36, 45–100)
  - `app/api/feeds/route.ts` (Lines 17–45)
  - `components/BookView.tsx` & `components/DomPanel.tsx`
  - `components/TradingPanel.tsx` & `stores/usePaperStore.ts`
  - `components/PortfolioPanel.tsx` & `stores/usePortfolioStore.ts`
- **Direct Observations**:
  - **Top Macro Pulse Ribbon**:
    - Fetches `/api/feeds?kind=macro` every 120s (`AffenTerminalWindow.tsx:61-76`).
    - Uses real FRED CSV series (`parseFredCsv` for 10Y Treasury, CPI, Fed Funds, GDP).
    - Uses Alternative.me Crypto Fear & Greed index payload (`parseFearGreedPayload`).
    - Uses live/delayed cross-asset prices for `^GSPC` (S&P 500), `^IXIC` (Nasdaq), `GC=F` (Gold), `CL=F` (Crude Oil), `^TNX` (10Y Yield), `BTCUSDT` (Bitcoin), `EURUSD=X` (EUR/USD).
  - **Status & Header Bar**:
    - UTC clock updated every 1,000ms (`AffenTerminalWindow.tsx:79-86`).
    - Window Link Group selector with 7 color groups (`red`, `blue`, `green`, `orange`, `yellow`, `purple`, `off`) transmitting across tabs via `BroadcastChannel` in `hooks/useWindowLink.ts`.
    - Light/Dark theme toggle updating `useWorkspaceStore`.
  - **Order Book / Market Depth**:
    - Powered by `useChartStore((s) => s.orderBook)`:
      - Live mode: WebSocket streams from Binance, Hyperliquid, Alpaca, Kraken.
      - Simulation mode: `depthBookStatus` generates synthetic depth.
    - Rendered in `BookView.tsx` and `DomPanel.tsx` with tick grouping, cumulative/level bars, midpoint, and spread bps.
  - **Positions & Portfolio**:
    - `PortfolioPanel.tsx`: Holdings computed from lots, FIFO/average cost, unrealized/realized PnL, SVG allocation donut, CSV import/export.
    - `TradingPanel.tsx`: Paper trading execution engine (`paperCommands.place`), order tickets with limit/market/stop/stop-limit, bracket TP/SL orders, and SVG equity curve.
  - **Analytical Modules**:
    - `OpportunitiesHub.tsx`: `/api/terminal-opportunities` (Calculates multi-strategy setup scores, R:R, relative strength vs benchmark, VCP squeezes, and preloads fundamentals).
    - `StockBaseScanner.tsx`: `/api/stock-base` (Confirmed double bottoms, range contraction, benchmark outperformance).
    - `FundamentalsPanel.tsx`: `/api/terminal-fundamentals` (SEC Form 4 insider transactions, SEC XBRL valuation ratios, quant momentum/volatility/VaR signals, analyst consensus).
    - `TerminalMarkets.tsx`: `/api/terminal-markets` (Global market indices and commodities with 1d/5d/20d percentage changes).
    - `TerminalCompare.tsx`: `/api/terminal-compare` (Paired returns, relative performance, closing drawdowns).
    - `NewsPanel.tsx`: `/api/feeds?kind=news` (Equities, macro, crypto headlines).
    - `CalendarPanel.tsx`: `/api/feeds?kind=economic|earnings|dividends|yields` (Economic events with live countdowns, earnings, dividends, Treasury yield curves).
    - `OsintMapPanel.tsx`: `/api/osint-map` (Regional Baltic/North Sea AIS marine vessels, ADS-B aircraft flights, energy chokepoints, marine weather).

### 1.4 Dead-End UI Controls & Unhandled States
- **Direct Observations**:
  1. `ResearchTerminal.tsx:525`: If `view === "fa"`, Pane 2 unmounts in `split-2` and `split-3` mode, causing layout collapse and empty space.
  2. `ResearchTerminal.tsx:247-274`: Command input has no dropdown autocomplete or command suggestions; any mistyped command renders a generic text error without recovery hints.
  3. `ResearchTerminal.tsx:65`: History is volatile in-memory state; lost upon navigation or window reload.
  4. `ResearchTerminal.tsx:535-540`: Tertiary pane hardcodes `TerminalMarkets` + `NewsPanel`; no ability to swap, close, or maximize.
  5. `AffenTerminalWindow.tsx:167-181`: Macro ribbon chips open charts via `useChartStore.getState().set({ symbol: a.symbol })`, but if `symbol` is a macro index/future (`^GSPC`, `GC=F`), `OpportunitiesHub` in Pane 1 cannot scan them, leaving the user with an empty setup list unless they navigate to `FA` or `MARKETS`.

### 1.5 Baseline Verification Run
- **Test suite command**:
  `$env:PATH = "C:\Users\Niklas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\Niklas\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;$env:PATH"; pnpm test`
  - Result: **246 test files passed (100%), 2,552 tests passed (100%) in 17.44s**.
- **Typecheck command**:
  `$env:PATH = ...; pnpm typecheck`
  - Result: **0 errors**.
- **Build command**:
  `$env:PATH = ...; pnpm build`
  - Result: **Compiled successfully, 0 errors, generated routes `/` and `/terminal`**.

---

## 2. Logic Chain

1. **Premise 1 (Command Bar)**: Based on `ResearchTerminal.tsx:157-226` and `lib/terminal/commands.ts:29-127`, the command parser only recognises 2-token inputs and 11 view identifiers. It lacks order execution, quote lookup, layout control, and autocomplete. Therefore, the command bar currently functions as a simple tab-switcher rather than a Bloomberg-style operational command interface.
2. **Premise 2 (Workspace Layout)**: Based on `ResearchTerminal.tsx:525-541`, Pane 2 and Pane 3 have fixed component bindings, no resizer dividers, and an unhandled edge case where selecting `FA` collapses Pane 2. Therefore, the multi-pane grid is rigid, vulnerable to layout distortion, and incapable of dynamic multi-module analysis.
3. **Premise 3 (Keyboard Control)**: Based on `ResearchTerminal.tsx:100-109`, only `Alt+K` is registered. Lacking `Tab`, `ESC`, and function keys (`F1`–`F12`), users are forced to use the mouse for virtually all workspace operations, conflicting directly with the Bloomberg terminal paradigm.
4. **Premise 4 (Data Feeds & Ribbons)**: Based on `lib/server/macroAndSentimentSources.ts`, `app/api/feeds/route.ts`, `components/BookView.tsx`, and `components/FundamentalsPanel.tsx`, the application already possesses deep, genuine data integrations (FRED macroeconomic series, SEC Form 4 insider XML, real-time WebSocket order book depth, quant technicals, D3 AIS/ADS-B tracking). It does not rely on synthetic mock place-holders for core analytical panels.
5. **Deductive Conclusion**: The core data feeds, analytical engines, and execution models are robust and fully functional. The gap preventing AffenTerminal from feeling like a professional Bloomberg terminal lies entirely in the **interaction layer**: missing command bar capabilities (autocomplete, order execution, layout commands), rigid multi-pane grid structure, absence of active-pane focus management, and missing keyboard navigation.

---

## 3. Caveats

1. **Standalone `/terminal` vs Embedded Bottom Panel**: `ResearchTerminal` is used both in standalone mode (`/terminal` and popup windows via `AffenTerminalWindow.tsx`) and embedded inside `BottomPanel.tsx` (height 370px). Any layout changes must be responsive to both contexts.
2. **Yahoo Finance Rate Limits**: The macro pulse ribbon and cross-asset quotes depend on Yahoo Finance and FRED endpoints. Under high-frequency polling, rate limiting (HTTP 429) can occur, so client-side cache and abort controllers must be maintained.
3. **Execution Routing**: Paper trading orders via `paperCommands.place` require an active symbol and trading session; commands executed for index instruments (`^GSPC`, `^IXIC`) that do not have perpetual or equity contracts must fail gracefully with informative feedback.

---

## 4. Conclusion & Actionable Recommendations

AffenTerminal possesses a high-quality data and calculation backend, but its front-end interaction model currently limits its institutional utility. To complete the Bloomberg-style transformation, the following roadmap is recommended:

### Recommendation 1: Enhanced Bloomberg Command Bar (`AffenTerminalCommandBar`)
1. **Interactive Autocomplete Overlay**:
   - As the user types, show an institutional command palette dropdown matching commands (`OPPS`, `FA`, `FLOW`, `MARKETS`, `NEWS`, `OSINT`, `HEATMAP`, `COMPARE`, `CAPM`, `HELP`), tickers (`AAPL`, `MSFT`, `NVDA`), and actions (`<GO>`, `GP`, `FA`, `FLOW`, `BUY`, `SELL`).
2. **Direct Trading & Order Commands**:
   - Extend `lib/terminal/commands.ts` to parse:
     - `BUY <TICKER> <QTY>` (e.g., `BUY AAPL 100`)
     - `SELL <TICKER> <QTY>` (e.g., `SELL NVDA 50`)
     - `LIMIT <PRICE>` / `BUY <TICKER> <QTY> @ <PRICE>`
   - Dispatch directly to `paperCommands.place` or open the staged order ticket.
3. **Layout & Pane Control Commands**:
   - Support `SPLIT 1` / `1-PANE`, `SPLIT 2` / `2-PANE`, `SPLIT 3` / `3-PANE`, `PANE 1`, `PANE 2`, `PANE 3`, `FULLSCREEN`, `CLEAR`.
4. **Persistent Command History**:
   - Save the last 50 commands in `localStorage` (`affentrader-terminal-history`) with deduplication.
5. **Keyboard Handling**:
   - `Escape`: Clear command input or blur to return focus to active pane.
   - `Tab`: Autocomplete highlighted suggestion or cycle active pane.

### Recommendation 2: Flexible Multi-Pane Workspace (`TerminalWorkspace`)
1. **Dynamic Pane State Model**:
   - Replace the fixed primary/secondary/tertiary hardcoded structure with a state array:
     ```ts
     interface TerminalPaneState {
       id: "p1" | "p2" | "p3";
       view: TerminalView;
       ticker: string;
     }
     ```
   - Allow any view (`opps`, `fa`, `markets`, `news`, `compare`, `heatmap`, `osint`, `dom`, `trading`) to be rendered in any pane.
   - Fix the `view === "fa"` collapse bug by keeping Pane 2 active and allowing it to display complementary information (e.g. `markets` or `news`) if Pane 1 is set to `fa`.
2. **Bloomberg Pane Headers**:
   - Every pane should feature a standardized Bloomberg-style header bar:
     - Pane identifier and title (e.g., `P1: TRADE SETUPS · QCOM`).
     - Quick View switcher dropdown.
     - Maximize / Restore icon.
     - Close Pane icon (in split-2 and split-3 modes).
3. **Draggable Dividers / Splitters**:
   - Insert interactive resizer handles between panes with pointer capture and keyboard arrow resize support (similar to `sidebar-resizer` in `TradingWorkspace.tsx`).
4. **Active Pane Focus State**:
   - Track `activePane: "p1" | "p2" | "p3"`.
   - Add high-contrast amber/gold border on the focused pane.
   - Route command bar actions to the active pane by default.

### Recommendation 3: Institutional Keyboard Navigation (F-Keys & Shortcuts)
- Implement global keydown handler in `ResearchTerminal` / `AffenTerminalWindow`:
  - `F1`: HELP (Interactive command reference & shortcut overlay)
  - `F2`: OPPS (Trade-Möglichkeiten)
  - `F3`: FA / VALUE (Financial Analysis & Fundamentals)
  - `F4`: MARKETS / WEI (World Equity Indices)
  - `F5`: REFRESH (Reload active pane data)
  - `F6`: SCAN (Stock Base Scanner)
  - `F7`: COMPARE (Relative Performance & Drawdown)
  - `F8`: NEWS (Headlines & RSS)
  - `F9`: ORDER / TRADE (Order Ticket & Paper Positions)
  - `F10`: HEATMAP (Sector & Asset Treemap)
  - `F11`: OSINT (Tankers, Flights, Chokepoints)
  - `F12`: FULLSCREEN (Toggle full screen)
  - `Ctrl + 1 / 2 / 3`: Focus Pane 1 / Pane 2 / Pane 3.

### Recommendation 4: Top Ticker Ribbon & Status Line Polish
- In `AffenTerminalWindow.tsx`, ensure clicking any asset in the Top Macro Pulse Ribbon (`^GSPC`, `GC=F`, `CL=F`, `AAPL`, etc.) intelligently updates the active pane's ticker or opens its daily chart / comparison.
- Add real-time visual pulse indicators (amber/green/red) for WebSocket and REST feed freshness.

---

## 5. Verification Method

To independently verify all findings and test suite integrity:

1. **Verify Test Suite**:
   ```powershell
   $runtimePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
   $env:PATH = "$(Join-Path $runtimePath 'node\bin');$(Join-Path $runtimePath 'bin\fallback');$env:PATH"
   pnpm test
   ```
   *Expected outcome*: 246 test files passed, 2,552 tests passed.
2. **Verify Typecheck**:
   ```powershell
   pnpm typecheck
   ```
   *Expected outcome*: 0 TypeScript errors.
3. **Verify Build**:
   ```powershell
   pnpm build
   ```
   *Expected outcome*: Production build finishes with static routes `/` and `/terminal`.
4. **Verify Observations in Source Files**:
   - Inspect `components/ResearchTerminal.tsx:525` to confirm the secondary pane conditional `{layoutMode !== "single" && view !== "fa" && ...}`.
   - Inspect `lib/terminal/commands.ts:40-41` to confirm the two-token limit and absence of order or layout commands.
   - Inspect `components/AffenTerminalWindow.tsx:149-188` to confirm the macro pulse feed integration.
