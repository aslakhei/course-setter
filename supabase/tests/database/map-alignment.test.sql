-- Saving the alignment of a map version. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('cccccccc-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ada@example.com', '{"full_name": "Ada"}', now(), now()),
  ('cccccccc-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'mo@example.com', '{"full_name": "Mo"}', now(), now());

create function pg_temp.sign_in(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select pg_temp.sign_in('cccccccc-0000-0000-0000-000000000001');
select set_config('test.club', public.create_club('Club')::text, true);
reset role;
insert into public.club_members (club_id, user_id) values (current_setting('test.club')::uuid, 'cccccccc-0000-0000-0000-000000000002');

-- Two versions as the worker leaves them: v1 ready, v2 waiting to be lined up with v1.
insert into public.maps (id, club_id, name) values ('dddddddd-0000-0000-0000-000000000001', current_setting('test.club')::uuid, 'Skogen');
insert into public.map_versions (id, map_id, club_id, version, kind, status, file_name, original_path, scale) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', current_setting('test.club')::uuid, 1, 'ocad', 'ready', 'a.ocd', 'p1', 15000),
  ('eeeeeeee-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', current_setting('test.club')::uuid, 2, 'pdf', 'needs_alignment', 'b.pdf', 'p2', 15000);
update public.map_versions set previous_version_id = 'eeeeeeee-0000-0000-0000-000000000001' where id = 'eeeeeeee-0000-0000-0000-000000000002';

select pg_temp.sign_in('cccccccc-0000-0000-0000-000000000002');
select is_empty($$ select * from public.map_versions where status = 'needs_alignment' $$, 'members do not see a version waiting to be lined up');
select throws_ok(
  $$ select public.set_map_version_alignment('eeeeeeee-0000-0000-0000-000000000002', '{"a":1,"b":0,"tx":0,"ty":0}', 0.5) $$,
  '42501', null, 'members cannot line versions up'
);
reset role;

select pg_temp.sign_in('cccccccc-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.set_map_version_alignment('eeeeeeee-0000-0000-0000-000000000002', '{"a":1,"b":0,"tx":0}', 0.5) $$,
  '22023', null, 'the transform needs all four numbers'
);
select throws_ok(
  $$ select public.set_map_version_alignment('eeeeeeee-0000-0000-0000-000000000002', '{"a":10,"b":0,"tx":0,"ty":0}', 0.5) $$,
  '22023', 'transform is not plausible', 'a tenfold scale is refused'
);
select throws_ok(
  $$ select public.set_map_version_alignment('eeeeeeee-0000-0000-0000-000000000001', '{"a":1,"b":0,"tx":0,"ty":0}', 0) $$,
  '22023', null, 'the first version has nothing to line up with'
);
select lives_ok(
  $$ select public.set_map_version_alignment('eeeeeeee-0000-0000-0000-000000000002', '{"a":0.999,"b":0.03,"tx":12.5,"ty":-4,"extra":1}', 1.2) $$,
  'an admin saves the alignment from matched points'
);
reset role;

select results_eq(
  $$ select status::text, transform_method, transform_rms_m, transform_from_previous from public.map_versions where id = 'eeeeeeee-0000-0000-0000-000000000002' $$,
  $$ values ('ready', 'points', 1.2::double precision, '{"a":0.999,"b":0.03,"tx":12.5,"ty":-4}'::jsonb) $$,
  'the version becomes ready with the transform, keeping only its four numbers'
);

select pg_temp.sign_in('cccccccc-0000-0000-0000-000000000002');
select results_eq($$ select version from public.map_versions order by version $$, $$ values (1), (2) $$, 'members now see both versions');
reset role;

select * from finish();
rollback;
