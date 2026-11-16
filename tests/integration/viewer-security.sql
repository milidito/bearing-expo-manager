-- Security tests for view-only sharing. Runs as the real "authenticated" role with JWT claims,
-- exactly like PostgREST / Supabase Storage do. Any failed check raises an exception.
\set ON_ERROR_STOP 1
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
insert into auth.users values ('cccccccc-0000-4000-8000-000000000003','viewer@example.com') on conflict do nothing;

-- ===== owner A creates data =====
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', false);
insert into public.expo_suppliers (id, user_id, code, company_name, factory_address, factory_city, to_visit, notes, rating, wechat_id, bearing_types, created_at, updated_at)
values ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'BE-001', 'Shared Co', 'SECRET FACTORY ADDRESS', 'Linqing', true, 'my note', 4, 'wx1', '{Spherical}', now(), now()),
       ('11111111-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'BE-002', 'Deleted Co', '', '', false, '', null, '', '{}', now(), now());
update public.expo_suppliers set deleted = true where id = '11111111-0000-4000-8000-000000000002';
insert into public.expo_products (id, user_id, supplier_id, name, created_at, updated_at) values ('22222222-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001','6204',now(),now());
insert into public.expo_quotations (id, user_id, product_id, supplier_id, price, created_at, updated_at) values ('33333333-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','22222222-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001', 1.85, now(), now());
insert into public.expo_photos (id, user_id, supplier_id, kind, created_at, updated_at) values
  ('44444444-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001','booth',now(),now()),
  ('44444444-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000002','booth',now(),now());
insert into storage.objects (bucket_id, name) values
  ('expo-photos','aaaaaaaa-0000-4000-8000-000000000001/44444444-0000-4000-8000-000000000001.jpg'),
  ('expo-photos','aaaaaaaa-0000-4000-8000-000000000001/44444444-0000-4000-8000-000000000002.jpg'),
  ('expo-photos','aaaaaaaa-0000-4000-8000-000000000001/backups/2026-12-10.zip');
-- sharing before adding: viewer is not yet a viewer
select public.expo_add_viewer('viewer@example.com', 'Mehrdad 09122381686');
do $$ begin
  if (select watermark from public.expo_viewers) <> 'Mehrdad 09122381686' then raise exception 'FAIL: watermark not stored'; end if;
  perform public.expo_set_viewer_watermark('cccccccc-0000-4000-8000-000000000003', '  Mehrdad 0912 ');
  if (select watermark from public.expo_viewers) <> 'Mehrdad 0912' then raise exception 'FAIL: owner could not edit watermark'; end if;
  perform public.expo_set_viewer_watermark('cccccccc-0000-4000-8000-000000000003', 'Mehrdad 09122381686');
  if (select count(*) from public.expo_viewers) <> 1 then raise exception 'FAIL: owner should see 1 viewer'; end if;
  if (select count(*) from public.expo_shared_companies()) <> 0 then raise exception 'FAIL: owner is not a viewer of anyone'; end if;
  begin perform public.expo_add_viewer('nobody@example.com'); raise exception 'FAIL: unknown email accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin insert into public.expo_viewers values ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002','x',now());
    raise exception 'FAIL: direct insert into expo_viewers allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- ===== viewer V =====
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated","session_id":"dddddddd-0000-4000-8000-000000000001"}', false);
do $$
declare n int; r record;
begin
  if not public.expo_is_viewer() then raise exception 'FAIL: viewer not detected'; end if;
  -- before claiming the device: nothing visible
  if (select count(*) from public.expo_shared_companies()) <> 0 then raise exception 'FAIL: data visible before device claim'; end if;
  if (select count(*) from storage.objects where bucket_id = 'expo-photos') <> 0 then raise exception 'FAIL: photos visible before device claim'; end if;
  if public.expo_viewer_claim() <> 'ok' then raise exception 'FAIL: first device could not claim'; end if;
  if public.expo_viewer_claim() <> 'ok' then raise exception 'FAIL: same device re-claim failed'; end if;
  -- viewer reads its own watermark but cannot change it
  if (select watermark from public.expo_viewers where viewer_id = 'cccccccc-0000-4000-8000-000000000003') <> 'Mehrdad 09122381686' then raise exception 'FAIL: viewer cannot read its watermark'; end if;
  perform public.expo_set_viewer_watermark('cccccccc-0000-4000-8000-000000000003', 'removed');
  begin update public.expo_viewers set watermark = 'removed';
    get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: viewer could edit expo_viewers'; end if;
  exception when insufficient_privilege then null; end;
  -- no direct table access at all
  if (select count(*) from public.expo_suppliers) <> 0 then raise exception 'FAIL: viewer can read expo_suppliers table'; end if;
  if (select count(*) from public.expo_quotations) <> 0 then raise exception 'FAIL: viewer can read prices'; end if;
  if (select count(*) from public.expo_products) <> 0 then raise exception 'FAIL: viewer can read products'; end if;
  -- only allowed columns, only active companies
  select count(*) into n from public.expo_shared_companies();
  if n <> 1 then raise exception 'FAIL: viewer should see exactly 1 company, saw %', n; end if;
  select * into r from public.expo_shared_companies();
  if r.company_name <> 'Shared Co' or r.notes <> 'my note' or r.rating <> 4 or r.wechat_id <> 'wx1' then raise exception 'FAIL: allowed fields missing'; end if;
  if exists (select 1 from information_schema.routines where routine_name = 'expo_shared_companies')
     and (select pg_get_function_result('public.expo_shared_companies()'::regprocedure)) ~* 'factory|price|to_visit|status'
  then raise exception 'FAIL: hidden column exposed'; end if;
  if (select count(*) from public.expo_shared_photos()) <> 1 then raise exception 'FAIL: viewer should see 1 photo'; end if;
  -- storage: only the photo of the shared, non-deleted company; never backups
  select count(*) into n from storage.objects where bucket_id = 'expo-photos';
  if n <> 1 then raise exception 'FAIL: viewer sees % storage objects (expected 1)', n; end if;
  if not exists (select 1 from storage.objects where name like '%44444444-0000-4000-8000-000000000001.jpg') then raise exception 'FAIL: allowed photo not visible'; end if;
  -- cannot write anything
  begin insert into public.expo_suppliers (id, user_id, code, created_at, updated_at) values (gen_random_uuid(), 'cccccccc-0000-4000-8000-000000000003', 'V-1', now(), now());
    raise exception 'FAIL: viewer could insert';
  exception when insufficient_privilege then null; end;
  update public.expo_suppliers set notes = 'hacked' where id = '11111111-0000-4000-8000-000000000001';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: viewer could update'; end if;
  delete from public.expo_suppliers where id = '11111111-0000-4000-8000-000000000001';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: viewer could delete'; end if;
  begin insert into storage.objects (bucket_id, name) values ('expo-photos', 'cccccccc-0000-4000-8000-000000000003/x.jpg');
    raise exception 'FAIL: viewer could upload';
  exception when insufficient_privilege then null; end;
  if to_regclass('public.suppliers') is not null then  -- Yiwu tables exist in the shared project
    begin execute $q$insert into public.suppliers (id, user_id, code, created_at, updated_at) values (gen_random_uuid(), 'cccccccc-0000-4000-8000-000000000003', 'V-1', now(), now())$q$;
      raise exception 'FAIL: viewer could write Yiwu table';
    exception when insufficient_privilege then null; end;
  end if;
  begin perform public.expo_add_viewer('other@example.com'); raise exception 'FAIL: viewer could share';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform public.expo_remove_viewer('cccccccc-0000-4000-8000-000000000003'); -- viewer can't remove anything (not owner)
end $$;

-- ===== same viewer email + password on a SECOND device (another session) =====
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated","session_id":"dddddddd-0000-4000-8000-000000000002"}', false);
do $$ begin
  if public.expo_viewer_claim() <> 'locked' then raise exception 'FAIL: second device was not refused'; end if;
  if (select count(*) from public.expo_shared_companies()) <> 0 then raise exception 'FAIL: second device sees companies'; end if;
  if (select count(*) from public.expo_shared_photos()) <> 0 then raise exception 'FAIL: second device sees photo list'; end if;
  if (select count(*) from storage.objects where bucket_id = 'expo-photos') <> 0 then raise exception 'FAIL: second device can download photos'; end if;
  perform public.expo_unlock_viewer('cccccccc-0000-4000-8000-000000000003'); -- viewer cannot unlock itself
  if public.expo_viewer_claim() <> 'locked' then raise exception 'FAIL: viewer unlocked itself'; end if;
end $$;
-- a token without a session id gets nothing
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', false);
do $$ begin
  if public.expo_viewer_claim() <> 'no_session' then raise exception 'FAIL: claim without session'; end if;
  if (select count(*) from public.expo_shared_companies()) <> 0 then raise exception 'FAIL: no-session token sees data'; end if;
end $$;
-- owner unlocks -> the second device can take over, the first loses access
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', false);
do $$ begin
  if (select locked_session from public.expo_viewers) <> 'dddddddd-0000-4000-8000-000000000001' then raise exception 'FAIL: lock not recorded'; end if;
  perform public.expo_unlock_viewer('cccccccc-0000-4000-8000-000000000003');
  if (select locked_session from public.expo_viewers) is not null then raise exception 'FAIL: owner could not unlock'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated","session_id":"dddddddd-0000-4000-8000-000000000002"}', false);
do $$ begin
  if public.expo_viewer_claim() <> 'ok' then raise exception 'FAIL: new device could not claim after unlock'; end if;
  if (select count(*) from public.expo_shared_companies()) <> 1 then raise exception 'FAIL: new device sees no data after unlock'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated","session_id":"dddddddd-0000-4000-8000-000000000001"}', false);
do $$ begin
  if public.expo_viewer_claim() <> 'locked' then raise exception 'FAIL: old device still allowed after hand-over'; end if;
  if (select count(*) from public.expo_shared_companies()) <> 0 then raise exception 'FAIL: old device still sees data'; end if;
end $$;

-- watermark unchanged by the viewer's attempts
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', false);
do $$ begin
  if (select watermark from public.expo_viewers) <> 'Mehrdad 09122381686' then raise exception 'FAIL: viewer changed the watermark'; end if;
end $$;

-- ===== stranger B sees nothing =====
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', false);
do $$ begin
  if (select count(*) from public.expo_shared_companies()) <> 0 then raise exception 'FAIL: stranger sees shared data'; end if;
  if (select count(*) from storage.objects where bucket_id = 'expo-photos') <> 0 then raise exception 'FAIL: stranger sees photos'; end if;
end $$;

-- ===== owner revokes =====
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', false);
select public.expo_remove_viewer('cccccccc-0000-4000-8000-000000000003');
do $$ begin
  if (select notes from public.expo_suppliers where id = '11111111-0000-4000-8000-000000000001') <> 'my note' then raise exception 'FAIL: data was changed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', false);
do $$ begin
  if public.expo_is_viewer() then raise exception 'FAIL: still a viewer after removal'; end if;
  if (select count(*) from public.expo_shared_companies()) <> 0 then raise exception 'FAIL: still sees data after removal'; end if;
  if (select count(*) from storage.objects where bucket_id = 'expo-photos') <> 0 then raise exception 'FAIL: still sees photos after removal'; end if;
end $$;
reset role;
select 'VIEWER SECURITY: ALL CHECKS PASSED' as result;
