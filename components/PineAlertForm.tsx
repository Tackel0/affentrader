"use client";
import { useState, type FormEvent } from "react";
import type { AlertRule, AlertTrigger } from "@/types/alerts";
import type { PineAlertInspection, PineAlertSnapshot } from "@/types/pineAlerts";
import { useChartStore } from "@/stores/useChartStore";
import { useAlertStore } from "@/stores/useAlertStore";
import { editAlerts } from "@/lib/alerts/browserOwnership";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { useServerStore } from "@/stores/useServerStore";
import { pineAlertInspector as pineAlertClient } from "@/lib/alerts/pineClient";
import { pineSnapshot, pineFillTemplate } from "@/lib/alerts/pineRules";
import { browserPineSeries } from "@/hooks/usePineAlerts";
import { validateRuleShape } from "@/lib/alerts/rules";
import { normalizeRuleMarkets } from "@/lib/alerts/dependencies";
import { freshRate } from "@/lib/alerts/rateLimit";
import { defaultExpiry, isExpired, timingFields } from "@/lib/alerts/schedule";
import { QUICK_INTERVALS, isTickInterval } from "@/lib/market/intervals";
import { serverAlerts } from "@/lib/alerts/serverClient";
import { requestNotifications, unlockAudio } from "@/lib/alerts/notifications";
import { AlertTimingFields } from "./AlertTimingFields";
import { ServerKeyField } from "./RuleForm";
import { findIndicator } from "@/lib/indicators/catalog";
import { resolveZone } from "@/lib/timezones";

export const PINE_ALERT_EXAMPLE = `//@version=6
indicator("EMA signal alerts", overlay=true)
length = input.int(20, "EMA length", minval=1, maxval=500)
average = ta.ema(close, length)
plot(average, "EMA", color=color.teal)
alertcondition(ta.crossover(close, average), "Cross above EMA", "{{ticker}} crossed above EMA at {{close}}")
if ta.crossunder(close, average)
    alert("Cross below EMA at " + str.tostring(close), alert.freq_once_per_bar_close)`;

export function PineAlertForm({ existing, onClose }: { existing?: AlertRule; onClose: () => void }) {
  const chart = useChartStore.getState(), saved = existing ? pineSnapshot(existing.condition) : undefined;
  const lists = useWatchlistStore(state => state.lists), key = useServerStore(state => state.key);
  const [name, setName] = useState(existing?.name ?? "Pine script alert");
  const [symbol, setSymbol] = useState(existing?.scope.type === "symbol" ? existing.scope.symbol : chart.symbol);
  const [timeframe, setTimeframe] = useState(existing?.scope.timeframe ?? (isTickInterval(chart.timeframe) ? "1m" : chart.timeframe));
  const [watch, setWatch] = useState(existing?.scope.type === "watchlist");
  const [listId, setListId] = useState(existing?.scope.type === "watchlist" ? existing.scope.listId : useWatchlistStore.getState().activeId);
  const [source, setSource] = useState(saved?.source ?? chart.pineDraft?.source ?? PINE_ALERT_EXAMPLE);
  const [inputs, setInputs] = useState<PineAlertSnapshot["inputs"]>(saved?.inputs ?? {});
  const [selection, setSelection] = useState(saved?.selection.type === "condition" ? saved.selection.id : saved?.selection.type ?? "calls");
  const [inspection, setInspection] = useState<PineAlertInspection | null>(null);
  const [history, setHistory] = useState(saved?.history ?? 500);
  const [trigger, setTrigger] = useState<AlertTrigger>(existing?.trigger ?? "once_per_close");
  const [expiresAt, setExpiresAt] = useState(existing?.expiresAt);
  const [sound, setSound] = useState(existing?.sound ?? true), [notify, setNotify] = useState(existing?.browserNotification ?? false);
  const [serverSide, setServerSide] = useState(existing?.serverSide ?? false);
  const [message, setMessage] = useState(existing?.message ?? ""), [cooldown, setCooldown] = useState((existing?.cooldownMs ?? 0) / 60000);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const libraries = saved?.libraries ?? chart.pineLibraries;
  const savedCondition = saved?.selection.type === "condition" ? saved.selection.id : undefined;
  const scriptTiming = ["calls", "orders", "both"].includes(selection), fills = selection === "orders" || selection === "both";
  const snapshot = (): PineAlertSnapshot => ({ source, inputs: { ...inputs }, title: inspection?.title ?? saved?.title ?? "Pine script", libraries: { ...libraries }, selection: selection === "calls" || selection === "orders" || selection === "both" ? { type: selection } : { type: "condition", id: selection }, history, chartType: saved?.chartType ?? chart.chartType, timezone: saved?.timezone ?? resolveZone(chart.timezone, symbol) });
  const inspect = async () => {
    setBusy(true); setError(""); const id = `inspect:${crypto.randomUUID()}`;
    try {
      const target = watch ? lists.find(list => list.id === listId)?.symbols.find(symbol => !symbol.startsWith("###")) : symbol;
      if (!target) throw new Error("Choose a symbol or nonempty watchlist.");
      const definition = snapshot(), series = await browserPineSeries(target, timeframe, history);
      const result = await pineAlertClient.run(id, id, definition, { series, now: Date.now() }, browserPineSeries);
      setInspection(result.inspection);
      if (!saved) {
        if (result.inspection.declaration === "strategy") { setSelection(result.inspection.hasCalls ? "both" : "orders"); if (!message) setMessage(pineFillTemplate(source)); }
        else if (!result.inspection.hasCalls && result.inspection.conditions.length) setSelection(result.inspection.conditions[0].id);
        setInputs(previous => Object.fromEntries(result.inspection.inputs.map(input => [input.id, previous[input.id] ?? (input.varId ? previous[input.varId] : undefined) ?? previous[input.title] ?? input.defval])));
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { pineAlertClient.drop(id); setBusy(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!saved && !inspection) throw new Error("Load the script inputs and alert conditions first.");
      if (!saved && inspection?.declaration !== "strategy" && !inspection?.hasCalls && !inspection?.conditions.length) throw new Error("This indicator contains no alert() calls or alertcondition() declarations.");
      const definition = saved ?? snapshot();
      const rule: AlertRule = normalizeRuleMarkets({ id: existing?.id ?? crypto.randomUUID(), name: name.trim(), kind: "pine", status: existing?.status === "paused" ? "paused" : "active", scope: watch ? { type: "watchlist", listId, symbols: lists.find(list => list.id === listId)?.symbols ?? [], timeframe } : { type: "symbol", symbol, timeframe }, condition: { op: "leaf", leaf: { type: "pine", snapshot: definition } }, ...timingFields(definition.selection.type === "condition" ? trigger : "every_time"), expiresAt, cooldownMs: cooldown * 60000, sound, browserNotification: notify, serverSide, message: message.trim() || undefined, createdAt: existing?.createdAt ?? Date.now(), rate: freshRate(Date.now(), existing?.rate), lastFired: {}, scriptState: {}, triggeredSymbols: [], webhook: existing?.webhook });
      rule.pineEpoch = crypto.randomUUID(); rule.pineMemberEpochs = {}; rule.pineCursors = {};
      const problem = validateRuleShape(rule); if (problem) throw new Error(problem);
      if (isExpired(rule)) throw new Error("Choose a future expiration.");
      if (rule.scope.type === "watchlist" && !rule.scope.symbols.length) throw new Error("Choose a nonempty watchlist.");
      if (serverSide && !key) throw new Error("Connect the alert server first.");
      unlockAudio(); if (notify && !await requestNotifications()) rule.browserNotification = false;
      if (serverSide) { const result = await serverAlerts.save(key, rule); await editAlerts(store=>{if(existing&&!existing.serverSide)store.removeRule(rule.id);store.replaceServerRules([...useAlertStore.getState().rules.filter(value=>value.serverSide&&value.id!==rule.id),result.rule]);}); }
      else { if (existing?.serverSide) await serverAlerts.remove(key, existing.id); await editAlerts(store=>{if(existing)store.editRule(rule.id,rule);else store.addRule(rule);}); }
      chart.toast("Pine alert saved", `${rule.name} · ${definition.title}`, "success"); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <form onSubmit={submit}><div className="form-body rule-form">
    <label>Alert name<input aria-label="Pine alert name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
    <div className="form-grid">
      <label>Scope<select aria-label="Pine alert scope" disabled={Boolean(saved)} value={watch ? "watchlist" : "symbol"} onChange={event => { const value = event.target.value === "watchlist"; setWatch(value); if (value && expiresAt === undefined) setExpiresAt(defaultExpiry()); }}><option value="symbol">This symbol</option><option value="watchlist">Watchlist</option></select></label>
      {watch ? <label>Watchlist<select aria-label="Pine watchlist" disabled={Boolean(saved)} value={listId} onChange={event => setListId(event.target.value)}>{lists.map(list => <option value={list.id} key={list.id}>{list.name}</option>)}</select></label> : <label>Symbol<input aria-label="Pine alert symbol" disabled={Boolean(saved)} value={symbol} onChange={event => setSymbol(event.target.value)} /></label>}
      <label>Interval<select aria-label="Pine alert interval" disabled={Boolean(saved)} value={timeframe} onChange={event => setTimeframe(event.target.value)}>{[...new Set([...QUICK_INTERVALS.filter(value => !isTickInterval(value)), timeframe])].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>History<input aria-label="Pine history bars" disabled={Boolean(saved)} type="number" min={50} max={20000} step={1} value={history} onChange={event => { setHistory(Number(event.target.value)); setInspection(null); }} /></label>
    </div>
    {!saved ? <label>Script source<select aria-label="Pine script choice" defaultValue="editor" onChange={event => {
      const instance = chart.indicators.find(value => value.id === event.target.value);
      setSource(event.target.value === "example" ? PINE_ALERT_EXAMPLE : instance ? instance.script ?? findIndicator(instance.definitionId)?.script ?? PINE_ALERT_EXAMPLE : chart.pineDraft?.source ?? PINE_ALERT_EXAMPLE);
      setInputs(instance ? { ...instance.inputs } : {}); setSelection("calls"); setInspection(null);
    }}><option value="editor">Editor draft</option><option value="example">EMA alert example</option>{chart.indicators.filter(value => value.script || findIndicator(value.definitionId)?.kind === "pine").map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label> : null}
    <label>Saved Pine script<textarea aria-label="Pine alert source" rows={8} className="pine-alert-source" readOnly={Boolean(saved)} value={source} onChange={event => { setSource(event.target.value); setInputs({}); setSelection("calls"); setInspection(null); }} /></label>
    <button type="button" className="button" disabled={busy} onClick={() => void inspect()}>{busy ? "Reading script…" : "Load inputs and alert conditions"}</button>
    <p className="form-help">{saved ? "The saved script, inputs and chart context are fixed. Create a new alert to use a different snapshot." : "A separate copy of this script, its inputs and imported libraries will run independently of later chart edits."}</p>
    {saved && !inspection ? <p className="form-help">Saved inputs: {Object.entries(saved.inputs).map(([key, value]) => `${key}=${value}`).join(", ") || "Script defaults"}</p> : null}
    {inspection?.inputs.map(input => <label key={input.id}>{input.title}{input.type === "bool" ? <input type="checkbox" disabled={Boolean(saved)} checked={Boolean(inputs[input.id] ?? inputs[input.title] ?? input.defval)} onChange={event => setInputs({ ...inputs, [input.id]: event.target.checked })} /> : input.options?.length ? <select disabled={Boolean(saved)} value={String(inputs[input.id] ?? input.defval)} onChange={event => setInputs({ ...inputs, [input.id]: typeof input.defval === "number" ? Number(event.target.value) : event.target.value })}>{input.options.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select> : <input disabled={Boolean(saved)} type={typeof input.defval === "number" ? "number" : "text"} min={input.min} max={input.max} step={input.type === "int" ? 1 : "any"} value={String(inputs[input.id] ?? inputs[input.title] ?? input.defval)} onChange={event => setInputs({ ...inputs, [input.id]: typeof input.defval === "number" ? Number(event.target.value) : event.target.value })} />}</label>)}
    <label>Condition<select aria-label="Pine alert condition" disabled={Boolean(saved) || !inspection} value={selection} onChange={event => setSelection(event.target.value)}>
      {inspection?.hasCalls || saved?.selection.type === "calls" || !inspection ? <option value="calls">Any alert() function call</option> : null}
      {inspection?.declaration === "strategy" || saved?.selection.type === "orders" || saved?.selection.type === "both" ? <><option value="orders">Order fills only</option><option value="both">Order fills and alert() function calls</option></> : null}
      {inspection?.conditions.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}
      {savedCondition && !inspection?.conditions.some(value => value.id === savedCondition) ? <option value={savedCondition}>{savedCondition}</option> : null}
    </select></label>
    {scriptTiming ? <p className="form-help">The script controls alert() frequency.{fills ? " Each broker-emulator order execution can trigger separately, including multiple fills in one bar." : ""}</p> : null}
    <AlertTimingFields trigger={trigger} expiresAt={expiresAt} watchlist={watch} hideTrigger={scriptTiming} onTrigger={value => { if (value !== "legacy") setTrigger(value); }} onExpiry={setExpiresAt} />
    <label>Cool-down (minutes)<input type="number" min={0} max={10080} step="any" value={cooldown} onChange={event => setCooldown(Number(event.target.value))} /></label>
    {selection === "calls" ? <p className="form-help">The message comes from each alert() call in the saved script.</p> : <label>{fills ? "Order fill message" : "Message override (optional)"}<input aria-label="Pine alert message" maxLength={500} value={message} onChange={event => setMessage(event.target.value)} /></label>}
    {fills ? <p className="form-help">Use strategy.order.* and strategy.market_position placeholders. Include {"{{strategy.order.alert_message}}"} to insert the order's custom message. In combined mode, alert() calls keep their own messages. Fills are labeled EMULATED FILL in the log.</p> : null}
    <p className="form-help">Reloading restores this script's observed state from its local recovery journal. Missing or incompatible journal data stops the alert visibly. {saved ? "Saving changes starts a fresh run; pause and resume retain the current run." : "Keep this browser's site data to retain browser-run recovery."}</p>
    <label className="checkbox-row"><input type="checkbox" checked={sound} onChange={event => setSound(event.target.checked)} />Play notification sound</label>
    <label className="checkbox-row"><input type="checkbox" checked={notify} onChange={event => setNotify(event.target.checked)} />Browser notification</label>
    <label className="checkbox-row"><input type="checkbox" checked={serverSide} onChange={event => setServerSide(event.target.checked)} />Run on the server</label>
    {serverSide ? <ServerKeyField /> : null}
    {watch ? <p className="form-help">Browser candle subscriptions currently cover the first 40 watchlist members.</p> : null}
    {error ? <p role="alert" className="error-message">{error}</p> : null}
  </div><div className="modal-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Create Pine alert"}</button></div></form>;
}
