-- =====================================================================
-- Bearing Expo Manager — Supabase schema (adds to the SAME project as the Yiwu app)
-- Run once in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run (idempotent). Does not touch the Yiwu tables or photos.
--
--  * Tables are prefixed expo_ ; photos go to the private bucket "expo-photos".
--  * Same design as the Yiwu app: device-generated UUIDs (idempotent upserts), soft delete,
--    updated_at = device edit time (conflicts), server_updated_at = server time (download cursor),
--    Row Level Security: every row belongs to auth.uid(); nobody else can read or write it.
--  * View-only sharing: an owner can give another account read-only access (table expo_viewers).
--    Viewers never get table access: they only receive the allowed columns through the functions
--    expo_shared_companies() / expo_shared_photos(), and can download only photos of shared companies.
--    Viewer accounts cannot write anything (all write policies exclude them).
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

-- ---------- view-only sharing ----------
create table if not exists public.expo_viewers (
  owner_id uuid not null references auth.users(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewer_email text not null default '',
  created_at timestamptz not null default now(),
  primary key (owner_id, viewer_id),
  check (owner_id <> viewer_id)
);
alter table public.expo_viewers enable row level security;
drop policy if exists "owner or viewer reads" on public.expo_viewers;
create policy "owner or viewer reads" on public.expo_viewers for select to authenticated
  using (owner_id = (select auth.uid()) or viewer_id = (select auth.uid()));
-- no insert/update/delete policies: changes only through expo_add_viewer / expo_remove_viewer
revoke all on public.expo_viewers from anon;
revoke insert, update, delete on public.expo_viewers from authenticated;
grant select on public.expo_viewers to authenticated;

create or replace function public.expo_is_viewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.expo_viewers where viewer_id = auth.uid())
$$;

-- ---------- tables: RLS + owner-only policies (viewer accounts can never write) ----------
do $$
declare t text;
begin
  foreach t in array array['expo_suppliers','expo_products','expo_quotations','expo_photos'] loop
    execute format('drop trigger if exists ysm_touch on public.%I', t);
    execute format('create trigger ysm_touch before insert or update on public.%I for each row execute function public.ysm_touch()', t);
    execute format('create index if not exists %I on public.%I (user_id, server_updated_at)', t || '_cursor_idx', t);
    execute format('alter table public.%I enable row level security', t);
    -- not FORCE: the table owner (used only by the sharing functions below) must be able to read
    execute format('alter table public.%I no force row level security', t);
    execute format('drop policy if exists "owner select" on public.%I', t);
    execute format('drop policy if exists "owner insert" on public.%I', t);
    execute format('drop policy if exists "owner update" on public.%I', t);
    execute format('drop policy if exists "owner delete" on public.%I', t);
    execute format('create policy "owner select" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "owner insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()) and not (select public.expo_is_viewer()))', t);
    execute format('create policy "owner update" on public.%I for update to authenticated using (user_id = (select auth.uid()) and not (select public.expo_is_viewer())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "owner delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()) and not (select public.expo_is_viewer()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------- sharing functions (return ONLY the columns a viewer may see) ----------
-- Visible to viewers: company, brand, bearing types, hall/booth, contacts, rating, notes, photos.
-- Never sent to viewers: prices/products/quotes, main products text, factory address/city/visit list,
-- status, supplier type, follow-up, location notes, backups.
create or replace function public.expo_shared_companies()
returns table (
  id uuid, owner_id uuid, code text, company_name text, brand text,
  bearing_types text[], bearing_types_other text, hall text, booth text,
  contact_person text, wechat_id text, whatsapp text, phone text, email text, website text,
  rating smallint, notes text, updated_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, s.code, s.company_name, s.brand,
         s.bearing_types, s.bearing_types_other, s.hall, s.booth,
         s.contact_person, s.wechat_id, s.whatsapp, s.phone, s.email, s.website,
         s.rating, s.notes, s.updated_at
  from public.expo_suppliers s
  join public.expo_viewers v on v.owner_id = s.user_id and v.viewer_id = auth.uid()
  where not s.deleted
  order by s.code
$$;

create or replace function public.expo_shared_photos()
returns table (id uuid, owner_id uuid, supplier_id uuid, kind text, width integer, height integer, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.user_id, p.supplier_id, p.kind, p.width, p.height, p.created_at
  from public.expo_photos p
  join public.expo_suppliers s on s.id = p.supplier_id and s.user_id = p.user_id
  join public.expo_viewers v on v.owner_id = p.user_id and v.viewer_id = auth.uid()
  where not p.deleted and not s.deleted
  order by p.created_at
$$;

-- may the signed-in viewer download this storage object? (only photos of shared, non-deleted companies)
create or replace function public.expo_viewer_can_read(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.expo_photos p
    join public.expo_suppliers s on s.id = p.supplier_id and s.user_id = p.user_id
    join public.expo_viewers v on v.owner_id = p.user_id and v.viewer_id = auth.uid()
    where not p.deleted and not s.deleted
      and object_name = p.user_id::text || '/' || p.id::text || '.jpg'
  )
$$;

create or replace function public.expo_add_viewer(p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.expo_is_viewer() then raise exception 'View-only accounts cannot share'; end if;
  select id into v from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v is null then
    raise exception 'No account with this email yet. Create it first in Supabase: Authentication -> Users -> Add user (Auto Confirm).';
  end if;
  if v = auth.uid() then raise exception 'You cannot add yourself as a viewer'; end if;
  if exists (select 1 from public.expo_suppliers where user_id = v) then
    raise exception 'This account has its own data. Use a separate account only for viewing.';
  end if;
  insert into public.expo_viewers (owner_id, viewer_id, viewer_email)
  values (auth.uid(), v, lower(trim(p_email)))
  on conflict (owner_id, viewer_id) do nothing;
  return v;
end $$;

create or replace function public.expo_remove_viewer(p_viewer uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.expo_viewers where owner_id = auth.uid() and viewer_id = p_viewer
$$;

do $$
declare f text;
begin
  foreach f in array array['expo_is_viewer()','expo_shared_companies()','expo_shared_photos()','expo_viewer_can_read(text)','expo_add_viewer(text)','expo_remove_viewer(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- private photo bucket: <user_id>/<photo_id>.jpg and <user_id>/backups/<time>.zip ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expo-photos', 'expo-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','application/zip','application/octet-stream'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "expo photos select" on storage.objects;
drop policy if exists "expo photos viewer select" on storage.objects;
drop policy if exists "expo photos insert" on storage.objects;
drop policy if exists "expo photos update" on storage.objects;
drop policy if exists "expo photos delete" on storage.objects;

create policy "expo photos select" on storage.objects for select to authenticated
  using (bucket_id = 'expo-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "expo photos viewer select" on storage.objects for select to authenticated
  using (bucket_id = 'expo-photos' and public.expo_viewer_can_read(name));
create policy "expo photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'expo-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and not (select public.expo_is_viewer()));
create policy "expo photos update" on storage.objects for update to authenticated
  using (bucket_id = 'expo-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and not (select public.expo_is_viewer()))
  with check (bucket_id = 'expo-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "expo photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'expo-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and not (select public.expo_is_viewer()));

-- ---------- also keep viewer accounts out of the Yiwu tables/photos (if this project has them) ----------
do $$
declare t text;
begin
  foreach t in array array['suppliers','products','quotations','photos'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "owner insert" on public.%I', t);
      execute format('drop policy if exists "owner update" on public.%I', t);
      execute format('drop policy if exists "owner delete" on public.%I', t);
      execute format('create policy "owner insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()) and not (select public.expo_is_viewer()))', t);
      execute format('create policy "owner update" on public.%I for update to authenticated using (user_id = (select auth.uid()) and not (select public.expo_is_viewer())) with check (user_id = (select auth.uid()))', t);
      execute format('create policy "owner delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()) and not (select public.expo_is_viewer()))', t);
    end if;
  end loop;
  if exists (select 1 from storage.buckets where id = 'supplier-photos') then
    drop policy if exists "ysm photos insert" on storage.objects;
    drop policy if exists "ysm photos update" on storage.objects;
    drop policy if exists "ysm photos delete" on storage.objects;
    create policy "ysm photos insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'supplier-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and not (select public.expo_is_viewer()));
    create policy "ysm photos update" on storage.objects for update to authenticated
      using (bucket_id = 'supplier-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and not (select public.expo_is_viewer()))
      with check (bucket_id = 'supplier-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
    create policy "ysm photos delete" on storage.objects for delete to authenticated
      using (bucket_id = 'supplier-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and not (select public.expo_is_viewer()));
  end if;
end $$;
