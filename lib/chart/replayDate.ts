import { wallDateTime, wallTimeCandidates } from "@/lib/timezones";

export interface ReplayDateDraft { value: string; occurrence: number }
export function replayDateDraft(cursor: number | null, zone: string): ReplayDateDraft {
  if (cursor === null || !Number.isFinite(cursor)) return { value: "", occurrence: 0 };
  const value = wallDateTime(cursor, zone, "second");
  const candidates = wallTimeCandidates(value, zone);
  return { value, occurrence: Math.max(0, candidates.indexOf(Math.floor(cursor / 1000) * 1000)) };
}

/** Validate absolute instants: local min/max strings cannot order the repeated DST hour. */
export function replaySeekTime(draft: ReplayDateDraft, zone: string, bounds: { first: number | null; last: number | null }): number {
  const candidates = wallTimeCandidates(draft.value, zone);
  if (!candidates.length) throw new Error(`This time does not exist in ${zone}, or the date is incomplete. Choose another time.`);
  const time = Number.isInteger(draft.occurrence) ? candidates[draft.occurrence] : undefined;
  if (time === undefined) throw new Error("Choose the intended time occurrence.");
  if (bounds.first === null || bounds.last === null || !Number.isFinite(bounds.first) || !Number.isFinite(bounds.last) || bounds.last < bounds.first)
    throw new Error("Wait for Replay history to finish loading.");
  if (time < bounds.first || time > bounds.last) throw new Error("Choose a time within the loaded Replay history.");
  return time;
}
