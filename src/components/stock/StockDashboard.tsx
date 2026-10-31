"use client";

import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, Radar, Minus } from "lucide-react";
import { useState } from "react";
import { PriceBlock, ValuationBlock } from "./Charts";
import ModelCard from "./ModelCard";
import NewsWatch from "./NewsWatch";
import { compact, sliceRange, stats, useStock, type MultipleKey, type RangeKey } from "./useStock";
import { SourceGlyph } from "@/components/ui/bits";
import { NoKey } from "@/components/ui/StockPanel";
import { KIND_LABEL } from "@/components/space/ListView";
import { pathLabel, readsFor, type Bubble, type Item, type StockModel } from "@/lib/graph";

const GROUPS: { label: string; kinds: string[] | null }[] = [
  { label: "Pitch & thesis", kinds: ["pitch", "thesis"] },
  { label: "Model", kinds: ["model"] },
  { label: "Filings & earnings", kinds: ["filing"] },
  { label: "Posts, research & news", kinds: null },
];

const date = (i: Item) => new Date(i.publishedAt ? `${i.publishedAt}T12:00:00` : i.createdAt)
  .toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// A covered stock opened up: how it has traded, what it trades at on your numbers, what the
// rest of your research means for it, and everything you've saved on it.
export default function StockDashboard({ stock, items, bubbles, connectionsReady, newsReady, onOpenItem, onScan, onSaveModel, onNewsEmail }: {
  stock: Bubble & { ticker: string }; items: Item[]; bubbles: Bubble[]; connectionsReady: boolean; newsReady: boolean;
  onOpenItem: (id: string) => void; onScan: () => Promise<number | null>; onSaveModel: (m: StockModel | undefined) => void;
  onNewsEmail: (on: boolean) => void;
}) {
  const [range, setRange] = useState<RangeKey>("1Y");
  const [multiple, setMultiple] = useState<MultipleKey>("pe");
  const a = useStock(stock.ticker);
  const data = a?.enabled ? a.stock : undefined;
  const own = items.filter(i => i.bubbleId === stock.id);
  const reads = readsFor(stock.ticker, items, stock.id).sort((x, y) => y.item.createdAt - x.item.createdAt);
  const source = stock.model?.sourceItemId ? own.find(i => i.id === stock.model!.sourceItemId) : undefined;

  // the market's average multiples over five years, to price the investor's forward numbers
  const five = data ? sliceRange(data, "5Y").multiples : [];
  const history = data?.basis ? {
    pe: stats(five.map(m => m.pe))?.avg, evEbitda: stats(five.map(m => m.evEbitda))?.avg, ps: stats(five.map(m => m.ps))?.avg,
  } : null;
  const card = (k: number) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { type: "spring" as const, stiffness: 260, damping: 28, delay: 0.08 + k * 0.05 } });

  return (
    <div className="c-dash" style={{ "--h": stock.hue } as React.CSSProperties}>
      <div className="c-dash-col">
      <motion.section className="c-dash-card c-dash-price" {...card(0)}>
        <div className="c-dash-head">
          <div className="c-eyebrow">Price</div>
          {data && <span className="c-dash-sub">{[data.exchange, data.sector, data.marketCap ? `${compact(data.marketCap, data.currency)} market cap` : ""].filter(Boolean).join(" · ")}</span>}
        </div>
        {!a && <div className="c-stock-loading">Loading {stock.ticker}…</div>}
        {a && !a.enabled && <p className="c-dash-empty"><NoKey /></p>}
        {a?.enabled && a.error && <p className="c-dash-empty">{a.error}</p>}
        {data && <PriceBlock stock={data} range={range} onRange={setRange} />}
      </motion.section>

      {data && (
        <motion.section className="c-dash-card c-dash-val" {...card(2)}>
          <ValuationBlock stock={data} range={range} multiple={multiple} onMultiple={setMultiple} />
        </motion.section>
      )}
      </div>

      <div className="c-dash-col">
      <motion.div className="c-dash-model" {...card(1)}>
        <ModelCard key={stock.id} ticker={stock.ticker} model={stock.model} marketPrice={data ? sliceRange(data, "1M").last : null}
          currency={data?.currency ?? "USD"} history={history} period="5Y"
          source={source ? { id: source.id, title: source.title } : undefined} onSave={onSaveModel} onOpenSource={onOpenItem} />
      </motion.div>

      <motion.section className="c-dash-card c-dash-news" {...card(3)}>
        <NewsWatch key={stock.id} stock={stock} own={own} newsReady={newsReady} onEmail={onNewsEmail} />
      </motion.section>

      <motion.section className="c-dash-card c-dash-reads" {...card(4)}>
        <ReadsHead ticker={stock.ticker} count={reads.length} connectionsReady={connectionsReady} onScan={onScan} />
        {reads.length ? (
          <ul className="c-reads">
            {reads.map(({ item, read }) => (
              <li key={item.id}>
                <button className="c-read" onClick={() => onOpenItem(item.id)}>
                  <span className={`c-read-impact is-${read.impact}`} title={read.impact}>
                    {read.impact === "positive" ? <ArrowUpRight size={14} /> : read.impact === "negative" ? <ArrowDownRight size={14} /> : <Minus size={14} />}
                    <span className="c-sr">{read.impact}</span>
                  </span>
                  <span className="c-read-text">
                    <span className="c-read-title">{item.title}</span>
                    <span className="c-read-why">{read.why}</span>
                    <span className="c-read-meta"><SourceGlyph source={item.source} size={12} /> {pathLabel(item.bubbleId, bubbles)} · {date(item)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="c-dash-empty">Market articles, posts and research elsewhere in your space that matter for {stock.ticker} show up here, with what specifically connects them to the position.</p>
        )}
      </motion.section>
      </div>

      <motion.section className="c-dash-card c-dash-files" {...card(5)}>
        <div className="c-dash-head"><div className="c-eyebrow">Your research on {stock.ticker}</div><span className="c-dash-sub">{own.length} {own.length === 1 ? "note" : "notes"}</span></div>
        {own.length ? GROUPS.map(g => {
          const list = own.filter(i => (g.kinds ? g.kinds.includes(i.kind ?? "") : !GROUPS.some(x => x.kinds?.includes(i.kind ?? ""))))
            .sort((x, y) => y.createdAt - x.createdAt);
          if (!list.length) return null;
          return (
            <div key={g.label} className="c-dash-group">
              <h3 className="c-lv-group-title">{g.label}<span>{list.length}</span></h3>
              {list.map(i => (
                <button key={i.id} className="c-dash-file" onClick={() => onOpenItem(i.id)}>
                  <span className="c-lv-glyph"><SourceGlyph source={i.source} size={14} /></span>
                  <span className="c-lv-text">
                    <span className="c-lv-title">{i.title}</span>
                    <span className="c-lv-sub">{i.summary}</span>
                  </span>
                  {i.kind && <span className={`c-kind c-kind-${i.kind}`}>{KIND_LABEL[i.kind] ?? i.kind}</span>}
                  <span className="c-lv-date">{date(i)}</span>
                </button>
              ))}
            </div>
          );
        }) : <p className="c-dash-empty">Save your pitch, drop your model or a filing, or paste posts about {stock.ticker}. They land here.</p>}
      </motion.section>
    </div>
  );
}

function ReadsHead({ ticker, count, connectionsReady, onScan }: { ticker: string; count: number; connectionsReady: boolean; onScan: () => Promise<number | null> }) {
  const [state, setState] = useState<"idle" | "busy" | string>("idle");
  const run = async () => {
    setState("busy");
    const n = await onScan();
    setState(n === null ? "Couldn't reach the model. Try again in a moment." : n === 0 ? "Nothing new that matters for the position." : "");
  };
  return (
    <>
      <div className="c-dash-head">
        <div className="c-eyebrow">Read-throughs{count ? <span className="c-dash-count">{count}</span> : null}</div>
        {connectionsReady && (
          <button className="c-pill" onClick={run} disabled={state === "busy"} title={`Read everything you've saved for what matters to ${ticker}`}>
            <Radar size={13} /> {state === "busy" ? "Reading your research…" : "Scan my research"}
          </button>
        )}
      </div>
      {state !== "idle" && state !== "busy" && state && <p className="c-stock-note">{state}</p>}
    </>
  );
}
