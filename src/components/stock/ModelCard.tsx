"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Plus, X } from "lucide-react";
import { Tile } from "./Charts";
import { money, pct, times } from "./useStock";
import { blankModel, forwardYear, impliedAt, multiplesOn } from "@/lib/valuation";
import type { ModelYear, StockModel } from "@/lib/graph";

type Line = { key: keyof Omit<ModelYear, "label">; label: string; unit: string };
const LINES: Line[] = [
  { key: "revenue", label: "Revenue", unit: "m" },
  { key: "ebitda", label: "EBITDA", unit: "m" },
  { key: "eps", label: "EPS", unit: "" },
  { key: "fcf", label: "Free cash flow", unit: "m" },
];

// The investor's forecast for one stock, and what the current price means on those numbers:
// forward multiples, the gap to their target, and the price their numbers imply at the
// multiples the market has paid in the past.
export default function ModelCard({ ticker, model, marketPrice, currency, history, period, source, onSave, onOpenSource }: {
  ticker: string; model?: StockModel; marketPrice: number | null; currency: string;
  history: { pe?: number | null; evEbitda?: number | null; ps?: number | null } | null; period: string;
  source?: { id: string; title: string }; onSave: (m: StockModel | undefined) => void; onOpenSource: (id: string) => void;
}) {
  const cur = model?.currency || currency;
  const unit = cur === "USD" ? "$m" : `${cur}m`;
  if (!model) {
    return (
      <section className="c-dash-card c-model">
        <div className="c-dash-head"><div className="c-eyebrow">On your numbers</div></div>
        <p className="c-dash-empty">Drop your Excel model for {ticker} anywhere on the page and its forecast fills in here, or type your numbers. You&apos;ll see what {ticker} trades at on your estimates and what they&apos;re worth at the multiples the market has paid before.</p>
        <button className="c-btn c-btn-ghost" onClick={() => onSave(blankModel())}><Plus size={15} /> Type my numbers</button>
      </section>
    );
  }

  const price = marketPrice ?? model.price ?? null;
  const save = (patch: Partial<StockModel>) => onSave({ ...model, ...patch });
  const setYear = (i: number, patch: Partial<ModelYear>) => save({ years: model.years.map((y, k) => (k === i ? { ...y, ...patch } : y)) });
  const rows = price ? multiplesOn(model, price) : [];
  const fwd = forwardYear(model.years);
  const fwdRow = rows.find(r => r.label === fwd?.label);
  const implied = price && history ? impliedAt(model, price, history, period) : [];
  const upside = price && model.target ? model.target / price - 1 : null;

  return (
    <section className="c-dash-card c-model">
      <div className="c-dash-head">
        <div className="c-eyebrow">On your numbers</div>
        {source && (
          <button className="c-model-source" onClick={() => onOpenSource(source.id)} title="Open the model this came from">
            <FileSpreadsheet size={13} /> {source.title}
          </button>
        )}
      </div>

      {price && fwd ? (
        <p className="c-model-headline">
          At {money(price, cur)}{marketPrice === null ? " (the price in your model)" : ""}, {ticker} trades at{" "}
          {fwdRow?.pe ? <><b>{times(fwdRow.pe)}</b> your {fwd.label} EPS</> : null}
          {fwdRow?.pe && fwdRow?.evEbitda ? " and " : null}
          {fwdRow?.evEbitda ? <><b>{times(fwdRow.evEbitda)}</b> {fwd.label} EV/EBITDA</> : null}
          {!fwdRow?.pe && !fwdRow?.evEbitda ? <>… add {fwd.label} EPS, or EBITDA with shares, to see it</> : null}
          {fwdRow?.fcfYield ? <>, with a free cash flow yield of <b>{(fwdRow.fcfYield * 100).toFixed(1)}%</b></> : null}.
        </p>
      ) : (
        <p className="c-model-headline">Add a price to your model, or switch on price data, to see what {ticker} trades at on these numbers.</p>
      )}

      {(upside !== null || implied.length > 0) && (
        <div className="c-stock-tiles c-model-tiles">
          {upside !== null && <Tile label={`to your ${money(model.target!, cur)} target`} value={pct(upside)} tone={upside >= 0 ? "up" : "down"} />}
          {implied.map(x => (
            <Tile key={x.multiple} label={`${pct(x.upside)} at the ${period} avg ${times(x.at)} ${x.multiple}`} value={money(x.price, cur)} tone={x.upside >= 0 ? "up" : "down"} />
          ))}
        </div>
      )}

      <div className="c-model-scroll">
        <table className="c-model-table">
          <thead>
            <tr>
              <th scope="col"><span className="c-sr">Line</span></th>
              {model.years.map((y, i) => (
                <th key={i} scope="col">
                  <span className="c-model-year">
                    <Cell text value={y.label} onCommit={v => setYear(i, { label: String(v || y.label) })} label={`Year ${i + 1}`} />
                    {model.years.length > 1 && (
                      <button className="c-model-x" aria-label={`Remove ${y.label}`} onClick={() => save({ years: model.years.filter((_, k) => k !== i) })}><X size={11} /></button>
                    )}
                  </span>
                </th>
              ))}
              <th className="c-model-add">
                {model.years.length < 8 && (
                  <button className="c-icon-btn" aria-label="Add a year" title="Add a year" onClick={() => {
                    const last = model.years.at(-1)?.label ?? "";
                    const n = Number(last.match(/(19|20)\d{2}/)?.[0]);
                    save({ years: [...model.years, { label: n ? `${n + 1}E` : "" }] });
                  }}><Plus size={14} /></button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {LINES.map(l => (
              <tr key={l.key}>
                <th scope="row">{l.label}{l.unit && <span className="c-model-unit"> {unit}</span>}</th>
                {model.years.map((y, i) => (
                  <td key={i}><Cell value={y[l.key]} onCommit={v => setYear(i, { [l.key]: v })} label={`${l.label} ${y.label}`} digits={l.key === "eps" ? 2 : 0} /></td>
                ))}
                <td />
              </tr>
            ))}
            {rows.length > 0 && (
              <>
                <tr className="c-model-sep"><td colSpan={model.years.length + 2} /></tr>
                {([["pe", "P/E"], ["evEbitda", "EV/EBITDA"], ["ps", "P/S"], ["fcfYield", "FCF yield"]] as const).map(([k, label]) => (
                  <tr key={k} className="c-model-out">
                    <th scope="row">{label}</th>
                    {rows.map((r, i) => {
                      const v = r[k];
                      return <td key={i}>{v === null ? "—" : k === "fcfYield" ? `${(v * 100).toFixed(1)}%` : times(v)}</td>;
                    })}
                    <td />
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      <div className="c-model-inputs">
        <label>Diluted shares (m)<Cell value={model.shares} onCommit={v => save({ shares: v as number | undefined })} label="Diluted shares in millions" /></label>
        <label>Net debt ({unit})<Cell value={model.netDebt} onCommit={v => save({ netDebt: v as number | undefined })} label="Net debt in millions" /></label>
        <label>Price target<Cell value={model.target} onCommit={v => save({ target: v as number | undefined })} label="Price target" digits={2} /></label>
        {marketPrice === null && <label>Price<Cell value={model.price} onCommit={v => save({ price: v as number | undefined })} label="Share price" digits={2} /></label>}
      </div>
      <p className="c-stock-note">
        Every number is editable. Net debt is negative for net cash. Multiples use {marketPrice !== null ? "the latest close" : "the price above"}.
        <button className="c-link-btn" onClick={() => onSave(undefined)}>Clear numbers</button>
      </p>
    </section>
  );
}

// A number (or label) that reads as plain text and edits in place; commits on blur or Enter.
function Cell({ value, onCommit, label, digits = 0, text }: {
  value: number | string | undefined; onCommit: (v: number | string | undefined) => void; label: string; digits?: number; text?: boolean;
}) {
  const shown = value === undefined || value === "" ? "" : typeof value === "number"
    ? value.toLocaleString(undefined, { maximumFractionDigits: Math.max(digits, Math.abs(value) < 10 ? 2 : 0) }) : value;
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; setDraft(null); return; }
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    if (text) { if (raw !== value) onCommit(raw); return; }
    if (!raw) { if (value !== undefined) onCommit(undefined); return; }
    const neg = /^\(.*\)$/.test(raw) || raw.startsWith("-") || raw.startsWith("−");
    const n = Number(raw.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && raw.replace(/[^\d]/g, "")) {
      const v = neg ? -n : n;
      if (v !== value) onCommit(v);
    }
  };
  return (
    <input className={"c-model-cell" + (text ? " is-text" : "")} aria-label={label} inputMode={text ? "text" : "decimal"}
      value={draft ?? shown} placeholder="—"
      onFocus={e => { setDraft(shown); e.currentTarget.select(); }}
      onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { cancelled.current = true; (e.target as HTMLInputElement).blur(); } }} />
  );
}
