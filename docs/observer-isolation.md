# MutationObserver startup error isolation

The error reported on the authenticated Netlify site was reproducible in a new
browser tab on 2026-11-04/05. It did not prevent the live Footprint from rendering.
No production error handler was changed to suppress it.

Four controlled pages were compared in the same in-app browser:

| Page | Application code | Netlify badge code | Inline frame | Result |
| --- | --- | --- | --- | --- |
| Plain control | None | None | None | No errors |
| Public badge as the main document | None | Present | None | No errors |
| Isolated public badge in `srcdoc` | None | Present | Present | Same MutationObserver error |
| Minimal script-free `srcdoc` document | None | None | Present | Same MutationObserver error |

The last page contains only a heading and paragraph inside the frame; it has no
scripts. Its parent creates the iframe and installs a plain `error` event listener,
but never creates or calls a MutationObserver. The parent's error output remains
empty while the browser's diagnostic log reports the non-Node `observe` argument.

This excludes Affentrader, Vela and Netlify badge code as necessary causes of this
specific reproduction. An injected browser/automation observer or frame lifecycle
in the inspection environment is the supported explanation; the exact injected
call site was not exposed by the browser log API. This is not a claim that every
MutationObserver error in the application can be ignored, nor a verification of
all other browsers.

Evidence:

- `artifacts/observer-isolation-evidence.json`: control/badge empty logs, identical
  MutationObserver errors for both inline-frame cases.
- `artifacts/observer-probe.mjs`: reproducible isolated local server, including
  `/control`, `/badge`, `/iframe`, `/empty-frame`.
- `artifacts/observer-script-free-frame.png`: script-free frame and empty parent
  application-error output.

The isolated probe server was stopped after verification. These probe files are
not included in the Netlify upload package. The current production application
and its authentication settings were not modified by this investigation.
