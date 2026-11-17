import type { AlertRule } from "@/types/alerts";
import type { DrawingAlertGeometry } from "@/types/drawingAlerts";
import { drawingCondition,drawingFingerprint,drawingSourceRevision,drawingSync } from "./drawing";
export interface DrawingEditIntent { id:string; symbol:string; expected:string; geometry?:DrawingAlertGeometry }
export function checkDrawingEdit(rule:AlertRule|undefined,intent:DrawingEditIntent):"apply"|"same"|"conflict" {
  const condition=rule&&drawingCondition(rule);
  if(!rule||!condition||rule.scope.type!=="symbol"||rule.scope.symbol!==intent.symbol)return "conflict";
  if(intent.geometry&&(intent.geometry.id!==condition.geometry.id||intent.geometry.type!==condition.geometry.type||intent.geometry.chartCellId!==condition.geometry.chartCellId))return "conflict";
  if(drawingSourceRevision(rule)===drawingFingerprint(intent.geometry))return "same";
  return drawingSourceRevision(rule)===intent.expected?"apply":"conflict";
}
export function applyDrawingEdit(rule:AlertRule,intent:DrawingEditIntent,now=Date.now()):Partial<AlertRule>|undefined {
  const state=checkDrawingEdit(rule,intent);if(state==="same")return;
  if(state==="conflict")throw new Error("The linked alert has a newer drawing. Reopen the alert and save explicitly to bind this chart's drawing.");
  return drawingSync(rule,intent.geometry,now);
}
