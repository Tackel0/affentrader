"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChartCandlestick,
  Check,
  Eye,
  EyeOff,
  GitCompare,
  ScanSearch,
  Settings2,
  Star,
  Trash2,
  Plus,
} from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { resetDerivedSetting, updateDerivedSettings } from "@/lib/chart/derivedSettings";
import {
  intervalLabel,
  isTickInterval,
  normalizeInterval,
  parseInterval,
  QUICK_INTERVALS,
} from "@/lib/market/intervals";
import {
  CHART_TYPES,
  chartTypeInfo,
  DEFAULT_CHART_TYPE_SETTINGS,
} from "@/lib/chart/chartTypes";
import type { BoxSizing } from "@/lib/chart/transforms";
import { collectSymbols, parseFormula } from "@/lib/chart/compare";
import {
  allPatternIds,
  DEFAULT_PATTERN_OPTIONS,
  type PatternHit,
} from "@/lib/patterns";
import {
  defaultParameters,
  findTaIndicator,
  TA_INDICATORS,
  type PriceSource,
} from "@/lib/ta";
import {
  DERIVED_DEFINITION_ID,
  describeDerived,
  isDerivedSpec,
  type DerivedSpec,
} from "@/lib/indicators/derived";
import { useSymbolCatalog } from "@/hooks/useSymbolCatalog";
import { getSymbol } from "@/lib/symbols";
import { isSymbolId } from "@/lib/symbolId";
import type { ChartType, CompareSeries } from "@/types/trading";
import { IconButton, Modal } from "./ui";
import { useDismiss } from "./WorkspaceMenus";

const COLORS = ["#f7b955", "#e91e63", "#9c27b0", "#00bcd4", "#8bc34a", "#ff7043"];

export function IntervalPicker() {
  const timeframe = useChartStore((s) => s.timeframe);
  const favorites = useChartStore((s) => s.favoriteIntervals);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const ref = useDismiss(open, () => setOpen(false));
  const choose = (value: string) => {
    useChartStore.getState().set({ timeframe: normalizeInterval(value) });
    setOpen(false);
    setCustom("");
    setError("");
  };
  const toggleFavorite = (value: string) =>
    useChartStore.getState().set({
      favoriteIntervals: favorites.includes(value)
        ? favorites.filter((f) => f !== value)
        : [...favorites, value],
    });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseInterval(custom);
    if (!parsed) {
      setError(
        "Use a number and unit: 45s, 7m, 2h, 3D, 2W, 1M or 200T (ticks).",
      );
      return;
    }
    choose(parsed.id);
  };
  return (
    <div ref={ref} className="toolbar-popover-host interval-picker">
      <button
        className="toolbar-button interval-button"
        aria-label="Chart interval"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <strong>{timeframe}</strong>
      </button>
      {open ? (
        <div className="tv-popover interval-popover" role="menu">
          <div className="popover-label">Custom interval</div>
          <form className="interval-custom" onSubmit={submit}>
            <input
              aria-label="Custom interval"
              placeholder="e.g. 45s, 7m, 3D, 200T"
              value={custom}
              maxLength={8}
              onChange={(e) => {
                setCustom(e.target.value);
                setError("");
              }}
            />
            <button className="button primary small">Set</button>
          </form>
          {error ? <p className="error-message interval-error">{error}</p> : null}
          <div className="popover-label">Favorites</div>
          <div className="interval-grid">
            {favorites.map((f) => (
              <button
                key={f}
                className={f === timeframe ? "selected" : ""}
                onClick={() => choose(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="popover-label">All intervals</div>
          <div className="interval-list">
            {QUICK_INTERVALS.map((f) => (
              <div className="interval-row" key={f}>
                <button
                  className={f === timeframe ? "selected" : ""}
                  onClick={() => choose(f)}
                >
                  <span>{f}</span>
                  <small>
                    {intervalLabel(f)}
                    {isTickInterval(f) ? " · trade bars" : ""}
                  </small>
                </button>
                <IconButton
                  label={favorites.includes(f) ? `Unfavorite ${f}` : `Favorite ${f}`}
                  onClick={() => toggleFavorite(f)}
                >
                  <Star
                    size={13}
                    fill={favorites.includes(f) ? "currentColor" : "none"}
                  />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SizingEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: BoxSizing;
  onChange: (value: BoxSizing) => void;
}) {
  return (
    <div className="sizing-editor">
      <label>
        {label}
        <select
          value={value.mode}
          onChange={(e) => {
            const mode = e.target.value as BoxSizing["mode"];
            onChange(
              mode === "atr"
                ? { mode, length: 14 }
                : mode === "percent"
                  ? { mode, percent: 0.5 }
                  : { mode, size: 1 },
            );
          }}
        >
          <option value="atr">ATR (volatility)</option>
          <option value="percent">Percent of price</option>
          <option value="fixed">Fixed price</option>
        </select>
      </label>
      {value.mode === "atr" ? (
        <label>
          ATR length
          <input
            type="number"
            min={1}
            max={200}
            value={value.length}
            onChange={(e) =>
              onChange({ mode: "atr", length: Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 14))) })
            }
          />
        </label>
      ) : value.mode === "percent" ? (
        <label>
          Percent
          <input
            type="number"
            min={0.001}
            step="any"
            value={value.percent}
            onChange={(e) =>
              onChange({ mode: "percent", percent: Math.max(0.001, Math.min(1e6, Number(e.target.value) || 0.5)) })
            }
          />
        </label>
      ) : (
        <label>
          Price
          <input
            type="number"
            min={0}
            step="any"
            value={value.size}
            onChange={(e) =>
              onChange({ mode: "fixed", size: Math.max(1e-9, Math.min(1e12, Number(e.target.value) || 1)) })
            }
          />
        </label>
      )}
    </div>
  );
}

function ChartTypeSettingsDialog({ type, onClose }: { type: ChartType; onClose: () => void }) {
  const [owner] = useState(() => useWorkspaceStore.getState().activeId);
  const activeId = useWorkspaceStore(s => s.activeId);
  const chartType = useChartStore(s => s.chartType);
  useEffect(() => { if (activeId !== owner || chartType !== type) onClose(); }, [activeId, owner, chartType, type, onClose]);
  const settings = useChartStore((s) => s.chartTypeSettings);
  const set = (patch: Partial<typeof settings>) =>
    updateDerivedSettings(owner, patch);
  const info = chartTypeInfo(type);
  return (
    <Modal title={`${info?.label ?? type} settings`} onClose={onClose} className="small-modal">
      <div className="form-body">
        {type === "renko" ? (
          <SizingEditor label="Brick size" value={settings.renko} onChange={(renko) => set({ renko })} />
        ) : null}
        {type === "range" ? (
          <SizingEditor label="Range" value={settings.range} onChange={(range) => set({ range })} />
        ) : null}
        {type === "kagi" ? (
          <SizingEditor label="Reversal" value={settings.kagi} onChange={(kagi) => set({ kagi })} />
        ) : null}
        {type === "pointfigure" ? (
          <>
            <SizingEditor
              label="Box size"
              value={settings.pointfigure.sizing}
              onChange={(sizing) => set({ pointfigure: { ...settings.pointfigure, sizing } })}
            />
            <label>
              Reversal (boxes)
              <input
                type="number"
                min={1}
                max={10}
                value={settings.pointfigure.reversal}
                onChange={(e) =>
                  set({
                    pointfigure: {
                      ...settings.pointfigure,
                      reversal: Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 3))),
                    },
                  })
                }
              />
            </label>
          </>
        ) : null}
        {type === "linebreak" ? (
          <label>
            Number of lines
            <input
              type="number"
              min={1}
              max={10}
              value={settings.linebreak.lines}
              onChange={(e) =>
                set({ linebreak: { lines: Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 3))) } })
              }
            />
          </label>
        ) : null}
        <p className="form-help">
          Renko, Kagi, Line break, Range and Point &amp; Figure ignore time:
          each mark is placed on the bar where it formed, and marks that formed
          on the same bar take the free slots beside it.
        </p>
      </div>
      <div className="modal-actions">
        <button
          type="button"
          className="button"
          onClick={() => { if (type in DEFAULT_CHART_TYPE_SETTINGS) resetDerivedSetting(owner, type as keyof typeof DEFAULT_CHART_TYPE_SETTINGS); }}
        >
          Reset
        </button>
        <button type="button" className="button primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

export function ChartTypeMenu({ showLabel = false, onSelect }: { showLabel?: boolean; onSelect?: () => void } = {}) {
  const type = useChartStore((s) => s.chartType);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<ChartType | null>(null);
  const ref = useDismiss(open, () => setOpen(false));
  const groups = useMemo(() => {
    const map = new Map<string, typeof CHART_TYPES>();
    for (const t of CHART_TYPES) map.set(t.group, [...(map.get(t.group) ?? []), t]);
    return [...map];
  }, []);
  const current = chartTypeInfo(type);
  return (
    <div ref={ref} className="toolbar-popover-host chart-type-host">
      <button
        className="toolbar-button chart-type-button"
        aria-label={`Chart type: ${current?.label ?? type}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChartCandlestick size={19} />
        {showLabel ? <span>Charttyp: {current?.label ?? type}</span> : null}
      </button>
      {current?.settings?.length && current.id !== "baseline" ? (
        <IconButton label={`${current.label} settings`} onClick={() => setSettings(type)}>
          <Settings2 size={14} />
        </IconButton>
      ) : null}
      {open ? (
        <div className="tv-popover chart-type-popover" role="menu">
          {groups.map(([group, items]) => (
            <div key={group}>
              <div className="popover-label">{group}</div>
              {items.map((t) => (
                <button
                  key={t.id}
                  role="menuitemradio"
                  aria-checked={t.id === type}
                  className={t.id === type ? "selected" : ""}
                  title={t.description}
                  onClick={() => {
                    useChartStore.getState().set({ chartType: t.id });
                    setOpen(false);
                    onSelect?.();
                  }}
                >
                  <span>{t.label}</span>
                  {t.id === type ? <Check size={14} /> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {settings ? (
        <ChartTypeSettingsDialog type={settings} onClose={() => setSettings(null)} />
      ) : null}
    </div>
  );
}

export function CompareButton() {
  const count = useChartStore((s) => s.compares.length);
  return (
    <button
      className="toolbar-button compare-toolbar-button"
      aria-label="Compare or add symbol"
      title={count?`Compare or add symbol (${count})`:"Compare or add symbol"}
      onClick={() => useChartStore.getState().set({ compareOpen: true })}
    >
      <Plus size={20} />
      {count?<small className="compare-count">{count}</small>:null}
    </button>
  );
}

export function CompareDialog() {
  const open = useChartStore((s) => s.compareOpen);
  const compares = useChartStore((s) => s.compares);
  const main = useChartStore((s) => s.symbol);
  const catalog = useSymbolCatalog(open);
  const [mode, setMode] = useState<"symbol" | "formula">("symbol");
  const [symbol, setSymbol] = useState("ETHUSDT");
  const [expression, setExpression] = useState("");
  const [scale, setScale] = useState<CompareSeries["scale"]>("relative");
  const [error, setError] = useState("");
  const close = useCallback(() => useChartStore.getState().set({ compareOpen: false }), []);
  if (!open) return null;
  const update = (id: string, patch: Partial<CompareSeries>) =>
    useChartStore.getState().set({
      compares: compares.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const color = COLORS[compares.length % COLORS.length];
    try {
      if (mode === "symbol") {
        const value = symbol.trim().toUpperCase();
        if (!isSymbolId(value)) throw new Error("Enter a valid symbol, e.g. ETHUSDT or YF:AAPL.");
        if (compares.length >= 10) throw new Error("A chart can compare up to 10 series.");
        useChartStore.getState().set({
          compares: [
            ...compares,
            { id: crypto.randomUUID(), kind: "symbol", label: value, symbol: value, color, lineWidth: 2, scale, visible: true },
          ],
        });
      } else {
        const text = expression.trim();
        const symbols = collectSymbols(parseFormula(text));
        if (!symbols.size) throw new Error("A formula needs at least one symbol.");
        if (compares.length >= 10) throw new Error("A chart can compare up to 10 series.");
        useChartStore.getState().set({
          compares: [
            ...compares,
            { id: crypto.randomUUID(), kind: "formula", label: text, expression: text, color, lineWidth: 2, scale: "own", visible: true },
          ],
        });
        setExpression("");
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal title="Compare or add symbol" onClose={close} className="compare-modal">
      <form onSubmit={add}>
        <div className="form-body">
          <div className="segmented" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "symbol"} className={mode === "symbol" ? "active" : ""} onClick={() => setMode("symbol")}>
              Symbol
            </button>
            <button type="button" role="tab" aria-selected={mode === "formula"} className={mode === "formula" ? "active" : ""} onClick={() => setMode("formula")}>
              Formula / spread
            </button>
          </div>
          {mode === "symbol" ? (
            <>
              <label>
                Symbol
                <input
                  list="compare-symbols"
                  aria-label="Comparison symbol"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                />
                <datalist id="compare-symbols">
                  {catalog.slice(0, 400).map((s) => (
                    <option key={s.symbol} value={s.symbol}>
                      {s.name}
                    </option>
                  ))}
                </datalist>
              </label>
              <label>
                Scale
                <select value={scale} onChange={(e) => setScale(e.target.value as CompareSeries["scale"])}>
                  <option value="relative">Rebased to {main} at the left edge</option>
                  <option value="own">Own scale (fit to pane)</option>
                  <option value="price">Same price scale</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label>
                Formula
                <input
                  aria-label="Formula"
                  placeholder="BTCUSDT / ETHUSDT"
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                />
              </label>
              <p className="form-help">
                Use symbols with + − × ÷ ^ and abs, log, ln, sqrt, exp, min,
                max, sma(x, n), ema(x, n), change(x). Pick a field with
                BTCUSDT.high. Examples: <code>BTCUSDT / ETHUSDT</code>,{" "}
                <code>(SOLUSDT - AVAXUSDT)</code>, <code>sma(BTCUSDT, 20) - BTCUSDT</code>.
              </p>
            </>
          )}
          {error ? <p className="error-message">{error}</p> : null}
          <button className="button primary" type="submit">
            <Plus size={14} />
            Add to chart
          </button>
          <p className="form-section-label">ON THIS CHART</p>
          {!compares.length ? <p className="form-help">Nothing compared yet.</p> : null}
          {compares.map((c) => (
            <div className="compare-row" key={c.id}>
              <input
                type="color"
                aria-label={`Color for ${c.label}`}
                value={c.color}
                onChange={(e) => update(c.id, { color: e.target.value })}
              />
              <span className="compare-label" title={c.label}>
                {c.label}
                {c.symbol ? <small>{getSymbol(c.symbol).name}</small> : <small>formula</small>}
                {c.error ? <em className="negative">{c.error}</em> : null}
              </span>
              <select
                aria-label={`Scale for ${c.label}`}
                value={c.scale}
                onChange={(e) => update(c.id, { scale: e.target.value as CompareSeries["scale"] })}
              >
                <option value="relative">Rebased</option>
                <option value="own">Own scale</option>
                <option value="price">Price scale</option>
              </select>
              <IconButton label={c.visible ? `Hide ${c.label}` : `Show ${c.label}`} onClick={() => update(c.id, { visible: !c.visible })}>
                {c.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </IconButton>
              <IconButton
                label={`Remove ${c.label}`}
                onClick={() => useChartStore.getState().set({ compares: compares.filter((x) => x.id !== c.id) })}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
        </div>
      </form>
    </Modal>
  );
}

const PRICE_FIELDS: PriceSource[] = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "volume"];

function ParameterInputs({
  indicator,
  values,
  onChange,
}: {
  indicator: string;
  values: Record<string, number>;
  onChange: (values: Record<string, number>) => void;
}) {
  const study = findTaIndicator(indicator);
  if (!study) return null;
  return (
    <div className="parameter-grid">
      {study.parameters.map((p) => (
        <label key={p.key}>
          {p.label}
          <input
            type="number"
            min={p.min}
            max={p.max}
            step={p.step ?? "any"}
            value={values[p.key] ?? p.defval}
            onChange={(e) => onChange({ ...values, [p.key]: Number(e.target.value) })}
          />
        </label>
      ))}
    </div>
  );
}

const DEFAULT_DERIVED: DerivedSpec = {
  source: { kind: "indicator", indicator: "rsi", params: { length: 14 } },
  apply: { indicator: "sma", params: { length: 9 } },
};

export function DerivedDialog() {
  const openNew = useChartStore((s) => s.derivedOpen);
  const editing = useChartStore((s) =>
    s.indicators.find((i) => i.id === s.settingsId && i.definitionId === DERIVED_DEFINITION_ID),
  );
  const open = openNew || Boolean(editing);
  const close = useCallback(() => {
    useChartStore.getState().set({ derivedOpen: false, settingsId: null });
  }, []);
  if (!open) return null;
  return <DerivedForm key={editing?.id ?? "new"} editing={editing} onClose={close} />;
}

function DerivedForm({
  editing,
  onClose,
}: {
  editing: ReturnType<typeof useChartStore.getState>["indicators"][number] | undefined;
  onClose: () => void;
}) {
  const initial = useMemo(() => {
    try {
      const parsed = editing ? JSON.parse(String(editing.inputs.spec)) : null;
      return isDerivedSpec(parsed) ? parsed : DEFAULT_DERIVED;
    } catch {
      return DEFAULT_DERIVED;
    }
  }, [editing]);
  const [spec, setSpec] = useState<DerivedSpec>(initial);
  const sourceable = TA_INDICATORS.filter((i) => i.sourceable);
  const sourceStudy = spec.source.kind === "indicator" ? findTaIndicator(spec.source.indicator ?? "") : null;
  const valid = isDerivedSpec(spec);
  const save = () => {
    if (!valid) return;
    const store = useChartStore.getState();
    const name = describeDerived(spec);
    const inputs = { spec: JSON.stringify(spec) };
    if (editing) store.updateIndicator(editing.id, { name, inputs, error: undefined });
    else
      store.addIndicator({
        id: crypto.randomUUID(),
        definitionId: DERIVED_DEFINITION_ID,
        name,
        visible: true,
        inputs,
        color: "#2962ff",
        lineWidth: 2,
        source: "close",
      });
    onClose();
  };
  return (
    <Modal title={editing ? "Edit indicator on indicator" : "Indicator on indicator"} onClose={onClose} className="derived-modal">
      <div className="form-body">
        <p className="form-section-label">1 · DATA TO ANALYZE</p>
        <div className="segmented">
          <button
            type="button"
            className={spec.source.kind === "price" ? "active" : ""}
            onClick={() => setSpec({ ...spec, source: { kind: "price", field: "close" } })}
          >
            Price
          </button>
          <button
            type="button"
            className={spec.source.kind === "indicator" ? "active" : ""}
            onClick={() => setSpec({ ...spec, source: DEFAULT_DERIVED.source })}
          >
            Another indicator
          </button>
        </div>
        {spec.source.kind === "price" ? (
          <label>
            Price field
            <select
              value={spec.source.field ?? "close"}
              onChange={(e) => setSpec({ ...spec, source: { kind: "price", field: e.target.value as PriceSource } })}
            >
              {PRICE_FIELDS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              Indicator
              <select
                value={spec.source.indicator}
                onChange={(e) => {
                  const study = findTaIndicator(e.target.value)!;
                  setSpec({
                    ...spec,
                    source: { kind: "indicator", indicator: study.id, params: defaultParameters(study), plot: study.compute([], {}).plots[0]?.id },
                  });
                }}
              >
                {TA_INDICATORS.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            <ParameterInputs
              indicator={spec.source.indicator ?? "rsi"}
              values={{ ...(sourceStudy ? defaultParameters(sourceStudy) : {}), ...(spec.source.params ?? {}) }}
              onChange={(params) => setSpec({ ...spec, source: { ...spec.source, params } })}
            />
            {sourceStudy && sourceStudy.compute([], {}).plots.length > 1 ? (
              <label>
                Output line
                <select
                  value={spec.source.plot ?? sourceStudy.compute([], {}).plots[0].id}
                  onChange={(e) => setSpec({ ...spec, source: { ...spec.source, plot: e.target.value } })}
                >
                  {sourceStudy.compute([], {}).plots.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        )}
        <p className="form-section-label">2 · APPLY</p>
        <label>
          Study
          <select
            value={spec.apply.indicator}
            onChange={(e) => {
              const study = findTaIndicator(e.target.value)!;
              setSpec({ ...spec, apply: { indicator: study.id, params: defaultParameters(study) } });
            }}
          >
            {sourceable.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <ParameterInputs
          indicator={spec.apply.indicator}
          values={{ ...(findTaIndicator(spec.apply.indicator) ? defaultParameters(findTaIndicator(spec.apply.indicator)!) : {}), ...(spec.apply.params ?? {}) }}
          onChange={(params) => setSpec({ ...spec, apply: { ...spec.apply, params } })}
        />
        <p className="derived-preview">{valid ? describeDerived(spec) : "Choose a valid combination."}</p>
      </div>
      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="button primary" disabled={!valid} onClick={save}>
          {editing ? "Apply" : "Add to chart"}
        </button>
      </div>
    </Modal>
  );
}

export function PatternsButton() {
  const on = useChartStore((s) => s.patternsOn);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const options = useChartStore((s) => s.patternOptions);
  const hits = useChartStore((s) => s.patternHits);
  const list = useMemo(() => allPatternIds(), []);
  const set = (patch: Partial<typeof options>) =>
    useChartStore.getState().set({ patternOptions: { ...options, ...patch } });
  const toggleId = (id: string) =>
    set({
      disabled: options.disabled.includes(id)
        ? options.disabled.filter((d) => d !== id)
        : [...options.disabled, id],
    });
  return (
    <div ref={ref} className="toolbar-popover-host">
      <button
        className={`toolbar-button patterns-toolbar-button ${on ? "active" : ""}`}
        aria-label="Pattern analysis"
        title="Pattern analysis"
        aria-pressed={on}
        onClick={() => setOpen(!open)}
      >
        <ScanSearch size={19} />
        <span>Patterns{on && hits.length ? ` (${hits.length})` : ""}</span>
      </button>
      {open ? (
        <div className="tv-popover pattern-popover">
          <label className="sync-option">
            <span>Detect patterns on this chart</span>
            <input
              type="checkbox"
              checked={on}
              onChange={(e) => useChartStore.getState().set({ patternsOn: e.target.checked })}
            />
          </label>
          <label className="sync-option">
            <span>Candlestick patterns</span>
            <input type="checkbox" checked={options.candlestick} onChange={(e) => set({ candlestick: e.target.checked })} />
          </label>
          <label className="sync-option">
            <span>Chart patterns</span>
            <input type="checkbox" checked={options.chart} onChange={(e) => set({ chart: e.target.checked })} />
          </label>
          <label className="sync-option">
            <span>Minimum confidence</span>
            <select
              value={options.minConfidence}
              onChange={(e) => set({ minConfidence: Number(e.target.value) })}
            >
              {[0.4, 0.5, 0.6, 0.7].map((v) => (
                <option key={v} value={v}>
                  {Math.round(v * 100)}%
                </option>
              ))}
            </select>
          </label>
          <label className="sync-option">
            <span>Scan last bars</span>
            <select value={options.lookback} onChange={(e) => set({ lookback: Number(e.target.value) })}>
              {[200, 400, 600, 1000, 2000].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <hr />
          <div className="popover-label">Detected ({hits.length})</div>
          <PatternList hits={hits.slice(-40).reverse()} />
          <hr />
          <div className="popover-label">Pattern catalog</div>
          <div className="pattern-catalog">
            {list.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={!options.disabled.includes(p.id)}
                  onChange={() => toggleId(p.id)}
                />
                <span>{p.name}</span>
                <small className={p.bias === "bullish" ? "positive" : p.bias === "bearish" ? "negative" : "muted"}>
                  {p.kind === "chart" ? "chart" : "candle"}
                </small>
              </label>
            ))}
          </div>
          <button className="button small" onClick={() => useChartStore.getState().set({ patternOptions: DEFAULT_PATTERN_OPTIONS })}>
            Reset options
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PatternList({ hits }: { hits: PatternHit[] }) {
  if (!hits.length)
    return <p className="popover-help">No patterns found in the scanned range.</p>;
  return (
    <div className="pattern-list">
      {hits.map((hit) => (
        <button
          key={hit.key}
          title={hit.description}
          onClick={() =>
            useChartStore.getState().set({
              command: { id: Date.now(), kind: "goto", time: hit.time },
            })
          }
        >
          <span className={hit.bias === "bullish" ? "positive" : hit.bias === "bearish" ? "negative" : "muted"}>
            {hit.bias === "bullish" ? "▲" : hit.bias === "bearish" ? "▼" : "◆"}
          </span>
          <span>{hit.name}</span>
          <small>
            {new Date(hit.time).toISOString().slice(5, 16).replace("T", " ")} ·{" "}
            {Math.round(hit.confidence * 100)}%{hit.confirmed ? "" : " · pending"}
          </small>
        </button>
      ))}
    </div>
  );
}

export function useChartToolHotkeys() {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        useChartStore.getState().set({ compareOpen: true });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
