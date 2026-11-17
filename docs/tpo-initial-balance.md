# TPO Initial Balance

Current Vela continuation: [independent IB minutes](tpo-ib-minutes.md) replaces
the visible block-count control described below. Default is 60 minutes;
old saved block counts migrate to their previous duration. The remainder of
this document records the earlier implementation checkpoint.

**Evidence correction:** prior histogram-disappearance claims in this checkpoint are superseded by the [presented screenshot re-audit](tpo-presented-evidence.md). The cited captures do not prove that failure. This does not affect the independently verified mathematical features.

The TPO chart now has a configurable Initial Balance (IB): 1–48 opening blocks, an independent visibility switch and a color control in the native chart settings. Defaults are two blocks, visible, cyan. The feature follows the opening-block/vertical-range concept in the public [TradingView TPO reference](https://www.tradingview.com/support/solutions/43000725590-time-price-opportunity-charts-explained/). This is not a claim of complete TPO-setting parity.

The model uses only revealed, aligned candles whose opening is inside the initial block window and whose full interval fits inside it. The ending timestamp is exclusive and clamped to the resolved session end. Later extremes cannot modify the IB high or low. Opening blocks use elapsed time from the existing DST-aware session anchor. Range subtraction preserves canonical decimal inputs rather than introducing binary decimal artifacts.

The model distinguishes unavailable, incomplete, developing and complete coverage. No opening candles means no numerical range or bracket. Missing revealed opening slots make it incomplete; an opening still in progress is developing. Completion requires a revealed candle opening at or after the IB end and all expected opening slots. This conservative status does not assert that exchange history is complete, nor that OHLC reveals every execution. Incomplete/developing brackets are dashed and labelled. Complete brackets are solid. Data-window fields show status, exclusive end, loaded/expected slots, missing revealed slots and exact high/low/range, independently of the bracket's visibility.

The mathematical cache includes the block count. Color/visibility edits reuse the model. Legacy preferences without the three new fields remain valid, and native application resolves their defaults while preserving the other TPO settings. New fields persist through the existing per-cell series/layout/backup path; invalid new values and unknown fields remain rejected.

## Verification

- **1,477 tests across 128 files passed**, production build and TypeScript passed.
- Eight new tests cover first-block development, completed ranges excluding later extremes, absent opening/internal slots, unavailable ranges, session-end clamping, one-block input, invalid data/settings, exact decimal subtraction/overflow, DST fold and Replay prefixes, legacy/native settings, cache invalidation and actual painter projection on both normal/inverted scales. Existing all-hidden painter tests now explicitly disable the independent IB display.
- Production BTC/5m showed two 30-minute blocks ending at 01:00 UTC, 12/12 loaded slots, high 78,222, low 76,685 and range 1,537. Changing to three blocks produced an end at 01:30 and 18/18 slots; these values survived reload. Two blocks and the original visibility were restored afterward.
- Turning the native IB display off removed the cyan bracket while the TPO profile/readout remained. Turning it back on restored it.
- Actual Replay at 00:15 showed developing coverage, 4/12 slots, high 78,222, low 77,083 and range 1,139. At 01:05 it was complete with 12/12 slots. All IB fields stayed identical after seeking to 04:00; captured DOM fields were compared directly.
- The original Candles/EMA/Volume/Watchlist scene was restored, Replay stopped, and no console warnings/errors were captured in this final session.

Evidence is under `artifacts/tpo-initial-balance-*`, including tests/build logs, settings/reload/Replay DOM snapshots, compared completed fields, visibility screenshots and console output.

One visual observation remains unresolved: after the 04:00 Replay seek and sidebar scrolling, the saved completed-IB screenshot showed most TPO histogram blocks absent while price candles, IB and the complete numerical readout remained. Earlier screenshots in the same session showed the profiles. This does not establish a cause or a fix; it is a concrete follow-up for the renderer investigation. Do not treat this test run as proof of stable rendering in every frame. Mobile native IB controls, every layout/backup combination, IB extensions, full TPO parity, complete archives and licensed Nasdaq data remain open.

Follow-up: [render-state investigation](tpo-render-state.md) reproduces this visual failure with geometry-only diagnostics. Exception cleanup is hardened, but the histogram disappearance remains unresolved.

Completed-IB expansion controls and verification: [Initial Balance extensions](tpo-ib-extensions.md).
