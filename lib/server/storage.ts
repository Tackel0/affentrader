import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cloudDocumentKey, cloudStore, updateCloudDocument, usesNetlifyStorage } from "./netlifyStorage";

/** Directory holding every server-side file (alerts, keys, sync documents). */
export function dataDir(): string {
  return process.env.AFFENTRADER_DATA ?? path.join(process.cwd(), ".data");
}

const BACKUPS_KEPT = 14;

/**
 * A small durable JSON document: serialized writes, atomic replacement
 * (write temp file then rename), a `.bak` copy of the previous version that is
 * used to recover from a corrupt primary, and one dated snapshot per day.
 */
export class JsonStore<T> {
  private queue: Promise<unknown> = Promise.resolve();
  private cached: T | null = null;
  constructor(
    private readonly name: string,
    private readonly fallback: () => T,
    private readonly dir: () => string = dataDir,
  ) {}
  private get file() {
    return path.join(this.dir(), `${this.name}.json`);
  }
  private async load(): Promise<T> {
    for (const candidate of [this.file, `${this.file}.bak`]) {
      try {
        return JSON.parse(await fs.readFile(candidate, "utf8")) as T;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && candidate === this.file) {
          // Corrupt primary: fall through to the backup.
          continue;
        }
      }
    }
    return this.fallback();
  }
  async read(): Promise<T> {
    await this.queue;
    if (usesNetlifyStorage()) {
      const entry = await cloudStore().getWithMetadata(cloudDocumentKey(this.name, this.dir(), dataDir()), { type: "json" });
      return structuredClone(entry ? entry.data as T : this.fallback());
    }
    this.cached ??= await this.load();
    return structuredClone(this.cached);
  }
  /** Serialized read-modify-write. The updater may mutate or return a new value. */
  update(updater: (draft: T) => T | void): Promise<T> {
    const run = async () => {
      if (usesNetlifyStorage()) return updateCloudDocument(cloudDocumentKey(this.name, this.dir(), dataDir()), this.fallback, updater);
      this.cached ??= await this.load();
      const draft = structuredClone(this.cached);
      const next = updater(draft) ?? draft;
      await this.persist(next);
      this.cached = next;
      return structuredClone(next);
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async persist(value: T) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
      try {
        await fs.copyFile(this.file, `${this.file}.bak`);
      } catch {
        /* first write has nothing to back up */
      }
      await fs.rename(temp, this.file);
    } catch (error) {
      await fs.unlink(temp).catch(() => {});
      throw error;
    }
    await this.snapshot();
  }
  private async snapshot() {
    const day = new Date().toISOString().slice(0, 10);
    const folder = path.join(path.dirname(this.file), "backups");
    const target = path.join(folder, `${this.name}-${day}.json`);
    try {
      await fs.access(target);
      return;
    } catch {
      /* no snapshot yet today */
    }
    try {
      await fs.mkdir(folder, { recursive: true });
      await fs.copyFile(this.file, target);
      const mine = (await fs.readdir(folder))
        .filter((f) => f.startsWith(`${this.name}-`))
        .sort();
      for (const old of mine.slice(0, Math.max(0, mine.length - BACKUPS_KEPT)))
        await fs.rm(path.join(folder, old), { force: true });
    } catch {
      /* snapshots are best effort */
    }
  }
  /** Forget the in-memory copy (tests and external edits). */
  invalidate() {
    this.cached = null;
  }
}
