"use client";
import { useEffect, useState } from "react";
import type { OrderBook } from "@/types/trading";
import { binanceDepth } from "@/lib/market/binanceStream";
import { parseWireObject } from "@/lib/market/marketWire";

export function useBinanceBook(symbol: string | null) {
  const [book, setBook] = useState<OrderBook | null>(null);
  useEffect(() => {
    setBook(null);
    if (!symbol) return;
    let active = true;
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let lastBook = Date.now();
    const connect = () => {
      const connection = new WebSocket(`wss://data-stream.binance.vision/ws/${symbol.toLowerCase()}@depth10`);
      socket = connection;
      lastBook = Date.now();
      connection.onmessage = ({ data }) => {
        if (!active || connection !== socket) return;
        const message = parseWireObject(data);
        const depth = message && binanceDepth(message);
        if (!depth?.bids.length || !depth.asks.length) return;
        lastBook = Date.now();
        setBook({ symbol, ...depth, time: lastBook, simulated: false });
      };
      connection.onerror = () => connection.close();
      connection.onclose = () => {
        if (!active || connection !== socket) return;
        setBook(null);
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    const watchdog = setInterval(() => {
      if (Date.now() - lastBook > 15_000) socket.close();
    }, 5000);
    return () => {
      active = false;
      clearInterval(watchdog);
      clearTimeout(retry);
      socket.close();
    };
  }, [symbol]);
  return symbol && book?.symbol === symbol ? book : null;
}
