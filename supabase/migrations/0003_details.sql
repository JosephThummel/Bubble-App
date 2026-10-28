-- Note details for sorting and for analyst-style connections: when the article or post
-- came out, what kind of note it is, and which tickers it's about. Deductions gain a kind
-- and a suggested next step. Safe to run more than once.

alter table public.items add column if not exists published_at text;
alter table public.items add column if not exists kind text;
alter table public.items add column if not exists tickers jsonb not null default '[]'::jsonb;

alter table public.insights add column if not exists kind text;
alter table public.insights add column if not exists next_step text;
