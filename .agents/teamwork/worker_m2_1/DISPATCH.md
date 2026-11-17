# Worker M2-3 Dispatch

## 2026-11-14T19:16:37Z
You are Worker M2-3 for the AffenTerminal Bloomberg-Style Transformation project.
Working directory: c:\Users\Niklas\Desktop\affentrader\.agents\teamwork\worker_m2_1\

Mandatory request file: Read c:\Users\Niklas\Desktop\affentrader\.agents\teamwork\ORIGINAL_REQUEST.md before starting work. Do NOT skip reading this file.

Master Project Plan: Read c:\Users\Niklas\Desktop\affentrader\PROJECT.md
Survey Analysis to consult:
- Survey 2 (Functional Architecture & Commands): c:\Users\Niklas\Desktop\affentrader\.agents\teamwork\teamwork_explorer_survey_2\handoff.md
- Test Suite & Infra: c:\Users\Niklas\Desktop\affentrader\TEST_READY.md and c:\Users\Niklas\Desktop\affentrader\TEST_INFRA.md

Your Exclusive File Write Ownership:
- lib/terminal/commands.ts
- components/ResearchTerminal.tsx
- components/AffenTerminalWindow.tsx
- tests/research-terminal-command-bar.test.tsx
- tests/research-terminal-layout.test.tsx

Milestones 2 & 3 Implementation Scope:
1. Milestone 2: Bloomberg Command Bar & Function Keys
   - In `lib/terminal/commands.ts`: Expand grammar and action parser:
     * Layout commands: `SPLIT 1` / `1-PANE`, `SPLIT 2` / `2-PANE`, `SPLIT 3` / `3-PANE`, `PANE 1`, `PANE 2`, `PANE 3`, `GRID`, `CLEAR`.
     * Order staging commands: `BUY <TICKER> [QTY]`, `SELL <TICKER> [QTY]` (dispatching to paper trading or opening order ticket).
     * Shortcuts: `HELP`, `QUOTE <TICKER>`, `DES <TICKER>`, `WEI`.
   - In `components/ResearchTerminal.tsx`:
     * Interactive Autocomplete Dropdown: As the user types, display matching command keywords, action verbs, and tickers.
     * Persistent Command History: Store last 50 commands in `localStorage` (`affentrader-terminal-history`) with deduplication; navigate with `ArrowUp` / `ArrowDown`.
     * Institutional Hotkeys & Function Keys (F1–F12):
       - `F1`: Help modal / cheat sheet
       - `F2`: OPPS (Trade-Setups)
       - `F3`: FA (Fundamentals)
       - `F4`: MARKETS
       - `F5`: Refresh active data
       - `F6`: SCAN (Stock Bases)
       - `F7`: COMPARE
       - `F8`: NEWS
       - `F9`: ORDER / TRADE
       - `F10`: HEATMAP
       - `F11`: OSINT (Marine & Aviation)
       - `F12`: FULLSCREEN toggle
       - `Alt+K`: Focus command bar
       - `Escape`: Clear command bar or blur
       - `Tab`: Autocomplete highlighted suggestion or cycle pane
2. Milestone 3: Dynamic Multi-Pane Workspace & Tile Headers
   - Fix the `view === 'fa'` collapse bug in `components/ResearchTerminal.tsx`:
     * When `view === "fa"` in 2-Pane or 3-Pane mode, secondary pane must NOT unmount or collapse! Instead, render complementary analysis (e.g. `TerminalMarkets` or `NewsPanel`).
   - Standardized Bloomberg Tile Headers:
     * Every pane (Primary, Secondary, Tertiary) must render a crisp Bloomberg header bar:
       - Pane ID & Title (e.g., `P1: TRADE SETUPS · QCOM`, `P2: FUNDAMENTALS · QCOM`, `P3: GLOBAL MARKETS`)
       - View selector dropdown
       - Maximize / Restore button
       - Close button (in split-2 and split-3 mode)
   - Active Pane Focus Indicator:
     * Track `activePane: "p1" | "p2" | "p3"` state.
     * Render high-contrast amber border on the active pane.
     * Allow clicking any pane or pressing `Ctrl+1 / 2 / 3` or `Tab` to shift focus.
     * Direct command bar actions to the active pane.
   - Bounded height & independent overflow:
     * Ensure each pane tile has independent `overflow-y: auto` so tertiary pane stacking does NOT push the entire page into a global scrollbar.
3. Update and expand component tests in `tests/research-terminal-command-bar.test.tsx` and `tests/research-terminal-layout.test.tsx` to verify all new commands, autocomplete, history persistence, F-keys, and the `view === 'fa'` bugfix.


## 2026-11-15T15:03:50Z
**Context**: AffenTerminal Milestones 2 & 3 Resume
**Content**: The system has resumed after server restart. Please continue and complete your assigned implementation for Milestones 2 & 3:
1. Enhanced command parser in `lib/terminal/commands.ts` (layout commands SPLIT 1/2/3, PANE 1/2/3, BUY/SELL, HELP, etc.).
2. Autocomplete overlay, persistent localStorage history, institutional hotkeys & F1-F12 keys in `components/ResearchTerminal.tsx`.
3. Dynamic multi-pane workspace with standardized Bloomberg tile headers, active pane focus border, and the fix for the `view === 'fa'` collapse bug in `components/ResearchTerminal.tsx`.
4. Update and expand tests in `tests/research-terminal-command-bar.test.tsx` and `tests/research-terminal-layout.test.tsx`.
5. Verify `pnpm typecheck`, `pnpm test`, `node scripts/verify-terminal-e2e-browser.mjs`, and `pnpm build`.
6. Write your handoff report to `c:\Users\Niklas\Desktop\affentrader\.agents\teamwork\worker_m2_1\handoff.md`.
**Action**: Resume execution from Step 2 and deliver your handoff report when complete.
