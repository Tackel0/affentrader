# Book depth view

The Order flow panel displays asks above the midpoint and bids below it. Both sides accumulate from the best price outward. Use the grouping, unit, depth mode and style controls to switch between per-level or cumulative Bars, Area, Area + line and Line. Book and DOM share grouping, the execution display unit, colors and zoom. The Book row limit is saved in workspace preferences and defaults to 10 rows per side. DOM waiting quantities continue to use provider units.

Hover or focus a row to inspect the grouped-price weighted average and total base quantity between it and the best available level. Quote rows use grouped price times quantity. Neither grouping nor the view invents missing depth. Live mode uses public venue grid metadata when available. Paused snapshots and Replay use spacing inferred from their retained observations. The midpoint comes from the same snapshot as the displayed levels. The existing snapshot capture and raw CSV export remain available.

The pinned Vela reference comparison uses 1,880 row checks and 3,072 exact SVG path checks. Quantity and weighted averages allow a relative tolerance of 1e-10. Grouped prices and SVG strings are compared exactly. Run `scripts/verify-book-reference.ts` against the hash-pinned public source fixture to reproduce these checks. Full layout, format and interaction parity remain open.

The center of the Book shows the best bid, best ask, midpoint and spread in quote units and basis points. These values come from the ungrouped snapshot currently displayed, including when depth is paused or a recorded snapshot is selected in Replay.
