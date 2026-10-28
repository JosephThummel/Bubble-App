-- Connections engine: key facts per item, bonds between items, and AI deductions.
-- Also tightens the policies from 0001. Safe to run more than once.

alter table public.items add column if not exists facts jsonb not null default '[]'::jsonb;
alter table public.items add column if not exists linked_at bigint;

create table if not exists public.links (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  a          text not null,
  b          text not null,
  strength   integer not null default 1 check (strength between 1 and 3),
  label      text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.insights (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  item_ids   jsonb not null default '[]'::jsonb,
  title      text not null default '',
  body       text not null default '',
  created_at bigint not null,
  primary key (user_id, id)
);

alter table public.bubbles  enable row level security;
alter table public.items    enable row level security;
alter table public.links    enable row level security;
alter table public.insights enable row level security;

-- Newer projects don't expose new tables to the app automatically, so grant
-- signed-in users access explicitly; the policies below limit them to their own rows.
grant select, insert, update, delete on public.bubbles, public.items, public.links, public.insights to authenticated;
revoke all on public.bubbles, public.items, public.links, public.insights from anon;

-- Signed-in users only, and only their own rows. (select auth.uid()) is evaluated once per query, not per row.
drop policy if exists "own bubbles" on public.bubbles;
drop policy if exists "own items" on public.items;
drop policy if exists "own links" on public.links;
drop policy if exists "own insights" on public.insights;

create policy "own bubbles" on public.bubbles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own items" on public.items for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own links" on public.links for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own insights" on public.insights for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
