"use client";
import { useMemo, useState, type FormEvent } from "react";
import { Play, Pause, SkipForward, ChevronsLeft, X } from "lucide-react";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useChartStore } from "@/stores/useChartStore";
import { offsetLabel, resolveZone, wallTimeCandidates } from "@/lib/timezones";
import { replayDateDraft, replaySeekTime, type ReplayDateDraft } from "@/lib/chart/replayDate";
import { IconButton } from "./ui";
import { useTradeArchiveStore } from "@/stores/useTradeArchiveStore";

export function ReplayBar() {
  const replay = useWorkspaceStore(s => s.replay);
  const symbol = useChartStore(s => s.symbol), timeframe = useChartStore(s => s.timeframe);
  const choice = useChartStore(s => s.timezone), epoch = useChartStore(s => s.feedEpoch);
  const zone = resolveZone(choice, symbol);
  if (!replay.active) return null;
  const command = useWorkspaceStore.getState().commandReplay;
  return <div className="replay-bar" aria-label="Bar replay controls">
    <span className="replay-label"><ChevronsLeft size={17} />Bar Replay</span>
    <IconButton label={replay.playing ? "Pause replay" : "Play replay"} onClick={() => command(replay.playing ? "pause" : "play", { intervalMs: replay.intervalMs })}>
      {replay.playing ? <Pause size={18} /> : <Play size={18} />}
    </IconButton>
    <IconButton label="Next replay bar" onClick={() => command("step")}><SkipForward size={18} /></IconButton>
    <select aria-label="Replay speed" value={replay.intervalMs} onChange={event => {
      const intervalMs = Number(event.target.value);
      useWorkspaceStore.getState().setReplay({ intervalMs });
      if (replay.playing) command("play", { intervalMs });
    }}>
      {[[2000, "0.5×"], [1000, "1×"], [500, "2×"], [200, "5×"], [100, "10×"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <ReplayDateControl key={JSON.stringify([symbol, timeframe, choice, zone, epoch])} symbol={symbol} timeframe={timeframe} choice={choice} zone={zone} epoch={epoch} />
    <span className="replay-remaining">{replay.remaining.toLocaleString()} bars remaining</span>
    <button className="button small" title="Load recorded executions for Footprint, SVP and CVD. Only completed Replay candles are included; coverage may have gaps." onClick={() => useTradeArchiveStore.setState({ open: true })}>Recorded orderflow</button>
    <span className="flex-1" />
    <IconButton label="Exit replay" onClick={() => command("stop")}><X size={17} /></IconButton>
  </div>;
}

function ReplayDateControl({ symbol, timeframe, choice, zone, epoch }: { symbol: string; timeframe: string; choice: string; zone: string; epoch: number }) {
  const replay = useWorkspaceStore(s => s.replay);
  const [draft, setDraft] = useState<ReplayDateDraft | null>(null), [error, setError] = useState("");
  const cursorDraft = useMemo(() => replayDateDraft(replay.cursorTime, zone), [replay.cursorTime, zone]);
  const displayed = draft ?? cursorDraft;
  const candidates = useMemo(() => wallTimeCandidates(displayed.value, zone), [displayed.value, zone]);
  const selectedTime = candidates[displayed.occurrence];
  const edit = (value: ReplayDateDraft) => {
    if (useWorkspaceStore.getState().replay.playing) useWorkspaceStore.getState().commandReplay("pause");
    setDraft(value); setError("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError("");
    try {
      const state = useChartStore.getState(), current = useWorkspaceStore.getState();
      if (!current.replay.active || state.symbol !== symbol || state.timeframe !== timeframe || state.timezone !== choice || state.feedEpoch !== epoch || resolveZone(state.timezone, state.symbol) !== zone)
        throw new Error("The chart or time zone changed. Review the Replay date again.");
      const from = replaySeekTime(displayed, zone, current.replay);
      current.commandReplay("seek", { from }); setDraft(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return <form className="replay-date-control" onSubmit={submit} noValidate>
    <input aria-label="Replay start date" aria-describedby="replay-date-zone" type="datetime-local" step="1" value={displayed.value}
      onInput={event => edit({ value: event.currentTarget.value, occurrence: 0 })}
      onChange={event => edit({ value: event.target.value, occurrence: 0 })} />
    <span id="replay-date-zone" className="replay-date-zone" title={`Dates and times are in ${zone}, the chart time zone.`}>
      {zone === "UTC" ? "UTC" : `${zone.split("/").at(-1)?.replace(/_/g, " ")} ${selectedTime === undefined ? "" : offsetLabel(zone, new Date(selectedTime))}`}
    </span>
    {candidates.length > 1 && <select aria-label="Replay time occurrence" value={displayed.occurrence} onChange={event => edit({ value: displayed.value, occurrence: Number(event.target.value) })}>
      {candidates.map((time, index) => <option key={time} value={index}>{index === 0 ? "First" : "Second"} · {offsetLabel(zone, new Date(time))} · {new Date(time).toISOString().slice(11, 19)} UTC</option>)}
    </select>}
    <button className="button small" type="submit">Go to</button>
    {draft && <button className="button small" type="button" onClick={() => { setDraft(null); setError(""); }}>Reset date</button>}
    {error && <span className="replay-date-error" role="alert">{error}</span>}
  </form>;
}
