"use client";
import {useState} from "react";
import {MoreHorizontal,Search,SlidersHorizontal,Camera,Maximize,PanelRight,Undo2,Redo2} from "lucide-react";
import {IconButton} from "./ui";
import {useDismiss,LayoutMenu,SavedLayoutsMenu,IndicatorTemplateMenu} from "./WorkspaceMenus";
import {PatternsButton} from "./ChartTools";
import {useChartStore} from "@/stores/useChartStore";
export function ChartToolbarOverflow({toggleSidebar}:{toggleSidebar:()=>void}){
  const [open,setOpen]=useState(false),ref=useDismiss(open,()=>setOpen(false));
  const command=(kind:"settings"|"snapshot"|"undo"|"redo")=>{setOpen(false);useChartStore.getState().set({command:{kind,id:Date.now()}});};
  return <div ref={ref} className="toolbar-mobile-overflow">
    <IconButton label="More chart controls" aria-expanded={open} aria-haspopup="true" onClick={()=>setOpen(!open)}><MoreHorizontal size={21}/></IconButton>
    {open?<div className="tv-popover mobile-chart-controls" aria-label="Additional chart controls">
      <button type="button" onClick={()=>{setOpen(false);useChartStore.getState().set({searchOpen:true,searchTarget:"chart"});}}><Search size={18}/><span>Symbol search</span></button>
      <button type="button" onClick={()=>command("settings")}><SlidersHorizontal size={18}/><span>Chart settings</span></button>
      <div className="mobile-controls-component"><IndicatorTemplateMenu/></div>
      <div className="mobile-controls-component"><PatternsButton/></div>
      <div className="mobile-controls-component"><LayoutMenu/></div>
      <div className="mobile-controls-component"><SavedLayoutsMenu/></div>
      <button type="button" onClick={()=>command("undo")}><Undo2 size={18}/><span>Undo drawing</span></button>
      <button type="button" onClick={()=>command("redo")}><Redo2 size={18}/><span>Redo drawing</span></button>
      <button type="button" onClick={()=>{setOpen(false);toggleSidebar();}}><PanelRight size={18}/><span>Toggle sidebar</span></button>
      <button type="button" onClick={()=>command("snapshot")}><Camera size={18}/><span>Take a snapshot</span></button>
      <button type="button" onClick={()=>{setOpen(false);void(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()).catch(()=>useChartStore.getState().toast("Full screen unavailable","Use your browser full screen shortcut."));}}><Maximize size={18}/><span>Full screen</span></button>
    </div>:null}
  </div>;
}
