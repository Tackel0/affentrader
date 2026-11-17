"use client";
import {useEffect,useState,useMemo,type FormEvent} from "react";
import {CalendarDays} from "lucide-react";
import {useChartStore} from "@/stores/useChartStore";
import {RANGE_SHORTCUTS,rangeTimeframe,dateWindow} from "@/lib/chart/ranges";
import {parseInterval} from "@/lib/market/intervals";
import {resolveZone,wallDateTime,wallTimeCandidates,offsetLabel} from "@/lib/timezones";
import type {RangeShortcut} from "@/types/trading";
import {Modal,IconButton} from "./ui";
import {TimezoneMenu} from "./TimezoneMenu";

export function RangeToolbar(){
  const symbol=useChartStore(s=>s.symbol),timeframe=useChartStore(s=>s.timeframe),chartType=useChartStore(s=>s.chartType);
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<{range:RangeShortcut;symbol:string}|null>(null);
  useEffect(()=>useChartStore.subscribe((state,before)=>{if(state.command!==before.command&&state.command&&["goto","recent","fit"].includes(state.command.kind))setSelected(null);}),[]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{
    if(!event.altKey||event.key.toLowerCase()!=="g"||(event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')||document.querySelector('[role="dialog"]'))return;
    event.preventDefault();setOpen(true);
  };window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[]);
  return <div className="range-toolbar" role="toolbar" aria-label="Chart date range">
    <div className="range-shortcuts" role="group" aria-label="Date range presets">
      {RANGE_SHORTCUTS.map(range=><button key={range} type="button" title={`${range==="ALL"?"All available data":range} · ${rangeTimeframe(range,chartType)} interval`} aria-pressed={selected?.range===range&&selected.symbol===symbol&&rangeTimeframe(range,chartType)===timeframe}
        className={selected?.range===range&&selected.symbol===symbol&&rangeTimeframe(range,chartType)===timeframe?"active":""}
        onClick={()=>{setSelected({range,symbol});useChartStore.getState().set({command:{id:Date.now(),kind:"range",value:range}});}}>{range=== "ALL"?"All":range}</button>)}
    </div>
    <span className="range-separator" />
    <IconButton label="Go to date (Alt+G)" onClick={()=>setOpen(true)}><CalendarDays size={19}/></IconButton>
    <span className="flex-1"/>
    <TimezoneMenu/>
    {open?<DateRangeDialog onClose={()=>setOpen(false)} onSubmit={(time,to)=>{setSelected(null);useChartStore.getState().set({command:{id:Date.now(),kind:"goto",time,to}});setOpen(false);}}/>:null}
  </div>;
}

function DateRangeDialog({onClose,onSubmit}:{onClose:()=>void;onSubmit:(time:number,to?:number)=>void}){
  const timeframe=useChartStore(s=>s.timeframe),unit=parseInterval(timeframe)?.unit;
  const intraday=unit!=="D"&&unit!=="W"&&unit!=="M";
  const [context]=useState(()=>{const state=useChartStore.getState();return {symbol:state.symbol,timeframe:state.timeframe,choice:state.timezone,zone:resolveZone(state.timezone,state.symbol)};});
  const zone=context.zone,now=wallDateTime(Date.now(),zone),[tab,setTab]=useState<"date"|"range">("date"),[date,setDate]=useState(now.slice(0,10)),[time,setTime]=useState("00:00"),[endDate,setEndDate]=useState(now.slice(0,10)),[endTime,setEndTime]=useState(now.slice(11,16)),[error,setError]=useState("");
  const [startOccurrence,setStartOccurrence]=useState(0),[endOccurrence,setEndOccurrence]=useState(0);
  const startCandidates=useMemo(()=>wallTimeCandidates(`${date}T${intraday?time:"00:00"}`,zone),[date,time,intraday,zone]),endCandidates=useMemo(()=>wallTimeCandidates(`${endDate}T${intraday?endTime:"00:00"}`,zone),[endDate,endTime,intraday,zone]);
  const changeStartDate=(value:string)=>{setDate(value);setStartOccurrence(0);setError("");},changeStartTime=(value:string)=>{setTime(value);setStartOccurrence(0);setError("");},changeEndDate=(value:string)=>{setEndDate(value);setEndOccurrence(0);setError("");},changeEndTime=(value:string)=>{setEndTime(value);setEndOccurrence(0);setError("");};
  const submit=(event:FormEvent)=>{event.preventDefault();setError("");try{
    const state=useChartStore.getState();if(state.symbol!==context.symbol||state.timeframe!==context.timeframe||state.timezone!==context.choice||resolveZone(state.timezone,state.symbol)!==zone)throw new Error("The chart or time zone changed. Reopen this dialog to review the date.");
    const from=startCandidates[startOccurrence],to=tab==="range"?endCandidates[endOccurrence]:undefined;
    if(from===undefined||tab==="range"&&to===undefined)throw new Error(`This local time does not exist in ${zone}, or the date is incomplete. Choose another time.`);dateWindow(from,to,timeframe);onSubmit(from,to);
  }catch(error){setError(error instanceof Error?error.message:String(error));}};
  return <Modal title="Go to" onClose={onClose} className="goto-date-modal">
    <div className="panel-tabs" role="tablist" aria-label="Date navigation type">
      <button type="button" role="tab" aria-selected={tab==="date"} className={tab==="date"?"active":""} onClick={()=>{setTab("date");setError("");}}>Date</button>
      <button type="button" role="tab" aria-selected={tab==="range"} className={tab==="range"?"active":""} onClick={()=>{setTab("range");setError("");}}>Custom range</button>
    </div>
    <form onSubmit={submit}>
      <div className="form-body">
        <div className="goto-date-fields"><label>{tab==="range"?"Start date":"Date"}<input aria-label="Go to date" type="date" required max={now.slice(0,10)} value={date} onInput={event=>changeStartDate(event.currentTarget.value)} onChange={event=>changeStartDate(event.target.value)}/></label>
          <label>Time<input aria-label="Go to time" type="time" required disabled={!intraday} value={time} onInput={event=>changeStartTime(event.currentTarget.value)} onChange={event=>changeStartTime(event.target.value)}/></label></div>
        {startCandidates.length>1?<OccurrenceChoice label="Start time occurrence" values={startCandidates} value={startOccurrence} zone={zone} onChange={value=>{setStartOccurrence(value);setError("");}}/>:null}
        {tab==="range"?<><div className="goto-date-fields"><label>End date<input aria-label="Range end date" type="date" required max={now.slice(0,10)} value={endDate} onInput={event=>changeEndDate(event.currentTarget.value)} onChange={event=>changeEndDate(event.target.value)}/></label>
          <label>End time<input aria-label="Range end time" type="time" required disabled={!intraday} value={endTime} onInput={event=>changeEndTime(event.currentTarget.value)} onChange={event=>changeEndTime(event.target.value)}/></label></div>
          {endCandidates.length>1?<OccurrenceChoice label="End time occurrence" values={endCandidates} value={endOccurrence} zone={zone} onChange={value=>{setEndOccurrence(value);setError("");}}/>:null}</>:null}
        <p className="form-help" data-testid="navigation-time-zone">Dates and times are in {zone}, the chart time zone. Available history depends on the market and interval.</p>
        {error?<p role="alert" className="form-error">{error}</p>:null}
      </div>
      <div className="modal-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="submit" className="button primary">Go to</button></div>
    </form>
  </Modal>;
}

function OccurrenceChoice({label,values,value,zone,onChange}:{label:string;values:number[];value:number;zone:string;onChange:(value:number)=>void}){
  return <label>{label}<select aria-label={label} value={value} onChange={event=>onChange(Number(event.target.value))}>{values.map((time,index)=><option key={time} value={index}>{index===0?"First":"Second"} occurrence · {offsetLabel(zone,new Date(time))} · {new Date(time).toISOString().slice(11,16)} UTC</option>)}</select><small className="form-help">This clock time occurs twice. Choose the intended UTC offset.</small></label>;
}
