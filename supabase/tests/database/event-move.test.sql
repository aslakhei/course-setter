-- Moving an event to a newer map version. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('99999999-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cleo@example.com', '{"full_name": "Cleo"}', now(), now()),
  ('99999999-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'mo@example.com', '{"full_name": "Mo"}', now(), now());

create function pg_temp.sign_in(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select pg_temp.sign_in('99999999-0000-0000-0000-000000000001');
select set_config('test.club', public.create_club('Club')::text, true);
reset role;
insert into public.club_members (club_id, user_id) values (current_setting('test.club')::uuid, '99999999-0000-0000-0000-000000000002');
insert into public.maps (id, club_id, name) values
  ('88888888-1111-0000-0000-000000000001', current_setting('test.club')::uuid, 'Skogen'),
  ('88888888-1111-0000-0000-000000000002', current_setting('test.club')::uuid, 'Other');
insert into public.map_versions (id, map_id, club_id, version, kind, status, file_name, original_path, scale) values
  ('88888888-2222-0000-0000-000000000001', '88888888-1111-0000-0000-000000000001', current_setting('test.club')::uuid, 1, 'ocad', 'ready', 'a', 'move-test/1', 15000),
  ('88888888-2222-0000-0000-000000000002', '88888888-1111-0000-0000-000000000001', current_setting('test.club')::uuid, 2, 'ocad', 'ready', 'b', 'move-test/2', 15000),
  ('88888888-2222-0000-0000-000000000003', '88888888-1111-0000-0000-000000000001', current_setting('test.club')::uuid, 3, 'pdf', 'needs_alignment', 'c', 'move-test/3', 15000),
  ('88888888-2222-0000-0000-000000000004', '88888888-1111-0000-0000-000000000002', current_setting('test.club')::uuid, 1, 'ocad', 'ready', 'd', 'move-test/4', 15000);

select pg_temp.sign_in('99999999-0000-0000-0000-000000000001');
select set_config('test.event', public.create_event(current_setting('test.club')::uuid, 'Training', '88888888-2222-0000-0000-000000000001')::text, true);
select results_eq(
  $$ select revision, map_version_id from public.event_revisions $$,
  $$ values (1, '88888888-2222-0000-0000-000000000001'::uuid) $$,
  'the first revision records its map version'
);

select throws_ok(
  $$ select public.move_event_to_version(current_setting('test.event')::uuid, '88888888-2222-0000-0000-000000000003', '{"schemaVersion": 1}', 1) $$,
  '22023', 'not a newer ready version of the same map', 'a version that is not ready is refused'
);
select throws_ok(
  $$ select public.move_event_to_version(current_setting('test.event')::uuid, '88888888-2222-0000-0000-000000000004', '{"schemaVersion": 1}', 1) $$,
  '22023', null, 'a version of another map is refused'
);
select throws_ok(
  $$ select public.move_event_to_version(current_setting('test.event')::uuid, '88888888-2222-0000-0000-000000000002', '{"schemaVersion": 1}', 0) $$,
  'P0001', 'someone else saved this event', 'an out-of-date revision is refused'
);
select is(
  public.move_event_to_version(current_setting('test.event')::uuid, '88888888-2222-0000-0000-000000000002', '{"schemaVersion": 1, "controls": [], "courses": [], "moved": true}', 1),
  2,
  'moving to a newer ready version returns the next revision'
);
select results_eq(
  $$ select map_version_id, doc ->> 'moved' from public.events $$,
  $$ values ('88888888-2222-0000-0000-000000000002'::uuid, 'true') $$,
  'the event now uses the new version with the moved document'
);
select throws_ok(
  $$ select public.move_event_to_version(current_setting('test.event')::uuid, '88888888-2222-0000-0000-000000000001', '{"schemaVersion": 1}', 2) $$,
  '22023', null, 'an event cannot move back to an older version'
);
select is(public.save_event(current_setting('test.event')::uuid, '{"schemaVersion": 1}', 2), 3, 'saving afterwards works as before');
select results_eq(
  $$ select revision, map_version_id from public.event_revisions order by revision $$,
  $$ values (1, '88888888-2222-0000-0000-000000000001'::uuid), (2, '88888888-2222-0000-0000-000000000002'::uuid), (3, '88888888-2222-0000-0000-000000000002'::uuid) $$,
  'every revision records the map version its positions refer to'
);
reset role;

select pg_temp.sign_in('99999999-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.move_event_to_version(current_setting('test.event')::uuid, '88888888-2222-0000-0000-000000000002', '{"schemaVersion": 1}', 3) $$,
  '42501', null, 'a member without access to the event cannot move it'
);
reset role;

select * from finish();
rollback;
