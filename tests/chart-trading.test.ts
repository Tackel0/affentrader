import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {DEFAULT_CHART_TRADING,validChartTrading} from "@/lib/trading/chartPreferences";
import {createAccount} from "@/lib/trading/broker";
beforeEach(()=>{
  vi.resetModules();const disk=new Map<string,string>();
  vi.stubGlobal("localStorage",{getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>disk.set(key,value),removeItem:(key:string)=>disk.delete(key)});
  vi.stubGlobal("sessionStorage",{getItem:()=>null,setItem:()=>{}});
  vi.stubGlobal("navigator",{locks:{request:async(_name:string,_options:unknown,action:()=>Promise<unknown>)=>action()}});
  vi.stubGlobal("crypto",{randomUUID:()=>"chart-test"});
});
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function setup(){
  const {useChartStore:chart}=await import("@/stores/useChartStore"),{usePaperStore:paper}=await import("@/stores/usePaperStore"),{useWorkspaceStore:workspace}=await import("@/stores/useWorkspaceStore"),api=await import("@/lib/trading/chartTrading");
  chart.setState({symbol:"BTCUSDT",chartTrading:{...DEFAULT_CHART_TRADING}});workspace.getState().capture();paper.setState({live:createAccount({feeRate:0,slippageBps:0})});paper.getState().observePrice("BTCUSDT",100,false);return{chart,paper,workspace,...api};
}
describe("chart trading controls",()=>{
  it("clears multi-level entry settings when staging a fresh chart ticket",async()=>{const s=await setup();s.paper.getState().setTicket({exitLevels:[{quantity:1,takeProfit:120,stopLoss:80}]});await s.tradeFromChart("BTCUSDT",s.workspace.getState().activeId,"buy");expect(s.paper.getState().ticket.exitLevels).toBeUndefined();expect(s.paper.getState().live.orders).toHaveLength(0);});

  it("keeps snapshot image data out of persisted preferences and workspace backups",async()=>{
    const s=await setup();s.chart.getState().set({snapshot:{image:"data:image/png;base64,cG5n",filename:"test.png",width:800,height:400,title:"BTC",source:"Replay",capturedAt:"2026-10-26T12:00:00Z"}});const partial=s.chart.persist.getOptions().partialize!(s.chart.getState());expect(partial).not.toHaveProperty("snapshot");const {createWorkspaceBackup}=await import("@/lib/workspaceBackup");expect(JSON.stringify(createWorkspaceBackup())).not.toContain("data:image/png");s.chart.getState().set({snapshot:null});expect(s.chart.getState().snapshot).toBeNull();
  });

  it("defaults to a visible ticket-opening flow with instant execution off",()=>{expect(DEFAULT_CHART_TRADING).toEqual({showButtons:true,instantOrders:false});expect(validChartTrading(DEFAULT_CHART_TRADING)).toBe(true);});
  it.each([null,[],{}, {showButtons:true,instantOrders:"yes"},{showButtons:true,instantOrders:false,execute:true}])("rejects malformed trading settings %#",value=>expect(validChartTrading(value)).toBe(false));
  it("opens a fresh market ticket without placing an order or carrying stale limit/bracket fields",async()=>{
    const s=await setup();s.paper.getState().setTicket({type:"stop_limit",price:50,stopPrice:60,takeProfit:200,stopLoss:40,reduceOnly:true,quantity:2});
    expect(await s.tradeFromChart("BTCUSDT",s.workspace.getState().activeId,"sell")).toBe("ticket");expect(s.paper.getState().live.orders).toHaveLength(0);expect(s.paper.getState().ticket).toEqual({side:"sell",type:"market",quantity:2,price:undefined,stopPrice:undefined,takeProfit:undefined,stopLoss:undefined,reduceOnly:false});expect(s.chart.getState()).toMatchObject({bottomTab:"trading",bottomOpen:true});
  });
  it("opens the editable ticket even when a previous quantity was cleared",async()=>{const s=await setup();s.paper.getState().setTicket({quantity:0});expect(await s.tradeFromChart("BTCUSDT",s.workspace.getState().activeId,"buy")).toBe("ticket");});
  it("executes an explicitly enabled instant order through the actual serialized broker at ask",async()=>{
    const s=await setup(),time=Date.now();s.chart.setState({chartTrading:{showButtons:true,instantOrders:true}});s.paper.getState().setTicket({quantity:2});s.paper.getState().observeBook({symbol:"BTCUSDT",time,simulated:false,bids:[{price:99,quantity:1}],asks:[{price:101,quantity:1}]});await s.tradeFromChart("BTCUSDT",s.workspace.getState().activeId,"buy");expect(s.paper.getState().live.fills[0]).toMatchObject({quantity:2,price:101,priceBasis:"ask"});expect(s.chart.getState().toasts.at(-1)?.title).toBe("Paper order filled");
  });
  it("rejects a stale symbol/cell and invalid instant quantity before execution",async()=>{
    const s=await setup();await expect(s.tradeFromChart("ETHUSDT",s.workspace.getState().activeId,"buy")).rejects.toThrow(/chart changed/);await expect(s.tradeFromChart("BTCUSDT","missing","sell")).rejects.toThrow(/chart changed/);s.chart.setState({chartTrading:{showButtons:true,instantOrders:true}});s.paper.getState().setTicket({quantity:NaN});await expect(s.tradeFromChart("BTCUSDT",s.workspace.getState().activeId,"buy")).rejects.toThrow(/positive quantity/);expect(s.paper.getState().live.orders).toHaveLength(0);
  });
  it("activates the clicked satellite before opening its ticket",async()=>{
    const s=await setup();s.workspace.getState().setLayout("two-columns");const cell=s.workspace.getState().cells.find(c=>c.id!==s.workspace.getState().activeId)!;s.workspace.setState({cells:s.workspace.getState().cells.map(c=>c.id===cell.id?{...c,symbol:"ETHUSDT"}:c),sync:{...s.workspace.getState().sync,symbol:false}});await s.tradeFromChart("ETHUSDT",cell.id,"buy");expect(s.workspace.getState().activeId).toBe(cell.id);expect(s.chart.getState().symbol).toBe("ETHUSDT");expect(s.paper.getState().live.orders).toHaveLength(0);
  });
  it("blocks satellite trading during another chart's Replay and keeps instant Replay local",async()=>{
    const s=await setup();s.workspace.getState().setLayout("two-columns");const cell=s.workspace.getState().cells.find(c=>c.id!==s.workspace.getState().activeId)!;s.paper.getState().startReplay();await expect(s.tradeFromChart(cell.symbol,cell.id,"buy")).rejects.toThrow(/Finish Replay/);s.paper.getState().bar("BTCUSDT",{time:1000,open:50,high:50,low:50,close:50});s.chart.setState({chartTrading:{showButtons:true,instantOrders:true}});await s.tradeFromChart("BTCUSDT",s.workspace.getState().activeId,"buy");expect(s.paper.getState().live.fills).toHaveLength(0);expect(s.paper.getState().replay.fills[0]).toMatchObject({price:50,source:"replay"});
  });
  it("round trips trading preferences and the chart timezone through the actual backup serializer",async()=>{
    const s=await setup();s.chart.setState({timezone:"Europe/Berlin",chartTrading:{showButtons:false,instantOrders:true}});const {createWorkspaceBackup}=await import("@/lib/workspaceBackup"),{parseWorkspace}=await import("@/lib/workspace");const backup=createWorkspaceBackup();expect(parseWorkspace(JSON.stringify(backup)).chart.state).toMatchObject({timezone:"Europe/Berlin",chartTrading:{showButtons:false,instantOrders:true}});backup.chart.state.chartTrading={showButtons:true,instantOrders:"yes"};expect(()=>parseWorkspace(JSON.stringify(backup))).toThrow(/trading preferences/);
  });
});
