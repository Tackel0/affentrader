"use client";
import { useMemo, useState, type FormEvent } from "react";
import { useChartStore } from "@/stores/useChartStore";
import { useAlertStore } from "@/stores/useAlertStore";
import { editAlerts } from "@/lib/alerts/browserOwnership";
import { useServerStore } from "@/stores/useServerStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { linkedDrawingAxis } from "@/lib/alerts/drawingProjection";
import { getPrimaryChart } from "@/hooks/useVelaChart";
import { DRAWING_LABELS,DRAWING_OPERATORS,defaultDrawingTarget,drawingArchive,drawingCondition,drawingFingerprint,drawingGeometry,drawingPrice,fibLevelPrice,isChannelDrawing,isFibDrawing,validateDrawingCondition } from "@/lib/alerts/drawing";
import { isTickInterval } from "@/lib/market/intervals";
import { validateRuleShape } from "@/lib/alerts/rules";
import { freshRate } from "@/lib/alerts/rateLimit";
import { isExpired,timingFields } from "@/lib/alerts/schedule";
import { unlockAudio,requestNotifications } from "@/lib/alerts/notifications";
import { serverAlerts } from "@/lib/alerts/serverClient";
import { AlertTimingFields } from "./AlertTimingFields";
import { ServerKeyField } from "./RuleForm";
import type { AlertRule,AlertTrigger } from "@/types/alerts";
import type { DrawingAlertCondition,DrawingAlertOperator,DrawingAlertTarget } from "@/types/drawingAlerts";

export function DrawingAlertForm({drawingId,existing,onClose}:{drawingId?:string;existing?:AlertRule;onClose:()=>void}){
  const chart=useChartStore.getState(),version=useChartStore(state=>state.drawingsVersion),symbol=existing?.scope.type==="symbol"?existing.scope.symbol:chart.symbol;
  const saved=existing&&drawingCondition(existing),key=useServerStore(state=>state.key);
  const choices=useMemo(()=>{
    const drawings=symbol===useChartStore.getState().symbol?getPrimaryChart()?.drawings.all():undefined;
    return (drawings??drawingArchive(useChartStore.getState().drawings[symbol])??[]).flatMap(d=>{const geometry=drawingGeometry(d,saved?linkedDrawingAxis(saved.geometry,symbol,chart,useWorkspaceStore.getState()):chart.logarithmic,saved?.geometry.chartCellId??useWorkspaceStore.getState().activeId);return geometry?[geometry]:[];});
  },[symbol,version]);
  const [selected,setSelected]=useState(saved?.geometry.id??drawingId??choices[0]?.id??"");
  const geometry=choices.find(g=>g.id===selected);
  const initial=saved??(geometry?{type:"drawing" as const,geometry,...defaultDrawingTarget(geometry)}:undefined);
  const [target,setTarget]=useState<DrawingAlertTarget>(initial?.target??{type:"level"}),[operator,setOperator]=useState<DrawingAlertOperator>(initial?.operator??"crossing");
  const [name,setName]=useState(existing?.name??`${geometry?DRAWING_LABELS[geometry.type]:"Drawing"} alert`),[trigger,setTrigger]=useState<AlertTrigger|"legacy">(existing?.trigger??"once"),[expiresAt,setExpiresAt]=useState(existing?.expiresAt),[cooldown,setCooldown]=useState((existing?.cooldownMs??0)/60000),[message,setMessage]=useState(existing?.message??""),[sound,setSound]=useState(existing?.sound??true),[notify,setNotify]=useState(existing?.browserNotification??false),[serverSide,setServerSide]=useState(existing?.serverSide??false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const fib=geometry&&isFibDrawing(geometry.type),channel=geometry&&isChannelDrawing(geometry.type),vwap=geometry?.type==="anchoredvwap",levels=geometry?.levels.filter(l=>l.enabled)??[],zone=target.type==="zone";
  const pickTarget=(value:string)=>{
    if(value==="zone"){const first=levels[0]?.ratio??0,second=levels[1]?.ratio??1;setTarget({type:"zone",...(fib?{ratios:[first,second] as [number,number]}:{})});setOperator("entering");}
    else {setTarget(value==="all_levels"?{type:"all_levels"}:{type:"level",...(fib?{ratio:Number(value)}:vwap?{series:value as "mid"|"upper"|"lower"}:{})});setOperator("crossing");}
  };
  const submit=async(event:FormEvent)=>{
    event.preventDefault();setBusy(true);setError("");
    try{
      if(!geometry)throw new Error("Restore or select a supported price-pane drawing first.");
      if(isTickInterval(existing?.scope.timeframe??chart.timeframe))throw new Error("Drawing alerts currently require a time-based interval.");
      const condition:DrawingAlertCondition={type:"drawing",geometry,target,operator},problem=validateDrawingCondition(condition);if(problem)throw new Error(problem);
      const rule:AlertRule={id:existing?.id??crypto.randomUUID(),name:name.trim(),kind:"drawing",status:existing?.status==="paused"?"paused":"active",scope:{type:"symbol",symbol,timeframe:existing?.scope.timeframe??chart.timeframe},condition:{op:"leaf",leaf:condition},...timingFields(trigger==="legacy"?"once":trigger),expiresAt,cooldownMs:cooldown*60000,message:message.trim()||undefined,sound,browserNotification:notify,serverSide,createdAt:existing?.createdAt??Date.now(),rate:freshRate(Date.now(),existing?.rate),webhook:existing?.webhook};
      const invalid=validateRuleShape(rule);if(invalid)throw new Error(invalid);if(isExpired(rule))throw new Error("Choose a future expiration.");if(serverSide&&!key)throw new Error("Connect the alert server first.");
      rule.drawingRevision=drawingFingerprint(geometry);
      unlockAudio();if(notify&&!await requestNotifications())rule.browserNotification=false;
      if(serverSide){const saved=await serverAlerts.save(key,rule);await editAlerts(store=>{if(existing&&!existing.serverSide)store.removeRule(rule.id);store.replaceServerRules([...useAlertStore.getState().rules.filter(r=>r.serverSide&&r.id!==rule.id),saved.rule]);});}
      else {if(existing?.serverSide)await serverAlerts.remove(key,existing.id);await editAlerts(store=>{if(existing)store.editRule(rule.id,{...rule,drawingIssue:undefined,stop:undefined,lastFired:{},lastTriggeredAt:undefined});else store.addRule(rule);});}
      chart.toast("Drawing alert saved",`${rule.name} · ${symbol}`,"success");onClose();
    }catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
  };
  return <form onSubmit={submit}><div className="form-body rule-form">
    <label>Alert name<input aria-label="Drawing alert name" required maxLength={100} value={name} onChange={event=>setName(event.target.value)}/></label>
    <div className="form-grid"><label>Symbol<input aria-label="Drawing alert symbol" readOnly value={symbol}/></label><label>Interval<input aria-label="Drawing alert interval" readOnly value={existing?.scope.timeframe??chart.timeframe}/></label></div>
    <label>Drawing<select aria-label="Alert drawing" value={selected} onChange={event=>{setSelected(event.target.value);const next=choices.find(g=>g.id===event.target.value);if(next){const defaults=defaultDrawingTarget(next);setTarget(defaults.target);setOperator(defaults.operator);}}}>
      {!geometry&&selected?<option value={selected}>Missing drawing · {selected}</option>:null}
      {!choices.length&&!selected?<option value="">No supported price drawing</option>:null}
      {choices.map(g=><option value={g.id} key={g.id}>{DRAWING_LABELS[g.type]} · {g.id}</option>)}
    </select></label>
    {fib||vwap?<label>Target<select aria-label="Drawing alert target" value={zone?"zone":target.type==="all_levels"?"all_levels":fib?String(target.type==="level"?target.ratio:""):target.type==="level"?target.series??"mid":"mid"} onChange={event=>pickTarget(event.target.value)}>
      {fib?<><option value="all_levels">Any enabled level</option>{levels.map(level=><option key={level.ratio} value={level.ratio}>{level.ratio} · {drawingPrice(fibLevelPrice(geometry!,level.ratio))}{level.label?` · ${level.label}`:""}</option>)}</>:<><option value="mid">VWAP</option><option value="upper">Upper band</option><option value="lower">Lower band</option></>}
      <option value="zone" disabled={Boolean(fib&&levels.length<2)}>{fib?"Between two levels":"VWAP band channel"}</option>
    </select></label>:null}
    {zone&&fib?<div className="form-grid">{[0,1].map(index=><label key={index}>{index===0?"First level":"Second level"}<select aria-label={index===0?"First Fibonacci level":"Second Fibonacci level"} value={target.ratios?.[index]} onChange={event=>{const ratios=[...target.ratios!] as [number,number];ratios[index]=Number(event.target.value);setTarget({type:"zone",ratios});}}>{levels.map(level=><option key={level.ratio} value={level.ratio}>{level.ratio}{level.label?` · ${level.label}`:""}</option>)}</select></label>)}</div>:null}
    <label>Condition<select aria-label="Drawing alert condition" value={operator} onChange={event=>setOperator(event.target.value as DrawingAlertOperator)}>{Object.entries(DRAWING_OPERATORS).filter(([value])=>(channel||zone)===["entering","exiting","inside","outside"].includes(value)).map(([value,label])=><option value={value} key={value}>{label}{zone?` ${geometry?.type==="box"?"rectangle":"channel"}`:""}</option>)}</select></label>
    <AlertTimingFields trigger={trigger} expiresAt={expiresAt} onTrigger={setTrigger} onExpiry={setExpiresAt}/>
    <label>Cool-down (minutes)<input type="number" min={0} max={10080} step="any" value={cooldown} onChange={event=>setCooldown(Number(event.target.value))}/></label>
    <label>Message override (optional)<input aria-label="Drawing alert message" maxLength={500} value={message} onChange={event=>setMessage(event.target.value)}/></label>
    <p className="form-help">This alert follows changes to the linked drawing. Removing it or disabling a selected Fib level stops the alert. Restore the drawing, then restart the alert to continue.</p>
    {fib?<p className="form-help">Fibonacci levels use {geometry?.logLevels&&geometry.logarithmic?"logarithmic":"linear"} price ratios. Change the construction in Drawing settings on a logarithmic chart. Level alerts monitor those prices beyond the drawing's displayed width.</p>:null}
    {geometry&&!fib&&!["hline","hray","crossline","box"].includes(geometry.type)?<p className="form-help">The complete anchor history is required. Line and channel projection follows the drawing's extension settings and captured {geometry.logarithmic?"logarithmic":"linear"} chart scale.</p>:null}
    {saved?<p className="form-help">Saving changes starts a new alert run. Moving the drawing retains its trigger counts and timing gates.</p>:null}
    <label className="checkbox-row"><input type="checkbox" checked={sound} onChange={event=>setSound(event.target.checked)}/>Play notification sound</label>
    <label className="checkbox-row"><input type="checkbox" checked={notify} onChange={event=>setNotify(event.target.checked)}/>Browser notification</label>
    <label className="checkbox-row"><input type="checkbox" checked={serverSide} onChange={event=>setServerSide(event.target.checked)}/>Run on the server</label>
    {serverSide?<ServerKeyField/>:null}{!geometry?<p role="alert" className="error-message">Draw a line, Fibonacci tool, channel, rectangle or Anchored VWAP on this symbol, or restore the missing drawing.</p>:null}
    {error?<p role="alert" className="error-message">{error}</p>:null}
  </div><div className="modal-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy||!geometry}>{busy?"Saving…":existing?"Save changes":"Create drawing alert"}</button></div></form>;
}
