## 2026-11-14T18:49:25Z
You are the E2E Test Writer for the AffenTerminal Professional Bloomberg-Style Transformation project.
Working directory: c:\Users\Niklas\Desktop\affentrader\.agents\teamwork\teamwork_test_writer_1\

Mandatory request file: Read c:\Users\Niklas\Desktop\affentrader\.agents\teamwork\ORIGINAL_REQUEST.md before starting work. Do NOT skip reading this file.

Master Project Plan: Read c:\Users\Niklas\Desktop\affentrader\PROJECT.md
Survey Analysis to consult:
- Survey 3 (Testing & Build Setup): c:\Users\Niklas\Desktop\affentrader\.agents\teamwork\teamwork_spec_miner_survey_3\handoff.md
- Survey 1 (UI findings): c:\Users\Niklas\Desktop\affentrader\.agents\teamwork\teamwork_explorer_survey_1\handoff.md
- Survey 2 (Functional Architecture): c:\Users\Niklas\Desktop\affentrader\.agents\teamwork\teamwork_explorer_survey_2\handoff.md

Your Exclusive File Write Ownership:
- TEST_INFRA.md (at project root)
- vitest.config.ts
- tests/setup-dom.ts (if needed)
- tests/research-terminal-command-bar.test.tsx
- tests/research-terminal-layout.test.tsx
- tests/affen-terminal-window.test.tsx
- tests/terminal-capm-panel.test.tsx
- TEST_READY.md (at project root)

Objectives:
1. Create TEST_INFRA.md at repository root following the Dual Track testing methodology (Tiers 1 to 4: Feature coverage, Boundary & Corner cases, Cross-Feature, Real-World scenarios).
2. Configure Vitest in `vitest.config.ts` to include `tests/**/*.test.tsx` alongside `tests/**/*.test.ts`, while preserving `environment: "node"` as default so the existing 246 test files remain fast and unaffected.
3. Use `// @vitest-environment jsdom` at the top of each `.test.tsx` file for component testing. Note: If `@testing-library/react` or `jsdom` need configuration or dependencies, check what is in `node_modules` or install / configure minimal robust DOM test harnesses.
4. Implement comprehensive UI component and integration tests:
   - `tests/research-terminal-command-bar.test.tsx`: Command parsing, execution, Alt+K focus, history navigation (ArrowUp/Down), invalid command feedback, ticker sync.
   - `tests/research-terminal-layout.test.tsx`: Layout mode switching (1-Pane, 2-Pane, 3-Pane), secondary pane and tertiary pane rendering, FA view bug test, tab bar switching.
   - `tests/affen-terminal-window.test.tsx`: Header brand, UTC clock, window link groups ('off', 'red', etc.), theme switching, macro pulse ribbon chips, Fear & Greed status.
   - `tests/terminal-capm-panel.test.tsx`: Input validation (rates outside -20 to 50), form submission, calculated statistics display.
5. Verify test execution:
   Run the test suite using the Windows Codex runtime:
   ```powershell
   $r = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
   $env:PATH = "$r\node\bin;$r\bin\fallback;$r\native\git\cmd;$r\git\cmd;$env:PATH"
   pnpm test
   pnpm typecheck
   ```
   Ensure ALL existing 2552 tests pass AND all new tests pass with 0 errors.
6. When tests are fully implemented and passing, create `TEST_READY.md` at project root summarizing the test runner and coverage by tier.


## 2026-11-14T18:59:49Z
**Context**: AffenTerminal E2E Test Suite Creation
**Content**: Checking in on progress for TEST_INFRA.md and Vitest UI component tests. Please provide a brief status update on what step you are currently executing.
**Action**: Update progress.md and reply with your current status.
