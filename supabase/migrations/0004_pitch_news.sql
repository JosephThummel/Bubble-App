-- News watch for saved pitches: an AI agent that scans the news on each company you've saved a
-- pitch on (price-moving news, press releases, filings, analyst moves) and says what it means for
-- the pitch. Pitch ideas you haven't saved are not watched. Safe to run more than once.

-- Per pitch: whether to email new findings, and when the agent last looked.
alter table public.bubbles add column if not exists news_email boolean not null default false;
alter table public.bubbles add column if not exists news_checked_at bigint;

-- What the agent found. kind "take" rows are its running feedback on the pitch as a whole;
-- every other row is one news story with the agent's take on it.
create table if not exists public.pitch_news (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id           text not null,
  bubble_id    text not null,
  ticker       text not null,
  kind         text not null default 'other',
  headline     text not null default '',
  url          text not null default '',
  source       text not null default '',
  published_at text,
  summary      text not null default '',
  take         text not null default '',
  impact       text not null default 'neutral',
  importance   integer not null default 1,
  created_at   bigint not null,
  emailed_at   bigint,
  primary key (user_id, id)
);

create index if not exists pitch_news_user_bubble on public.pitch_news (user_id, bubble_id, created_at desc);

alter table public.pitch_news enable row level security;
grant select, insert, update, delete on public.pitch_news to authenticated;
revoke all on public.pitch_news from anon;

drop policy if exists "own pitch news" on public.pitch_news;
create policy "own pitch news" on public.pitch_news for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
