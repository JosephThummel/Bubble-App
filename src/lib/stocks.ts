import "server-only";

// Price and valuation history from Financial Modeling Prep (FMP). Needs FMP_API_KEY.
// The free plan covers US stocks with end-of-day prices; paid plans add more history and markets.

const API = process.env.FMP_API_BASE || "https://financialmodelingprep.com/stable";
export const stocksEnabled = () => !!process.env.FMP_API_KEY;

export type Multiple = { date: string; pe: number | null; evEbitda: number | null; ps: number | null };
export type Stock = {
  symbol: string; name: string; currency: string; exchange: string; sector: string;
  price: number | null; marketCap: number | null;
  prices: [string, number][]; // [date, close], oldest first
  multiples: Multiple[]; // daily, from each day's price and the trailing twelve months reported by then
  basis: "quarterly" | "annual" | null; // what the trailing figures were built from
};

type Row = Record<string, unknown>;
const num = (...vals: unknown[]) => {
  for (const v of vals) if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
};
// a multiple on losses or a tiny denominator says nothing on a chart
const sane = (v: number) => (Number.isFinite(v) && v > 0 && v < 500 ? Math.round(v * 10) / 10 : null);
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

async function get(path: string, params: Record<string, string>): Promise<Row[] | null> {
  const qs = new URLSearchParams({ ...params, apikey: process.env.FMP_API_KEY! });
  const res = await fetch(`${API}/${path}?${qs}`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(15000) });
  if ([401, 402, 403].includes(res.status)) return null; // not on this plan
  if (!res.ok) throw new Error(`FMP ${path} ${res.status}`);
  const j = await res.json();
  return Array.isArray(j) ? (j as Row[]) : null;
}

type Period = { date: string; eps: number | null; revenue: number | null; ebitda: number | null; shares: number | null; netDebt: number | null };

// Trailing-twelve-month figures as of each reported period: the sum of the last four quarters,
// or the year itself when only annual statements are available.
function trailing(periods: Period[], quarterly: boolean): Period[] {
  if (!quarterly) return periods;
  const sum = (xs: (number | null)[]) => (xs.every(x => x !== null) ? xs.reduce((a, b) => a! + b!, 0) : null);
  return periods.slice(3).map((p, k) => {
    const four = periods.slice(k, k + 4);
    return { ...p, eps: sum(four.map(x => x.eps)), revenue: sum(four.map(x => x.revenue)), ebitda: sum(four.map(x => x.ebitda)) };
  });
}

export async function fetchStock(symbol: string): Promise<Stock | null> {
  const from = new Date(Date.now() - 5 * 365.25 * 864e5).toISOString().slice(0, 10);
  const [profile, prices] = await Promise.all([
    get("profile", { symbol }),
    get("historical-price-eod/light", { symbol, from }),
  ]);
  if (!prices?.length) return null;

  // Quarterly statements where the plan allows, annual otherwise.
  const statements = async (period?: string) => Promise.all([
    get("income-statement", { symbol, limit: period ? "28" : "7", ...(period ? { period } : {}) }).catch(() => null),
    get("balance-sheet-statement", { symbol, limit: period ? "28" : "7", ...(period ? { period } : {}) }).catch(() => null),
  ]);
  let quarterly = true;
  let [income, balance] = await statements("quarter");
  if (!income?.length) { quarterly = false; [income, balance] = await statements(); }

  const debt = new Map((balance ?? []).map(r => [String(r.date), (num(r.totalDebt) ?? 0) - (num(r.cashAndCashEquivalents, r.cashAndShortTermInvestments) ?? 0)]));
  const periods: Period[] = (income ?? [])
    .map(r => ({
      date: String(r.date),
      eps: num(r.epsDiluted, r.epsdiluted, r.eps),
      revenue: num(r.revenue),
      ebitda: num(r.ebitda),
      shares: num(r.weightedAverageShsOutDil, r.weightedAverageShsOut),
      netDebt: debt.get(String(r.date)) ?? null,
    }))
    .filter(p => isDate(p.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const ttm = trailing(periods, quarterly);

  const series = prices
    .map(r => [String(r.date), num(r.price, r.close)] as [string, number | null])
    .filter((x): x is [string, number] => x[1] !== null && isDate(x[0]))
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Each day's multiple uses that day's price and the latest trailing figures reported by then.
  const multiples: Multiple[] = [];
  let k = -1;
  for (const [date, price] of series) {
    while (k + 1 < ttm.length && ttm[k + 1].date <= date) k++;
    if (k < 0) continue;
    const t = ttm[k];
    const cap = t.shares ? price * t.shares : null;
    multiples.push({
      date,
      pe: t.eps ? sane(price / t.eps) : null,
      ps: cap && t.revenue ? sane(cap / t.revenue) : null,
      evEbitda: cap && t.ebitda ? sane((cap + (t.netDebt ?? 0)) / t.ebitda) : null,
    });
  }

  const p = profile?.[0] ?? {};
  const hasMultiples = multiples.some(m => m.pe ?? m.ps ?? m.evEbitda);
  return {
    symbol, name: String(p.companyName ?? symbol), currency: String(p.currency ?? "USD"),
    exchange: String(p.exchange ?? p.exchangeShortName ?? ""), sector: String(p.sector ?? ""),
    price: num(p.price) ?? series.at(-1)?.[1] ?? null, marketCap: num(p.marketCap, p.mktCap),
    prices: series, multiples: hasMultiples ? multiples : [], basis: hasMultiples ? (quarterly ? "quarterly" : "annual") : null,
  };
}
