-- Your own data, deleting your account and deleting a club. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Ada: admin of A (with Bo), the only member of C, admin of D with Di (Bo also in D). Oz: outsider.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select ('dddddddd-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       name || '@example.com', jsonb_build_object('full_name', name), now(), now()
from (values (1, 'Ada'), (2, 'Bo'), (4, 'Di'), (5, 'Oz')) as u (n, name);

create function pg_temp.sign_in(n integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'dddddddd-0000-0000-0000-00000000000' || n, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.sign_out() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.uid(n integer) returns uuid language sql as $$ select ('dddddddd-0000-0000-0000-00000000000' || n)::uuid $$;
create function pg_temp.club(c text) returns uuid language sql as $$ select current_setting('test.club_' || c)::uuid $$;
-- The test's own clubs (the local database may hold others).
create function pg_temp.ours() returns uuid[] language sql as $$ select array[pg_temp.club('a'), pg_temp.club('c'), pg_temp.club('d')] $$;
grant execute on function pg_temp.uid(integer), pg_temp.club(text) to authenticated;

select pg_temp.sign_in(1);
select set_config('test.club_a', public.create_club('A')::text, true);
select set_config('test.club_c', public.create_club('C')::text, true);
select set_config('test.club_d', public.create_club('D')::text, true);
select pg_temp.sign_out();
insert into public.club_members (club_id, user_id, role) values
  (pg_temp.club('a'), pg_temp.uid(2), 'member'),
  (pg_temp.club('d'), pg_temp.uid(4), 'admin'),
  (pg_temp.club('d'), pg_temp.uid(2), 'member');

-- A map and an event in A (Bo created the event and asked for an export) and files of A and C.
insert into public.maps (id, club_id, name) values ('dddddddd-1111-0000-0000-000000000001', pg_temp.club('a'), 'Skogen');
insert into public.map_versions (id, map_id, club_id, version, kind, status, file_name, original_path, scale) values
  ('dddddddd-2222-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000001', pg_temp.club('a'), 1, 'ocad', 'ready', 'a.ocd', pg_temp.club('a') || '/m/v/a.ocd', 15000);
select pg_temp.sign_in(2);
select set_config('test.event', public.create_event(pg_temp.club('a'), 'Tuesday', 'dddddddd-2222-0000-0000-000000000001')::text, true);
select pg_temp.sign_out();
insert into public.exports (id, event_id, club_id, requested_by, revision, course_ids, status, path, file_name) values
  ('dddddddd-3333-0000-0000-000000000001', current_setting('test.event')::uuid, pg_temp.club('a'), pg_temp.uid(2), 1, array['x'], 'ready',
   pg_temp.club('a') || '/e/x/Tuesday.pdf', 'Tuesday.pdf');
insert into storage.objects (bucket_id, name) values
  ('map-originals', pg_temp.club('a') || '/m/v/a.ocd'),
  ('exports', pg_temp.club('a') || '/e/x/Tuesday.pdf'),
  ('map-originals', pg_temp.club('c') || '/m/v/c.ocd'),
  ('map-tiles', pg_temp.club('c') || '/m/v/tiles.pmtiles');

-- My data.
select pg_temp.sign_in(2);
select is(public.my_data() -> 'account' ->> 'email', 'Bo@example.com', 'my data holds my account');
select is((select jsonb_agg(x ->> 'club' order by x ->> 'club') from jsonb_array_elements(public.my_data() -> 'clubs') x), '["A", "D"]'::jsonb, 'and my clubs');
select is(public.my_data() -> 'eventsCreated' -> 0 ->> 'event', 'Tuesday', 'and the events I created');
select is(public.my_data() -> 'exports' -> 0 ->> 'file', 'Tuesday.pdf', 'and my exports');
select pg_temp.sign_out();
select throws_ok($$ select public.my_data() $$, '42501', null, 'only when signed in');

-- Deleting a club: admins only.
select pg_temp.sign_in(5);
select throws_ok($$ select public.delete_club(pg_temp.club('d')) $$, '42501', null, 'an outsider cannot delete a club');
select pg_temp.sign_out();
select pg_temp.sign_in(2);
select throws_ok($$ select public.delete_club(pg_temp.club('d')) $$, '42501', null, 'nor can a member');
select pg_temp.sign_out();

-- Ada is the only admin of A, which has Bo in it: she must make someone else admin first.
select pg_temp.sign_in(1);
select throws_ok($$ select public.delete_my_account() $$, 'P0001', 'you are the only admin of a club with other members', 'the only admin of a club with members cannot leave it without an admin');
select pg_temp.sign_out();
select ok(exists (select 1 from auth.users where id = pg_temp.uid(1)), 'and nothing was deleted');

-- Bo deletes his account: memberships, profile and exports go, his export file is queued for removal,
-- and the event he made stays with the club without his name.
select pg_temp.sign_in(2);
select lives_ok($$ select public.delete_my_account() $$, 'a member deletes their account');
select pg_temp.sign_out();
select is_empty($$ select 1 from auth.users where id = pg_temp.uid(2) $$, 'the account is gone');
select is_empty($$ select 1 from public.profiles where id = pg_temp.uid(2) $$, 'and the profile');
select is_empty($$ select 1 from public.club_members where user_id = pg_temp.uid(2) $$, 'and the memberships');
select is_empty($$ select 1 from public.exports where id = 'dddddddd-3333-0000-0000-000000000001' $$, 'and the exports');
select results_eq(
  $$ select name, created_by from public.events where club_id = any (pg_temp.ours()) $$,
  $$ values ('Tuesday'::text, null::uuid) $$,
  'the event stays with the club, without his name'
);
select results_eq(
  $$ select payload -> 'files' from public.jobs where type = 'delete_files' and payload::text like '%' || pg_temp.club('a') || '/e/x/%' $$,
  $$ values (jsonb_build_array(jsonb_build_object('bucket', 'exports', 'name', pg_temp.club('a') || '/e/x/Tuesday.pdf'))) $$,
  'his export file is queued for removal'
);

-- Now Ada is alone in A and C: they go with her account; D stays with Di.
select pg_temp.sign_in(1);
select lives_ok($$ select public.delete_my_account() $$, 'the only member of clubs deletes their account');
select pg_temp.sign_out();
select results_eq($$ select name from public.clubs where id = any (pg_temp.ours()) $$, $$ values ('D'::text) $$, 'clubs where she was alone are deleted, the other stays');
select results_eq($$ select user_id from public.club_members where club_id = any (pg_temp.ours()) $$, $$ values (pg_temp.uid(4)) $$, 'with its other admin');
select is_empty($$ select 1 from public.events where club_id = any (pg_temp.ours()) $$, 'the deleted club''s events are gone');
select is_empty($$ select 1 from public.map_versions where club_id = any (pg_temp.ours()) $$, 'and its maps');
select results_eq(
  $$ select f ->> 'name' from public.jobs j, jsonb_array_elements(j.payload -> 'files') f
     where j.type = 'delete_files' and f ->> 'name' not like '%/e/x/%'
       and split_part(f ->> 'name', '/', 1)::uuid = any (pg_temp.ours()) order by 1 $$,
  $$ select unnest(array[pg_temp.club('a') || '/m/v/a.ocd', pg_temp.club('c') || '/m/v/c.ocd', pg_temp.club('c') || '/m/v/tiles.pmtiles']) order by 1 $$,
  'and all their files are queued for removal'
);

-- An admin deletes a club.
select pg_temp.sign_in(4);
select lives_ok($$ select public.delete_club(pg_temp.club('d')) $$, 'an admin deletes a club');
select pg_temp.sign_out();
select is_empty($$ select 1 from public.clubs where id = any (pg_temp.ours()) $$, 'it is gone');
select is_empty($$ select 1 from public.club_members where club_id = any (pg_temp.ours()) $$, 'with its members');

select * from finish();
rollback;
