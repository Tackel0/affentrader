"use client";
import {currentPriceAlertDraft} from "@/lib/alerts/priceDraft";
import { retainedTpoReference, tpoReferenceLabel } from "@/lib/alerts/tpoDraft";
import { useCallback, useState } from "react";
import {
  Bell,
  Plus,
  Pause,
  Play,
  Pencil,
  Trash2,
  CheckCircle2,
  Clock3,
  Volume2,
} from "lucide-react";
import { useAlertStore } from "@/stores/useAlertStore";
import { editAlerts } from "@/lib/alerts/browserOwnership";
import { useAlertRole } from "@/hooks/useAlertOwnership";
import { useChartStore } from "@/stores/useChartStore";
import { describeSymbol, formatPrice, getSymbol, TIMEFRAMES } from "@/lib/symbols";
import { symbolLabel } from "@/lib/symbolId";
import { requestNotifications, unlockAudio } from "@/lib/alerts/notifications";
import type { AlertCondition, PriceAlert } from "@/types/trading";
import { IconButton, Modal } from "./ui";
import { RuleForm } from "./RuleForm";
import { useServerStore } from "@/stores/useServerStore";
import { serverAlerts } from "@/lib/alerts/serverClient";
import { describeCondition } from "@/lib/alerts/rules";
import type { AlertRule, RuleKind } from "@/types/alerts";
import type { AlertTrigger } from "@/types/alerts";
import { AlertTimingFields } from "./AlertTimingFields";
import { closesOnly, isExpired, timingFields, timingLabel, validateTiming } from "@/lib/alerts/schedule";
import { freshRate, restartRule, resumeRate, stopMessage } from "@/lib/alerts/rateLimit";
import type { AlertRateFields } from "@/types/alerts";
import { PineAlertForm } from "./PineAlertForm";
import { DrawingAlertForm } from "./DrawingAlertForm";
import { usePineRecoveryStore } from "@/stores/usePineRecoveryStore";
import { pineSnapshot } from "@/lib/alerts/pineRules";
import {expirationLabel} from "@/lib/alerts/lifecycle";
const KIND_LABEL: Record<RuleKind, string> = {
  technical: "Indicator",
  watchlist: "Watchlist",
  composite: "Combined",
  pine: "Pine Script",
  drawing:"Drawing",
};
const conditions: Record<AlertCondition, string> = {
  crossing: "Crossing",
  crossing_up: "Crossing up",
  crossing_down: "Crossing down",
  entering_band: "Entering band",
  exiting_band: "Exiting band",
};
function RateNotice({ alert, onRestartMembers, disabled }: { alert: AlertRateFields & {drawingIssue?:string}; onRestartMembers?: () => void; disabled?: boolean }) {
  const stopped = Object.entries(alert.rate?.stoppedSymbols ?? {});
  return <>
    {alert.stop ? <p className="alert-stop-reason">{alert.stop.reason==="drawing_unavailable"&&!alert.drawingIssue?"Drawing restored. Restart this alert to resume.":stopMessage(alert.stop)}</p> : null}
    {stopped.length && !alert.stop ? <details className="alert-member-stops">
      <summary>{stopped.length} stopped {stopped.length === 1 ? "symbol" : "symbols"}</summary>
      <p>15 triggers within 3 minutes. Other symbols are unaffected.</p>
      <ul>{stopped.map(([symbol, time]) => <li key={symbol}><span>{symbol}</span><time dateTime={new Date(time).toISOString()}>{new Date(time).toLocaleTimeString()}</time></li>)}</ul>
      {onRestartMembers ? <button type="button" className="button small" disabled={disabled} onClick={onRestartMembers}>Restart stopped symbols</button> : null}
    </details> : null}
  </>;
}
export function AlertsPanel() {
  const { alerts, logs } = useAlertStore();
  const role=useAlertRole();
  const change=(action:Parameters<typeof editAlerts>[0])=>{void editAlerts(action).catch(error=>useChartStore.getState().toast("Alert not saved",String(error),"error"));};
  const remove=(id:string)=>change(store=>store.remove(id));
  const clearLogs=()=>change(store=>store.clearLogs());
  const rules = useAlertStore((s) => s.rules),
    events = useAlertStore((s) => s.events);
  const [tab, setTab] = useState<"alerts" | "log">("alerts");
  const [filter, setFilter] = useState("all");
  const create = () => {
    const s = useChartStore.getState();
    s.set({
      alertDraft: currentPriceAlertDraft(),
    });
  };
  return (
    <section className="alerts-workspace" aria-label="Alert manager">
      <div className="panel-heading">
        <strong>
          Alerts
          <span className="count-badge">
            {alerts.filter((a) => a.status === "active").length +
              rules.filter((r) => r.status === "active").length}
          </span>
        </strong>
        <IconButton label="Create alert" onClick={create}>
          <Plus size={18} />
        </IconButton>
      </div>
      <div className="panel-tabs">
        <button
          className={tab === "alerts" ? "active" : ""}
          onClick={() => setTab("alerts")}
        >
          Alerts
        </button>
        <button
          className={tab === "log" ? "active" : ""}
          onClick={() => setTab("log")}
        >
          Trigger log<span>{logs.length + events.length}</span>
        </button>
      </div>
      {tab === "alerts" ? (
        <>
          <div className="alert-filters">
            <select
              aria-label="Filter alerts"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All alerts</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="triggered">Triggered</option>
            <option value="expired">Expired</option>
            <option value="stopped">Stopped</option>
            </select>
            <span>{alerts.length + rules.length} total</span>
          </div>
          <div className="alerts-list" role="region" aria-label="Alert list" tabIndex={0}>
            {rules
              .filter((r) => filter === "all" || r.status === filter)
              .map((r) => (
                <RuleCard key={r.id} rule={r} />
              ))}
            {alerts
              .filter((a) => filter === "all" || a.status === filter)
              .map((a) => (
                <div key={a.id} className="alert-card">
                  <div className="alert-card-title">
                    <Bell
                      size={14}
                      className={
                        a.status === "active" ? "text-accent" : "muted"
                      }
                    />
                    <strong>{a.name}</strong>
                    <span className={`alert-status ${a.status}`}>
                      {a.status}
                    </span>
                  </div>
                  {a.tpoReference && <p className="form-help">{tpoReferenceLabel(a.tpoReference)}</p>}
                  <p>
                    {symbolLabel(a.symbol)} <span>· {conditions[a.condition]}</span>
                  </p>
                  <div className="alert-threshold mono">
                    {formatPrice(a.price)}
                    {a.upperPrice ? ` – ${formatPrice(a.upperPrice)}` : ""}
                    <small> {describeSymbol(a.symbol).quote}</small>
                  </div>
                  <p className="alert-expiration">{a.expiresAt === undefined ? "Open ended" : `Expires ${new Date(a.expiresAt).toISOString().replace("T", " ").slice(0, 19)} UTC`}</p>
                  <RateNotice alert={a} />
                  {expirationLabel(a)?<p className="alert-stop-reason">{expirationLabel(a)}</p>:null}
                  <div className="alert-card-footer">
                    <span>
                      <Clock3 size={11} />
                      {timingLabel(a)}
                      {a.sound ? <Volume2 size={11} /> : null}
                    </span>
                    <div>
                      <IconButton
                        disabled={isExpired(a)}
                        label={
                          a.status === "active"
                            ? "Pause alert"
                            : a.status === "stopped" ? "Restart alert" : "Activate alert"
                        }
                        onClick={() =>
                          change(store=>{const current=store.alerts.find(value=>value.id===a.id);if(current)store.update(a.id, {
                            status: current.status === "active" ? "paused" : "active",
                            ...(current.status === "paused" ? { rate: resumeRate(current.rate) } : {}),
                            ...(current.status === "triggered" || current.status === "stopped" ? { lastTriggeredAt: undefined, lastTriggeredBar: undefined, stop: undefined, rate: freshRate(Date.now(), current.rate) } : {}),
                          });})
                        }
                      >
                        {a.status === "active" ? (
                          <Pause size={13} />
                        ) : (
                          <Play size={13} />
                        )}
                      </IconButton>
                      <IconButton
                        label={`Edit ${a.name}`}
                        onClick={() =>
                          useChartStore
                            .getState()
                            .set({
                              alertDraft: {
                                id: a.id,
                                price: a.price,
                                upperPrice: a.upperPrice,
                              },
                            })
                        }
                      >
                        <Pencil size={13} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${a.name}`}
                        onClick={() => remove(a.id)}
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  </div>
                </div>
              ))}
          {!alerts.length && !rules.length ? (
            <div className="empty-state alert-empty">
              <div className="empty-icon">
                <Bell size={26} />
              </div>
              <h3>Never miss a move</h3>
              <p>
                Set a price. Choose a condition.
                <br />
                We’ll let you know when it happens.
              </p>
              <button className="button primary" onClick={create}>
                <Plus size={14} />
                Create your first alert
              </button>
              <small>Or click the chart’s price scale.</small>
            </div>
          ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="alert-filters">
            <span>{logs.length + events.length} triggered events</span>
            <button
              className="text-accent"
              disabled={!logs.length && !events.length}
              onClick={clearLogs}
            >
              Clear log
            </button>
          </div>
          <div className="alert-events" role="region" aria-label="Alert trigger log" tabIndex={0}>
          {events.map((e) => (
            <div className="alert-log" key={e.id}>
              <CheckCircle2 size={16} className="positive" />
              <div>
                <strong>{e.name}</strong>
                <p>{e.message}</p>
                <small>
                  {new Date(e.time).toLocaleString()} ·{" "}
                  {e.source === "server" ? "SERVER" : "BROWSER"}
                  {e.strategyFill ? " · EMULATED FILL" : ""}
                  {e.simulated ? " · SIMULATION" : ""}
                </small>
              </div>
            </div>
          ))}
          {logs.map((log) => (
            <div className="alert-log" key={log.id}>
              <CheckCircle2 size={16} className="positive" />
              <div>
                <strong>{log.name}</strong>
                <p>
                  {log.symbol} · {formatPrice(log.price)}
                </p>
                <small>
                  {new Date(log.time).toLocaleString()}{" "}
                  {log.simulated ? "· SIMULATION" : ""}
                </small>
              </div>
            </div>
          ))}
          {!logs.length && !events.length ? (
            <div className="empty-state">
              <Clock3 size={26} />
              <p>No triggered alerts yet.</p>
            </div>
          ) : null}
          </div>
        </>
      )}
      <div className="alerts-disclaimer">
        <span className="status-dot" />
        <span role="status" data-testid="browser-alert-owner">{role.status==="primary"?"Browser alerts active in this tab":role.status==="standby"?"Browser alerts on standby — automatic takeover when the active tab closes":role.error}</span>
        <br />
        Rules marked SERVER keep running without browser tabs.
        <br />
        Simulation events are labeled in the log.
      </div>
    </section>
  );
}
function RuleCard({ rule }: { rule: AlertRule }) {
  const recovering = usePineRecoveryStore(state => Object.entries(state.progress).find(([owner, value]) => owner.startsWith(`saved:${rule.id}:`) && value.completed < value.total)?.[1]);
  const observations = Object.values(rule.pineCursors ?? {}).reduce((sum, sources) => sum + Object.values(sources).reduce((total, value) => total + (value?.sequence ?? 0), 0), 0);
  const key = useServerStore((s) => s.key);
  const [busy, setBusy] = useState(false);
  const control = async (action: "pause" | "resume" | "restart" | "restart_symbols") => {
    if (busy) return;
    setBusy(true);
    try {
      if (rule.serverSide) {
        if (!key) throw new Error("Connect the alert server before changing this alert.");
        const saved = await serverAlerts.control(key, rule.id, action);
        await editAlerts(store=>store.replaceServerRules([...store.rules.filter(existing=>existing.serverSide&&existing.id!==rule.id),saved.rule]));
      } else {
        await editAlerts(store=>{
        const current = store.rules.find(existing => existing.id === rule.id);
        if (!current) return;
        store.updateRule(rule.id, action === "restart" || action === "restart_symbols" ? restartRule(current, Date.now(), action === "restart_symbols") : { status: action === "pause" ? "paused" : "active", ...(action === "resume" ? { rate: resumeRate(current.rate) } : {}) });
        });
      }
    } catch (error) { useChartStore.getState().toast("Alert not updated", error instanceof Error ? error.message : String(error), "error"); }
    finally { setBusy(false); }
  };
  const setStatus = async (status: AlertRule["status"]) => {
    if (status === "active" && isExpired(rule)) return;
    await control(status === "paused" ? "pause" : rule.status === "stopped" || rule.status === "triggered" ? "restart" : "resume");
  };
  const del = async () => {
    await editAlerts(store=>store.removeRule(rule.id));
    if (rule.serverSide && key) await serverAlerts.remove(key, rule.id).catch(() => undefined);
  };
  const scope =
    rule.scope.type === "symbol" ? rule.scope.symbol : `${rule.scope.symbols.length} symbols`;
  return (
    <div className="alert-card">
      <div className="alert-card-title">
        <Bell size={14} className={rule.status === "active" ? "text-accent" : "muted"} />
        <strong>{rule.name}</strong>
        <span className={`alert-status ${rule.status}`}>{rule.status}</span>
      </div>
      <p>
        {scope} <span>· {rule.scope.timeframe} · {KIND_LABEL[rule.kind]}</span>
        {rule.serverSide ? <span className="server-badge">SERVER</span> : null}
        {rule.webhook ? <span className="server-badge">WEBHOOK</span> : null}
      </p>
      <div className="alert-threshold rule-summary-line">{describeCondition(rule.condition)}</div>
      {recovering ? <p role="status">Restoring strategy… {recovering.completed}/{recovering.total} observations</p> : observations ? <p className="muted">Recovery journal · {observations.toLocaleString()} observations</p> : null}
      <p className="alert-expiration">{rule.expiresAt === undefined ? "Open ended" : `Expires ${new Date(rule.expiresAt).toISOString().replace("T", " ").slice(0, 19)} UTC`}{rule.scope.type === "watchlist" && rule.triggeredSymbols?.length ? ` · ${rule.triggeredSymbols.length}/${rule.scope.symbols.length} completed` : ""}</p>
      <RateNotice alert={rule} disabled={busy || isExpired(rule)} onRestartMembers={() => void control("restart_symbols")} />
      {expirationLabel(rule)?<p className="alert-stop-reason">{expirationLabel(rule)}</p>:null}
      <div className="alert-card-footer">
        <span>
          <Clock3 size={11} />
          {pineSnapshot(rule.condition) && pineSnapshot(rule.condition)!.selection.type !== "condition" ? "Script frequency" : timingLabel(rule)}
          {rule.sound ? <Volume2 size={11} /> : null}
        </span>
        <div>
          <IconButton
            disabled={busy || isExpired(rule)}
            label={rule.status === "active" ? "Pause alert" : rule.status === "stopped" ? "Restart alert" : "Activate alert"}
            onClick={() => void setStatus(rule.status === "active" ? "paused" : "active")}
          >
            {rule.status === "active" ? <Pause size={13} /> : <Play size={13} />}
          </IconButton>
          <IconButton
            label={`Edit ${rule.name}`}
            onClick={() => useChartStore.getState().set({ alertDraft: { id: rule.id, price: 0 } })}
          >
            <Pencil size={13} />
          </IconButton>
          <IconButton label={`Delete ${rule.name}`} onClick={() => void del()}>
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
type AlertMode = "price" | RuleKind;
export function AlertDialog() {
  const draft = useChartStore((s) => s.alertDraft);
  const close = useCallback(
    () => useChartStore.getState().set({ alertDraft: null }),
    [],
  );
  const rule = useAlertStore((s) =>
    draft?.id ? s.rules.find((r) => r.id === draft.id) : undefined,
  );
  if (!draft) return null;
  if (rule)
    return (
      <Modal title="Edit alert" onClose={close} className="rule-modal">
        {rule.kind === "pine" ? <PineAlertForm key={rule.id} existing={rule} onClose={close} /> : rule.kind==="drawing"?<DrawingAlertForm key={rule.id} existing={rule} onClose={close}/>:<RuleForm key={rule.id} kind={rule.kind} existing={rule} onClose={close} />}
      </Modal>
    );
  return (
    <AlertCreator
      key={draft.id ?? draft.drawingId ?? String(draft.price)}
      onClose={close}
      draft={draft}
    />
  );
}
function AlertCreator({
  onClose,
  draft,
}: {
  onClose: () => void;
  draft: import("@/types/trading").AlertDraft;
}) {
  const [mode, setMode] = useState<AlertMode>(draft.drawingId?"drawing":draft.ruleCondition?"technical":"price");
  const tabs = (
    <div className="segmented alert-kind" role="tablist" aria-label="Alert type">
      {(
        [
          ["price", "Price"],
          ["technical", "Indicator"],
          ["watchlist", "Watchlist"],
          ["composite", "Combined"],
          ["pine", "Pine Script"],
          ["drawing","Drawing"],
        ] as [AlertMode, string][]
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={mode === id}
          className={mode === id ? "active" : ""}
          onClick={() => setMode(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
  if (mode === "price" || draft.id)
    return <AlertForm onClose={onClose} draft={draft} tabs={draft.id ? null : tabs} />;
  return (
    <Modal title="Create alert" onClose={onClose} className="rule-modal">
      <div className="form-body">{tabs}</div>
      {mode === "pine" ? <PineAlertForm onClose={onClose} /> : mode==="drawing"?<DrawingAlertForm drawingId={draft.drawingId} onClose={onClose}/>:<RuleForm key={mode} kind={mode} draft={mode === "technical" ? draft : undefined} onClose={onClose} />}
    </Modal>
  );
}
function AlertForm({
  onClose,
  draft,
  tabs,
}: {
  onClose: () => void;
  draft: import("@/types/trading").AlertDraft;
  tabs?: React.ReactNode;
}) {
  const current = useChartStore.getState();
  const existing = useAlertStore
    .getState()
    .alerts.find((a) => a.id === draft.id);
  const symbol=existing?.symbol??draft.symbol??current.symbol,initialPrice=existing?.price??draft.price??0;
  const [form, setForm] = useState<Omit<PriceAlert, "id" | "createdAt">>({
    name: existing?.name ?? draft.name ?? `${getSymbol(symbol).base} price alert`,
    symbol,
    condition: existing?.condition ?? "crossing",
    price: initialPrice,
    upperPrice: existing?.upperPrice??draft.upperPrice??(initialPrice>0?initialPrice*1.01:undefined),
    status: existing?.status === "expired" || existing?.status === "triggered" || existing?.status === "stopped" ? "active" : existing?.status ?? "active",
    repeat: existing?.repeat ?? false,
    trigger: existing?.trigger,
    expiresAt: existing?.expiresAt,
    frequency: existing?.frequency ?? "tick",
    timeframe: existing?.timeframe ?? draft.timeframe??current.timeframe,
    sound: existing?.sound ?? true,
    browserNotification: existing?.browserNotification ?? false,
    simulated: existing?.simulated??draft.tpoReference?.simulated??current.quotes[symbol]?.simulated??(current.feedMode==="simulation"),
  });
  const [trigger, setTrigger] = useState<AlertTrigger | "legacy">(existing ? existing.trigger ?? "legacy" : "once");
  const [error, setError] = useState("");
  const band =
    form.condition === "entering_band" || form.condition === "exiting_band";
  const reference = existing?.tpoReference ?? draft.tpoReference;
  const retainedReference = retainedTpoReference(reference, form);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(form.price) || form.price <= 0) {
      setError("Enter a positive trigger price.");
      return;
    }
    if (band && (!form.upperPrice || form.upperPrice <= form.price)) {
      setError("The upper band must be above the lower band.");
      return;
    }
    const timingError = validateTiming(form);
    if (timingError || isExpired(form)) { setError(timingError ?? "Choose an expiration in the future or an open-ended alert."); return; }
    unlockAudio();
    const notification = form.browserNotification
      ? await requestNotifications()
      : false;
    const values = {
      ...form,
      tpoReference: retainedReference,
      ...(trigger === "legacy" ? { trigger: undefined } : timingFields(trigger)),
      upperPrice: band ? form.upperPrice : undefined,
      browserNotification: notification,
      lastTriggeredAt: undefined,
      lastTriggeredBar: undefined,
      rate: freshRate(Date.now(), existing?.rate),
      stop: undefined,
    };
    try{await editAlerts(store=>{if(existing)store.edit(existing.id,values);else store.add({...values,id:crypto.randomUUID(),createdAt:Date.now()});});}
    catch(error){setError(error instanceof Error?error.message:String(error));return;}
    current.toast(
      existing ? "Alert updated" : "Alert created",
      `${symbolLabel(form.symbol)} · ${conditions[form.condition]} ${formatPrice(form.price)} ${describeSymbol(form.symbol).quote}`,
      "success",
    );
    if (form.browserNotification && !notification)
      current.toast(
        "Browser notifications unavailable",
        "In-app notifications remain enabled.",
      );
    onClose();
  };
  return (
    <Modal
      title={existing ? "Edit price alert" : "Create price alert"}
      onClose={onClose}
      className="small-modal"
    >
      <form onSubmit={submit}>
        <div className="form-body">
          {tabs}
          <div className="alert-symbol-badge">
            <Bell size={17} />
            <strong>{symbolLabel(form.symbol)}</strong>
            <span>{describeSymbol(form.symbol).caption}</span>
          </div>
          {!existing && <p className="muted" role="status">{!draft.price
            ? "No observed quote is available. Enter a trigger price."
            : draft.source === "simulation"
              ? "Starting value from the last observed simulation quote."
              : draft.source === "market"
                ? "Starting value from the last observed market quote."
                : draft.source === "tpo" ? "Starting value from a completed TPO reference."
                : "Starting value from your selected chart price."}</p>}
          {reference && <p className="form-help" role="status">{retainedReference
            ? `${tpoReferenceLabel(reference)}. This threshold does not follow new profiles.`
            : "Price or condition changed. This will be saved as a regular price alert."}</p>}
          <label>
            Alert name
            <input
              required
              maxLength={70}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Condition
            <select
              value={form.condition}
              onChange={(e) =>
                setForm({
                  ...form,
                  condition: e.target.value as AlertCondition,
                })
              }
            >
              {Object.entries(conditions).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label>
              {band ? "Lower price" : "Trigger price"}
              <div className="input-suffix">
                <input
                  aria-label={band ? "Lower price" : "Trigger price"}
                  type="number"
                  min="0.000000001"
                  step="any"
                  required
                  value={form.price>0?form.price:""}
                  onChange={(e) =>
                    {setForm({ ...form, price: Number(e.target.value) });setError("");}
                  }
                />
                <span>{describeSymbol(form.symbol).quote}</span>
              </div>
            </label>
            {band ? (
              <label>
                Upper price
                <input
                  aria-label="Upper price"
                  type="number"
                  step="any"
                  min={form.price}
                  required
                  value={form.upperPrice??""}
                  onChange={(e) =>
                    setForm({ ...form, upperPrice: Number(e.target.value) })
                  }
                />
              </label>
            ) : null}
          </div>
          <AlertTimingFields trigger={trigger} expiresAt={form.expiresAt} onTrigger={setTrigger} onExpiry={expiresAt => setForm({ ...form, expiresAt })} price={!band} />
          {trigger === "legacy" ? <label>
            Evaluate
            <select
              value={form.frequency}
              onChange={(e) =>
                setForm({
                  ...form,
                  frequency: e.target.value as "tick" | "close",
                })
              }
            >
              <option value="tick">On every price tick</option>
              <option value="close">On candle close</option>
            </select>
          </label> : null}
          {(trigger === "legacy" ? form.frequency === "close" : trigger === "once_per_close" || trigger === "once_per_bar") ? (
            <label>
              Candle timeframe
              <select
                value={form.timeframe}
                onChange={(e) =>
                  setForm({
                    ...form,
                    timeframe: e.target.value as PriceAlert["timeframe"],
                  })
                }
              >
                {TIMEFRAMES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="checkbox-group">
            {trigger === "legacy" ? <label>
              <input
                type="checkbox"
                checked={form.repeat}
                onChange={(e) => setForm({ ...form, repeat: e.target.checked })}
              />
              Repeat after each crossing
            </label> : null}
            <label>
              <input
                type="checkbox"
                checked={form.sound}
                onChange={(e) => setForm({ ...form, sound: e.target.checked })}
              />
              Play notification sound
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.browserNotification}
                onChange={(e) =>
                  setForm({ ...form, browserNotification: e.target.checked })
                }
              />
              Browser notification
            </label>
          </div>
          <p className="form-help">
            Alerts start observing the next quote and run while this tab is
            open. Live and simulated price sequences are evaluated separately.
          </p>
          {error ? <p className="error-message">{error}</p> : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            <Bell size={14} />
            {existing ? "Save changes" : "Create alert"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
