-- =====================================================================
-- Bearing Expo Manager — Supabase schema (adds to the SAME project as the Yiwu app)
-- Run once in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run (idempotent). Does not touch the Yiwu tables or photos.
--
--  * Tables are prefixed expo_ ; photos go to the private bucket "expo-photos".
--  * Same design as the Yiwu app: device-generated UUIDs (idempotent upserts), soft delete,
--    updated_at = device edit time (conflicts), server_updated_at = server time (download cursor),
--    Row Level Security: every row belongs to auth.uid(); nobody else can read or write it.
-- =====================================================================

create or replace function public.ysm_touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;  -- ownership can never be changed
  end if;
  return new;
end $$;

create table if not exists public.expo_suppliers (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null,
  company_name text not null default '',
  brand text not null default '',
  contact_person text not null default '',
  wechat_id text not null default '',
  whatsapp text not null default '',
  phone text not null default '',
  email text not null default '',
  website text not null default '',
  hall text not null default '',
  booth text not null default '',
  location_notes text not null default '',
  category text not null default '',
  bearing_types text[] not null default '{}',
  bearing_types_other text not null default '',
  factory_address text not null default '',
  factory_city text not null default '',
  to_visit boolean not null default false,
  visited boolean not null default false,
  visit_date date,
  supplier_type text not null default 'unknown',
  status text not null default 'new',
  rating smallint check (rating is null or rating between 1 and 5),
  follow_up_date date,
  follow_up_note text not null default '',
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.expo_products (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplier_id uuid not null,
  name text not null default '',
  category text not null default '',
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.expo_quotations (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null,
  supplier_id uuid not null,
  price numeric(14,4) not null,
  currency text not null default 'CNY',
  unit text not null default 'piece',
  moq integer,
  tier_qty integer,
  quote_date date,
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.expo_photos (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplier_id uuid not null,
  product_id uuid,
  kind text not null,
  caption text not null default '',
  width integer not null default 0,
  height integer not null default 0,
  bytes integer not null default 0,
  mime text not null default 'image/jpeg',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

do $$
declare t text;
begin
  foreach t in array array['expo_suppliers','expo_products','expo_quotations','expo_photos'] loop
    execute format('drop trigger if exists ysm_touch on public.%I', t);
    execute format('create trigger ysm_touch before insert or update on public.%I for each row execute function public.ysm_touch()', t);
    execute format('create index if not exists %I on public.%I (user_id, server_updated_at)', t || '_cursor_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists "owner select" on public.%I', t);
    execute format('drop policy if exists "owner insert" on public.%I', t);
    execute format('drop policy if exists "owner update" on public.%I', t);
    execute format('drop policy if exists "owner delete" on public.%I', t);
    execute format('create policy "owner select" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "owner insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "owner update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "owner delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- private bucket: <user_id>/<photo_id>.jpg and <user_id>/backups/<time>.zip
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expo-photos', 'expo-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','application/zip','application/octet-stream'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "expo photos select" on storage.objects;
drop policy if exists "expo photos insert" on storage.objects;
drop policy if exists "expo photos update" on storage.objects;
drop policy if exists "expo photos delete" on storage.objects;

create policy "expo photos select" on storage.objects for select to authenticated
  using (bucket_id = 'expo-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "expo photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'expo-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "expo photos update" on storage.objects for update to authenticated
  using (bucket_id = 'expo-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'expo-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "expo photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'expo-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
