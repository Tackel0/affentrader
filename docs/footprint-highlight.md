# Independent Footprint highlight controls

The retained official Vela client and its settings descriptors are recorded in
`artifacts/footprint-imbalance-reference-controls.json` (source SHA256
`b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b`).

Implemented on 2026-11-05:

- Highlight and value recolor default **off**. Outline width defaults to 2 and
  accepts integer values 1–10. Ask/Bid outlines and Ask/Bid values have four
  independent palettes, separate from histogram/candle colors and stack fills.
- Ratio (%) accepts 100–10,000, default 300, native step 50. The new persisted
  `imbalancePercent` is authoritative when present; `imbalanceRatio` remains the
  internal multiplier. Old layouts containing only a multiplier migrate to its
  percent equivalent. A new percentage edit intentionally overrides an old ratio.
- Highlight rectangles cover the corresponding half-slot in all five modes.
  Ladder uses insets on both edges; other modes reach the central axis. Insets
  honor line width, full row height and the one-pixel row gap. Ladder retains the
  reference's signed-width rectangles when large insets cross inside a narrow
  slot; the common painter suppresses nonpositive rectangles in other modes.
- Centered Total/Delta/Trades values use the Ask flag first, otherwise Bid, while
  recolor is enabled. Delta sign alone does not tint numbers. Bid × Ask values
  tint independently per side. Explicit false flags and hidden rows remain in force.
- All five native chart instances, including disabled saved slots, the independent
  visible aggregate and both study overlays retain the new controls. Stored old
  histogram colors migrate to the former coupled outline/value palettes when
  independent colors are absent. Old explicit highlight/recolor switches survive.
- Migration runs before SDK defaults are merged for primary and secondary native
  studies; chart configuration is normalized before application. View changes
  do not create market ticks or replay historical alarms.

Verification:

- Nine new regressions cover default-off/legacy behavior, independent palette
  application, actual canvas rectangle geometry in every mode on both axes,
  uncapped row height and narrow/short-row limits, Ask-first center labels,
  percent precedence/migration in both overlays, disabled-instance/range strict
  persistence and the native input surface. Focused: 293 tests in 27 files passed.
- `scripts/verify-footprint-highlight-reference.ts` evaluates only the reviewed,
  hash-pinned pure canvas helpers and Ladder outline block in an isolated VM,
  never the full public application bundle. **1,280** actual-reference versus
  actual-painter rectangle comparisons pass across five modes, four line widths,
  four slot widths, four row heights and all side-flag pairs. This is a direct
  ordinary-axis outline comparison; it does not establish full pixel equivalence
  or inverted-reference behavior. Report: `artifacts/footprint-highlight-reference.json`.
- Native simulated five-mode comparison uses orange/blue outlines and cyan/purple
  values while the histograms remain green/red. Raising the native ratio from
  300% to 500% removes all ten exact-threshold side flags without new trades.
  Native Reset defaults yields outline/recolor off, width 2 and ratio 300.
  Screenshots: `artifacts/footprint-highlight-comparison.png`,
  `footprint-highlight-defaults.png`; browser evidence JSON alongside.
- Isolated full production app with real Binance data: 750%, width 6 and Ask text
  `#9c27b0` survive reload while Ask outline stays `#089981`. At 414px, the ratio
  was edited to 800 and restored to 750; the same color picker exposes the saved
  value. Existing default-on legacy switches were retained. No console errors.
  Evidence: `artifacts/footprint-highlight-native-evidence.json` and native
  settings/mobile screenshots. No real access credential was read or changed.
- Full suite: **2,325 tests in 214 files passed**, standalone TypeScript and
  production build passed. Relevant logs use the `footprint-highlight-` prefix.

Mode-specific histogram palettes were subsequently completed and checked in
`footprint-palette.md`. Remaining: exact text alignment/auto sizing/fit
controls, other default/style comparisons, populated multi-chart, browser recorded
Replay and full-capacity rendering. This increment does not establish complete
Footprint or Orderflow parity, original historical data or full exchange coverage.
