import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { PineJournalDb } from "@/lib/alerts/pineJournalDb";
import type { PineJournal, PineJournalRecord } from "@/types/pineAlerts";
const databases:PineJournalDb[]=[];
beforeEach(()=>{vi.stubGlobal("indexedDB",new IDBFactory());vi.stubGlobal("IDBKeyRange",IDBKeyRange);});
afterEach(async()=>{for(const db of databases)await db.close();databases.length=0;vi.unstubAllGlobals();});
const database=()=>{const value=new PineJournalDb();databases.push(value);return value;};
const record=(sequence:number):PineJournalRecord=>({sequence,now:1000+sequence,primary:{first:1000,last:1000,bars:[{time:1000,open:1,high:1,low:1,close:1,volume:1}],info:{currency:"USD"}},secondary:[],digest:"a".repeat(64)});
const journal=():PineJournal=>{const entry=record(1);return {version:1,id:crypto.randomUUID(),epoch:"first",revision:"revision",definition:"definition",symbol:"BTCUSDT",timeframe:"1s",simulated:false,seed:1,bytes:JSON.stringify(entry).length,acknowledged:0,records:[entry]};};
const advance=(value:PineJournal)=>{const next=structuredClone(value),entry=record(next.records.length+1);next.records.push(entry);next.bytes+=JSON.stringify(entry).length;return next;};
describe("transactional browser Pine journals",()=>{
  it("commits observations and metadata together and restores them from another connection",async()=>{
    const first=database(),value=journal();await first.append("owner",value);const next=advance(value);await first.append("owner",next);
    expect(await database().load("owner")).toEqual(next);await first.acknowledge("owner",next.id,2);expect((await database().load("owner"))?.acknowledged).toBe(2);
  });
  it("rejects a stale concurrent writer without overwriting the winner",async()=>{
    const first=database(),second=database(),value=journal();await first.append("owner",value);const next=advance(value);
    const results=await Promise.allSettled([first.append("owner",next),second.append("owner",next)]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect(results.filter(result=>result.status==="rejected")).toHaveLength(1);
    expect(await first.load("owner")).toEqual(next);
  });
  it("replaces a journal atomically only for an explicit new run",async()=>{
    const db=database(),value=journal();await db.append("owner",value);await db.append("owner",advance(value));
    const replacement=journal();await expect(db.append("owner",replacement)).rejects.toThrow(/Another tab/);
    replacement.epoch="new-run";await db.append("owner",replacement);expect(await db.load("owner")).toEqual(replacement);
  });
  it("keeps unrelated journals when pruning deleted scopes and superseded run identities",async()=>{
    const db=database(),one=journal(),two=journal();await db.append("one",one);await db.append("two",two);
    await db.prune([{owner:"one",epoch:one.epoch},{owner:"two",epoch:"different"}]);
    expect(await db.load("one")).toEqual(one);expect(await db.load("two")).toBeUndefined();
  });
  it("refuses a storage-budget overflow before replacing existing data",async()=>{
    const db=database(),value=journal();await db.append("owner",value);const huge=journal();huge.bytes=256*1024*1024;
    await expect(db.append("large",huge)).rejects.toThrow(/256 MiB/);expect(await db.load("large")).toBeUndefined();expect(await db.load("owner")).toEqual(value);
  });
  it("does not let an old acknowledgement change a replacement journal",async()=>{
    const db=database(),old=journal();await db.append("owner",old);const next=journal();next.epoch="new-run";await db.append("owner",next);
    await db.acknowledge("owner",old.id,999);expect((await db.load("owner"))?.acknowledged).toBe(0);
  });
});
