import type { ModelYear, StockModel } from "@/lib/storage";

// What the stock trades at on the investor's own numbers. Money in millions, per-share in units.

export type YearMultiples = { label: string; pe: number | null; evEbitda: number | null; ps: number | null; fcfYield: number | null };
export type Implied = { label: string; multiple: string; at: number; price: number; upside: number };

const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const ratio = (a: number | null, b: number | undefined) => (ok(a) && ok(b) && b > 0 && a > 0 ? a / b : null);

// "2027E", "FY27", "FY2027", "2027" → 2027
export function yearOf(label: string): number | null {
  const full = label.match(/(19|20)\d{2}/)?.[0];
  if (full) return Number(full);
  const short = label.match(/FY\s*'?(\d{2})\b/i)?.[1];
  return short ? 2000 + Number(short) : null;
}

// The year an investor would quote a forward multiple on: next calendar year if the model has
// it, else the latest year it has.
export function forwardYear(years: ModelYear[], today = new Date()): ModelYear | undefined {
  const next = today.getFullYear() + 1;
  return years.find(y => (yearOf(y.label) ?? 0) >= next) ?? years.at(-1);
}

export function multiplesOn(model: StockModel, price: number): YearMultiples[] {
  const cap = ok(model.shares) ? price * model.shares : null;
  const ev = cap !== null ? cap + (model.netDebt ?? 0) : null;
  return model.years.map(y => ({
    label: y.label,
    pe: ratio(price, y.eps),
    evEbitda: ratio(ev, y.ebitda),
    ps: ratio(cap, y.revenue),
    fcfYield: cap && ok(y.fcf) ? y.fcf / cap : null,
  }));
}

// The price the investor's forward numbers are worth at the multiples the market has paid.
export function impliedAt(model: StockModel, price: number, history: { pe?: number | null; evEbitda?: number | null; ps?: number | null }, period: string): Implied[] {
  const y = forwardYear(model.years);
  if (!y) return [];
  const out: Implied[] = [];
  const add = (multiple: string, at: number | null | undefined, value: number | null) => {
    if (!ok(at) || !ok(value) || value <= 0) return;
    out.push({ label: `${period} average ${multiple}`, multiple, at, price: value, upside: value / price - 1 });
  };
  add("P/E", history.pe, ok(y.eps) && ok(history.pe) ? history.pe * y.eps : null);
  if (ok(model.shares) && model.shares > 0) {
    add("EV/EBITDA", history.evEbitda, ok(y.ebitda) && ok(history.evEbitda) ? (history.evEbitda * y.ebitda - (model.netDebt ?? 0)) / model.shares : null);
    add("P/S", history.ps, ok(y.revenue) && ok(history.ps) ? (history.ps * y.revenue) / model.shares : null);
  }
  return out;
}

export const blankModel = (today = new Date()): StockModel => {
  const y = today.getFullYear();
  return { years: [y, y + 1, y + 2].map(n => ({ label: `${n}E` })), updatedAt: Date.now() };
};
