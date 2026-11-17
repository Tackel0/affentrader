import {captureLayoutSnapshot,type SnapshotTile} from "./snapshot";
export interface SnapshotChart {renderer:{screenshotCanvas:()=>HTMLCanvasElement|null};read:()=>{title:string;timeframe:string;source:string;symbol?:string}}
const charts=new Map<HTMLElement,SnapshotChart>();
export function bindSnapshotChart(host:HTMLElement,chart:SnapshotChart){charts.set(host,chart);return()=>{if(charts.get(host)===chart)charts.delete(host);};}
/** Every visible cell must have its own mounted renderer; never silently drop a loading chart. */
export function captureVisibleLayout(grid:HTMLElement,options:{background:string;textColor:string;time?:number}){
  const cells=Array.from(grid.querySelectorAll<HTMLElement>("[data-cell-id]")).filter(cell=>{const rect=cell.getBoundingClientRect();return rect.width>0&&rect.height>0;});
  const tiles:SnapshotTile[]=cells.map(cell=>{
    const matches=[...charts].filter(([host])=>host.isConnected&&cell.contains(host));
    if(matches.length!==1||cell.querySelector(".chart-loading,.chart-error,.satellite-error"))throw new Error("Wait for every visible chart to finish loading, then retry the snapshot.");
    const [host,entry]=matches[0],metadata=entry.read(),canvas=entry.renderer.screenshotCanvas(),rect=host.getBoundingClientRect();
    if(!canvas)throw new Error("A visible chart is not ready for a snapshot.");
    return{id:cell.dataset.cellId??"",canvas,left:rect.left,top:rect.top,width:rect.width,height:rect.height,...metadata};
  });
  return captureLayoutSnapshot(tiles,options);
}
export function snapshotSource(lineage:"exchange"|"simulation"|undefined,replay:boolean,delayed:boolean){return replay?(lineage==="simulation"?"Replay - synthetic":lineage?"Replay":"Replay - source unavailable"):lineage==="simulation"?"Simulation":!lineage?"Source unavailable":delayed?"Delayed market feed":"Market feed";}
