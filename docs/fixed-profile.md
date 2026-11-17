# Fixed Range Volume Profile corrections

The existing native tool remains a two-anchor drawing with native controls, geometry, colors, selection, hit tests, undo and persistence. Its calculation is now replaced through the drawing factory, preserving the installed Vela class and painter.

The original estimator copied a candle's complete volume into each distinct OHLC price row. This could count one candle several times. Its developing POC/VA also used the final selection's price grid, allowing a later extreme to change an earlier developing value. Both paths are corrected.

## Calculation

`lib/orderflow/fixedProfileModel.ts` partitions each positive-volume candle uniformly across its high/low interval. Partial boundary rows receive proportional fractions; difference arrays allocate interior rows efficiently. Flat candles contribute once. Directional colors mean candle up/down (`close >= open`), not classified buy/sell aggressors. Invalid OHLCV records are excluded with a visible count. Zero-volume candles do not expand the profile price range.

The total row allocation must preserve the input quantity within explicit floating-point tolerance. Indistinguishable rows, nonfinite totals and unsupported allocations fail visibly. A flat-only range uses one centered row. POC and value-area expansion share the session-profile selector: center-nearest/lower POC tie handling, adjacent row comparison, and stopping before a row would exceed the remaining target; a POC alone can exceed the requested percentage. Zero-percent VA includes only POC;100% covers all rows.

Every developing point is calculated from its own available prefix and grid. Future highs/lows cannot alter earlier points. Cached numeric snapshots detect live, older-history and setting revisions; only the changed suffix is recomputed. A Replay prefix trims both the final profile and the developing paths. Failed calculations do not commit partially rebuilt cache state.

The native factory adapter in `lib/drawings/fixedProfilePlugin.ts` bounds source copies globally at64 entries /250,000 bar slots. Static profiles support50,000 loaded bars; developing profiles support5,000. Larger or unsupported requests display a recovery instruction instead of partially painting a plausible profile. Shorten the range or disable Developing POC and Developing VA. Rows remain native1–500, VA0–100, with native placement/width/colors/line settings.

## Visible source and failure information

A version-checked adapter in `scripts/patch-vela-fixed-profile.mjs` adds the source/error caption to all five installed Vela0.9.0 native painter bundles. The normal caption sits beneath the profile and reports **OHLCV estimate**, loaded bar count, summed quantity and rejected records. Error text appears below the native indicator legend. Transient notices and caches are not serialized into drawing documents.

This remains an estimate from the selected chart's **loaded** OHLCV bars. It is not a classified execution profile, a lower-timeframe reconstruction or proof that the entire selected historical interval is available. Classified retained-trade session profiles, Footprint and CVD are separate tools. Exact TradingView/Vela numerical equivalence, source entitlements and complete fixed-range classified-trade history remain open.

## Verification

- Full suite: **111 files /1,320 tests passed**. Fourteen new tests cover volume partitioning, fractional boundaries, an independent slow overlap reference, negative/flat prices, rejected/zero-volume records, causal prefixes, live/older/Replay revisions, bounds/precision/overflow, transactional recovery, zero/full VA, actual native reversed geometry/hit tests/inversion, serialization and all five painter adapters. The final caption-placement adjustment passed the targeted14-test set, final production build and standalone TypeScript.
- Logs: `artifacts/fixed-profile-{tests,targeted,build,typecheck}.log`.
- Actual production browser: drew a103-bar BTC/5m profile, changed Rows32 /VA68 /Width45 /Right with Developing POC/VA enabled, reloaded and verified persistence. The source caption reported5059.447 volume. Native Replay reduced the loaded range and returned to the full selection on exit. Undo restored the deleted native profile; Redo removed it again. Reload then cleared the temporary undo history. This establishes native/UI integration; it is not an independent reconciliation of the exchange's complete historical volume.
- Actual375×812 mobile: reopened native settings, saved Rows16, reloaded and confirmed16/68/45 plus Right. The source note originally overlapped the legend; its final placement below the profile was visually checked. Viewport changes dismiss the native drawing popup; reopening it at the phone size works.
- Isolated native fixture: `node scripts/verify-fixed-profile.mjs`, then open `http://127.0.0.1:4319/`. It serves only fixed loopback resources and uses explicitly simulated data with no exchange or production workspace connection. The renderer confirmed5,001 native bars. Enabling developing profiles showed the capacity message with no histogram; recovery restored a static profile reporting exactly500,100 units (5,001×100). No fixture browser warnings/errors were captured. The fixture server/tab were closed after use.
- Evidence: `artifacts/fixed-profile-{live,developing,reload,mobile-settings,mobile-reload-settings,mobile,replay,capacity,capacity-recovery,final,production}.jpg` and `fixed-profile-browser-errors.json`. Early images precede the final caption placement; final/mobile/capacity images record the relevant settled behavior.
- Restored profile defaults24/70/35/Left with developing lines off, removed the temporary drawing and retained BTC/5m/Candles/UTC/Dark, EMA20/Volume, watchlist and collapsed bottom panel. No orders or alerts were created. A price-scale alert draft opened during mobile deselection was canceled without saving.

The intermittent older-price-candle rendering issue and the full TradingView/Vela goal remain unresolved; this checkpoint does not mark the objective complete.
