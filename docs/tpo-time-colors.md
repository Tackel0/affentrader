# TPO time colors

Reference checked on 2026-11-04: https://docs.luxalgo.com/platform/charts/order-flow/tpo

The chart type and independent overlay now color each cell by its original
period index within the session. Simple is the default. Thermal, Spectrum,
Ocean, Ember and Custom share the reference's four-stop color ramps. Custom
stops retain CSS color alpha. Interpolation uses the full session period count,
including missing periods; merged profiles use their concatenated member
period spans and exclude overnight calendar gaps. Earlier cells do not change
color when Replay reveals another block or history repairs an earlier candle.

Cells and letters use 90% base opacity. Outside VA opacity defaults to 45% of
that base; its 0–100 control applies only when the value area is enabled.
Packed and expanded columns use the same colors. Compressed range rails retain
their separate range/VA/POC colors. Display edits reuse the price/time cache.
Saved preferences without the new optional fields remain valid.

Verification:

- Eleven new color regressions cover reference endpoints, custom interpolation
  and alpha, missing/revealed periods, composite spans, opacity boundaries,
  saved settings, overlay controls and model-cache reuse.
- Full suite: **1,998 tests across 184 files passed**; standalone TypeScript and
  production build passed. Logs: `artifacts/tpo-time-colors-tests.log` and
  `artifacts/tpo-time-colors-build.log`.
- Isolated production-server browser check: AAPL 15m explicit ETH profiles,
  Thermal rendering, theme persistence through reload, four Custom fields,
  and a 414×720 settings view. Screenshots: `artifacts/tpo-time-thermal.png`
  and `artifacts/tpo-time-mobile-settings.png`.

Subsequent metric implementation: see `tpo-metric-colors.md` for Volume, Trades count and Delta coloring from classified executions,
their metric hover values and source coverage/fallback handling. Still open: complete
direct Vela visual equivalence, full-capacity performance and multi-chart
acceptance. This increment does not establish complete TPO or Orderflow parity.
