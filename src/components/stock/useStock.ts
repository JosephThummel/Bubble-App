"use client";

import { useEffect, useState } from "react";
import type { Multiple, Stock } from "@/lib/stocks";

export type Answer = { enabled: false } | { enabled: true; stock?: Stock; error?: string };

export const RANGES = [
  { key: "1M", days: 31 }, { key: "3M", days: 92 }, { key: "6M", days: 183 },
  { key: "1Y", days: 366 }, { key: "3Y", days: 1096 }, { key: "5Y", days: 1827 },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

export type MultipleKey = keyof Omit<Multiple, "date">;
export const MULTIPLES: { key: MultipleKey; label: string; long: string }[] = [
  { key: "pe", label: "P/E", long: "Price to earnings" },
  { key: "evEbitda", label: "EV/EBITDA", long: "Enterprise value to EBITDA" },
  { key: "ps", label: "P/S", long: "Price to sales" },
];

// Fetched once per session per ticker; the server caches an hour on top of this.
const cache = new Map<string, Promise<Answer>>();
function load(symbol: string) {
  if (!cache.has(symbol)) {
    cache.set(symbol, fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}`)
      .then(r => r.json() as Promise<Answer>)
      .catch(() => ({ enabled: true, error: "Couldn't reach the market data service. Try again in a moment." }) as Answer)
      .then(a => { if (a.enabled && a.error) cache.delete(symbol); return a; }));
  }
  return cache.get(symbol)!;
}

// The market data answer for a ticker: null while loading.
export function useStock(symbol: string | null): Answer | null {
  const [answer, setAnswer] = useState<{ symbol: string; a: Answer } | null>(null);
  useEffect(() => {
    if (!symbol) return;
    let live = true;
    load(symbol).then(a => { if (live) setAnswer({ symbol, a }); });
    return () => { live = false; };
  }, [symbol]);
  return answer?.symbol === symbol ? answer.a : null;
}

export const money = (v: number, cur = "USD") =>
  v.toLocaleString(undefined, { style: "currency", currency: cur, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
export const compact = (v: number, cur = "USD") =>
  v.toLocaleString(undefined, { style: "currency", currency: cur, notation: "compact", maximumFractionDigits: 1 });
export const times = (v: number) => `${v.toFixed(v >= 100 ? 0 : 1)}x`;
export const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(Math.abs(v) >= 1 ? 0 : 1)}%`;

// Prices and multiples over a range, counted back from the latest close so a stale cache
// still shows a full range.
export function sliceRange(stock: Stock, range: RangeKey) {
  const days = RANGES.find(r => r.key === range)!.days;
  const end = stock.prices.at(-1)?.[0];
  const from = end ? new Date(new Date(`${end}T12:00:00Z`).getTime() - days * 864e5).toISOString().slice(0, 10) : "";
  const prices = stock.prices.filter(p => p[0] >= from);
  const first = prices[0]?.[1], last = prices.at(-1)?.[1];
  return {
    prices,
    multiples: stock.multiples.filter(m => m.date >= from),
    last: last ?? stock.price,
    change: first && last ? (last - first) / first : null,
  };
}

export function stats(values: (number | null)[]) {
  const vals = values.filter((v): v is number => v !== null);
  return vals.length ? { now: vals.at(-1)!, avg: vals.reduce((s, v) => s + v, 0) / vals.length, lo: Math.min(...vals), hi: Math.max(...vals) } : null;
}
