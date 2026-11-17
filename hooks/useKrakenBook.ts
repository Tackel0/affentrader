"use client";
import { useEffect, useState } from "react";
import type { OrderBook } from "@/types/trading";
import { subscribeKrakenTrades } from "@/lib/market/kraken";

export function useKrakenBook(pair: string | null) {
  const [book, setBook] = useState<OrderBook | null>(null);
  useEffect(() => {
    setBook(null);
    if (!pair) return;
    let retry: ReturnType<typeof setTimeout>;
    let stop: () => void;
    const connect = () => {
      stop = subscribeKrakenTrades([], () => {}, () => {
        setBook(null);
        retry = setTimeout(connect, 3000);
      }, setBook, [pair]);
    };
    connect();
    return () => {
      clearTimeout(retry);
      stop();
    };
  }, [pair]);
  return pair && book?.symbol === `KRK:${pair}` ? book : null;
}
