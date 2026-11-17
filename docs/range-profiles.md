# Fixed and visible OHLCV range profiles

Update 2026-11-01: both profiles now also support an explicitly selected **Classified executions** source. See [execution range profiles](execution-range-profiles.md) for actual-price allocation, archive/Replay boundaries, native settings, worker verification and current limitations. The OHLCV calculation described below remains the default estimate.

Fixed Range and Visible Range Volume Profile now share the same volume-conserving estimator. They remain **OHLCV estimates**: each candle's volume is distributed uniformly over its high/low range, with up/down classified by candle direction. These are not executed bid/ask quantities.

## Relative price grids

`rangePriceGrid.ts` constructs equal-width rational boundaries from the canonical decimal minimum/maximum and row count. Point candles on an exact boundary enter the correct row, while a price strictly below the boundary remains below it. Non-flat ranges exclude zero-measure endpoint touches. Rational thirds retain their actual assignment boundary even though projection coordinates must round to a JavaScript number.

Overlap weights use integer rational geometry before conversion to floating-point quantities. A guarded Number fast path uses only safe integer operands/products and corrects the quotient against exact products; other cases use BigInt. Invalid/collapsed/overflowing projection grids fail explicitly. The bounded canonical-decimal cache contains at most 16,384 representations.

`fixedProfileModel.ts` carries explicit edges and centers into developing POC/VA points. Flat tiny-priced candles use a price-relative span instead of a coarse absolute floor. The native drawing factory still owns anchors, properties, hit tests and persistence, while `fixedProfilePlugin.ts` substitutes canonical y edges, POC/VA coordinates and price extents. Existing 50,000 static-bar and 5,000 developing-bar limits remain.

## Visible Range integration

The app catalog's existing `vpvr` definition now maps to the native SDK contribution `af-visible-profile`. Existing saved definition IDs and six control keys remain valid. It uses a per-instance renderer/cache, supports multiple independent instances, and compares every selected candle by value. Repairs to older visible candles with unchanged endpoints therefore invalidate the result. Fractional logical bounds include partially visible end candles; Replay sees only the revealed bar surface.

The renderer supports normal/inverted projection, retains up/down colors, width, rows, value-area shading and POC visibility, and names the source **VRVP · OHLCV estimate** beside the Vela attribution. The second line reports the actual visible loaded-bar count and estimated volume. Empty/error results replace old marks with a source/error explanation. Hiding, removal and stop clear the data channel. The catalog no longer adds the legacy built-in as a duplicate of the app's corrected entry. The settings dialog explains the calculation and omits ineffective generic price-source/line-style controls; legend arguments omit colors and false style toggles.

## Evidence

- Full suite: **1,389 tests in 116 files**, production build and TypeScript checks. Logs: `artifacts/range-profiles-{tests,build,typecheck}.log`.
- Tests cover decimal boundary points, strictly preceding points, rational thirds, inclusive point/exclusive measure endpoints, narrow high-price overlap fractions, volume/POC/developing levels, flat tiny prices, collapse/overflow, older visible-bar repairs, Replay prefixes, control validation, native payload lifecycle, inverted painting and source/error captions. A test runs the actual native Fixed Range drawing layout with the decimal-boundary case.
- Production Hyperliquid BTC browser: adding VRVP rendered 600 visible bars/54.16K estimated volume. Reset to recent candles recalculated 150 bars/about 10.97K. Rows 24, Width 20 and disabled POC survived reload; the final settings showed the calculation explanation and no ineffective price-source field. The final catalog contained one Visible Range entry. Artifacts: `range-profiles-visible.jpg`, `range-profiles-visible-recent.jpg`, `range-profiles-settings-reload.txt`.
- Actual hide/show cleared/restored marks. Replay recalculated its visible revealed surface (140 bars/about 18.55K), and mobile 375 x 812 showed 48 visible bars/about 2.43K. Artifacts: `range-profiles-visible-replay.jpg`, `range-profiles-visible-mobile.jpg`. Counts/quantities are snapshots from a changing market, not fixed feed claims.
- The isolated, explicitly simulated native fixture rendered 5,001 bars, removed the profile when Developing exceeded its 5,000-bar limit, and recovered the static profile through its UI. Artifacts: `range-profiles-fixed.jpg`, `range-profiles-fixed-error.jpg`, `range-profiles-fixed-recovery.jpg`. This does not verify exchange executions.
- Final browser warning/error capture: `range-profiles-browser-errors.json`. Temporary VRVP and fixture tab were removed, Replay exited, recent Candles restored and the viewport override reset. No orders or alerts were created.

## Limits and follow-up

The local initial worst-case developing probe took about 186 ms for 1,000 prefixes and **3.20 seconds for 5,000 prefixes**, with all points and total volume retained within floating-point tolerance. Raw result: `artifacts/range-profile-performance.json`. The subsequent [background profile adapter](background-profiles.md) moves Developing ranges over 200 candles to a shared worker, retains the same prefix cache/math, rejects stale responses and browser-verifies responsiveness at 5,000 prefixes. Initial CPU work remains quadratic.

Projection remains floating-point and input cannot recover decimal precision already lost during parsing. The subsequent foreground-caption adapter corrects the Fixed Range source notice being obscured near the volume region, with a real 5,000-prefix fixture screenshot and tests executing all five pinned painters. Multiple drawing captions can still overlap each other. Existing mobile header/attribution overlap and the separate older-native-candle issue remain open.

The prior mobile closing observation was subsequently traced to an incorrect test path: it addressed an off-screen section before opening Sections. The normal visible navigation already worked. The actual off-screen accessibility/focus exposure is corrected and browser-verified in [Accessible native settings navigation](settings-navigation.md), including a real mobile inversion/Percent edit and reload. The range-profile turn itself verified inverted geometry in painter/native-layout tests; it did not perform that inversion-toggle check.

Full TradingView/Vela parity, complete historical classified trade coverage and licensed Nasdaq real-time/US-depth access remain unproven.
