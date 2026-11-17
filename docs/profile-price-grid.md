# Session Volume Profile and TPO grid correction

Follow-up: [Fixed and visible OHLCV range profiles](range-profiles.md) audits their separate relative grids and integrates the shared estimator into the Visible Range study.

The seven pre-change regressions in `artifacts/profile-price-grid-before.log` reproduced actual financial-data errors in the real models. An execution immediately below 0.3 was snapped up into the 0.3 row by the previous epsilon. TPO lost a touched price row when an OHLC range straddled that boundary, including at negative prices. Tiny SVP executions were combined incorrectly. Both models also rejected distinguishable large-price ticks after rounding the row prices to fourteen significant digits.

## Changes

Session Volume Profile and TPO now use `executionPriceGrid` for decimal row assignment and canonical boundary construction. Automatic row sizes use canonical decimal multiplication. Existing row/session/cell capacity gates remain in place before dense allocation; unsupported numeric grids still fail without returning a partial result.

`ExecutionPriceRow` now includes a canonical decimal center as well as its integer identity and lower/upper boundaries. SVP carries an optional `rowGrid` alongside its unchanged public volume rows. TPO carries optional internal `grid` metadata per row. Existing external/legacy models retain rendering fallbacks; generated models always carry their canonical coordinates. The public `tpoProfile` helper strips the internal grid metadata to preserve its established schema.

The SVP and TPO painters use those generated upper edges and centers for histogram blocks, POC, VAH and session brackets rather than recomputing drifting decimal sums. Tiny SVP line labels use scientific notation instead of being rounded to zero. Total-volume, diagonal, TPO-count and value-area rules are otherwise unchanged: SVP uses classified executions and TPO uses loaded OHLC ranges, not inferred bid/ask trades.

## Verification

- Full suite: **1,378 tests across 115 files**, production build and TypeScript pass. Logs: `artifacts/profile-price-grid-{tests,build,typecheck}.log`.
- Regression coverage includes strict below-boundary execution placement, tiny and negative prices, inclusive TPO range endpoints, retained distinguishable large-price ticks, canonical auto steps, JSON-safe edge/center metadata and the unchanged public TPO schema. Actual painter tests verify projected coordinates and nonzero tiny-price labels. Existing capacity/session/DST/Replay/value-area tests pass. Native SVP tests verify that a precision error clears the old model and a valid setting restores it.
- Production browser with public Hyperliquid BTC: added a temporary SVP, selected row size 10 and Session end placement, and inspected POC/VA labels and the partial-history caption. Row size 1e-12 removed stale profile marks and showed the precision message; restoring 10 recovered the profile. Reload retained the selected row size, and the profile rendered at 375 x 812. Artifacts: `profile-price-grid-svp.jpg`, `profile-price-grid-svp-error.jpg`, `profile-price-grid-svp-mobile.jpg`.
- Actual TPO desktop/mobile rendering was inspected. A 1e-12 row size showed the scoped precision error, survived reload and recovered through Reset TPO settings. Replay recalculated displayed profiles from its revealed candle prefix; deterministic tests verify exclusion of future price extremes and letters. Artifacts: `profile-price-grid-tpo.jpg`, `profile-price-grid-tpo-mobile.jpg`, `profile-price-grid-tpo-error.jpg`, `profile-price-grid-tpo-replay.jpg`.
- Browser warning/error capture: `artifacts/profile-price-grid-browser-errors.json`. The temporary SVP was removed, default TPO settings restored, Replay exited, Candles/recent view restored and the viewport override reset. No orders, drawings or alerts were created.

## Remaining limits

Canonical row assignment operates on already-parsed JavaScript numbers; lost wire-format decimal precision cannot be recovered. Projection still uses finite numeric coordinates. SVP history remains partial and bounded, and TPO remains an OHLC-derived time-at-price approximation over loaded history. Fixed-range/visible-range estimate grids require separate audit. Full TradingView/Vela parity, licensed Nasdaq real-time/US-depth coverage, mobile header/attribution overlap and the separate intermittent older-native-candle issue remain open.
