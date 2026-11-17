"use client";
import type {OrderBook} from "@/types/trading";
import {setPositionProtection,type PositionExitLevel,type ProtectionResult} from "@/lib/trading/protection";
import {executableQuote,liquidationPrices,type ExecutableQuote} from "@/lib/trading/quotes";
import { create } from "zustand";
import { createJSONStorage,persist } from "zustand/middleware";
import {assertPaperTransaction,paperRawStorage,PAPER_STORAGE_KEY,validPaperAccount} from "@/lib/trading/paperPersistence";
import {readPaperTicket,savePaperTicket} from "@/lib/trading/ticketPreferences";
import {processReplayUpdate} from "@/lib/trading/replay";
import {paperSampleSource,type PaperExecutionSource} from "@/lib/trading/executionSource";
import {
  amendOrder,
  type Amendment,
  type OrderPatch,
  cancelAll,
  cancelOrder,
  closePosition,
  reversePosition,
  createAccount,
  markToMarket,
  placeOrder,
  processPrice,
  type Account,
  type Bar,
  type NewOrder,
  type Order,
  type Prices,
} from "@/lib/trading/broker";

export type TradingMode = "live" | "replay";

export interface Ticket {
  exitLevels?:import("@/lib/trading/exitLevels").ExitLevel[];
  side: "buy" | "sell";
  type: NewOrder["type"];
  /** Order size in base units. */
  quantity: number;
  price?: number;
  stopPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  reduceOnly: boolean;
}

export const DEFAULT_TICKET: Ticket = {
  side: "buy",
  type: "market",
  quantity: 0.01,
  reduceOnly: false,
};

export interface PlaceResult {
  ok: boolean;
  order: Order;
}

interface PaperState {
  live: Account;
  /** Separate account used while Bar Replay is active; never persisted. */
  replay: Account;
  mode: TradingMode;
  contextEpoch:number;
  /** Latest price per symbol seen by the engine (live feed or replayed bar). */
  prices: Prices;
  livePrices:Prices;
  liveBooks:Record<string,OrderBook|undefined>;
  observeBook:(book:OrderBook)=>void;
  liveSources:Record<string,PaperExecutionSource|undefined>;
  replayPrices:Prices;
  replayClock?:number;
  replaySource:"replay"|"replay_simulation";
  replayBars:Record<string,Bar>;
  ticket: Ticket;
  setMode: (mode: TradingMode) => void;
  setTicket: (patch: Partial<Ticket>) => void;
  place: (order: NewOrder, time?: number) => PlaceResult;
  amend:(id:string,patch:OrderPatch,revision:number)=>Amendment;
  protect:(symbol:string,levels:readonly PositionExitLevel[])=>ProtectionResult;
  cancel: (id: string) => void;
  cancelAll: (symbol?: string) => void;
  close: (symbol: string,quantity?:number) => PlaceResult|null;
  reverse:(symbol:string)=>PlaceResult|null;
  reset: (patch?: Partial<Account>) => void;
  /** Live price update for a symbol (ignored while replaying). */
  tick: (symbol: string, price: number, time: number,simulated?:boolean,quote?:ExecutableQuote) => void;
  /** Local quote display, without processing the shared account. */
  observePrice:(symbol:string,price:number,simulated?:boolean)=>void;
  clearObservedPrices:()=>void;
  /** A replayed (or completed) bar. */
  bar: (symbol: string, bar: Bar) => void;
  startReplay: (simulated?:boolean) => void;
}

const key = (mode: TradingMode) => mode;

export const usePaperStore = create<PaperState>()(
  persist(
    (set, get) => ({
      live: createAccount(),
      replay: createAccount(),
      mode: "live",
      contextEpoch:0,
      prices: {},
      liveBooks:{},livePrices:{},liveSources:{},replayPrices:{},replayBars:{},replaySource:"replay",
      ticket: readPaperTicket(DEFAULT_TICKET),
      setMode: (mode) => set((s) => (s.mode === mode ? s : { mode,contextEpoch:s.contextEpoch+1, prices:mode==="live"?s.livePrices:s.replayPrices })),
      setTicket: (patch) => {const ticket={...get().ticket,...patch};savePaperTicket(ticket);set({ticket});},
      place: (order, time) => {
        const state = get();
        if(state.mode==="live")assertPaperTransaction();
        if(state.mode==="replay"&&!Number.isFinite(state.replayClock))throw new Error("Load a Replay cursor bar before placing a Replay order.");
        time??=state.mode==="replay"?state.replayClock!:Date.now();
        const account = state[key(state.mode)];
        const placed = placeOrder(account, order, state.prices, time,state.mode==="replay"?state.replaySource:state.liveSources[order.symbol],state.mode==="live"?executableQuote(state.liveBooks[order.symbol],order.symbol,state.liveSources[order.symbol]===undefined?undefined:state.liveSources[order.symbol]==="simulation",time):undefined);
        set({
          [key(state.mode)]: markToMarket(placed.account, state.mode==="live"?liquidationPrices(placed.account,state.prices,state.liveBooks,state.liveSources,time):state.prices, time),
        } as Partial<PaperState>);
        return { ok: placed.order.status !== "rejected", order: placed.order };
      },
      protect:(symbol,levels)=>{
        const state=get();if(state.mode==="live")assertPaperTransaction();
        if(state.mode==="replay"&&!Number.isFinite(state.replayClock))throw new Error("Load a Replay cursor before changing protection.");
        const time=state.mode==="replay"?state.replayClock!:Date.now(),source=state.mode==="replay"?state.replaySource:state.liveSources[symbol],quote=state.mode==="live"?executableQuote(state.liveBooks[symbol],symbol,source===undefined?undefined:source==="simulation",time):undefined;
        const result=setPositionProtection(state[key(state.mode)],symbol,levels,state.prices,time,source,quote);
        if(result.ok&&result.account!==state[key(state.mode)])set({[key(state.mode)]:result.account} as Partial<PaperState>);return result;
      },
      amend:(id,patch,revision)=>{
        const state=get();if(state.mode==="live")assertPaperTransaction();
        if(state.mode==="replay"&&!Number.isFinite(state.replayClock))throw new Error("Load a Replay cursor before modifying an order.");
        const time=state.mode==="replay"?state.replayClock!:Date.now(),original=state[key(state.mode)].orders.find(o=>o.id===id),symbol=original?.symbol??"",source=state.mode==="replay"?state.replaySource:state.liveSources[symbol];
        const quote=state.mode==="live"?executableQuote(state.liveBooks[symbol],symbol,source===undefined?undefined:source==="simulation",time):undefined;
        const result=amendOrder(state[key(state.mode)],id,patch,revision,state.prices,time,source,quote);
        if(result.ok&&result.account!==state[key(state.mode)])set({[key(state.mode)]:markToMarket(result.account,state.mode==="live"?liquidationPrices(result.account,state.prices,state.liveBooks,state.liveSources,time):state.prices,time)} as Partial<PaperState>);
        return result;
      },
      cancel: (id) => {if(get().mode==="live")assertPaperTransaction();set((s) => ({ [key(s.mode)]: cancelOrder(s[key(s.mode)], id) }) as Partial<PaperState>);},
      cancelAll: (symbol) => {if(get().mode==="live")assertPaperTransaction();set((s) => ({ [key(s.mode)]: cancelAll(s[key(s.mode)], symbol) }) as Partial<PaperState>);},
      close: (symbol,quantity) => {
        const state = get();
        if(state.mode==="live")assertPaperTransaction();
        if(state.mode==="replay"&&!Number.isFinite(state.replayClock))throw new Error("Load a Replay cursor bar before closing a Replay position.");
        const time=state.mode==="replay"?state.replayClock!:Date.now();
        const closed = closePosition(state[key(state.mode)], symbol, state.prices, time,state.mode==="replay"?state.replaySource:state.liveSources[symbol],state.mode==="live"?executableQuote(state.liveBooks[symbol],symbol,state.liveSources[symbol]===undefined?undefined:state.liveSources[symbol]==="simulation",time):undefined,quantity);
        if (closed)
          set({
            [key(state.mode)]: markToMarket(closed.account, state.mode==="live"?liquidationPrices(closed.account,state.prices,state.liveBooks,state.liveSources,time):state.prices, time),
          } as Partial<PaperState>);
        return closed?{ok:closed.order.status!=="rejected",order:closed.order}:null;
      },
      reverse:symbol=>{
        const state=get();if(state.mode==="live")assertPaperTransaction();
        if(state.mode==="replay"&&!Number.isFinite(state.replayClock))throw new Error("Load a Replay cursor bar before reversing a Replay position.");
        const time=state.mode==="replay"?state.replayClock!:Date.now(),source=state.mode==="replay"?state.replaySource:state.liveSources[symbol],quote=state.mode==="live"?executableQuote(state.liveBooks[symbol],symbol,source===undefined?undefined:source==="simulation",time):undefined;
        const marks=state.mode==="live"?liquidationPrices(state.live,state.prices,state.liveBooks,state.liveSources,time):state.prices;
        const result=reversePosition(state[key(state.mode)],symbol,marks,time,source,quote);
        if(result)set({[key(state.mode)]:markToMarket(result.account,state.mode==="live"?liquidationPrices(result.account,state.prices,state.liveBooks,state.liveSources,time):state.prices,time)} as Partial<PaperState>);
        return result?{ok:result.order.status!=="rejected",order:result.order}:null;
      },
      reset: (patch) =>
        set((s) => {
          if(s.mode==="live")assertPaperTransaction();
          const current = s[key(s.mode)];
          const account=createAccount({
              initialBalance: current.initialBalance,
              feeRate: current.feeRate,
              slippageBps: current.slippageBps,
              leverage: current.leverage,
              ...patch,
            });
          if(!validPaperAccount(account))throw new Error("Enter valid paper account settings.");
          return {[key(s.mode)]:account} as Partial<PaperState>;
        }),
      observeBook:book=>set(state=>({liveBooks:{...state.liveBooks,[book.symbol]:book}})),
      observePrice:(symbol,price,simulated)=>{const state=get(),source=paperSampleSource(simulated);if(!(price>0)||!Number.isFinite(price)||state.livePrices[symbol]===price&&state.liveSources[symbol]===source)return;const livePrices={...state.livePrices,[symbol]:price};set({livePrices,liveSources:{...state.liveSources,[symbol]:source},...(state.mode==="live"?{prices:livePrices}:{})});},
      clearObservedPrices:()=>set(s=>({livePrices:{},liveSources:{},liveBooks:{},contextEpoch:s.contextEpoch+1,...(s.mode==="live"?{prices:{}}:{})})),
      tick: (symbol, price, time,simulated,quote) => {
        const state = get();
        assertPaperTransaction();
        if (!(price > 0)||!Number.isFinite(price)||!Number.isFinite(time)) return;
        const prices = { ...state.livePrices, [symbol]: price };
        const source=paperSampleSource(simulated),quotePatch={livePrices:prices,liveSources:{...state.liveSources,[symbol]:source},...(state.mode==="live"?{prices}:{})};
        const account = state.live;
        const relevant =
          account.positions.some((p) => p.symbol === symbol) ||
          account.orders.some((o) => o.symbol === symbol && o.status === "working");
        if (!relevant) {
          set(quotePatch);
          return;
        }
        const result = processPrice(account, symbol, price, time,false,false,time,source,quote);
        set({ ...quotePatch, live: markToMarket(result.account, liquidationPrices(result.account,prices,state.liveBooks,quotePatch.liveSources,time), time) });
      },
      bar: (symbol, bar) => {
        const state = get();
        if (state.mode !== "replay") return;
        if(![bar.time,bar.open,bar.high,bar.low,bar.close].every(Number.isFinite)||Math.min(bar.open,bar.high,bar.low,bar.close)<=0||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close))return;
        if(state.replayBars[symbol]&&bar.time<state.replayBars[symbol].time)return;
        const prices = { ...state.replayPrices, [symbol]: bar.close };
        const result = processReplayUpdate(state.replay, symbol,state.replayBars[symbol],bar,state.replaySource);
        set({ prices,replayPrices:prices,replayBars:{...state.replayBars,[symbol]:{...bar}},replayClock:bar.time, replay: markToMarket(result.account, prices, bar.time) });
      },
      startReplay: (simulated=false) =>
        set((s) => ({
          replay: createAccount({
            initialBalance: s.live.initialBalance,
            feeRate: s.live.feeRate,
            slippageBps: s.live.slippageBps,
            leverage: s.live.leverage,
          }),
          mode: "replay",
          replaySource:simulated?"replay_simulation":"replay",
          contextEpoch:s.contextEpoch+1,
          prices: {},
          replayPrices:{},replayBars:{},replayClock:undefined,
        })),
    }),
    {
      name: PAPER_STORAGE_KEY,
      version:1,
      migrate:persisted=>persisted as {live:Account},
      storage:createJSONStorage(()=>paperRawStorage),
      partialize: (s) => ({ live: s.live }),
      merge:(persisted,current)=>({...current,...(persisted&&typeof persisted==="object"&&"live" in persisted?{live:persisted.live as Account}:{})}),
    },
  ),
);

export function activeAccount(state: Pick<PaperState, "live" | "replay" | "mode">): Account {
  return state.mode === "replay" ? state.replay : state.live;
}
