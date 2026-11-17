"use client";
import {createPortal} from "react-dom";
import {useChartStore} from "@/stores/useChartStore";
import {Modal} from "./ui";
export function ChartSnapshotDialog(){
  const snapshot=useChartStore(s=>s.snapshot);if(!snapshot||typeof document==="undefined")return null;
  const close=()=>useChartStore.getState().set({snapshot:null});
  const recapture=(snapshotScope:"chart"|"layout")=>useChartStore.getState().set({command:{kind:"snapshot",id:Date.now(),snapshotScope}});
  return createPortal(<Modal title="Chart snapshot" className="chart-snapshot-modal" onClose={close}>
    <div className="form-body"><div className="snapshot-scope" aria-label="Snapshot scope"><button type="button" className="button small" aria-pressed={snapshot.scope!=="layout"} onClick={()=>recapture("chart")}>Active chart</button><button type="button" className="button small" aria-pressed={snapshot.scope==="layout"} onClick={()=>recapture("layout")}>Visible layout</button></div><p>{snapshot.title} · {snapshot.source} · {snapshot.width} × {snapshot.height} px</p><img src={snapshot.image} alt={`Chart snapshot: ${snapshot.title}, ${snapshot.source}`} className="chart-snapshot-image"/><p className="form-help">Captured {snapshot.capturedAt.replace("T"," ").replace("Z"," UTC")}. This image is frozen; subsequent chart or order changes do not update it.</p></div>
    <div className="modal-actions"><button type="button" className="button" onClick={close}>Close</button><a className="button primary" href={snapshot.image} download={snapshot.filename}>Download PNG</a></div>
  </Modal>,document.getElementById("native-chart-dialog-host")??document.body);
}
