"use client";
import {useState} from "react";
import {MoreHorizontal,Search,Plus,Bell,BellPlus,ChevronsLeft,SlidersHorizontal,Camera,Maximize,PanelRight,Undo2,Redo2,CalendarDays,Wallet,ListTree,Star,LayoutGrid,Terminal,Menu} from "lucide-react";
import {IconButton} from "./ui";
import {useDismiss,LayoutMenu,SavedLayoutsMenu,IndicatorTemplateMenu} from "./WorkspaceMenus";
import {ChartTypeMenu,PatternsButton} from "./ChartTools";
import {ChartCoverageMenuItem} from "./ChartCoverage";
import {currentPriceAlertDraft} from "@/lib/alerts/priceDraft";
import {useChartStore} from "@/stores/useChartStore";
import {useWorkspaceStore} from "@/stores/useWorkspaceStore";
export function ChartToolbarOverflow({toggleSidebar, phone}:{
  toggleSidebar:()=>void;
  phone?: {
    showRanges: () => void;
    tradingOpen: boolean;
    toggleTrading: () => void;
    openObjects?: () => void;
    openAlerts: () => void;
    openModules: () => void;
    openTerminal: () => void;
    openMainMenu: () => void;
    alertCount: number;
  };
}){
  const [open,setOpen]=useState(false),ref=useDismiss(open,()=>setOpen(false));
  const replay = useWorkspaceStore((s) => s.replay.active);
  const tradingButtons = useChartStore(s => s.chartTrading.showButtons);
  const favoriteCount = useChartStore(s => s.drawingPreferences.favorites.length);
  const command=(kind:"settings"|"snapshot"|"undo"|"redo")=>{setOpen(false);useChartStore.getState().set({command:{kind,id:Date.now()}});};
  return <div ref={ref} className="toolbar-mobile-overflow">
    <IconButton label="More chart controls" aria-expanded={open} aria-haspopup="true" onClick={()=>setOpen(!open)}><MoreHorizontal size={21}/></IconButton>
    {open?<div className="tv-popover mobile-chart-controls" aria-label="Additional chart controls">
      {phone ? <>
        <div className="phone-hub-grid" role="group" aria-label="Schnellzugriff">
          <button type="button" className="phone-hub-tile" aria-label="Alarm erstellen" onClick={()=>{setOpen(false);useChartStore.getState().set({alertDraft:currentPriceAlertDraft()});}}>
            <BellPlus size={18}/>
            <span>Neuer Alarm</span>
          </button>
          <button type="button" className="phone-hub-tile" aria-label="Alerts" onClick={()=>{setOpen(false);phone.openAlerts();}}>
            <Bell size={18}/>
            <span>Alerts</span>
            {phone.alertCount ? <em className="phone-hub-badge">{phone.alertCount}</em> : null}
          </button>
          <button type="button" className="phone-hub-tile" aria-label="Schwebende Objektleiste" onClick={()=>{setOpen(false);useChartStore.getState().set({drawingFavoritesOpen:true});}}>
            <Star size={18}/>
            <span>{favoriteCount ? `Objekte (${favoriteCount})` : "Objekte"}</span>
          </button>
          <button type="button" className="phone-hub-tile" aria-label="More workspace panels" onClick={()=>{setOpen(false);phone.openModules();}}>
            <LayoutGrid size={18}/>
            <span>Module</span>
          </button>
          <button type="button" className="phone-hub-tile" aria-label="Terminal" onClick={()=>{setOpen(false);phone.openTerminal();}}>
            <Terminal size={18}/>
            <span>Terminal</span>
          </button>
          <button type="button" className="phone-hub-tile" aria-label="Main menu" onClick={()=>{setOpen(false);phone.openMainMenu();}}>
            <Menu size={18}/>
            <span>Menü</span>
          </button>
        </div>
        <div className="phone-hub-sep" />
        <div className="mobile-controls-component"><ChartTypeMenu showLabel onSelect={() => setOpen(false)} /></div>
        <button type="button" onClick={()=>{setOpen(false);phone.showRanges();}}><CalendarDays size={18}/><span>Zeitraum und Zeitzone</span></button>
        {tradingButtons && <button type="button" aria-pressed={phone.tradingOpen} onClick={()=>{setOpen(false);phone.toggleTrading();}}>
          <Wallet size={18}/><span>{phone.tradingOpen ? "Chart-Handel ausblenden" : "Chart-Handel einblenden"}</span>
        </button>}
        {phone.openObjects ? <button type="button" onClick={()=>{setOpen(false);phone.openObjects?.();}}><ListTree size={18}/><span>Objektbaum</span></button> : null}
      </> : <button type="button" onClick={()=>{setOpen(false);useChartStore.getState().set({searchOpen:true,searchTarget:"chart"});}}><Search size={18}/><span>Symbol search</span></button>}
      <ChartCoverageMenuItem onSelect={() => setOpen(false)} />
      <button type="button" onClick={()=>{setOpen(false);useChartStore.getState().set({compareOpen:true});}}><Plus size={18}/><span>Compare symbol</span></button>
      {!phone ? <button type="button" onClick={()=>{setOpen(false);useChartStore.getState().set({alertDraft:currentPriceAlertDraft()});}}><Bell size={18}/><span>Create alert</span></button> : null}
      <button type="button" aria-pressed={replay} onClick={()=>{setOpen(false);useWorkspaceStore.getState().commandReplay(replay?"stop":"start");}}><ChevronsLeft size={18}/><span>{replay?"Stop replay":"Bar Replay"}</span></button>
      <button type="button" onClick={()=>command("settings")}><SlidersHorizontal size={18}/><span>Chart settings</span></button>
      <div className="mobile-controls-component"><IndicatorTemplateMenu/></div>
      <div className="mobile-controls-component"><PatternsButton/></div>
      <div className="mobile-controls-component"><LayoutMenu/></div>
      <div className="mobile-controls-component"><SavedLayoutsMenu/></div>
      <button type="button" onClick={()=>command("undo")}><Undo2 size={18}/><span>Undo drawing</span></button>
      <button type="button" onClick={()=>command("redo")}><Redo2 size={18}/><span>Redo drawing</span></button>
      {!phone ? <button type="button" onClick={()=>{setOpen(false);toggleSidebar();}}><PanelRight size={18}/><span>Toggle sidebar</span></button> : null}
      <button type="button" onClick={()=>command("snapshot")}><Camera size={18}/><span>Take a snapshot</span></button>
      <button type="button" onClick={()=>{setOpen(false);void(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()).catch(()=>useChartStore.getState().toast("Full screen unavailable","Use your browser full screen shortcut."));}}><Maximize size={18}/><span>Full screen</span></button>
    </div>:null}
  </div>;
}
