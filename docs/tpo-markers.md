# TPO markers and price labels

Native TPO settings now include separate controls for Session open marker,
Session close marker, Session midpoint, POC price label, VAH price label and
VAL price label. Open/close/midpoint have color controls. They default off to
preserve existing chart appearance; the official reference does not specify
these defaults. Price-label switches are retained independently, while rendering
and settings visibility follow the parent POC / Value area switch.

Reference inspected 2026-11-04:
https://docs.luxalgo.com/platform/charts/order-flow/tpo

## Source and rendering

The opening arrow uses the opening candle's observed open, only if the session
opening is loaded. A missing prefix cannot establish the first traded price.
The closing arrow follows the last loaded candle's close and is positioned at
that candle's chart time. It is not asserted to be the final session close when
the session is developing or coverage is incomplete. Missing or invalid optional
open/close fields suppress that arrow without destroying otherwise valid TPO
opportunities. These are OHLC prices, not individual execution timestamps.

The midpoint uses the actual loaded session high/low, not rounded profile row
bounds. Canonical decimal arithmetic avoids overflow/cancellation and preserves
representable subnormal midpoints. Composites recompute their opening, last close
and midpoint from their revealed member candles. Replay prefixes cannot acquire
future extrema or closing prices. The Data window exposes all values and their
source/completion status, even when the corresponding marker is hidden.

POC, VAH and VAL labels use the model's canonical row centers/boundaries just
outside the session's left edge. Rounded backgrounds use the corresponding
POC / VA color and contrast text. Overlapping tags are omitted in POC, VAH,
VAL priority order without moving their price anchors. Native tags follow row
decimals (POC half-row decimals), up to eight places; model/readout precision
is unchanged. Narrow profiles omit tags below a 6px font. Arrows and midpoint
obey viewport bounds on normal and inverted price axes. The volume ladder's
separate label arrangement remains unchanged by this price-tag follow-up.

The cache now observes open/close revisions. Quote-only updates refresh marker
metadata while retaining the price rows, POC/VA, IB and structure objects.
Mathematical source changes continue to rebuild those objects. The pinned Vela
selected-bar adapter now includes tail open/close fields in the Data-window
fingerprint, preventing a stale close-only snapshot before a new paint. The
adapter recognizes its older versions and remains idempotent.

## Evidence

- Eleven new tests in `tests/tpo-markers.test.ts`: exact midpoint arithmetic,
  observed prices and exclusive prefixes, missing/invalid optional OHLC,
  composites, quote repairs/cache reuse, legacy/native options, regular/inverted
  painter geometry, independent toggles, label collisions, incomplete-close
  status and stale quote-only readout fencing.
- Full suite **1,905 tests in 174 files passed**, standalone TypeScript and
  production build. Logs: `artifacts/tpo-markers-tests.log`,
  `artifacts/tpo-markers-typecheck.log`, `artifacts/tpo-markers-build.log`.
- `scripts/verify-tpo-markers-live.ts` independently groups the retained public
  Kraken response from `artifacts/tpo-split-live.json`, excluding its forming row.
  Integer quote-unit arithmetic and raw OHLC agree with opening, last close,
  low/high and midpoint for **73 profiles across six Day/Week/Month and merged
  combinations**, using 720 closed hourly candles. Capture provenance and
  results: `artifacts/tpo-markers-live.json`. This is retained-source validation,
  not a fresh full execution-history claim.
- Isolated production browser: actual Binance 15m/4h-TPO marker and level-label
  rendering, live Data values, all six controls retained after reload, 414px
  native settings and midpoint off/on operation. Captured browser warnings and
  errors were empty. Screenshots: `artifacts/tpo-markers-desktop.png`,
  `artifacts/tpo-markers-mobile.png`, `artifacts/tpo-markers-mobile-settings.png`.

## Remaining parity

Price-tag follow-up: six new `tests/tpo-price-tags.test.ts` cases cover outside
placement, rounded background/contrast colors, parent-switch gating, collision
priority, canonical row/half-row formatting, inverted/off-pane coordinates,
minimum profile width and conditional overlay controls. Full suite: **2,026
tests across 188 files passed** (`artifacts/tpo-price-tags-tests.log`); standalone
TypeScript and production build passed (`artifacts/tpo-price-tags-build.log`).
Isolated production-browser Kraken BTC/USD 15m checks confirmed visible tags,
parent off/on behavior with retained label choices, and reload persistence.
Screenshot: `artifacts/tpo-price-tags-native.png`.

Exact Vela visual/default/numeric-format comparison is still unproven. Full
multi-chart, browser recorded Replay, touch-device and capacity/performance
verification remain open. Native labels may share space with chart trading
controls near the top of a narrow plot; full overlay equivalence is unverified.
Trading-hour calendars/presets, TPO metric themes, volume ladder, hover and the
remaining Orderflow checklist are not completed by this checkpoint.
