"use client";
import { useCallback, useId, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Activity,
  Plus,
  Check,
  Code2,
  Eye,
  EyeOff,
  SlidersHorizontal,
  Trash2,
  ChevronDown,
  ChevronUp,
  Ellipsis,
} from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { INDICATORS } from "@/lib/indicators/catalog";
import { indicatorHandles } from "@/hooks/useVelaChart";
import { useIndicatorLegendRows } from "@/hooks/useChartReadout";
import { statusLinePreferences, studyArguments } from "@/lib/chart/statusLine";
import { showsIndicatorValues } from "@/lib/indicators/presentation";
import { CVD_CANDLE_COLORS } from "@/lib/orderflow/cvdSettings";
import { tpoOverlayInputVisible } from "@/lib/orderflow/tpoOverlay";
import { footprintOverlayInputVisible } from "@/lib/orderflow/footprintOverlay";
import { validChartColor } from "@/lib/chart/appearance";
import { volumeProfileInputVisible } from "@/lib/orderflow/volumeProfileSettings";
import { tailsInputVisible } from "@/lib/orderflow/volumeTails";
import type {
  DrawingTool,
  IndicatorDefinition,
  IndicatorInstance,
} from "@/types/trading";
import { IconButton, Modal } from "./ui";
export function addStudy(def: IndicatorDefinition) {
  const store = useChartStore.getState();
  if (def.id === "tpo") {
    store.set({ chartType: def.id, indicatorsOpen: false });
    return;
  }
  if (def.id === "derived") {
    store.set({ derivedOpen: true, indicatorsOpen: false });
    return;
  }
  if (def.id === "anchored-vwap" || def.id === "fixed-profile" || def.id === "fixed-tails") {
    store.set({ drawing: def.id as DrawingTool, indicatorsOpen: false });
    store.toast(
      def.name,
      def.id === "anchored-vwap"
        ? "Click a candle to anchor the VWAP."
        : def.id === "fixed-tails" ? "Click start and end candles. Enter after the start leaves the end open."
        : "Click the starting and ending candles to define the profile.",
    );
    return;
  }
  if (
    ["volume", "cvd", "depth-heatmap"].includes(def.id) &&
    store.indicators.some((i) => i.definitionId === def.id)
  ) {
    store.toast("Study already added", `${def.name} is already on this chart.`);
    return;
  }
  store.addIndicator({
    id: crypto.randomUUID(),
    definitionId: def.id,
    name: def.shortName,
    visible: true,
    inputs: { ...def.defaults },
    color: ["#8e91ff", "#32b99b", "#f7b955", "#ed6675"][
      store.indicators.length % 4
    ],
    lineWidth: 2,
    source: "close",
    script: def.script,
  });
}
export function IndicatorPicker() {
  const open = useChartStore((s) => s.indicatorsOpen),
    extras = useChartStore((s) => s.nativeCatalog),
    active = useChartStore((s) => s.indicators);
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("All studies");
  const close = useCallback(
    () => useChartStore.getState().set({ indicatorsOpen: false }),
    [],
  );
  if (!open) return null;
  const catalog = [...INDICATORS, ...extras],
    results = catalog.filter(
      (d) =>
        (category === "All studies" || d.category === category) &&
        `${d.name} ${d.shortName}`.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <Modal
      title="Indicators & strategies"
      onClose={close}
      className="indicator-modal"
    >
      <div className="search-field">
        <Search size={18} />
        <input
          aria-label="Search indicators"
          placeholder="Search indicators, strategies and order flow"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="indicator-browser">
        <nav>
          {[
            "All studies",
            "Trend",
            "Momentum",
            "Volatility",
            "Volume",
            "Order flow",
            "Pine Script",
            "Derived",
          ].map((c) => (
            <button
              key={c}
              className={category === c ? "active" : ""}
              onClick={() => setCategory(c)}
            >
              {c === "Pine Script" ? (
                <Code2 size={16} />
              ) : (
                <Activity size={16} />
              )}
              <span>{c}</span>
              {c === "All studies" ? <small>{catalog.length}</small> : null}
            </button>
          ))}
        </nav>
        <div className="indicator-results">
          <div className="search-caption">
            <span>STUDY NAME</span>
            <span>ENGINE</span>
          </div>
          {results.map((d) => (
            <button
              key={d.id}
              className="indicator-result"
              onClick={() => addStudy(d)}
            >
              <span>
                <strong>{d.name}</strong>
                <small>{d.description}</small>
              </span>
              <span className={`engine-badge ${d.kind}`}>
                {d.kind === "pine"
                  ? "PineTS"
                  : d.kind === "orderflow"
                    ? "Order flow"
                    : "Native"}
              </span>
              {active.some((i) => i.definitionId === d.id) ? (
                <Check size={16} className="positive" />
              ) : (
                <Plus size={16} />
              )}
            </button>
          ))}
          {!results.length ? (
            <div className="empty-state">No matching studies.</div>
          ) : null}
        </div>
      </div>
      <div className="modal-footnote">
        <Code2 size={14} />
        Have a LuxAlgo script? Paste or import it in the Pine editor. Included
        structure studies are original AffenTerminal implementations.
      </div>
    </Modal>
  );
}
function IndicatorChipValues({ id, label }: { id: string; label: string }) {
  const rows = useIndicatorLegendRows(id);
  if (!rows?.length) return null;
  return <span className="chip-values" aria-label={label}>
    {rows.map((row, index) => <span key={`${index}-${row.label}`} style={{ color: row.color }} title={row.label} aria-label={`${row.label}: ${row.value}`}>{row.value}</span>)}
  </span>;
}

export function IndicatorChips() {
  const indicators = useChartStore((s) => s.indicators);
  const collapsed = useChartStore(state => state.legendCollapsed);
  const preferences = statusLinePreferences(useChartStore(state => state.statusLine));
  const folded = collapsed || !preferences.indicatorTitles;
  const [actionsId, setActionsId] = useState<string | null>(null);
  const listId = useId();
  const actions = indicators.find(indicator => indicator.id === actionsId);
  const removeFromActions = () => {
    if (!actions) return;
    useChartStore.getState().removeIndicator(actions.id);
    setActionsId(null);
    queueMicrotask(() => {
      const selector = useChartStore.getState().indicators.length ? ".legend-fold" : '.workspace-toolbar [aria-label="Indicators"]';
      document.querySelector<HTMLButtonElement>(selector)?.focus();
    });
  };
  if (!indicators.length) return null;
  return (
    <div className="study-legend">
    <div className="indicator-chips" id={listId} hidden={folded}>
      {indicators.map((i) => (
        <div
          className={`indicator-chip ${i.error ? "has-error" : ""}`}
          key={i.id}
          data-indicator-id={i.id}
        >
          <span className="study-dot" style={{ background: i.color }} />
          <button
            className="chip-name"
            onClick={() => useChartStore.getState().set({ settingsId: i.id })}
          >
            {i.name}
            {preferences.indicatorArguments && studyArguments(i.inputs, i.definitionId) ? ` ${studyArguments(i.inputs, i.definitionId)}` : ""}
          </button>
          {!folded && showsIndicatorValues(i, preferences.indicatorValues) ? <IndicatorChipValues id={i.id}
            label={`${i.name}${typeof i.inputs.length === "number" ? ` ${i.inputs.length}` : ""} values`} /> : null}
          {i.error ? (
            <span title={i.error} className="negative">
              !
            </span>
          ) : null}
          <span className="chip-actions"><IconButton
            label={`${i.visible ? "Hide" : "Show"} ${i.name}`}
            onClick={() =>
              useChartStore
                .getState()
                .updateIndicator(i.id, { visible: !i.visible })
            }
          >
            {i.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </IconButton>
          <IconButton
            label={`Settings for ${i.name}`}
            onClick={() => useChartStore.getState().set({ settingsId: i.id })}
          >
            <SlidersHorizontal size={12} />
          </IconButton>
          <IconButton
            label={`Remove ${i.name}`}
            onClick={() => useChartStore.getState().removeIndicator(i.id)}
          >
            <Trash2 size={12} />
          </IconButton></span>
          <IconButton className="chip-more" label={`Actions for ${i.name}${typeof i.inputs.length === "number" ? ` ${i.inputs.length}` : ""}`} onClick={() => setActionsId(i.id)}><Ellipsis size={15}/></IconButton>
        </div>
      ))}
    </div>
    <button type="button" className="legend-fold" aria-label={folded ? "Show indicator legend" : "Hide indicator legend"} title={folded ? "Show indicator legend" : "Hide indicator legend"}
      aria-expanded={!folded} aria-controls={listId} onClick={() => useChartStore.getState().set({ legendCollapsed: !folded, ...(folded ? { statusLine: { ...preferences, indicatorTitles: true } } : {}) })}>
      {folded ? <ChevronDown size={13}/> : <ChevronUp size={13}/>}{folded ? <span>{indicators.length}</span> : null}
    </button>
    {actions ? createPortal(<Modal title={`${actions.name}${typeof actions.inputs.length === "number" ? ` ${actions.inputs.length}` : ""} · Actions`} className="indicator-actions-modal" onClose={() => setActionsId(null)}>
      <div className="indicator-action-list">
        <button type="button" onClick={() => { useChartStore.getState().updateIndicator(actions.id, { visible: !actions.visible }); setActionsId(null); }}>{actions.visible ? <EyeOff size={16}/> : <Eye size={16}/>} {actions.visible ? "Hide indicator" : "Show indicator"}</button>
        <button type="button" onClick={() => { setActionsId(null); useChartStore.getState().set({ settingsId: actions.id }); }}><SlidersHorizontal size={16}/> Settings</button>
        <button type="button" className="negative" onClick={removeFromActions}><Trash2 size={16}/> Remove indicator</button>
      </div>
    </Modal>, document.querySelector(".trading-app") ?? document.body) : null}
    </div>
  );
}
export function IndicatorSettings() {
  const id = useChartStore((s) => s.settingsId),
    indicator = useChartStore((s) =>
      s.indicators.find((i) => i.id === s.settingsId),
    );
  const close = useCallback(
    () => useChartStore.getState().set({ settingsId: null }),
    [],
  );
  if (!id || !indicator || indicator.definitionId === "derived") return null;
  return (
    <IndicatorSettingsForm key={id} indicator={indicator} onClose={close} />
  );
}
function IndicatorSettingsForm({
  indicator,
  onClose,
}: {
  indicator: IndicatorInstance;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"inputs" | "style">("inputs");
  const [validationError, setValidationError] = useState("");
  const tabsId = useId();
  const [draft, setDraft] = useState({
    ...indicator,
    inputs: { ...indicator.inputs },
  });
  const handle = indicatorHandles.get(indicator.id);
  const countTotal = indicator.definitionId === "trade-count";
  const volumeTails = ["visible-tails", "rolling-tails", "session-tails"].includes(indicator.definitionId);
  const countDelta = indicator.definitionId === "trade-count-delta" || indicator.definitionId === "volume-delta";
  const candleFamily = indicator.definitionId === "cvd" || indicator.definitionId === "ctcd";
  const candlePlot = candleFamily && (draft.inputs.plot ?? "Candles") === "Candles";
  const signedCvdColumns = indicator.definitionId === "cvd" && draft.inputs.calculation === "Bar delta" && draft.inputs.plot === "Histogram";
  const schema = handle?.inputs ?? [];
  const inputs = schema.length
    ? schema.map((s) => ({
        key: s.key,
        title: s.title ?? s.key,
        type: s.type,
        min: s.min,
        max: s.max,
        step: s.step,
        options: s.options,
        defval: s.defval,
        tab: s.tab,
      }))
    : Object.entries(indicator.inputs).map(([key, value]) => ({
        key,
        title: key,
        type:
          typeof value === "boolean"
            ? "bool"
            : typeof value === "number"
              ? "float"
              : "string",
        defval: value,
        tab: undefined,
        min: undefined,
        max: undefined,
        step: undefined,
        options: undefined,
      }));
  return (
    <Modal
      title={`${indicator.name} · Settings`}
      onClose={onClose}
      className="small-modal"
    >
      <form
        onChangeCapture={() => setValidationError("")}
        onInvalidCapture={event => {
          event.preventDefault();
          const target = event.target as HTMLInputElement;
          setTab(target.closest('[role="tabpanel"]')?.id === `${tabsId}-style-panel` ? "style" : "inputs");
          setValidationError(target.validationMessage);
          queueMicrotask(() => target.focus());
        }}
        onSubmit={(e) => {
          e.preventDefault();
          useChartStore.getState().updateIndicator(indicator.id, draft);
          onClose();
        }}
      >
        <div className="indicator-settings-tabs" role="tablist" aria-label="Indicator settings sections">
          {(["inputs", "style"] as const).map((section, index) => <button key={section} type="button" role="tab"
            id={`${tabsId}-${section}-tab`} aria-controls={`${tabsId}-${section}-panel`} aria-selected={tab === section}
            tabIndex={tab === section ? 0 : -1} onClick={() => setTab(section)}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "inputs" : event.key === "End" ? "style" : index === 0 ? "style" : "inputs";
              setTab(next); document.getElementById(`${tabsId}-${next}-tab`)?.focus();
            }}>{section === "inputs" ? "Inputs" : "Style"}</button>)}
        </div>
        {validationError ? <p className="error-message" role="alert">{validationError}</p> : null}
        <div className="form-body settings-form indicator-settings-panel" role="tabpanel" id={`${tabsId}-inputs-panel`}
          aria-labelledby={`${tabsId}-inputs-tab`} hidden={tab !== "inputs"}>
          <p className="form-section-label">INPUTS</p>
          {indicator.definitionId === "session-profile" || indicator.definitionId === "rolling-profile" ? <p className="form-help">Built from retained classified trades, with partial coverage. Rolling profiles use the newest N loaded bars, including the forming live bar. Replay uses explicitly loaded archived observations through completed candles only; gaps remain unknown.</p> : null}
          {indicator.definitionId === "vpvr" ? <p className="form-help">Choose an OHLCV estimate or classified executions. The estimate distributes candle volume across high/low rows by candle direction. Classified mode places observed buy/sell quantities at execution prices and can include a loaded archive. Coverage may have gaps; no OHLCV fallback is used when trades are missing. Replay uses archived observations through completed candles only.</p> : null}
          {indicator.definitionId === "depth-heatmap" ? <p className="form-help">Collects the last received top-of-book snapshot per sample interval in this running study, up to 600 columns. Colors show resting bid/ask quantities, not trades or cancellations. Gaps longer than three seconds stay empty. Live history starts when the study is enabled. To use observed snapshots in Replay, turn on Capture depth for Replay in the Order flow panel before the period you want to inspect. Simulation and IEX/Yahoo do not supply depth. Auto rows use observed price spacing.</p> : null}
          {indicator.definitionId === "volume-bubbles" ? <p className="form-help">Price tick override 0 uses public venue precision for Binance, Kraken and Hyperliquid. Manual rows multiply that tick by Ticks per row; Auto rows adapt to the view on the same grid. A positive override keeps its explicit value. Missing metadata does not create a guessed exchange tick. Replay uses current precision metadata unless overridden; historical rule changes are not reconstructed.</p> : null}
          {indicator.definitionId === "cvd" || indicator.definitionId === "volume-delta" ? <p className="form-help">Total uses classified buy minus sell quantity. Average compares mean trade size per side and needs explicit print counts. Coverage starts with retained observations; gaps remain unknown. Replay uses only an explicitly loaded archive through completed candles.</p> : null}
          {volumeTails ? <p className="form-help">Supply accumulates sells from the observed high; demand accumulates buys from the observed low. Each targets Threshold % of combined volume and includes the crossing price bin. Means use zone midpoints; weighted means use side volume at bin centers. Partial classified executions only; no candle-direction estimate. Week/month sessions are UTC. Day windows use source-calendar RTH/ETH, the chart session, named UTC hours or custom UTC HHMM times. Without a source calendar, Full day/RTH/ETH use the configured day clock.</p> : null}
          {indicator.definitionId === "tpo-overlay" ? <p className="form-help">Time/price opportunities from loaded candles, with the same calculation as the TPO chart type. Choose a chart interval that divides the block length. Missing history remains incomplete. Replay uses the revealed candle prefix. The optional volume ladder estimates candle volume uniformly across its high/low range; it is not classified buy/sell volume. Session merge/context actions belong to the chart type.</p> : null}
          {indicator.definitionId === "cvd" ? <p className="form-help">Candles track ordered intrabar delta extremes. Trades use timestamp, venue sequence, then ID order when sequence data is unavailable.</p> : null}
          {["footprint", "visible-footprint"].includes(indicator.definitionId) ? <p className="form-help">Only collected classified executions are shown; missing history remains unknown. Trade-count values require underlying counts. Average sizing changes shapes while numeric volume labels stay raw. The range profile sums selected candles and has no per-candle projections.</p> : null}
          {inputs
            .filter(input => indicator.definitionId !== "tpo-overlay" || tpoOverlayInputVisible(input.key, draft.inputs))
            .filter(input => !["footprint", "visible-footprint"].includes(indicator.definitionId) || footprintOverlayInputVisible(indicator.definitionId === "footprint" ? "bar" : "visible", input.key, draft.inputs))
            .filter(input => input.tab !== "Style" && !["color", "lineWidth"].includes(input.key) && (input.key !== "source" || indicator.definitionId === "vwap"))
            .filter(input => indicator.definitionId !== "cvd" || draft.inputs.anchor === "Session" || !["sessionZone", "sessionStartMinutes", "sessionMinutes", "weekdaysOnly"].includes(input.key))
            .filter(input => indicator.definitionId !== "session-profile" || volumeProfileInputVisible(input.key, draft.inputs))
            .filter(input => indicator.definitionId !== "session-tails" || tailsInputVisible(input.key, draft.inputs))
            .map(input => <IndicatorInputControl key={input.key} input={input} value={draft.inputs[input.key] ?? input.defval}
              onChange={value => setDraft({ ...draft, inputs: { ...draft.inputs, [input.key]: value } })} />)}
          {!indicator.script && !volumeTails && !["vwap", "tpo-overlay", "footprint", "visible-footprint", "session-profile", "rolling-profile", "cvd", "volume-delta", "vpvr", "depth-heatmap", "trade-count", "trade-count-delta", "ctcd", "volume-bubbles", "bar-stats"].includes(indicator.definitionId) ? <label>
            Price source
            <select value={draft.source} onChange={event => setDraft({ ...draft, source: event.target.value as IndicatorInstance["source"] })}>
              {["close", "open", "high", "low", "hl2", "hlc3"].map(source => <option key={source}>{source}</option>)}
            </select>
          </label> : null}
        </div>
        <div className="form-body settings-form indicator-settings-panel" role="tabpanel" id={`${tabsId}-style-panel`}
          aria-labelledby={`${tabsId}-style-tab`} hidden={tab !== "style"}>
          {inputs.filter(input => input.tab === "Style" && !["color", "lineWidth"].includes(input.key) &&
            (!["footprint", "visible-footprint"].includes(indicator.definitionId) || footprintOverlayInputVisible(indicator.definitionId === "footprint" ? "bar" : "visible", input.key, draft.inputs)) &&
            (indicator.definitionId !== "session-profile" || volumeProfileInputVisible(input.key, draft.inputs)) &&
            !(candleFamily && !candlePlot && (CVD_CANDLE_COLORS as readonly string[]).includes(input.key) &&
              !(signedCvdColumns && ["upColor", "downColor"].includes(input.key)))).map(input => <IndicatorInputControl key={input.key} input={input} value={draft.inputs[input.key] ?? input.defval}
            exactColor={candleFamily} alphaColor={["footprint", "visible-footprint"].includes(indicator.definitionId)}
            onChange={value => setDraft({ ...draft, inputs: { ...draft.inputs, [input.key]: value } })} />)}
          {!indicator.script && !volumeTails && !["vwap", "tpo-overlay", "footprint", "visible-footprint", "session-profile", "rolling-profile", "vpvr", "depth-heatmap", "bar-stats"].includes(indicator.definitionId) && !candlePlot && !countDelta && !signedCvdColumns ? (
            <>
              <p className="form-section-label">STYLE</p>
              <label>
                {countTotal ? "Column color" : "Line color"}
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : indicator.color}
                  onChange={(e) =>
                    setDraft({ ...draft, color: e.target.value })
                  }
                />
              </label>
              <label>
                {countTotal ? "Column color hex" : "Line color hex"}
                <input type="text" value={draft.color} pattern="#[0-9a-fA-F]{6}" required maxLength={7}
                  spellCheck={false} title="Enter a six-digit hex color, for example #2962ff."
                  onChange={event => setDraft({ ...draft, color: event.target.value })} />
              </label>
              {!countTotal && <label>
                Line width
                <input
                  type="number"
                  min={1}
                  max={indicator.definitionId === "cvd" ? 10 : 6}
                  value={draft.lineWidth}
                  onChange={(e) =>
                    setDraft({ ...draft, lineWidth: Number(e.target.value) })
                  }
                />
              </label>}
            </>
          ) : indicator.script ? (
            <p className="form-help">
              Pine styles follow the script’s plot and input.color declarations.
              Edit the source in the Pine editor to customize additional plots.
            </p>
          ) : null}
          {!["tpo-overlay", "footprint", "visible-footprint", "session-profile", "rolling-profile", "depth-heatmap", "bar-stats"].includes(indicator.definitionId) ? <label>
            Values in the status line
            <input type="checkbox" checked={draft.valuesInStatusLine !== false}
              onChange={event => setDraft({ ...draft, valuesInStatusLine: event.target.checked })} />
          </label> : null}
          {!["tpo-overlay", "footprint", "visible-footprint", "session-profile", "rolling-profile", "volume", "vpvr", "depth-heatmap", "bar-stats"].includes(indicator.definitionId) && <label>
            Values on the price scale
            <input type="checkbox" checked={draft.valuesOnPriceScale !== false}
              onChange={event => setDraft({ ...draft, valuesOnPriceScale: event.target.checked })} />
          </label>}
          {!["tpo-overlay", "footprint", "visible-footprint", "session-profile", "rolling-profile", "volume", "vpvr", "depth-heatmap", "bar-stats"].includes(indicator.definitionId) && <p className="form-help">Shows current numeric plots on their own scale. Plot display restrictions and hidden axes take precedence. Crowded labels can be omitted; Data window values remain available.</p>}
          {!["tpo-overlay", "footprint", "visible-footprint", "session-profile", "rolling-profile", "bar-stats"].includes(indicator.definitionId) && !statusLinePreferences(useChartStore.getState().statusLine).indicatorValues ? <p className="form-help">Indicator values are hidden in Chart settings → Status line. Enable them there to show values for this study.</p> : null}
          <label>
            Visible
            <input
              type="checkbox"
              checked={draft.visible}
              onChange={(e) =>
                setDraft({ ...draft, visible: e.target.checked })
              }
            />
          </label>
          {indicator.error ? (
            <p className="error-message">{indicator.error}</p>
          ) : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary">Apply settings</button>
        </div>
      </form>
    </Modal>
  );
}

function IndicatorInputControl({ input, value, onChange, exactColor = false, alphaColor = false }: {
  input: { key: string; title: string; type: string; min?: number; max?: number; step?: number; options?: readonly unknown[] };
  value: unknown; onChange: (value: string | number | boolean) => void; exactColor?: boolean; alphaColor?: boolean;
}) {
  if (alphaColor && input.type === "color") return <label>{input.title}<input type="text" required maxLength={128} spellCheck={false}
    value={String(value ?? "")} title="Hex, RGB(A), or HSL(A) color; alpha is preserved."
    onChange={event => { event.currentTarget.setCustomValidity(validChartColor(event.target.value) ? "" : "Enter a valid hex, RGB(A), or HSL(A) color."); onChange(event.target.value); }} /></label>;
  if (exactColor && input.type === "color") return <>
    <label>{input.title}<input type="color" value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#000000"}
      onChange={event => onChange(event.target.value)} /></label>
    <label>{input.title} hex<input type="text" value={String(value ?? "")} pattern="#[0-9a-fA-F]{6}" maxLength={7} required spellCheck={false}
      title="Enter a six-digit hex color, for example #2962ff." onChange={event => onChange(event.target.value)} /></label>
  </>;
  return <label>{input.title}
    {input.type === "bool" ? <input type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.target.checked)} /> :
      input.options?.length ? <select value={String(value)} onChange={event => onChange(event.target.value)}>
        {input.options.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
      </select> : <input required type={["int", "float"].includes(input.type) ? "number" : input.type === "color" ? "color" : "text"}
        min={input.min} max={input.max} step={input.step ?? "any"} value={String(value ?? "")}
        onChange={event => onChange(["int", "float"].includes(input.type) ? Number(event.target.value) : event.target.value)} />}
  </label>;
}


