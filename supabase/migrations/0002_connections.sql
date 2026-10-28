-- Connections engine: key facts per item, bonds between items, and AI deductions.

alter table public.items add column if not exists facts jsonb not null default '[]'::jsonb;
alter table public.items add column if not exists linked_at bigint;

create table if not exists public.links (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  a          text not null,
  b          text not null,
  strength   integer not null default 1,
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

alter table public.links    enable row level security;
alter table public.insights enable row level security;

create policy "own links" on public.links
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own insights" on public.insights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
