"use client";

import LineChart from "@/components/ui/LineChart";
import { MULTIPLES, RANGES, compact, money, sliceRange, stats, times, type MultipleKey, type RangeKey } from "./useStock";
import type { Stock } from "@/lib/stocks";

export function Segments<K extends string>({ options, value, onChange, label }: {
  options: { key: K; label: string }[]; value: K; onChange: (k: K) => void; label: string;
}) {
  return (
    <div className="c-stock-ranges" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.key} className={"c-stock-range" + (value === o.key ? " is-on" : "")} aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

// The share price over a chosen range, with the move over that range.
export function PriceBlock({ stock, range, onRange }: { stock: Stock; range: RangeKey; onRange: (r: RangeKey) => void }) {
  const view = sliceRange(stock, range);
  const up = (view.change ?? 0) >= 0;
  return (
    <>
      <div className="c-stock-price">
        {view.last !== null && <span className="c-stock-last">{money(view.last, stock.currency)}</span>}
        {view.change !== null && (
          <span className={`c-stock-change ${up ? "is-up" : "is-down"}`}>
            {up ? "▲" : "▼"} {Math.abs(view.change * 100).toFixed(1)}% <span>over {range}</span>
          </span>
        )}
      </div>
      <Segments options={RANGES.map(r => ({ key: r.key, label: r.key }))} value={range} onChange={onRange} label="Time range" />
      <LineChart data={view.prices} hue={up ? 150 : 8} label={`${stock.symbol} share price, ${range}`} format={v => money(v, stock.currency)}
        axis={v => compact(v, stock.currency)} />
    </>
  );
}

// How the market has valued the company over the same range, one multiple at a time.
export function ValuationBlock({ stock, range, multiple, onMultiple }: {
  stock: Stock; range: RangeKey; multiple: MultipleKey; onMultiple: (m: MultipleKey) => void;
}) {
  const m = MULTIPLES.find(x => x.key === multiple)!;
  const series = sliceRange(stock, range).multiples.map(x => [x.date, x[multiple]] as [string, number | null]);
  const s = stats(series.map(x => x[1]));
  return (
    <>
      <div className="c-stock-sec-head">
        <div className="c-eyebrow">Valuation</div>
        {stock.basis && <Segments options={MULTIPLES.map(x => ({ key: x.key, label: x.label }))} value={multiple} onChange={onMultiple} label="Multiple" />}
      </div>
      {!stock.basis ? (
        <p className="c-stock-note">No financial statements for {stock.symbol} on your data plan, so multiples can&apos;t be worked out.</p>
      ) : s ? (
        <>
          <div className="c-stock-tiles">
            <Tile label="Now" value={times(s.now)} />
            <Tile label={`${range} average`} value={times(s.avg)} />
            <Tile label={`${range} low`} value={times(s.lo)} />
            <Tile label={`${range} high`} value={times(s.hi)} />
          </div>
          <LineChart data={series} hue={210} label={`${stock.symbol} ${m.long}, ${range}`} format={times} height={170} />
          <p className="c-stock-note">
            {m.long}, using each day&apos;s price and the trailing twelve months from {stock.basis === "quarterly" ? "quarterly" : "annual"} filings.
            Gaps are periods with losses, where the multiple means nothing.
          </p>
        </>
      ) : (
        <p className="c-stock-note">{m.label} isn&apos;t meaningful for {stock.symbol} over this range, usually because of losses. Try another multiple or a longer range.</p>
      )}
    </>
  );
}

export function Tile({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="c-stock-tile">
      <span className={"c-stock-tile-v" + (tone ? ` is-${tone}` : "")}>{value}</span>
      <span className="c-stock-tile-l">{label}</span>
    </div>
  );
}
