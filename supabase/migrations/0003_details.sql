-- Note details for sorting and for analyst-style connections: when the article or post
-- came out, what kind of note it is, which tickers it's about, and what it means for the
-- stocks the investor covers. Deductions gain a kind and a suggested next step. Stocks
-- covered as their own planets keep a ticker, a long or short stance and the investor's
-- model numbers. Safe to run more than once.

alter table public.items add column if not exists published_at text;
alter table public.items add column if not exists kind text;
alter table public.items add column if not exists tickers jsonb not null default '[]'::jsonb;
alter table public.items add column if not exists reads jsonb not null default '[]'::jsonb;

alter table public.insights add column if not exists kind text;
alter table public.insights add column if not exists next_step text;

alter table public.bubbles add column if not exists ticker text;
alter table public.bubbles add column if not exists stance text;
alter table public.bubbles add column if not exists model jsonb;
