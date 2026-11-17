# Project: AffenTerminal Professional Bloomberg-Style Transformation

## Architecture
- **Application Core**: Next.js 16.4.3 (Webpack bundler), React 19.2.0, TypeScript 5.9.3 (strict mode).
- **Terminal Entry Points**:
  - Standalone: `/terminal` route (`app/terminal/page.tsx`), isolated popout storage scope `affentrader-chart-v1@affen-terminal`.
  - Embedded: Main trading workspace toolbar launcher (`WorkspaceToolbar.tsx`) and bottom dock (`ResearchTerminal.tsx`).
- **Styling Architecture**:
  - Global CSS variables (`app/globals.css`), terminal features (`app/features.css`), and modular styles.
  - Visual standard: Institutional Bloomberg Terminal / OpenBB (deep pitch charcoal `#08090c` / `#0d0f14`, hairline borders `#1c202a`, zero corner roundings, amber `#ff9e00` command/`<GO>` accents, cyan `#00e5ff` telemetry, tabular monospace numbers, dense 24px rows).
  - No AI-slop: zero pill badges (`999px`), zero pastel lavender/purple gradients with drop shadows, zero multi-sentence tutorial blurbs, zero desktop breakpoint collapsing to 1fr.
- **Interaction Architecture**:
  - Command Bar: Enhanced Bloomberg parser in `lib/terminal/commands.ts`, autocomplete overlay, persistent `localStorage` history, direct trading & layout commands.
  - Workspace Grid: Dynamic multi-pane management (1-Pane, 2-Pane, 3-Pane) with standardized Bloomberg tile headers, active pane focus indicator (amber border), resizer dividers, and independent scroll containers.
  - Keyboard Navigation: Global hotkeys (`Alt+K`, `Escape`, `Tab`, `F1`–`F12` Bloomberg function keys).
- **Testing Architecture**:
  - Vitest v3.2.7 running in strict node mode for 246 backend test files (2552 tests).
  - React Testing Library with per-file `// @vitest-environment jsdom` for new UI component tests in `tests/`.
  - Headless Chrome DevTools Protocol E2E harness (`scripts/verify-terminal-e2e-browser.mjs`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Bloomberg Dark Theme & Palette | Charcoal `#08090c`, hairline borders, zero-radius corners, Amber/Cyan/Green/Red palette | M1 | Survey 1 |
| 2 | Slop Removal: Pill Badges & Gradients | Replace 999px pill `.chip` with sharp 0px/1px badges, eliminate lavender `#9695ff` drop shadows | M1 | Survey 1 |
| 3 | Slop Removal: Tutorial Text Blurbs | Replace sprawling descriptive paragraphs with compact status ribbons/tooltips | M1 | Survey 1 |
| 4 | Streamlined Header & Macro Pulse | Compact 32px top ribbon with cross-asset ticks, Fear & Greed, UTC clock, sync chips | M1 | Survey 1 & 2 |
| 5 | Responsive Desktop Grid Stability | Remove disruptive `@media (max-width: 1120px)` collapse to 1fr; maintain multi-pane down to 800px | M1 | Survey 1 |
| 6 | Bloomberg Command Bar Grammar | Expand parser to support layout (`SPLIT 1/2/3`, `PANE 1/2/3`, `CLEAR`), orders (`BUY/SELL`), shortcuts | M2 | Survey 2 |
| 7 | Command Autocomplete Overlay | Live dropdown suggestions matching commands, tickers, and actions while typing | M2 | Survey 2 |
| 8 | Persistent Command History | Last 50 commands saved in `localStorage` (`affentrader-terminal-history`) with ArrowUp/Down traversal | M2 | Survey 2 |
| 9 | Institutional Function Keys & Hotkeys | F1–F12 function key shortcuts for views, `Alt+K` command focus, `Escape` blur/clear, `Tab` cycle | M2 | Survey 2 |
| 10 | Dynamic Multi-Pane State & Tile Headers | Bloomberg pane headers (ID, Title, View Switcher, Close, Maximize), fix `view === 'fa'` collapse bug | M3 | Survey 2 |
| 11 | Active Pane Focus Indicator | `activePane` state with high-contrast amber border, routing commands to focused pane | M3 | Survey 2 |
| 12 | Pane Resizer Dividers & Independent Scroll | Draggable splitters between panes with independent `overflow-y: auto` containers | M3 | Survey 2 |
| 13 | Component Unit Test Suite | Vitest + React Testing Library tests for Command Bar, Layout, Window, and Tabs | M4 | Survey 3 |
| 14 | E2E Integration & Interaction Coverage | Expanded tests for multi-pane switching, Alt+K, history, theme toggle, and URL params | M4 | Survey 3 |
| 15 | Typecheck & Build Verification | 0 TypeScript errors (`tsc --noEmit`), clean Next.js 16 build (`pnpm build`), Netlify zip package | M5 | Survey 3 |
| 16 | CODEX_HANDOFF Documentation | Comprehensive architecture, UI guidelines, and test instructions in `CODEX_HANDOFF.md` | M5 | Survey 3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Bloomberg Design System & Shell Refactor | Clean institutional theme, remove pill chips & gradients, compact top ribbon, remove 1120px collapse | Survey | DONE (2596 tests pass, 0 TS errors, clean build) |
| M2 | Bloomberg Command Bar & Function Keys | Parser extensions, autocomplete overlay, persistent history, F1–F12 hotkeys | M1 | IN_PROGRESS |
| M3 | Dynamic Multi-Pane Workspace & Tile Headers | Tile headers, fix `view === 'fa'` bug, active pane border, pane resizers, scroll bounds | M1, M2 | IN_PROGRESS |
| M4 | Automated UI Component & E2E Testing Suite | JSDOM Vitest setup, command bar tests, layout tests, window tests, verify 2552+ tests pass | M1, M2, M3 | DONE (TEST_READY.md published, 44 tests, 2596 total tests pass) |
| M5 | Final Verification, Netlify Package & CODEX Handoff | Full build (`pnpm build`), typecheck, Netlify packaging, and update `CODEX_HANDOFF.md` | M1, M2, M3, M4 | PLANNED |

## Interface Contracts
### `lib/terminal/commands.ts` ↔ `components/ResearchTerminal.tsx`
- `parseTerminalCommand(raw: string, currentTicker?: string): ParsedTerminalCommand`
- Supported kinds:
  - `{ kind: "view", view: TerminalView, ticker?: string }`
  - `{ kind: "chart", ticker: string }`
  - `{ kind: "flow", ticker: string }`
  - `{ kind: "capm", ticker: string }`
  - `{ kind: "layout", mode: "single" | "split-2" | "split-3" }`
  - `{ kind: "order", action: "BUY" | "SELL", ticker: string, qty?: number, price?: number }`
  - `{ kind: "unknown", raw: string }`

### `components/ResearchTerminal.tsx` ↔ `components/AffenTerminalWindow.tsx`
- Prop contracts:
  - `externalWindow: boolean`
  - `initialView?: TerminalView`
  - `initialTicker?: string`
  - `onViewChange?: (view: TerminalView) => void`
  - `onTickerChange?: (ticker: string) => void`

## Code Layout
- `components/AffenTerminalWindow.tsx`: Standalone window shell, top macro ribbon, UTC clock, window link groups, theme switcher.
- `components/ResearchTerminal.tsx`: Core terminal workspace, command bar, multi-pane layout, sub-panel mounting.
- `components/OpportunitiesHub.tsx`: Trade opportunities table, filters, candlestick mini-charts.
- `components/FundamentalsPanel.tsx`: Valuation ratios, SEC Form 4 insider trades, analyst consensus, quant scores.
- `components/StockBaseScanner.tsx`: Base formation scanner and chart.
- `components/TerminalMarkets.tsx`: World markets matrix (1d/5d/20d returns).
- `components/TerminalCompare.tsx`: Paired asset comparison and drawdown chart.
- `components/CalendarPanel.tsx`, `components/NewsPanel.tsx`, `components/HeatmapPanel.tsx`, `components/OsintMapPanel.tsx`: Specialized analytical sub-panels.
- `lib/terminal/commands.ts`: Terminal command grammar, tokenizer, and action dispatch helper.
- `app/globals.css`: Base color variables, reset, typography, buttons, tabs.
- `app/features.css`: Terminal grid styling, badges, panes, ribbons, command bar styles.
- `tests/`: Automated Vitest test suite (`*.test.ts`, `*.test.tsx`).
- `CODEX_HANDOFF.md`: Authoritative engineering handoff and architecture record.
