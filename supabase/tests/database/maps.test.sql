-- Maps, map versions and the upload flow. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Ada: admin of Club X. Mo: member of X. Oz: admin of Club Y only.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ada@example.com', '{"full_name": "Ada"}', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'mo@example.com', '{"full_name": "Mo"}', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'oz@example.com', '{"full_name": "Oz"}', now(), now());

create function pg_temp.sign_in(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.setting(name text) returns text language sql as $$ select current_setting('test.' || name) $$;
grant execute on function pg_temp.setting(text) to authenticated;

select pg_temp.sign_in('bbbbbbbb-0000-0000-0000-000000000003');
select set_config('test.club_y', public.create_club('Club Y')::text, true);
reset role;
select pg_temp.sign_in('bbbbbbbb-0000-0000-0000-000000000001');
select set_config('test.club_x', public.create_club('Club X')::text, true);
reset role;
insert into public.club_members (club_id, user_id) values (pg_temp.setting('club_x')::uuid, 'bbbbbbbb-0000-0000-0000-000000000002');

-- Starting an upload.
select pg_temp.sign_in('bbbbbbbb-0000-0000-0000-000000000001');
create temp table up as
  select * from public.start_map_upload(pg_temp.setting('club_x')::uuid, 'Skogen.ocd', 'ocad', map_name => ' Skogen ');
reset role;
select set_config('test.v1', (select version_id::text from up), true);
select set_config('test.path1', (select upload_path from up), true);
select set_config('test.map', (select map_id::text from public.map_versions where id = pg_temp.setting('v1')::uuid), true);

select results_eq(
  $$ select m.name, v.version, v.status::text, v.kind::text, v.scale from public.map_versions v join public.maps m on m.id = v.map_id
     where v.id = pg_temp.setting('v1')::uuid $$,
  $$ values ('Skogen', 1, 'uploading', 'ocad', null::integer) $$,
  'start_map_upload creates the map and its first version, waiting for the file'
);
select is(
  pg_temp.setting('path1'),
  pg_temp.setting('club_x') || '/' || pg_temp.setting('map') || '/' || pg_temp.setting('v1') || '/original.ocd',
  'the upload path is <club>/<map>/<version>/original.ocd'
);

select pg_temp.sign_in('bbbbbbbb-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.start_map_upload(pg_temp.setting('club_x')::uuid, 'Old.pdf', 'pdf', map_name => 'Old') $$,
  '22023', null, 'a PDF map needs its scale'
);
select throws_ok(
  $$ select public.start_map_upload(pg_temp.setting('club_x')::uuid, 'X.ocd', 'ocad', map_name => 'X', scale => 10000) $$,
  '22023', null, 'an OCAD map does not take a scale'
);
select throws_ok(
  $$ select public.start_map_upload(pg_temp.setting('club_x')::uuid, 'X.ocd', 'ocad', map_name => '  ') $$,
  '23514', null, 'a new map needs a name'
);
select throws_ok(
  $$ select public.finish_map_upload(pg_temp.setting('v1')::uuid) $$,
  '22023', 'the map file has not been uploaded', 'finishing before the file is there fails'
);
-- Uploads: only to the handed-out path.
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('map-originals', pg_temp.setting('club_x') || '/' || pg_temp.setting('map') || '/other/original.ocd') $$,
  '42501', null, 'an admin cannot upload to any other path'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('map-originals', pg_temp.setting('path1')) $$,
  'an admin can upload the file to the handed-out path'
);
select lives_ok($$ select public.finish_map_upload(pg_temp.setting('v1')::uuid) $$, 'finishing after the upload works');
select throws_ok(
  $$ select public.finish_map_upload(pg_temp.setting('v1')::uuid) $$,
  '22023', null, 'an upload is finished only once'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('map-originals', pg_temp.setting('path1') || '.again') $$,
  '42501', null, 'nothing more can be uploaded once processing has started'
);
reset role;

select results_eq(
  $$ select v.status::text, j.type, j.payload from public.map_versions v join public.jobs j on j.payload ->> 'map_version_id' = v.id::text
     where v.id = pg_temp.setting('v1')::uuid $$,
  $$ values ('processing', 'process_map_version', jsonb_build_object('map_version_id', pg_temp.setting('v1'))) $$,
  'finishing queues a processing job'
);

-- Members do not see the map until a version is ready.
select pg_temp.sign_in('bbbbbbbb-0000-0000-0000-000000000002');
select is_empty($$ select * from public.maps $$, 'a member does not see a map that is still processing');
select is_empty($$ select * from public.map_versions $$, 'a member does not see versions that are not ready');
select throws_ok(
  $$ select public.start_map_upload(pg_temp.setting('club_x')::uuid, 'Mine.ocd', 'ocad', map_name => 'Mine') $$,
  '42501', null, 'a member cannot upload maps'
);
reset role;

update public.map_versions set status = 'ready', scale = 15000 where id = pg_temp.setting('v1')::uuid;

select pg_temp.sign_in('bbbbbbbb-0000-0000-0000-000000000002');
select results_eq($$ select name from public.maps $$, $$ values ('Skogen') $$, 'a member sees a map once a version is ready');
select results_eq($$ select version from public.map_versions $$, $$ values (1) $$, 'and its ready version');
select is_empty($$ update public.maps set name = 'Mine' returning 1 $$, 'a member cannot rename a map');
select throws_ok($$ update public.map_versions set status = 'failed' $$, '42501', null, 'nobody edits versions directly');
select throws_ok($$ select public.delete_map_version(pg_temp.setting('v1')::uuid) $$, '42501', null, 'a member cannot delete a version');
reset role;

-- A second version of the same map; an admin of another club cannot touch it.
select pg_temp.sign_in('bbbbbbbb-0000-0000-0000-000000000001');
create temp table up2 as
  select * from public.start_map_upload(pg_temp.setting('club_x')::uuid, 'Skogen-2.pdf', 'pdf', map_id => pg_temp.setting('map')::uuid, scale => 15000);
select results_eq(
  $$ select v.version, v.scale from up2 join public.map_versions v on v.id = up2.version_id $$,
  $$ values (2, 15000) $$,
  'a new version of a map gets the next number and keeps the given scale'
);
select results_eq(
  $$ select upload_path like '%/original.pdf' from public.start_map_upload(pg_temp.setting('club_x')::uuid, 'Skogen-3.pdf', 'pdf', map_id => pg_temp.setting('map')::uuid, scale => 15000) $$,
  $$ values (true) $$,
  'a PDF version uploads to original.pdf'
);
select is(
  (select count(*) from public.map_versions where map_id = pg_temp.setting('map')::uuid),
  3::bigint,
  'an admin sees all versions, also those still uploading'
);
select results_eq(
  $$ update public.maps set name = 'Skogen 2026' where id = pg_temp.setting('map')::uuid returning name $$,
  $$ values ('Skogen 2026') $$,
  'an admin can rename a map'
);
reset role;

select pg_temp.sign_in('bbbbbbbb-0000-0000-0000-000000000003');
select is_empty($$ select * from public.maps $$, 'an admin of another club sees none of the maps');
select throws_ok(
  $$ select public.start_map_upload(pg_temp.setting('club_y')::uuid, 'X.ocd', 'ocad', map_id => pg_temp.setting('map')::uuid) $$,
  '42501', null, 'a map of another club cannot get a version through your own club'
);
select throws_ok(
  $$ select public.start_map_upload(pg_temp.setting('club_x')::uuid, 'X.ocd', 'ocad', map_name => 'X') $$,
  '42501', null, 'you cannot upload to a club you are not admin of'
);
select throws_ok($$ select public.finish_map_upload(pg_temp.setting('v1')::uuid) $$, '42501', null, 'nor finish its uploads');
select throws_ok($$ select public.delete_map_version(pg_temp.setting('v1')::uuid) $$, '42501', null, 'nor delete its versions');
reset role;

-- Deleting.
select pg_temp.sign_in('bbbbbbbb-0000-0000-0000-000000000001');
select lives_ok($$ select public.delete_map_version(pg_temp.setting('v1')::uuid) $$, 'an admin can delete a version');
select is(
  (select count(*) from public.map_versions where id = pg_temp.setting('v1')::uuid),
  0::bigint,
  'a deleted version disappears at once'
);
select throws_ok($$ select public.delete_map_version(pg_temp.setting('v1')::uuid) $$, '42501', null, 'a version is deleted only once');
reset role;
select results_eq(
  $$ select v.status::text, j.type from public.map_versions v join public.jobs j on j.payload ->> 'map_version_id' = v.id::text
     where v.id = pg_temp.setting('v1')::uuid and j.type = 'delete_map_version' $$,
  $$ values ('deleted', 'delete_map_version') $$,
  'deleting queues a job that removes the files'
);

-- Not signed in: nothing.
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select * from public.maps $$, '42501', null, 'anonymous visitors cannot read maps');
select throws_ok($$ select * from public.map_versions $$, '42501', null, 'anonymous visitors cannot read map versions');
select throws_ok(
  $$ select public.start_map_upload(gen_random_uuid(), 'x.ocd', 'ocad', map_name => 'x') $$,
  '42501', null, 'anonymous visitors cannot upload'
);
reset role;

select * from finish();
rollback;
