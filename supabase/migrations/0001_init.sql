-- Constellation: one row per bubble and per saved item, owned by the signed-in user.
-- ids are client-generated strings so the UI can create rows optimistically.

create table if not exists public.bubbles (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  name       text not null,
  parent_id  text,
  hue        integer not null default 248,
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.items (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  bubble_id  text not null,
  title      text not null default '',
  summary    text not null default '',
  url        text not null default '',
  source     text not null default 'Note',
  raw        text not null default '',
  created_at bigint not null,
  primary key (user_id, id)
);

create index if not exists items_user_bubble on public.items (user_id, bubble_id);

alter table public.bubbles enable row level security;
alter table public.items   enable row level security;

create policy "own bubbles" on public.bubbles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own items" on public.items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
