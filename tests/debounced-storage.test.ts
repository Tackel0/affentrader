import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncedStorage } from "@/lib/debouncedStorage";

function backing() {
  const data = new Map<string, string>();
  const calls = { set: 0 };
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      calls.set++;
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  } as unknown as Storage;
  return { storage, data, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("debounced storage", () => {
  it("does not overwrite a second main tab's drawing with unchanged hot market snapshots", () => {
    const { storage, data, calls } = backing();storage.setItem("chart", "original");
    const first=createDebouncedStorage(400,()=>storage),second=createDebouncedStorage(400,()=>storage);
    expect(first.getItem("chart")).toBe("original");expect(second.getItem("chart")).toBe("original");
    second.setItem("chart","new drawing + log axis");second.flush();const written=calls.set;
    for(let i=0;i<100;i++){first.setItem("chart","original");vi.advanceTimersByTime(500);}
    expect(data.get("chart")).toBe("new drawing + log axis");expect(calls.set).toBe(written);
    expect(first.getItem("chart")).toBe("new drawing + log axis");first.setItem("chart","an intentional edit");first.flush();expect(data.get("chart")).toBe("an intentional edit");
  });
  it("retries identical values after quota failure and permits writes after discard or removal",()=>{
    const {storage,data}=backing();let quota=true;const recovering={...storage,getItem:storage.getItem,removeItem:storage.removeItem,setItem:(key:string,value:string)=>{if(quota)throw new Error("quota");storage.setItem(key,value);}} as Storage;
    const s=createDebouncedStorage(10,()=>recovering);s.setItem("k","value");s.flush();quota=false;s.setItem("k","value");s.flush();expect(data.get("k")).toBe("value");
    s.discard();storage.setItem("k","external");s.setItem("k","value");s.flush();expect(data.get("k")).toBe("value");s.removeItem("k");s.setItem("k","value");s.flush();expect(data.get("k")).toBe("value");
  });
  it("writes a burst of updates once", () => {
    const { storage, data, calls } = backing();
    const s = createDebouncedStorage(400, () => storage);
    for (let i = 0; i < 500; i++) s.setItem("k", `v${i}`);
    expect(calls.set).toBe(0);
    vi.advanceTimersByTime(399);
    expect(calls.set).toBe(0);
    vi.advanceTimersByTime(2);
    expect(calls.set).toBe(1);
    expect(data.get("k")).toBe("v499");
  });
  it("reads its own pending writes before they are flushed", () => {
    const { storage } = backing();
    const s = createDebouncedStorage(400, () => storage);
    storage.setItem("k", "old");
    s.setItem("k", "new");
    expect(s.getItem("k")).toBe("new");
    expect(storage.getItem("k")).toBe("old");
    s.flush();
    expect(storage.getItem("k")).toBe("new");
  });
  it("discards queued writes so a restore is not overwritten", () => {
    const { storage, data } = backing();
    const s = createDebouncedStorage(400, () => storage);
    s.setItem("k", "stale");
    s.discard();
    storage.setItem("k", "restored");
    vi.advanceTimersByTime(2000);
    expect(data.get("k")).toBe("restored");
  });
  it("removes immediately and survives a failing backing store", () => {
    const { storage, data } = backing();
    const s = createDebouncedStorage(400, () => storage);
    storage.setItem("k", "x");
    s.setItem("k", "y");
    s.removeItem("k");
    vi.advanceTimersByTime(1000);
    expect(data.has("k")).toBe(false);
    const broken = createDebouncedStorage(10, () => ({ setItem: () => { throw new Error("quota"); }, getItem: () => null, removeItem: () => {} }) as unknown as Storage);
    broken.setItem("a", "b");
    expect(() => vi.advanceTimersByTime(50)).not.toThrow();
    expect(createDebouncedStorage(10, () => undefined).getItem("x")).toBeNull();
  });
});
