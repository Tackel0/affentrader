import type { DrawingAlertGeometry } from "@/types/drawingAlerts";
import type { WorkspaceCell } from "@/types/workspace";

/** A drawing can appear on several charts; its saved alert follows its owning chart's axis. */
export function linkedDrawingAxis(geometry:DrawingAlertGeometry,symbol:string,chart:{symbol:string;logarithmic:boolean},workspace:{activeId:string;cells:readonly WorkspaceCell[]}):boolean{
  if(!geometry.chartCellId)return geometry.logarithmic;
  if(geometry.chartCellId===workspace.activeId&&chart.symbol===symbol)return chart.logarithmic;
  const owner=workspace.cells.find(cell=>cell.id===geometry.chartCellId&&cell.symbol===symbol);
  return owner?Boolean(owner.logarithmic):geometry.logarithmic;
}
