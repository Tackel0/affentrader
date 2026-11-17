# Correction of the TPO histogram evidence

Earlier checkpoints claimed that screenshots reproduced disappearing TPO histogram blocks and that pixel readback restored them. That claim was too strong. Reinspection of the actual saved screenshots shows intact profiles. Offline pixel measurements contradict a gross disappearance in those files.

The diagnosis is now **an unconfirmed intermittent rendering concern**, not a demonstrated failure and not a fixed defect. No production readback workaround or speculative renderer change was added. The independently tested Canvas2D `finally` cleanup and rectangle batching remain valid changes; their tests do not establish a raster root cause.

## Re-audit of earlier captures

Using the same plot region (x=50, y=90, width=810, height=460), pixels count as blue when B > 65, B > 1.5R and B > 1.5G:

| Saved capture | Blue pixels |
| --- | ---: |
| tpo-render-state-before.jpg | 12792 |
| tpo-render-state-after.jpg | 12792 |
| tpo-render-state-after-idle.jpg | 12792 |
| tpo-row-path-before-pixel.jpg | 12583 |
| tpo-row-path-after-pixel.jpg | 12628 |

The render-state before/after/idle samples have identical blue counts. The row-path pair differs by only 45 blue pixels (about 0.36%), with full profiles visible in both images. These captures cannot justify the prior claim of disappearance or readback healing.

## Fresh production sequence

BTC/Hyperliquid, 5m, TPO, UTC: Replay 00:15 → 01:05 → 04:00, then Data-window scrolling and an idle interval. No chart-frame or pixel-audit URL flags were enabled. Browser screenshots were captured through the computer-use interface and decoded outside the browser, without requesting a Vela screenshot recomposition or reading a chart canvas.

| Capture | Blue pixels |
| --- | ---: |
| Before scrolling | 11831 |
| After scrolling | 11831 |
| After idle | 11831 |
| Profile blocks deliberately switched off | 2464 |
| Profile blocks restored | 10965 |

The measured original sequence retained its blue pixels exactly. The deliberate histogram-off negative control substantially reduces the signal, confirming that the metric responds to missing profile fills. Opening/applying settings reframed the chart, so the control/restored sequence is not a pixel-identical geometry comparison with the earlier sequence; do not treat the 7.3% baseline difference after restoring as raster loss. EMA/text can contribute blue pixels. These screenshots sample presented states and do not prove every intervening frame or every platform is correct.

Reproduce the offline measurement with Windows PowerShell:

```powershell
./scripts/Measure-TpoPresented.ps1 -ImagePaths @(
  'artifacts/tpo-presented-replay-before.jpg',
  'artifacts/tpo-presented-replay-after-scroll.jpg',
  'artifacts/tpo-presented-replay-after-idle.jpg',
  'artifacts/tpo-presented-negative-control.jpg',
  'artifacts/tpo-presented-restored-blocks.jpg'
) -OutputPath artifacts/tpo-presented-measurements.json
```

The helper analyzes existing files only. It accepts a custom region, checks bounds, disposes image resources and records thresholds, dimensions, counts and ratios. Historical report: `artifacts/tpo-presented-historical-audit.json`; new report: `artifacts/tpo-presented-measurements.json`.

Future raster diagnosis needs an objectively failing presented capture or another direct observation that distinguishes absent pixels from changed viewport/history coverage. Old prose, geometry counts and successful readback do not supply that proof. The separate native-candle concern remains outside this TPO evidence correction.
