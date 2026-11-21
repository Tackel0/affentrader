import {afterEach,describe,expect,it,vi} from "vitest";
import {defaultDomPreferences,validDomPreferences,readDomPreferences,setDomGrouping,domGrouping} from "@/lib/orderflow/domPreferences";
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
function storage(){const disk=new Map<string,string>();vi.stubGlobal("navigator",{locks:{request:async(_name:string,_options:unknown,action:()=>Promise<unknown>)=>action()}});vi.stubGlobal("localStorage",{getItem:(k:string)=>disk.get(k)??null,setItem:(k:string,v:string)=>disk.set(k,v),removeItem:(k:string)=>disk.delete(k)});return disk;}
describe("persisted DOM view preferences",()=>{
  it("validates only complete view settings and rejects order/runtime data and malformed column layouts",()=>{
    expect(validDomPreferences(defaultDomPreferences())).toBe(true);
    for(const patch of [{unlocked:true},{order:{side:"buy"}},{follow:"chase"},{delay:0},{executionUnit:"usd"},{view:"unknown"},{groups:{"KRK:BTC/USD":2}}])expect(validDomPreferences({...defaultDomPreferences(),...patch})).toBe(false);
    const duplicate=defaultDomPreferences();duplicate.columns.order[0]="pnl";expect(validDomPreferences(duplicate)).toBe(false);
    const hidden=defaultDomPreferences();hidden.columns.visible.bid=false;expect(validDomPreferences(hidden)).toBe(false);
    expect(readDomPreferences({unlocked:true})).toEqual(defaultDomPreferences());
    const legacy=defaultDomPreferences();delete legacy.view;legacy.columns.visible.volume=true;
    expect(readDomPreferences(legacy)).toMatchObject({view:"book",columns:legacy.columns});
  });
  it("keeps market groups distinct, bounds them at 128 and removes default entries without mutating old state",()=>{
    const initial=defaultDomPreferences();let prefs=setDomGrouping(initial,"KRK:BTC/USD",5);prefs=setDomGrouping(prefs,"BTCUSDT",10);
    expect(domGrouping(prefs,"KRK:BTC/USD")).toBe(5);expect(domGrouping(prefs,"BTCUSDT")).toBe(10);expect(domGrouping(prefs,"HL:BTC")).toBe(1);expect(initial.groups).toEqual({});
    prefs=setDomGrouping(prefs,"BTCUSDT",1);expect(Object.hasOwn(prefs.groups,"BTCUSDT")).toBe(false);
    for(let i=0;i<130;i++)prefs=setDomGrouping(prefs,`TEST${i}`,5);
    expect(Object.keys(prefs.groups)).toHaveLength(128);expect(validDomPreferences(prefs)).toBe(true);
    expect(()=>setDomGrouping(prefs,"../bad",5)).toThrow();
  });
  it("round-trips through the real workspace store and storage without execution state",async()=>{
    const disk=storage();vi.resetModules();
    const {useWorkspaceStore}=await import("@/stores/useWorkspaceStore"),{hotStorage}=await import("@/lib/debouncedStorage");
    const columns=defaultDomPreferences().columns;columns.visible.volume=true;columns.order.reverse();
    useWorkspaceStore.getState().setDomPreferences({columns,follow:"timed",delay:30000,executionUnit:"quote",view:"configured"});useWorkspaceStore.getState().setDomGroup("KRK:BTC/USD",10);hotStorage.flush();
    const saved=JSON.parse(disk.get("affentrader-premium-v1")!).state.domPreferences;expect(saved.follow).toBe("timed");expect(saved.groups["KRK:BTC/USD"]).toBe(10);expect(saved.unlocked).toBeUndefined();
    vi.resetModules();const reloaded=(await import("@/stores/useWorkspaceStore")).useWorkspaceStore.getState();expect(reloaded.domPreferences).toEqual(saved);
    (await import("@/lib/debouncedStorage")).hotStorage.discard();
  });
  it("falls back to defaults for damaged/old persisted DOM data while retaining other workspace state",async()=>{
    const disk=storage();disk.set("affentrader-premium-v1",JSON.stringify({state:{sidebarWidth:420,domPreferences:{unlocked:true}},version:0}));vi.resetModules();
    const {useWorkspaceStore}=await import("@/stores/useWorkspaceStore");expect(useWorkspaceStore.getState().sidebarWidth).toBe(420);expect(useWorkspaceStore.getState().domPreferences).toEqual(defaultDomPreferences());
  });
  it("includes validated preferences in real workspace export/import and accepts older backups",async()=>{
    storage();vi.resetModules();const {useWorkspaceStore}=await import("@/stores/useWorkspaceStore");
    useWorkspaceStore.getState().setDomPreferences({follow:"fixed",executionUnit:"quote"});
    const {createWorkspaceBackup}=await import("@/lib/workspaceBackup"),{parseWorkspace}=await import("@/lib/workspace");
    const data=createWorkspaceBackup();expect(parseWorkspace(JSON.stringify(data)).premium?.state.domPreferences).toEqual(useWorkspaceStore.getState().domPreferences);
    (data.premium!.state.domPreferences as Record<string,unknown>).unlocked=true;expect(()=>parseWorkspace(JSON.stringify(data))).toThrow(/DOM workspace/);
    delete data.premium!.state.domPreferences;expect(()=>parseWorkspace(JSON.stringify(data))).not.toThrow();
    (await import("@/lib/debouncedStorage")).hotStorage.discard();
  });
  it("restores the Book row limit and combined markets from a workspace backup", async () => {
    storage();
    const reload = vi.fn();
    vi.resetModules();
    const { useWorkspaceStore } = await import("@/stores/useWorkspaceStore");
    const { createWorkspaceBackup, restoreWorkspaceText } = await import("@/lib/workspaceBackup");
    vi.stubGlobal("window", { location: { reload } });
    const book = { bars: "level", style: "line", rows: 50, combinedMarkets: ["ETH"] } satisfies NonNullable<ReturnType<typeof defaultDomPreferences>["book"]>;
    useWorkspaceStore.getState().setDomPreferences({ book });
    const backup = createWorkspaceBackup();
    useWorkspaceStore.getState().setDomPreferences({ book: { ...book, rows: 5, combinedMarkets: ["BTC"] } });
    await restoreWorkspaceText(JSON.stringify(backup));
    expect(reload).toHaveBeenCalledOnce();
    await useWorkspaceStore.persist.rehydrate();
    expect(useWorkspaceStore.getState().domPreferences.book).toEqual(book);

    const { parseWorkspace } = await import("@/lib/workspace");
    const savedBook = (backup.premium!.state.domPreferences as { book: Record<string, unknown> }).book;
    for (const combinedMarkets of [["ETH", "ETH"], ["SOL"], "ETH"]) {
      savedBook.combinedMarkets = combinedMarkets;
      expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(/DOM workspace/);
    }

    delete savedBook.rows;
    delete savedBook.combinedMarkets;
    await restoreWorkspaceText(JSON.stringify(backup));
    await useWorkspaceStore.persist.rehydrate();
    expect(useWorkspaceStore.getState().domPreferences.book).toEqual({ bars: "level", style: "line", rows: 10 });
  });
});
