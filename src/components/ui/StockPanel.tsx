"use client";

import { useEffect, useMemo, useState } from "react";
import { CandlestickChart } from "lucide-react";
import SidePanel from "./SidePanel";
import LineChart from "./LineChart";
import { SourceGlyph } from "./bits";
import type { Item } from "@/lib/graph";
import type { Multiple, Stock } from "@/lib/stocks";

type Answer = { enabled: false } | { enabled: true; stock?: Stock; error?: string };

const RANGES = [
  { key: "1M", days: 31 }, { key: "3M", days: 92 }, { key: "6M", days: 183 },
  { key: "1Y", days: 366 }, { key: "3Y", days: 1096 }, { key: "5Y", days: 1827 },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const MULTIPLES: { key: keyof Omit<Multiple, "date">; label: string; long: string }[] = [
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

const money = (v: number, cur = "USD") =>
  v.toLocaleString(undefined, { style: "currency", currency: cur, maximumFractionDigits: v >= 1000 ? 0 : 2 });
const compact = (v: number, cur = "USD") =>
  v.toLocaleString(undefined, { style: "currency", currency: cur, notation: "compact", maximumFractionDigits: 1 });
const times = (v: number) => `${v.toFixed(v >= 100 ? 0 : 1)}x`;

// A ticker's price over time and how the market has valued it, next to your notes on it.
export default function StockPanel({ symbol, items, onClose, onOpenItem }: {
  symbol: string | null; items: Item[]; onClose: () => void; onOpenItem: (id: string) => void;
}) {
  const [answer, setAnswer] = useState<{ symbol: string; a: Answer } | null>(null);
  const [range, setRange] = useState<RangeKey>("1Y");
  const [multiple, setMultiple] = useState<(typeof MULTIPLES)[number]["key"]>("pe");

  useEffect(() => {
    if (!symbol) return;
    let live = true;
    load(symbol).then(a => { if (live) setAnswer({ symbol, a }); });
    return () => { live = false; };
  }, [symbol]);

  const a = answer?.symbol === symbol ? answer.a : null;
  const stock = a?.enabled ? a.stock : undefined;
  const notes = symbol ? items.filter(i => i.tickers?.includes(symbol)).sort((x, y) => y.createdAt - x.createdAt) : [];

  const view = useMemo(() => {
    if (!stock) return null;
    const days = RANGES.find(r => r.key === range)!.days;
    // counted back from the latest close, so a stale cache still shows a full range
    const end = stock.prices.at(-1)?.[0];
    const from = end ? new Date(new Date(`${end}T12:00:00Z`).getTime() - days * 864e5).toISOString().slice(0, 10) : "";
    const prices = stock.prices.filter(p => p[0] >= from);
    const mult = stock.multiples.filter(m => m.date >= from).map(m => [m.date, m[multiple]] as [string, number | null]);
    const vals = mult.map(m => m[1]).filter((v): v is number => v !== null);
    const first = prices[0]?.[1], last = prices.at(-1)?.[1];
    return {
      prices, mult, last: last ?? stock.price,
      change: first && last ? (last - first) / first : null,
      stats: vals.length ? { now: vals.at(-1)!, avg: vals.reduce((s, v) => s + v, 0) / vals.length, lo: Math.min(...vals), hi: Math.max(...vals) } : null,
    };
  }, [stock, range, multiple]);

  const up = (view?.change ?? 0) >= 0;
  const hue = up ? 150 : 8;
  const m = MULTIPLES.find(x => x.key === multiple)!;

  return (
    <SidePanel openKey={symbol} hue={210} wide onClose={onClose}
      eyebrow={<span className="c-stock-eyebrow"><CandlestickChart size={13} /> ${symbol}{stock?.exchange ? ` · ${stock.exchange}` : ""}</span>}>
      {symbol && !a && <div className="c-stock-loading" aria-live="polite">Loading {symbol}…</div>}

      {a && !a.enabled && (
        <div className="c-stock-empty">
          <h2 className="c-panel-title">{symbol}</h2>
          <p className="c-panel-summary">Price charts aren&apos;t switched on yet. Add a free Financial Modeling Prep key as FMP_API_KEY in Vercel (step 9 of the setup guide), then redeploy.</p>
        </div>
      )}
      {a?.enabled && a.error && (
        <div className="c-stock-empty">
          <h2 className="c-panel-title">{symbol}</h2>
          <p className="c-panel-summary">{a.error}</p>
        </div>
      )}

      {stock && view && (
        <>
          <h2 className="c-panel-title">{stock.name}</h2>
          {stock.sector && <div className="c-panel-meta c-stock-sector">{stock.sector}{stock.marketCap ? ` · ${compact(stock.marketCap, stock.currency)} market cap` : ""}</div>}

          <div className="c-stock-price">
            {view.last !== null && <span className="c-stock-last">{money(view.last, stock.currency)}</span>}
            {view.change !== null && (
              <span className={`c-stock-change ${up ? "is-up" : "is-down"}`}>
                {up ? "▲" : "▼"} {Math.abs(view.change * 100).toFixed(1)}% <span>over {range}</span>
              </span>
            )}
          </div>

          <div className="c-stock-ranges" role="group" aria-label="Time range">
            {RANGES.map(r => (
              <button key={r.key} className={"c-stock-range" + (range === r.key ? " is-on" : "")} aria-pressed={range === r.key}
                onClick={() => setRange(r.key)}>{r.key}</button>
            ))}
          </div>
          <LineChart data={view.prices} hue={hue} label={`${symbol} share price, ${range}`} format={v => money(v, stock.currency)}
            axis={v => compact(v, stock.currency)} />

          <div className="c-panel-section">
            <div className="c-stock-sec-head">
              <div className="c-eyebrow">Valuation</div>
              {stock.basis && (
                <div className="c-stock-ranges" role="group" aria-label="Multiple">
                  {MULTIPLES.map(x => (
                    <button key={x.key} className={"c-stock-range" + (multiple === x.key ? " is-on" : "")} aria-pressed={multiple === x.key}
                      onClick={() => setMultiple(x.key)}>{x.label}</button>
                  ))}
                </div>
              )}
            </div>
            {!stock.basis ? (
              <p className="c-stock-note">No financial statements for {symbol} on your data plan, so multiples can&apos;t be worked out.</p>
            ) : view.stats ? (
              <>
                <div className="c-stock-tiles">
                  <Tile label="Now" value={times(view.stats.now)} />
                  <Tile label={`${range} average`} value={times(view.stats.avg)} />
                  <Tile label={`${range} low`} value={times(view.stats.lo)} />
                  <Tile label={`${range} high`} value={times(view.stats.hi)} />
                </div>
                <LineChart data={view.mult} hue={210} label={`${symbol} ${m.long}, ${range}`} format={times} height={170} />
                <p className="c-stock-note">
                  {m.long}, using each day&apos;s price and the trailing twelve months from {stock.basis === "quarterly" ? "quarterly" : "annual"} filings.
                  Gaps are periods with losses, where the multiple means nothing.
                </p>
              </>
            ) : (
              <p className="c-stock-note">{m.label} isn&apos;t meaningful for {symbol} over this range, usually because of losses. Try another multiple or a longer range.</p>
            )}
          </div>
        </>
      )}

      {symbol && (
        <div className="c-panel-section">
          <div className="c-eyebrow">Your notes on {symbol}</div>
          {notes.length ? notes.map(n => (
            <button key={n.id} className="c-deduction-row" onClick={() => onOpenItem(n.id)}>
              <SourceGlyph source={n.source} size={14} /> <span>{n.title}</span>
            </button>
          )) : <p className="c-stock-note">None yet.</p>}
        </div>
      )}
    </SidePanel>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="c-stock-tile">
      <span className="c-stock-tile-v">{value}</span>
      <span className="c-stock-tile-l">{label}</span>
    </div>
  );
}
