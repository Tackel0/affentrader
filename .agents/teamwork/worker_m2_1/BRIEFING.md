# BRIEFING — 2026-11-14T19:20:00Z

## Mission
Implement Milestone 2 (Bloomberg Command Bar & Function Keys) and Milestone 3 (Dynamic Multi-Pane Workspace & Tile Headers) in AffenTerminal, ensuring zero test regressions, clean typecheck, robust tests, and full Bloomberg-style interaction fidelity.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: c:\Users\Niklas\Desktop\affentrader\.agents\teamwork\worker_m2_1\
- Original parent: 8d2a012e-b70c-4402-a526-772fad1417eb
- Milestone: M2 & M3 (Bloomberg Command Bar, Function Keys, Multi-Pane Workspace & Tile Headers)

## 🔒 Key Constraints
- Exclusive file write ownership:
  - `lib/terminal/commands.ts`
  - `components/ResearchTerminal.tsx`
  - `components/AffenTerminalWindow.tsx`
  - `tests/research-terminal-command-bar.test.tsx`
  - `tests/research-terminal-layout.test.tsx`
  - `.agents/teamwork/worker_m2_1/*`
- Integrity Mandate: Genuine implementation, no cheats, no hardcoded values/facades.
- Maintain compatibility with existing test suite (2,596 tests passing).
- Zero TypeScript errors (`pnpm typecheck`).
- Successful build (`pnpm build`).
- Communication via `send_message` to parent `8d2a012e-b70c-4402-a526-772fad1417eb`.

## Current Parent
- Conversation ID: 8d2a012e-b70c-4402-a526-772fad1417eb
- Updated: not yet

## Task Summary
- **What to build**:
  1. Milestone 2: Expand `lib/terminal/commands.ts` grammar & action parser (layout commands `SPLIT 1/2/3`, `PANE 1/2/3`, `GRID`, `CLEAR`; order commands `BUY/SELL <TICKER> [QTY]`; shortcuts `HELP`, `QUOTE`, `DES`, `WEI`).
  2. In `components/ResearchTerminal.tsx`:
     - Interactive autocomplete dropdown for command keywords, action verbs, and tickers.
     - Persistent command history (last 50 in `localStorage["affentrader-terminal-history"]` with deduplication and `ArrowUp`/`ArrowDown`).
     - Institutional hotkeys and F-keys (F1–F12, Alt+K, Escape, Tab, Ctrl+1/2/3).
  3. Milestone 3:
     - Fix `view === 'fa'` collapse bug in `components/ResearchTerminal.tsx` (secondary pane must not unmount; show complementary analysis like `TerminalMarkets` or `NewsPanel`).
     - Standardized Bloomberg tile headers on every pane (ID & title, view selector, maximize/restore, close button in split-2/3).
     - Active pane focus indicator with high-contrast amber border, `activePane: "p1" | "p2" | "p3"` state, direct command bar actions to active pane.
     - Bounded height and independent overflow (`overflow-y: auto`) on each pane.
  4. Expand tests in `tests/research-terminal-command-bar.test.tsx` and `tests/research-terminal-layout.test.tsx`.
- **Success criteria**: All 2,596+ tests pass, headless Chrome E2E passes, 0 typecheck errors, production build succeeds.
- **Interface contracts**: PROJECT.md § Interface Contracts
- **Code layout**: PROJECT.md § Code Layout

## Key Decisions Made
- [TBD - will document during execution]

## Artifact Index
- `.agents/teamwork/worker_m2_1/DISPATCH.md` — Initial assignment & instructions
- `.agents/teamwork/worker_m2_1/BRIEFING.md` — Situational awareness & memory
- `.agents/teamwork/worker_m2_1/progress.md` — Liveness heartbeat & task progress
- `.agents/teamwork/worker_m2_1/handoff.md` — 5-component handoff report

## Change Tracker
- **Files modified**: None yet
- **Build status**: 2596 tests pass, 0 typecheck errors
- **Pending issues**: None

## Quality Status
- **Build/test result**: Not yet executed in this turn
- **Lint status**: Clean
- **Tests added/modified**: None yet

## Loaded Skills
- None specified by orchestrator
