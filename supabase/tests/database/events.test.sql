-- Events: access, invitations, saving with revisions. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Ada: admin. Cleo: creates the event. Ivan: invited. Mo: other member. Oz: other club only.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select ('ffffffff-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       name || '@example.com', jsonb_build_object('full_name', name), now(), now()
from (values (1, 'Ada'), (2, 'Cleo'), (3, 'Ivan'), (4, 'Mo'), (5, 'Oz')) as u (n, name);

create function pg_temp.sign_in(n integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'ffffffff-0000-0000-0000-00000000000' || n, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.uid(n integer) returns uuid language sql as $$ select ('ffffffff-0000-0000-0000-00000000000' || n)::uuid $$;
create function pg_temp.event() returns uuid language sql as $$ select current_setting('test.event')::uuid $$;
grant execute on function pg_temp.uid(integer), pg_temp.event() to authenticated;

select pg_temp.sign_in(1);
select set_config('test.club', public.create_club('Club')::text, true);
reset role;
select pg_temp.sign_in(5);
select set_config('test.other_club', public.create_club('Other club')::text, true);
reset role;
insert into public.club_members (club_id, user_id)
select current_setting('test.club')::uuid, pg_temp.uid(n) from generate_series(2, 4) n;
insert into public.maps (id, club_id, name) values ('aaaaaaaa-1111-0000-0000-000000000001', current_setting('test.club')::uuid, 'Skogen');
insert into public.map_versions (id, map_id, club_id, version, kind, status, file_name, original_path, scale) values
  ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', current_setting('test.club')::uuid, 1, 'ocad', 'ready', 'a.ocd', 'events-test/a', 15000),
  ('aaaaaaaa-2222-0000-0000-000000000002', 'aaaaaaaa-1111-0000-0000-000000000001', current_setting('test.club')::uuid, 2, 'ocad', 'processing', 'b.ocd', 'events-test/b', null);

-- Creating.
select pg_temp.sign_in(2);
select set_config('test.event', public.create_event(current_setting('test.club')::uuid, ' Tuesday training ', 'aaaaaaaa-2222-0000-0000-000000000001', '2026-11-24')::text, true);
select results_eq(
  $$ select name, event_date, revision, doc, created_by from public.events $$,
  $$ values ('Tuesday training', '2026-11-24'::date, 1, '{"schemaVersion": 1, "controls": [], "courses": []}'::jsonb, pg_temp.uid(2)) $$,
  'a member creates an event with an empty course document'
);
select results_eq($$ select revision from public.event_revisions $$, $$ values (1) $$, 'the first revision is kept');
select throws_ok(
  $$ select public.create_event(current_setting('test.club')::uuid, 'X', 'aaaaaaaa-2222-0000-0000-000000000002') $$,
  '22023', null, 'an event needs a ready map version'
);
select throws_ok(
  $$ insert into public.events (club_id, name, map_version_id, doc) values (current_setting('test.club')::uuid, 'X', 'aaaaaaaa-2222-0000-0000-000000000001', '{}') $$,
  '42501', null, 'events are only created with create_event'
);
reset role;

select pg_temp.sign_in(5);
select throws_ok(
  $$ select public.create_event(current_setting('test.club')::uuid, 'X', 'aaaaaaaa-2222-0000-0000-000000000001') $$,
  '42501', null, 'outsiders cannot create events in the club'
);
select is_empty($$ select * from public.events $$, 'outsiders see no events');
reset role;

-- Who sees it.
select pg_temp.sign_in(4);
select is_empty($$ select * from public.events $$, 'another club member does not see the event');
select is_empty($$ select * from public.event_revisions $$, 'nor its history');
select throws_ok($$ select public.save_event(pg_temp.event(), '{"schemaVersion": 1}', 1) $$, '42501', null, 'nor can save it');
select throws_ok(
  $$ insert into public.event_members (event_id, user_id) values (pg_temp.event(), pg_temp.uid(4)) $$,
  '42501', null, 'nor invite themselves'
);
reset role;

select pg_temp.sign_in(1);
select results_eq($$ select name from public.events $$, $$ values ('Tuesday training') $$, 'a club admin sees every event of the club');
reset role;

-- Inviting.
select pg_temp.sign_in(2);
select lives_ok(
  $$ insert into public.event_members (event_id, user_id) values (pg_temp.event(), pg_temp.uid(3)) $$,
  'the creator invites a club member'
);
select throws_ok(
  $$ insert into public.event_members (event_id, user_id) values (pg_temp.event(), pg_temp.uid(5)) $$,
  '23514', 'only members of the club can be invited to its events', 'people outside the club cannot be invited'
);
reset role;

select pg_temp.sign_in(3);
select results_eq($$ select name from public.events $$, $$ values ('Tuesday training') $$, 'an invited member sees the event');
select results_eq(
  $$ select user_id, invited_by from public.event_members $$,
  $$ values (pg_temp.uid(3), pg_temp.uid(2)) $$,
  'and who has been invited by whom'
);
select lives_ok(
  $$ insert into public.event_members (event_id, user_id) values (pg_temp.event(), pg_temp.uid(4)) $$,
  'an invited member invites another club member'
);
select is_empty(
  $$ delete from public.event_members where user_id = pg_temp.uid(4) returning 1 $$,
  'an invited member cannot remove others'
);
select is_empty($$ delete from public.events returning 1 $$, 'an invited member cannot delete the event');
select results_eq(
  $$ update public.events set name = 'Tuesday interval training' returning name $$,
  $$ values ('Tuesday interval training') $$,
  'an invited member renames the event'
);

-- Saving.
select is(public.save_event(pg_temp.event(), '{"schemaVersion": 1, "controls": [{"id": "c1"}], "courses": []}', 1), 2, 'saving returns the next revision');
select throws_ok(
  $$ select public.save_event(pg_temp.event(), '{"schemaVersion": 1, "controls": [], "courses": []}', 1) $$,
  'P0001', 'someone else saved this event', 'a save from an out-of-date revision is refused'
);
reset role;
select pg_temp.sign_in(2);
select throws_ok($$ select public.save_event(pg_temp.event(), '[1, 2]', 2) $$, '22023', null, 'only course documents are saved');
select throws_ok($$ select public.save_event(pg_temp.event(), '{"controls": []}', 2) $$, '22023', null, 'a document needs its schema version');
reset role;

-- The conflict tells who saved and when.
select pg_temp.sign_in(2);
do $$
declare
  detail text;
begin
  perform public.save_event(pg_temp.event(), '{"schemaVersion": 1}', 1);
exception when others then
  get stacked diagnostics detail = pg_exception_detail;
  perform set_config('test.detail', detail, true);
end;
$$;
reset role;
select results_eq(
  $$ select (d ->> 'revision')::integer, d ->> 'savedBy', (d ->> 'savedAt') is not null from (select current_setting('test.detail')::jsonb d) x $$,
  $$ values (2, 'Ivan', true) $$,
  'the refused save says which revision is current, who saved it and when'
);
select results_eq(
  $$ select revision, doc -> 'controls', saved_by from public.event_revisions where event_id = pg_temp.event() order by revision $$,
  $$ values (1, '[]'::jsonb, pg_temp.uid(2)), (2, '[{"id": "c1"}]'::jsonb, pg_temp.uid(3)) $$,
  'every saved revision is kept, the refused ones are not'
);

-- Removing access, leaving, leaving the club.
select pg_temp.sign_in(4);
select lives_ok($$ delete from public.event_members where user_id = pg_temp.uid(4) $$, 'an invited member can leave the event');
select is_empty($$ select * from public.events $$, 'and no longer sees it');
reset role;
select pg_temp.sign_in(2);
select lives_ok($$ delete from public.event_members where user_id = pg_temp.uid(3) $$, 'the creator removes an invited member');
reset role;
select pg_temp.sign_in(3);
select is_empty($$ select * from public.events $$, 'who then no longer sees the event');
reset role;

insert into public.event_members (event_id, user_id, invited_by) values (pg_temp.event(), pg_temp.uid(3), pg_temp.uid(2));
delete from public.club_members where user_id = pg_temp.uid(3);
select is((select count(*) from public.event_members where user_id = pg_temp.uid(3)), 0::bigint, 'leaving the club ends access to its events');
delete from public.club_members where user_id = pg_temp.uid(2);
select pg_temp.sign_in(2);
select is_empty($$ select * from public.events $$, 'a creator who left the club no longer sees the event');
reset role;

-- Map versions in use.
select pg_temp.sign_in(1);
select throws_ok(
  $$ select public.delete_map_version('aaaaaaaa-2222-0000-0000-000000000001') $$,
  '23503', 'events use this map version', 'a map version that events use cannot be deleted'
);
select lives_ok($$ delete from public.events where id = pg_temp.event() $$, 'an admin deletes the event');
select is((select count(*) from public.event_revisions where event_id = pg_temp.event()), 0::bigint, 'its history goes with it');
reset role;

-- Not signed in.
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select * from public.events $$, '42501', null, 'anonymous visitors cannot read events');
select throws_ok($$ select public.save_event(gen_random_uuid(), '{}', 1) $$, '42501', null, 'anonymous visitors cannot save');
reset role;

select * from finish();
rollback;
