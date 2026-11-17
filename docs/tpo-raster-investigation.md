# TPO row batching and raster investigation

**Evidence correction:** the screenshots cited below do not establish histogram disappearance or readback healing. [The current re-audit](tpo-presented-evidence.md) measured intact blue profiles before/after/idle. Earlier reproduction claims are superseded; the intermittent raster concern is unconfirmed.

TPO opportunities are now filled as one path per price row. Rectangle coordinates, alpha, split columns and colors remain unchanged. Rows stay separate because their minimum one-pixel heights can overlap at small scales; merging all rows would change compositing. A 72-opportunity fixture verifies every rectangle and reduces histogram fill operations from 72 to 3. This reduces drawing calls, not model complexity.

## Evidence

- Final source: **1,480 tests / 129 files passed**, production compilation, TypeScript and static generation passed. Logs: `artifacts/tpo-row-path-delivery-{tests,build}.log`.
- Production Replay 00:15 → 01:05 → 04:00 followed by Data-window scrolling was previously described as a reproduction. Reinspection of its saved screenshots does not support that description. Geometry reported 980 rectangles, but geometry alone cannot diagnose presentation.
- Temporary full-context reset and first-context `willReadFrequently` experiments were removed. Their earlier failure labels are not established by the cited screenshots. Artifacts `tpo-context-reset-*` and `tpo-raster-*` are historical experiments, not the final implementation.
- The opt-in geometry audit accepts the fragment `#tpo-pixel-audit` to enable full readback without reloading. With the existing `?tpo-frame-audit=1`, adding that fragment preserved the paused Replay at 04:00. The reports contained 11,666 blue pixels. Reinspection shows full profiles in both `tpo-row-path-before-pixel.jpg` and `tpo-row-path-after-pixel.jpg`; this is not evidence that readback healed a failure.
- The before/after readback screenshots contain 12583/12628 blue pixels in the same plot region. They show intact profiles, not a demonstrated healing transition. Normal rendering and geometry-only diagnostics never read pixels. Do not introduce continuous readback on this evidence.

The intermittent histogram concern remains unconfirmed. Obtain an objectively failing presented capture before choosing a rendering intervention. The separate native-candle concern, full TradingView/Vela parity and licensed Nasdaq data remain open.
