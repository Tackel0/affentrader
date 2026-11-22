"use client";

import { useEffect } from "react";
import { marketService } from "@/lib/market/service";
import { replayDepth } from "@/lib/orderflow/replayDepth";
import { replayDepthDb, type StoredDepth } from "@/lib/orderflow/replayDepthDb";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

export function useReplayDepthCapture() {
  useEffect(() => {
    const isPhone = typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(max-width: 768px) and (pointer: coarse)").matches;
    let mounted = true;
    let writing = false;
    let active = !isPhone || Boolean(replayDepth.recording);
    let restored = false;
    const pending = new Map<string, StoredDepth>();
    const storageFailed = () => { replayDepth.storageError = "Local depth storage is unavailable. Current captures are held in this tab."; };

    const loadStored = () => {
      if (restored) return;
      restored = true;
      void replayDepthDb.update([], true).then(rows => {
        if (!mounted) return;
        const now = Date.now();
        for (const row of rows) {
          if (row.receivedAt > now || row.book?.symbol !== row.symbol || !Array.isArray(row.book.bids) || !Array.isArray(row.book.asks)) continue;
          replayDepth.restore(row.book, row.receivedAt);
        }
        replayDepth.storageError = "";
      }).catch(storageFailed);
    };
    if (active) loadStored();

    const flush = async () => {
      if (writing || !pending.size) return;
      writing = true;
      const batch = [...pending.values()];
      pending.clear();
      try {
        await replayDepthDb.update(batch);
        replayDepth.storageError = "";
      } catch {
        storageFailed();
      } finally {
        writing = false;
        if (!mounted && pending.size) void flush();
      }
    };
    const offRecord = replayDepth.subscribe(() => {
      if (!active && replayDepth.recording) {
        active = true;
        loadStored();
      }
    });
    const off = marketService.onBook(book => {
      if (!active || !replayDepth.recording) return;
      const state = useChartStore.getState();
      if (state.feedMode !== "auto" || state.symbol !== book.symbol || useWorkspaceStore.getState().replay.active) return;
      const receivedAt = Date.now();
      const accepted = replayDepth.accept(book, receivedAt);
      if (!accepted) return;
      const bucket = Math.floor(receivedAt / 1000);
      pending.set(`${bucket}:${book.symbol}`, {
        symbol: book.symbol, receivedAt, bucket,
        book: { symbol: book.symbol, time: accepted.exchangeTime, simulated: false, bids: [...accepted.bids], asks: [...accepted.asks] },
      });
      if (pending.size > 600) pending.delete(pending.keys().next().value!);
    });
    const save = () => { if (pending.size) void flush(); };
    const timer = setInterval(save, isPhone ? 5000 : 2000);
    window.addEventListener("pagehide", save);
    return () => {
      mounted = false;
      offRecord();
      off();
      clearInterval(timer);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, []);
}
