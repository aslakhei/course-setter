-- Setting a map version's details (contour interval, mapper, year). Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('cccccccc-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ada@example.com', '{"full_name": "Ada"}', now(), now()),
  ('cccccccc-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'mo@example.com', '{"full_name": "Mo"}', now(), now()),
  ('cccccccc-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'eve@example.com', '{"full_name": "Eve"}', now(), now());

create function pg_temp.sign_in(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Ada is admin, Mo a member; Eve is in no club.
select pg_temp.sign_in('cccccccc-0000-0000-0000-000000000001');
select set_config('test.club', public.create_club('Club')::text, true);
reset role;
insert into public.club_members (club_id, user_id) values (current_setting('test.club')::uuid, 'cccccccc-0000-0000-0000-000000000002');
insert into public.maps (id, club_id, name) values ('dddddddd-0000-0000-0000-000000000001', current_setting('test.club')::uuid, 'Skogen');
insert into public.map_versions (id, map_id, club_id, version, kind, status, file_name, original_path, scale) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', current_setting('test.club')::uuid, 1, 'ocad', 'ready', 'a.ocd', 'p1', 15000);

select pg_temp.sign_in('cccccccc-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.set_map_version_details('eeeeeeee-0000-0000-0000-000000000001', 5, 'Mo', 2024) $$,
  '42501', null, 'members cannot set map details'
);
select pg_temp.sign_in('cccccccc-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.set_map_version_details('eeeeeeee-0000-0000-0000-000000000001', 5, 'Eve', 2024) $$,
  '42501', null, 'outsiders cannot set map details'
);
reset role;

select pg_temp.sign_in('cccccccc-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.set_map_version_details('eeeeeeee-0000-0000-0000-000000000001', 2.5, '  Ola Mapper  ', 2024) $$,
  'admins set map details'
);
select results_eq(
  $$ select contour_interval, mapper, map_year::integer from public.map_versions where id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  $$ values (2.5::numeric(4, 1), 'Ola Mapper', 2024) $$,
  'the details are saved, the mapper trimmed'
);
select throws_ok(
  $$ select public.set_map_version_details('eeeeeeee-0000-0000-0000-000000000001', 100, null, null) $$,
  '23514', null, 'a contour interval out of range is refused'
);
select lives_ok(
  $$ select public.set_map_version_details('eeeeeeee-0000-0000-0000-000000000001', null, '   ', null) $$,
  'admins clear map details'
);
select results_eq(
  $$ select contour_interval, mapper, map_year::integer from public.map_versions where id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  $$ values (null::numeric(4, 1), null::text, null::integer) $$,
  'blank text and nulls clear the details'
);
reset role;

-- Members read the details of ready versions.
select pg_temp.sign_in('cccccccc-0000-0000-0000-000000000002');
select is(
  (select count(*)::integer from public.map_versions where id = 'eeeeeeee-0000-0000-0000-000000000001' and contour_interval is null),
  1, 'members read map details'
);
reset role;

select * from finish();
rollback;
