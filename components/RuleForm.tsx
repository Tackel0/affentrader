"use client";
import { useMemo, useState } from "react";
import { Plus, Trash2, Server, Send } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useAlertStore } from "@/stores/useAlertStore";
import { editAlerts } from "@/lib/alerts/browserOwnership";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { useServerStore } from "@/stores/useServerStore";
import { serverAlerts } from "@/lib/alerts/serverClient";
import {
  describeCondition,
  isQuoteOnly,
  validateRuleShape,
} from "@/lib/alerts/rules";
import { QUICK_INTERVALS, isTickInterval, isValidInterval } from "@/lib/market/intervals";
import { CANDLE_PATTERNS } from "@/lib/patterns/candles";
import { defaultParameters, findTaIndicator, TA_INDICATORS, type PriceSource } from "@/lib/ta";
import { normalizeRuleMarkets, WATCHLIST_CANDLE_LIMIT } from "@/lib/alerts/dependencies";
import type {
  AlertRule,
  Comparator,
  Condition,
  Leaf,
  Operand,
  RuleKind,
  AlertTrigger,
  MovementOperand,
} from "@/types/alerts";
import { AlertTimingFields } from "./AlertTimingFields";
import { closesOnly, defaultExpiry, isExpired, timingFields } from "@/lib/alerts/schedule";
import { freshRate } from "@/lib/alerts/rateLimit";
import { requestNotifications, unlockAudio } from "@/lib/alerts/notifications";
import { tpoAlertSettings } from "@/lib/alerts/tpo";
import { TpoAlertConditionEditor } from "./TpoAlertConditionEditor";

const COMPARATORS: { value: Comparator; label: string }[] = [
  { value: ">", label: "is greater than" },
  { value: "<", label: "is less than" },
  { value: ">=", label: "is at or above" },
  { value: "<=", label: "is at or below" },
  { value: "crossing_up", label: "crosses above" },
  { value: "crossing_down", label: "crosses below" },
  { value: "crossing", label: "crosses" },
];
const PRICE_FIELDS: PriceSource[] = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "volume"];

function OperandEditor({
  value,
  onChange,
  quotes,
  historyOnly = false,
}: {
  value: Operand;
  onChange: (value: Operand) => void;
  quotes: boolean;
  historyOnly?: boolean;
}) {
  const study = value.type === "indicator" ? findTaIndicator(value.indicator) : null;
  const plots = study ? study.compute([], {}).plots : [];
  return (
    <div className="operand-editor">
      <select
        aria-label="Operand type"
        value={value.type}
        onChange={(e) => {
          const type = e.target.value as Operand["type"];
          onChange(
            type === "number"
              ? { type, value: 0 }
              : type === "price"
                ? { type, field: "close" }
                : type === "quote"
                  ? { type, field: "price" }
                  : { type: "indicator", indicator: "rsi", params: { length: 14 } },
          );
        }}
      >
        <option value="price">Price</option>
        <option value="indicator">Indicator</option>
        {!historyOnly ? <option value="number">Number</option> : null}
        {!historyOnly && quotes ? <option value="quote">Provider quote</option> : null}
        {!historyOnly && !quotes && value.type === "quote" ? <option value="quote">Provider quote</option> : null}
      </select>
      {value.type === "price" ? (
        <select aria-label="Price field" value={value.field} onChange={(e) => onChange({ type: "price", field: e.target.value as PriceSource })}>
          {PRICE_FIELDS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      ) : null}
      {value.type === "number" ? (
        <input
          aria-label="Number"
          type="number"
          step="any"
          value={value.value}
          onChange={(e) => onChange({ type: "number", value: Number(e.target.value) })}
        />
      ) : null}
      {value.type === "quote" ? (
        <select aria-label="Quote field" value={value.field} onChange={(e) => onChange({ type: "quote", field: e.target.value as Extract<Operand, { type: "quote" }>["field"] })}>
          <option value="price">Last price</option>
          <option value="changePercent">Change % (provider period)</option>
          <option value="volume">Base volume (provider period)</option>
          <option value="high">High (provider period)</option>
          <option value="low">Low (provider period)</option>
        </select>
      ) : null}
      {value.type === "indicator" && study ? (
        <>
          <select
            aria-label="Indicator"
            value={value.indicator}
            onChange={(e) => {
              const next = findTaIndicator(e.target.value)!;
              onChange({ type: "indicator", indicator: next.id, params: defaultParameters(next) });
            }}
          >
            {TA_INDICATORS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.shortName}
              </option>
            ))}
          </select>
          {study.parameters.map((p) => (
            <label key={p.key} className="inline-param" title={p.label}>
              <span>{p.label}</span>
              <input
                type="number"
                min={p.min}
                max={p.max}
                step={p.step ?? "any"}
                value={value.params?.[p.key] ?? p.defval}
                onChange={(e) =>
                  onChange({ ...value, params: { ...(value.params ?? {}), [p.key]: Number(e.target.value) } })
                }
              />
            </label>
          ))}
          {plots.length > 1 ? (
            <select aria-label="Output line" value={value.plot ?? plots[0].id} onChange={(e) => onChange({ ...value, plot: e.target.value })}>
              {plots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const DEFAULT_LEAF: Leaf = {
  type: "compare",
  left: { type: "indicator", indicator: "rsi", params: { length: 14 } },
  comparator: "<",
  right: { type: "number", value: 30 },
};

function LeafEditor({
  leaf,
  onChange,
  onRemove,
  canRemove,
  watchlist,
}: {
  leaf: Leaf;
  onChange: (leaf: Leaf) => void;
  onRemove: () => void;
  canRemove: boolean;
  watchlist: boolean;
}) {
  const [other, setOther] = useState(Boolean(leaf.symbol || leaf.timeframe));
  const change = (patch: Partial<Leaf>) => onChange({ ...leaf, ...patch } as Leaf);
  const context = { symbol: leaf.symbol, timeframe: leaf.timeframe };
  const switchType = (type: Leaf["type"]) => {
    switch (type) {
      case "tpo": return onChange({ type, level: "poc", direction: "crossing", settings: tpoAlertSettings(undefined, useChartStore.getState().symbol), ...context });
      case "compare":
        return onChange({ ...DEFAULT_LEAF, ...context } as Leaf);
      case "band":
        return onChange({ type, operand: { type: "price", field: "close" }, low: 0, high: 0, mode: "entering", ...context });
      case "change":
        return onChange({ type, percent: 5, bars: watchlist ? 0 : 4, direction: "up", ...context });
      case "movement":
        return onChange({ type, operand: { type: "price", field: "close" }, amount: 1, bars: 5, unit: "absolute", direction: "up", ...context });
      case "volume_spike":
        return onChange({ type, multiple: 3, length: 20, ...context });
      case "extreme":
        return onChange({ type, kind: "high", length: 20, ...context });
      case "pattern":
        return onChange({ type, patternId: "bullish-engulfing", ...context });
    }
  };
  return (
    <div className="leaf-editor">
      <div className="leaf-row">
        <select aria-label="Condition type" value={leaf.type} onChange={(e) => switchType(e.target.value as Leaf["type"])}>
          <option value="compare">Compare values</option>
          <option value="band">Price band</option>
          <option value="movement">Moving up / down</option>
          <option value="change">Percent change</option>
          <option value="tpo">Completed TPO reference</option>
          {!watchlist ? <option value="volume_spike">Volume spike</option> : null}
          {!watchlist ? <option value="extreme">New high / low</option> : null}
          {!watchlist ? <option value="pattern">Candle pattern</option> : null}
        </select>
        <button type="button" className="link-button" onClick={() => setOther(!other)}>
          {other ? "Same market" : "Other market…"}
        </button>
        {canRemove ? (
          <button type="button" className="icon-button" aria-label="Remove condition" onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        ) : null}
      </div>
      {leaf.type === "tpo" && <TpoAlertConditionEditor value={leaf} onChange={onChange} />}
      {leaf.type === "compare" ? (
        <div className="leaf-row">
          <OperandEditor value={leaf.left} quotes={watchlist} onChange={(left) => change({ left })} />
          <select aria-label="Comparator" value={leaf.comparator} onChange={(e) => change({ comparator: e.target.value as Comparator })}>
            {COMPARATORS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <OperandEditor value={leaf.right} quotes={watchlist} onChange={(right) => change({ right })} />
        </div>
      ) : null}
      {leaf.type === "band" ? (
        <div className="leaf-row">
          <OperandEditor value={leaf.operand} quotes={watchlist} onChange={(operand) => change({ operand })} />
          <select aria-label="Band mode" value={leaf.mode} onChange={(e) => change({ mode: e.target.value as "entering" })}>
            <option value="entering">enters</option>
            <option value="exiting">leaves</option>
            <option value="inside">is inside</option>
            <option value="outside">is outside</option>
          </select>
          <input aria-label="Lower bound" type="number" step="any" value={leaf.low} onChange={(e) => change({ low: Number(e.target.value) })} />
          <span>to</span>
          <input aria-label="Upper bound" type="number" step="any" value={leaf.high} onChange={(e) => change({ high: Number(e.target.value) })} />
        </div>
      ) : null}
      {leaf.type === "change" ? (
        <div className="leaf-row">
          <span>Price</span>
          <select aria-label="Direction" value={leaf.direction} onChange={(e) => change({ direction: e.target.value as "up" })}>
            <option value="up">rises</option>
            <option value="down">falls</option>
            <option value="either">moves</option>
          </select>
          <input aria-label="Percent" type="number" step="any" min={0} value={leaf.percent} onChange={(e) => change({ percent: Number(e.target.value) })} />
          <span>% within</span>
          <input aria-label="Bars" type="number" min={0} step={1} value={leaf.bars} onChange={(e) => change({ bars: Math.max(0, Math.floor(Number(e.target.value))) })} />
          <span>bars {leaf.bars === 0 ? "(0 = provider change)" : ""}</span>
        </div>
      ) : null}
      {leaf.type === "movement" ? (
        <>
          <div className="leaf-row">
            <OperandEditor value={leaf.operand} quotes={false} historyOnly onChange={operand => change({ operand: operand as MovementOperand })} />
          </div>
          <div className="leaf-row">
            <select aria-label="Movement operator" value={`${leaf.direction}:${leaf.unit}`} onChange={event => {
              const [direction, unit] = event.target.value.split(":") as ["up" | "down", "absolute" | "percent"];
              change({ direction, unit });
            }}>
              <option value="up:absolute">Moving up</option>
              <option value="down:absolute">Moving down</option>
              <option value="up:percent">Moving up %</option>
              <option value="down:percent">Moving down %</option>
            </select>
            <span className="movement-value">
              <input aria-label="Movement amount" type="number" min={0} step="any" value={leaf.amount} onChange={event => change({ amount: Number(event.target.value) })} />
              <span>{leaf.unit === "percent" ? "%" : "units"}</span>
            </span>
            <span className="movement-value">
              <span>within</span>
              <input aria-label="Movement bars" type="number" min={1} max={19999} step={1} value={leaf.bars} onChange={event => change({ bars: Number(event.target.value) })} />
              <span>bars</span>
            </span>
          </div>
          <p className="form-help">Compares the current source with its value {leaf.bars} bars ago. Units follow the source: price, volume or indicator points. Choose bar-close triggering for confirmed values.</p>
        </>
      ) : null}
      {leaf.type === "volume_spike" ? (
        <div className="leaf-row">
          <span>Volume ≥</span>
          <input aria-label="Multiple" type="number" step="any" min={0.1} value={leaf.multiple} onChange={(e) => change({ multiple: Number(e.target.value) })} />
          <span>× the average of</span>
          <input aria-label="Length" type="number" min={1} step={1} value={leaf.length} onChange={(e) => change({ length: Math.floor(Number(e.target.value)) })} />
          <span>bars</span>
        </div>
      ) : null}
      {leaf.type === "extreme" ? (
        <div className="leaf-row">
          <span>Close makes a new</span>
          <input aria-label="Length" type="number" min={1} step={1} value={leaf.length} onChange={(e) => change({ length: Math.floor(Number(e.target.value)) })} />
          <span>-bar</span>
          <select aria-label="High or low" value={leaf.kind} onChange={(e) => change({ kind: e.target.value as "high" })}>
            <option value="high">high</option>
            <option value="low">low</option>
          </select>
        </div>
      ) : null}
      {leaf.type === "pattern" ? (
        <div className="leaf-row">
          <span>Latest closed candle completes</span>
          <select aria-label="Pattern" value={leaf.patternId} onChange={(e) => change({ patternId: e.target.value })}>
            {CANDLE_PATTERNS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {other ? (
        <div className="leaf-row context-row">
          <input
            aria-label="Symbol for this condition"
            placeholder="Symbol (default: rule symbol)"
            value={leaf.symbol ?? ""}
            onChange={(e) => change({ symbol: e.target.value || undefined })}
          />
          <select
            aria-label="Interval for this condition"
            value={leaf.timeframe ?? ""}
            onChange={(e) => change({ timeframe: e.target.value || undefined })}
          >
            <option value="">Rule interval</option>
            {QUICK_INTERVALS.filter((i) => !isTickInterval(i)).map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

function GroupEditor({
  value,
  onChange,
  watchlist,
  root = true,
  onRemove,
}: {
  value: Extract<Condition, { op: "all" | "any" }>;
  onChange: (value: Extract<Condition, { op: "all" | "any" }>) => void;
  watchlist: boolean;
  root?: boolean;
  onRemove?: () => void;
}) {
  const setChild = (index: number, child: Condition) =>
    onChange({ ...value, conditions: value.conditions.map((c, i) => (i === index ? child : c)) });
  return (
    <div className={`group-editor ${root ? "root" : ""}`}>
      <div className="leaf-row">
        <span>Trigger when</span>
        <select aria-label="Match" value={value.op} onChange={(e) => onChange({ ...value, op: e.target.value as "all" | "any" })}>
          <option value="all">ALL of these are true</option>
          <option value="any">ANY of these is true</option>
        </select>
        {onRemove ? (
          <button type="button" className="icon-button" aria-label="Remove group" onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        ) : null}
      </div>
      {value.conditions.map((child, index) =>
        child.op === "leaf" ? (
          <LeafEditor
            key={index}
            leaf={child.leaf}
            watchlist={watchlist}
            canRemove={value.conditions.length > 1}
            onChange={(leaf) => setChild(index, { op: "leaf", leaf })}
            onRemove={() => onChange({ ...value, conditions: value.conditions.filter((_, i) => i !== index) })}
          />
        ) : (
          <GroupEditor
            key={index}
            root={false}
            value={child}
            watchlist={watchlist}
            onChange={(next) => setChild(index, next)}
            onRemove={() => onChange({ ...value, conditions: value.conditions.filter((_, i) => i !== index) })}
          />
        ),
      )}
      <div className="leaf-row">
        <button
          type="button"
          className="button small"
          onClick={() =>
            onChange({ ...value, conditions: [...value.conditions, { op: "leaf", leaf: watchlist ? WATCHLIST_LEAF : DEFAULT_LEAF }] })
          }
        >
          <Plus size={12} /> Add condition
        </button>
        {root && !watchlist ? (
          <button
            type="button"
            className="button small"
            onClick={() =>
              onChange({
                ...value,
                conditions: [...value.conditions, { op: "any", conditions: [{ op: "leaf", leaf: DEFAULT_LEAF }] }],
              })
            }
          >
            <Plus size={12} /> Add group
          </button>
        ) : null}
      </div>
    </div>
  );
}

const WATCHLIST_LEAF: Leaf = { type: "change", percent: 5, bars: 0, direction: "up" };

export function ServerKeyField() {
  const key = useServerStore((s) => s.key);
  const link = useServerStore((s) => s.link);
  const health = useServerStore((s) => s.health);
  const [draft, setDraft] = useState("");
  return (
    <div className="server-key">
      <div className="server-status">
        <Server size={14} />
        <span className={`status-dot ${link === "connected" ? "" : "amber"}`} />
        {link === "connected"
          ? `Server connected${health?.lastRunAt ? ` · last evaluated ${new Date(health.lastRunAt).toLocaleTimeString()}` : ""}`
          : link === "unauthorized"
            ? "The server rejected this access key."
            : link === "offline"
              ? "Server unreachable."
              : link === "connecting"
                ? "Connecting…"
                : "Not connected to the alert server."}
      </div>
      {link !== "connected" ? (
        <div className="server-key-input">
          <input
            aria-label="Server access key"
            type="password"
            autoComplete="off"
            placeholder="Paste the key from .data/access-key.txt"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            className="button small"
            disabled={!draft.trim()}
            onClick={() => {
              useServerStore.getState().setKey(draft);
              setDraft("");
            }}
          >
            Connect
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="link-button"
          onClick={() => useServerStore.getState().setKey("")}
        >
          Disconnect this browser
        </button>
      )}
      {key && link === "unauthorized" ? (
        <p className="form-help">
          The key is generated on first start and printed in the server console;
          it is also stored in <code>.data/access-key.txt</code>.
        </p>
      ) : null}
    </div>
  );
}

export function RuleForm({
  kind,
  existing,
  draft,
  onClose,
}: {
  kind: RuleKind;
  existing?: AlertRule;
  draft?: import("@/types/trading").AlertDraft;
  onClose: () => void;
}) {
  const chart = useChartStore.getState();
  const lists = useWatchlistStore((s) => s.lists);
  const activeList = useWatchlistStore((s) => s.activeId);
  const link = useServerStore((s) => s.link);
  const key = useServerStore((s) => s.key);
  const watch = (existing?.kind ?? kind) === "watchlist";
  const [name, setName] = useState(existing?.name ?? draft?.name ?? (watch ? "Watchlist alert" : `${chart.symbol} alert`));
  const [symbol, setSymbol] = useState(existing?.scope.type === "symbol" ? existing.scope.symbol : draft?.symbol ?? chart.symbol);
  const [listId, setListId] = useState(existing?.scope.type === "watchlist" ? existing.scope.listId : activeList);
  const [timeframe, setTimeframe] = useState(existing?.scope.timeframe ?? draft?.timeframe ?? (isTickInterval(chart.timeframe) ? "15m" : chart.timeframe));
  const [condition, setCondition] = useState<Extract<Condition, { op: "all" | "any" }>>(() => {
    if (existing && existing.condition.op !== "leaf") return existing.condition;
    if (existing && existing.condition.op === "leaf") return { op: "all", conditions: [existing.condition] };
    if (draft?.ruleCondition) return draft.ruleCondition.op === "leaf" ? { op: "all", conditions: [draft.ruleCondition] } : draft.ruleCondition;
    const leaves: Condition[] =
      watch
        ? [{ op: "leaf", leaf: WATCHLIST_LEAF }]
        : kind === "composite"
          ? [
              { op: "leaf", leaf: DEFAULT_LEAF },
              { op: "leaf", leaf: { type: "volume_spike", multiple: 2, length: 20 } },
            ]
          : [{ op: "leaf", leaf: DEFAULT_LEAF }];
    return { op: "all", conditions: leaves };
  });
  const [frequency, setFrequency] = useState<AlertRule["frequency"]>(existing?.frequency ?? (watch ? "tick" : "close"));
  const [repeat, setRepeat] = useState(existing?.repeat ?? false);
  const [trigger, setTrigger] = useState<AlertTrigger | "legacy">(existing ? existing.trigger ?? "legacy" : watch ? "once" : "once_per_close");
  const [expiresAt, setExpiresAt] = useState<number | undefined>(existing?.expiresAt ?? (watch ? defaultExpiry() : undefined));
  const timing = trigger === "legacy" ? { frequency, repeat } : timingFields(trigger);
  const [cooldown, setCooldown] = useState(Math.round((existing?.cooldownMs ?? 0) / 60000));
  const [message, setMessage] = useState(existing?.message ?? "");
  const [sound, setSound] = useState(existing?.sound ?? true);
  const [notify, setNotify] = useState(existing?.browserNotification ?? false);
  const [serverSide, setServerSide] = useState(existing?.serverSide ?? false);
  const [webhookUrl, setWebhookUrl] = useState(existing?.webhook?.url ?? "");
  const [webhookSecret, setWebhookSecret] = useState(existing?.webhook?.secret ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const summary = useMemo(() => describeCondition(condition), [condition]);
  const list = lists.find((l) => l.id === listId);

  const build = (): AlertRule => {
    const scope: AlertRule["scope"] = watch
      ? { type: "watchlist", listId, symbols: list?.symbols ?? [], timeframe }
      : { type: "symbol", symbol: symbol.trim(), timeframe };
    return normalizeRuleMarkets({
      id: existing?.id ?? crypto.randomUUID(),
      name: name.trim(),
      kind: existing?.kind ?? kind,
      status: existing?.status === "triggered" || existing?.status === "expired" || existing?.status === "stopped" ? "active" : (existing?.status ?? "active"),
      scope,
      condition,
      ...timing,
      trigger: trigger === "legacy" ? undefined : trigger,
      expiresAt,
      triggeredSymbols: [],
      lastFired: {},
      rate: freshRate(Date.now(), existing?.rate),
      stop: undefined,
      cooldownMs: Math.max(0, cooldown) * 60000,
      message: message.trim() || undefined,
      sound,
      browserNotification: notify,
      serverSide,
      webhook: webhookUrl.trim() ? { url: webhookUrl.trim(), secret: webhookSecret || undefined } : undefined,
      createdAt: existing?.createdAt ?? Date.now(),
      lastTriggeredAt: undefined,
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const rule = build();
    const problem = validateRuleShape(rule) ?? (isValidInterval(rule.scope.timeframe) ? null : "Choose a valid interval.");
    if (problem) return setError(problem);
    if (rule.scope.type === "watchlist" && !rule.scope.symbols.length) return setError("Add at least one symbol to the watchlist before creating the alert.");
    if (isExpired(rule)) return setError("Choose an expiration in the future or an open-ended alert.");
    if (serverSide && isTickInterval(rule.scope.timeframe)) return setError("Server alerts need a time-based interval.");
    if ((serverSide || rule.webhook) && !key) return setError("Connect the alert server first (access key below).");
    setBusy(true);
    try {
      unlockAudio();
      if (notify && !(await requestNotifications())) rule.browserNotification = false;
      if (serverSide) {
        const saved = await serverAlerts.save(key, rule);
        await editAlerts(store=>{if(existing)store.removeRule(existing.id);store.replaceServerRules([...useAlertStore.getState().rules.filter(r=>r.serverSide&&r.id!==rule.id),saved.rule]);});
      } else {
        if (existing?.serverSide) await serverAlerts.remove(key, existing.id).catch(() => undefined);
        await editAlerts(store=>{if(existing)store.editRule(existing.id,rule);else store.addRule(rule);});
      }
      chart.toast(existing ? "Alert updated" : "Alert created", `${rule.name} · ${describeCondition(rule.condition)}`, "success");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const testWebhook = async () => {
    setError("");
    try {
      await serverAlerts.testWebhook(key, { url: webhookUrl.trim(), secret: webhookSecret || undefined });
      chart.toast("Webhook delivered", webhookUrl.trim(), "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="form-body rule-form">
        <label>
          Alert name
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {watch ? (
          <div className="form-grid">
            <label>
              Watchlist
              <select value={listId} onChange={(e) => setListId(e.target.value)}>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.symbols.length})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Interval
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                {QUICK_INTERVALS.filter((i) => !isTickInterval(i)).map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="form-grid">
            <label>
              Symbol
              <input aria-label="Alert symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={64} required />
            </label>
            <label>
              Interval
              <select value={QUICK_INTERVALS.includes(timeframe) ? timeframe : "custom"} onChange={(e) => e.target.value !== "custom" && setTimeframe(e.target.value)}>
                {QUICK_INTERVALS.map((i) => (
                  <option key={i}>{i}</option>
                ))}
                {!QUICK_INTERVALS.includes(timeframe) ? <option value="custom">{timeframe}</option> : null}
              </select>
            </label>
          </div>
        )}
        <GroupEditor value={condition} onChange={setCondition} watchlist={watch} />
        <p className="rule-summary">{summary}</p>
        {watch && (!isQuoteOnly(condition) || closesOnly(timing) || trigger === "once_per_bar") ? (
          <p className="form-help">
            Conditions requiring candles are evaluated for the first {WATCHLIST_CANDLE_LIMIT} symbols of the watchlist.
          </p>
        ) : null}
        <AlertTimingFields trigger={trigger} expiresAt={expiresAt} watchlist={watch} onTrigger={setTrigger} onExpiry={setExpiresAt} />
        <div className="form-grid" style={trigger === "legacy" ? undefined : { gridTemplateColumns: "1fr" }}>
          {trigger === "legacy" ? <label>
            Evaluate
            <select aria-label="Alert evaluation" value={frequency} onChange={(e) => setFrequency(e.target.value as "tick" | "close")}>
              <option value="close">When a bar closes</option>
              <option value="tick">On every price update</option>
            </select>
          </label> : null}
          <label>
            Cool-down (minutes)
            <input type="number" min={0} step={1} value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} />
          </label>
        </div>
        {closesOnly(timing) ? <p className="form-help">Uses confirmed candles at the smallest condition interval. Live quote metrics require a snapshot from that candle boundary. Server checks run every 15 seconds.</p> : null}
        <label>
          Message (optional)
          <input maxLength={500} value={message} placeholder="Shown in the notification" onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className="checkbox-group">
          {trigger === "legacy" ? <label>
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            Repeat every time the condition becomes true again
          </label> : null}
          <label>
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
            Play notification sound
          </label>
          <label>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Browser notification
          </label>
          <label>
            <input type="checkbox" checked={serverSide} onChange={(e) => setServerSide(e.target.checked)} />
            Run on the server (keeps working with no browser open)
          </label>
        </div>
        <div className="webhook-box">
          <label>
            Webhook URL (optional)
            <input type="url" placeholder="https://example.com/hooks/alert" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
          </label>
          {webhookUrl ? (
            <div className="form-grid">
              <label>
                Signing secret
                <input type="password" autoComplete="off" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
              </label>
              <button type="button" className="button small" disabled={link !== "connected"} onClick={testWebhook}>
                <Send size={12} /> Send test
              </button>
            </div>
          ) : null}
        </div>
        {serverSide || webhookUrl ? <ServerKeyField /> : null}
        {error ? <p className="error-message">{error}</p> : null}
      </div>
      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : existing ? "Save changes" : "Create alert"}
        </button>
      </div>
    </form>
  );
}
