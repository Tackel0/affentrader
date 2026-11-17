# Footprint mode palettes

The inspected official Vela controls provide separate Bid/Ask, Volume Buy/Sell,
Delta Up/Down and mono ramp colors. Retained descriptors and source hash are in
`artifacts/footprint-display-reference-controls.json`.

Implemented on 2026-11-05:

- Bid × Ask Profile and Ladder use `bidColor` / `askColor`.
- Split Volume Profile uses `volumeSellColor` / `volumeBuyColor`; mono uses its
  existing independent low/high ramp. Both Delta modes use `deltaDownColor` /
  `deltaUpColor`. Shared legacy `buyColor` / `sellColor` remain candle colors.
- Mode/split conditions expose only the applicable palette in chart settings and
  both native overlays. All five instances and the visible aggregate retain their
  own values, including disabled slots in backups/layouts.
- Old explicit shared colors migrate into absent independent palettes before SDK
  defaults are merged. Explicit new palette values take precedence. Chart binding
  materializes the normalized palettes once even when its signature is unchanged;
  otherwise a first candle-color edit on an empty native default bag could be
  mistaken for a legacy shared-color import. Later candle edits stay independent.
- Side gradients retain reference alpha and light/dark interpolation. The mono
  volume ramp always interpolates by row volume, including while Gradient cells
  is off. The previous gradient-off/high-color-only behavior was incorrect.
- This changes view preferences and drawing colors, not original executions,
  quantities, grid membership, classifications or alert delivery.

Verification:

- Six palette regressions plus a startup-binding regression cover independent
  field routing, alpha/ramp behavior, pre-default migration for both overlays,
  explicit precedence, immutable inputs, active/disabled/range strict persistence,
  conditional controls and first-edit separation from candle colors. Focused
  gate: 300 tests in 28 files passed.
- `scripts/verify-footprint-palette-reference.ts` evaluates only reviewed pure
  shade/mono interpolation functions from the hash-pinned retained Vela source,
  never its application bundle. **288 shade and 60 mono comparisons** pass for
  alpha, clamping, gradients and both sides of the light-theme threshold.
  Report: `artifacts/footprint-palette-reference.json`.
- Native simulated six-profile comparison shows independent Bid/Ask orange/blue,
  Volume split cyan/purple, gray mono ramp and Delta red/green. Toggling gradients
  changes the colored profiles while mono stays unchanged. Screenshots:
  `artifacts/footprint-palette-flat.png`, `footprint-palette-gradient.png`;
  browser evidence JSON alongside. This is application rendering, not full Vela
  screenshot equality or actual market coverage.
- Isolated production app with live Binance data: custom Delta down `#3344aa`
  survives reload while Bid histogram stays `#f23645`. At 414px, Bid/Ask controls,
  the mono ramp and toggled split Volume Buy/Sell controls remain reachable.
  No browser console errors. Evidence:
  `artifacts/footprint-palette-native-evidence.json` and native mobile screenshots.
- **2,332 tests in 215 files passed** and production build/type checking passed.
  Logs: `artifacts/footprint-palette-tests.log`, `footprint-palette-build.log`.

Text formatting/alignment/auto-size/fitting were subsequently implemented and
checked in `footprint-text.md`. Remaining: full direct
rendering/default comparisons, populated multi-chart, recorded browser Replay and
full-capacity acceptance. Complete Footprint/Orderflow parity is not established.
