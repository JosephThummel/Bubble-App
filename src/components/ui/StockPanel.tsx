"use client";

import { useState } from "react";
import { CandlestickChart, Plus } from "lucide-react";
import SidePanel from "./SidePanel";
import { SourceGlyph } from "./bits";
import { PriceBlock, ValuationBlock } from "@/components/stock/Charts";
import { compact, useStock, type MultipleKey, type RangeKey } from "@/components/stock/useStock";
import type { Item } from "@/lib/graph";

// A quick look at a ticker you don't cover yet: price, valuation and your notes that mention it,
// with a way to give it its own planet.
export default function StockPanel({ symbol, items, onClose, onOpenItem, onCover }: {
  symbol: string | null; items: Item[]; onClose: () => void; onOpenItem: (id: string) => void;
  onCover: (symbol: string, name: string) => void;
}) {
  const [range, setRange] = useState<RangeKey>("1Y");
  const [multiple, setMultiple] = useState<MultipleKey>("pe");
  const a = useStock(symbol);
  const stock = a?.enabled ? a.stock : undefined;
  const notes = symbol ? items.filter(i => i.tickers?.includes(symbol)).sort((x, y) => y.createdAt - x.createdAt) : [];

  return (
    <SidePanel openKey={symbol} hue={210} wide onClose={onClose}
      eyebrow={<span className="c-stock-eyebrow"><CandlestickChart size={13} /> ${symbol}{stock?.exchange ? ` · ${stock.exchange}` : ""}</span>}>
      {symbol && !a && <div className="c-stock-loading" aria-live="polite">Loading {symbol}…</div>}

      {a && (!a.enabled || a.error) && (
        <div className="c-stock-empty">
          <h2 className="c-panel-title">{symbol}</h2>
          <p className="c-panel-summary">{!a.enabled ? <NoKey /> : a.error}</p>
        </div>
      )}

      {stock && (
        <>
          <h2 className="c-panel-title">{stock.name}</h2>
          {stock.sector && <div className="c-panel-meta c-stock-sector">{stock.sector}{stock.marketCap ? ` · ${compact(stock.marketCap, stock.currency)} market cap` : ""}</div>}
          <PriceBlock stock={stock} range={range} onRange={setRange} />
          <div className="c-panel-section">
            <ValuationBlock stock={stock} range={range} multiple={multiple} onMultiple={setMultiple} />
          </div>
        </>
      )}

      {symbol && a && (
        <button className="c-btn c-btn-ghost c-stock-cover" onClick={() => onCover(symbol, stock?.name ?? "")}>
          <Plus size={15} /> Cover {symbol} as its own planet
        </button>
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

export function NoKey() {
  return <>Price charts aren&apos;t switched on yet. Add a free Financial Modeling Prep key as FMP_API_KEY in Vercel (step 9 of the setup guide), then redeploy.</>;
}
