import { revision } from "@/.generated/pine-alert-code";
import type { PineAlertSnapshot, PineFrame, PineJournal, PineJournalRecord, PineSeries, PineSeriesDelta, PineSeriesLoader, PineDeliveryBatch, PineAlertResult } from "@/types/pineAlerts";
import { PineSession } from "./pineSession";

export const MAX_PINE_JOURNAL_BYTES = 64 * 1024 * 1024;
export const MAX_PINE_JOURNAL_RECORDS = 1_000_000;
export const MAX_PINE_PENDING_BATCHES = 128;
export class PineRecoveryError extends Error {}
export const pineSource = (simulated?: boolean) => simulated ? "simulation" as const : "exchange" as const;
export async function pineDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
}
export const pineDefinition = (snapshot: PineAlertSnapshot, symbol: string, timeframe: string) => pineDigest([snapshot, symbol, timeframe]);
const recordDigest = (record: Omit<PineJournalRecord, "digest">, result: PineAlertResult) => pineDigest([record.sequence, record.now, record.observation ?? null, record.closedBar ?? null, record.primary, record.secondary, result]);
const sameBar = (a: PineSeries["bars"][number], b: PineSeries["bars"][number]) => a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume;
export function deltaSeries(previous: PineSeries | undefined, current: PineSeries): PineSeriesDelta {
  if (!current.bars.length) throw new PineRecoveryError("Cannot journal an empty market observation.");
  const before = new Map(previous?.bars.map(bar => [bar.time, bar]));
  const times = new Set(current.bars.map(bar => bar.time)), remove = (previous?.bars ?? []).filter(bar => bar.time >= current.bars[0].time && bar.time <= current.bars.at(-1)!.time && !times.has(bar.time)).map(bar => bar.time);
  return { first: current.bars[0].time, last: current.bars.at(-1)!.time,
    bars: current.bars.filter(bar => !before.has(bar.time) || !sameBar(before.get(bar.time)!, bar)).map(bar => ({ ...bar })),
    ...(remove.length ? { remove } : {}), simulated: Boolean(current.simulated),
    ...(JSON.stringify(previous?.info) !== JSON.stringify(current.info) ? { info: structuredClone(current.info) } : {}) };
}
export function applySeriesDelta(previous: PineSeries | undefined, delta: PineSeriesDelta, symbol: string, timeframe: string, simulated: boolean): PineSeries {
  const bars = new Map((previous?.bars ?? []).filter(bar => bar.time >= delta.first && bar.time <= delta.last).map(bar => [bar.time, bar]));
  for (const time of delta.remove ?? []) bars.delete(time);
  for (const bar of delta.bars) bars.set(bar.time, { ...bar });
  const values = [...bars.values()].sort((a, b) => a.time - b.time);
  if (!values.length || values[0].time !== delta.first || values.at(-1)!.time !== delta.last) throw new PineRecoveryError("Pine observation journal has an incomplete candle window.");
  return { symbol, timeframe, simulated: delta.simulated ?? previous?.simulated ?? simulated, info: structuredClone(delta.info ?? previous?.info ?? {}), bars: values };
}
export const journalCursor = (journal: PineJournal) => ({ id: journal.id, sequence: journal.records.length, time: journal.records.at(-1)?.now ?? 0, epoch: journal.epoch });
export interface PineJournalOptions {
  epoch: string;
  journal?: PineJournal;
  expected?: { id: string; sequence: number };
  progress?: (completed: number, total: number) => void;
  cancelled?: () => boolean;
}
/** Rebuilds the complete interpreter by replaying the exact observations, clock and secondary replies. */
export class PineJournalSession {
  journal?: PineJournal;
  private session?: PineSession;
  private primary?: PineSeries;
  private secondary = new Map<string, PineSeries>();
  private ready = false;
  private disposed = false;
  private pending: PineDeliveryBatch[] = [];
  private snapshot: PineAlertSnapshot;
  constructor(snapshot: PineAlertSnapshot, private options: PineJournalOptions) { this.snapshot = structuredClone(snapshot); this.journal = options.journal ? structuredClone(options.journal) : undefined; }
  private checkCancelled() { if (this.disposed || this.options.cancelled?.()) throw new PineRecoveryError("Pine recovery was cancelled."); }
  private async prepare(frame: PineFrame) {
    if (this.ready) return;
    this.checkCancelled();
    const definition = await pineDefinition(this.snapshot, frame.series.symbol, frame.series.timeframe);
    let journal = this.journal;
    if (journal && journal.epoch !== this.options.epoch) journal = undefined;
    if (this.options.expected && (!journal || journal.id !== this.options.expected.id || journal.records.length < this.options.expected.sequence)) throw new PineRecoveryError("The saved Pine observation journal is missing or older than its firing state. Restart this alert explicitly.");
    if (journal && (journal.version !== 1 || journal.revision !== revision || journal.definition !== definition)) throw new PineRecoveryError("The saved Pine runtime or definition changed. Restart this alert explicitly; its old journal was retained.");
    if (journal && (journal.symbol !== frame.series.symbol || journal.timeframe !== frame.series.timeframe || journal.simulated !== Boolean(frame.series.simulated))) throw new PineRecoveryError("Pine journal market source does not match this subscription.");
    if (!journal) journal = { version: 1, id: crypto.randomUUID(), epoch: this.options.epoch, revision, definition, symbol: frame.series.symbol, timeframe: frame.series.timeframe, simulated: Boolean(frame.series.simulated), seed: crypto.getRandomValues(new Uint32Array(1))[0], bytes: 0, acknowledged: 0, records: [] };
    if (!Array.isArray(journal.records) || journal.records.length > MAX_PINE_JOURNAL_RECORDS || !Number.isSafeInteger(journal.bytes) || journal.bytes < 0 || journal.bytes > MAX_PINE_JOURNAL_BYTES || !Number.isInteger(journal.seed) || journal.seed < 0 || journal.seed > 0xffffffff || !Number.isInteger(journal.acknowledged) || journal.acknowledged < 0 || journal.acknowledged > journal.records.length) throw new PineRecoveryError("Invalid or oversized Pine recovery journal.");
    this.journal = journal; this.session = new PineSession(this.snapshot, journal.seed);
    let recoveredBytes = 0;
    for (const record of journal.records) {
      this.checkCancelled();
      if (record.sequence !== this.replayed + 1) throw new PineRecoveryError("Pine observation journal sequence is broken.");
      if (!Number.isSafeInteger(record.now) || record.now < 0 || !Array.isArray(record.secondary) || !/^[a-f\d]{64}$/.test(record.digest)) throw new PineRecoveryError("Pine recovery verification failed: invalid observation evidence.");
      recoveredBytes += new TextEncoder().encode(JSON.stringify(record)).byteLength;
      if (recoveredBytes > MAX_PINE_JOURNAL_BYTES) throw new PineRecoveryError("Pine recovery journal exceeds its storage budget.");
      this.primary = applySeriesDelta(this.primary, record.primary, journal.symbol, journal.timeframe, journal.simulated);
      let call = 0;
      const result = await this.session.observe({ series: this.primary, now: record.now, observation: record.observation, closedBar: record.closedBar }, async (symbol, timeframe, count) => {
        const reply = record.secondary[call++];
        if (!reply || reply.symbol !== symbol || reply.timeframe !== timeframe || reply.count !== count) throw new PineRecoveryError("Pine recovery requested a different secondary series.");
        const key = `${symbol}|${timeframe}|${count}`, value = applySeriesDelta(this.secondary.get(key), reply.delta, symbol, timeframe, journal.simulated);
        this.secondary.set(key, value); return structuredClone(value);
      });
      if (call !== record.secondary.length || await recordDigest(record, result) !== record.digest) throw new PineRecoveryError(`Pine recovery verification failed at observation ${record.sequence}. The journal was retained.`);
      this.replayed = record.sequence;
      if (record.sequence > (this.options.expected?.sequence ?? 0)) {
        if (this.pending.length >= MAX_PINE_PENDING_BATCHES) throw new PineRecoveryError("Pine recovery has more than 128 uncommitted observations. Restore the matching alert state or restart explicitly; the journal was retained.");
        this.pending.push({ cursor: { id: journal.id, epoch: journal.epoch, sequence: record.sequence, time: record.now }, series: this.primary, result });
      }
      if (record.sequence % 25 === 0 || record.sequence === journal.records.length) { this.options.progress?.(record.sequence, journal.records.length); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
    }
    if (recoveredBytes !== journal.bytes) throw new PineRecoveryError("Pine recovery journal byte count is inconsistent. The journal was retained.");
    this.ready = true;
  }
  private replayed = 0;
  async observe(input: PineFrame, loader?: PineSeriesLoader) {
    const frame = structuredClone(input);
    await this.prepare(frame); this.checkCancelled();
    const journal = this.journal!;
    if (Boolean(frame.series.simulated) !== journal.simulated) throw new PineRecoveryError("A Pine journal cannot mix exchange and simulated observations.");
    if (journal.records.length >= MAX_PINE_JOURNAL_RECORDS) throw new PineRecoveryError("Pine observation journal reached its record budget. It was retained; restart explicitly to begin a new run.");
    const secondary: PineJournalRecord["secondary"] = [];
    const result = await this.session!.observe(frame, async (symbol, timeframe, count) => {
      if (!loader) throw new PineRecoveryError("Secondary Pine data is unavailable.");
      const value = structuredClone(await loader(symbol, timeframe, count)), key = `${symbol}|${timeframe}|${count}`;
      secondary.push({ symbol, timeframe, count, delta: deltaSeries(this.secondary.get(key), value) }); this.secondary.set(key, value); return value;
    });
    this.checkCancelled();
    const evidence = { sequence: journal.records.length + 1, now: frame.now, observation: frame.observation, closedBar: frame.closedBar, primary: deltaSeries(this.primary, frame.series), secondary };
    const record: PineJournalRecord = { ...evidence, digest: await recordDigest(evidence, result) };
    const bytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
    if (journal.bytes + bytes > MAX_PINE_JOURNAL_BYTES) throw new PineRecoveryError("Pine observation journal reached its storage budget. It was retained; restart explicitly to begin a new run.");
    journal.records.push(record); journal.bytes += bytes; this.primary = frame.series;
    const cursor = journalCursor(journal), deliveries = [...this.pending, { cursor, series: frame.series, result }]; this.pending = [];
    return { ...result, deliveries, cursor, restored: this.replayed };
  }
  acknowledge(sequence: number) { if (this.journal) this.journal.acknowledged = Math.max(this.journal.acknowledged, Math.min(sequence, this.journal.records.length)); }
  dispose() { this.disposed = true; this.session?.dispose(); this.session = undefined; }
}
