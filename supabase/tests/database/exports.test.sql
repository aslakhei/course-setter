-- PDF exports: who may ask for one, who sees it, who downloads the file. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Ada: admin. Cleo: creates the event. Mo: other member (no access). Oz: outsider.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select ('eeeeeeee-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       name || '@example.com', jsonb_build_object('full_name', name), now(), now()
from (values (1, 'Ada'), (2, 'Cleo'), (3, 'Mo'), (4, 'Oz')) as u (n, name);

create function pg_temp.sign_in(n integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'eeeeeeee-0000-0000-0000-00000000000' || n, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.uid(n integer) returns uuid language sql as $$ select ('eeeeeeee-0000-0000-0000-00000000000' || n)::uuid $$;
create function pg_temp.event() returns uuid language sql as $$ select current_setting('test.event')::uuid $$;
grant execute on function pg_temp.uid(integer), pg_temp.event() to authenticated;

select pg_temp.sign_in(1);
select set_config('test.club', public.create_club('Club')::text, true);
reset role;
insert into public.club_members (club_id, user_id) select current_setting('test.club')::uuid, pg_temp.uid(n) from generate_series(2, 3) n;
insert into public.maps (id, club_id, name) values ('bbbbbbbb-1111-0000-0000-000000000001', current_setting('test.club')::uuid, 'Skogen');
insert into public.map_versions (id, map_id, club_id, version, kind, status, file_name, original_path, scale) values
  ('bbbbbbbb-2222-0000-0000-000000000001', 'bbbbbbbb-1111-0000-0000-000000000001', current_setting('test.club')::uuid, 1, 'ocad', 'ready', 'a.ocd', 'exports-test/a', 15000);

select pg_temp.sign_in(2);
select set_config('test.event', public.create_event(current_setting('test.club')::uuid, 'Tuesday', 'bbbbbbbb-2222-0000-0000-000000000001')::text, true);
select public.save_event(pg_temp.event(), '{"schemaVersion": 1, "controls": [], "courses": [{"id": "A"}, {"id": "B"}]}', 1);

-- Asking.
select set_config('test.export', public.request_export(pg_temp.event(), array['A', 'B'], true)::text, true);
select results_eq(
  $$ select revision, course_ids, separate, status::text, requested_by from public.exports $$,
  $$ values (2, array['A', 'B'], true, 'queued', pg_temp.uid(2)) $$,
  'someone with access asks for an export of the event as it is now'
);
select throws_ok($$ select public.request_export(pg_temp.event(), array['Z']) $$, '22023', null, 'only courses of the event');
select throws_ok($$ select public.request_export(pg_temp.event(), array[]::text[]) $$, '22023', null, 'at least one course');
select throws_ok($$ select public.request_export(pg_temp.event(), array['all']) $$, '22023', null, 'no all-controls page without controls');
select throws_ok($$ insert into public.exports (event_id, club_id, revision, course_ids) values (pg_temp.event(), current_setting('test.club')::uuid, 1, array['A']) $$, '42501', null, 'exports are only made through request_export');
reset role;
select results_eq(
  $$ select type from public.jobs where payload ->> 'export_id' = current_setting('test.export') $$,
  $$ values ('export_pdf') $$,
  'an export_pdf job is queued'
);

select pg_temp.sign_in(3);
select throws_ok($$ select public.request_export(pg_temp.event(), array['A']) $$, '42501', null, 'a member without access to the event cannot');
select is_empty($$ select * from public.exports $$, 'nor see its exports');
reset role;
select pg_temp.sign_in(4);
select throws_ok($$ select public.request_export(pg_temp.event(), array['A']) $$, '42501', null, 'an outsider cannot');
reset role;

-- The admin has access to the event, but the export is Cleo's.
select pg_temp.sign_in(1);
select is_empty($$ select * from public.exports $$, 'others with access do not see someone else''s exports');
reset role;

-- The worker finishes it; Cleo downloads the file while it is ready and not expired.
update public.exports set status = 'ready', path = current_setting('test.club') || '/' || pg_temp.event() || '/' || current_setting('test.export') || '/Tuesday.zip'
where id = current_setting('test.export')::uuid;
insert into storage.objects (bucket_id, name) values
  ('exports', current_setting('test.club') || '/' || pg_temp.event() || '/' || current_setting('test.export') || '/Tuesday.zip'),
  ('exports', current_setting('test.club') || '/' || pg_temp.event() || '/other/Other.pdf');

select pg_temp.sign_in(2);
select results_eq($$ select count(*)::integer from storage.objects where bucket_id = 'exports' $$, $$ values (1) $$, 'the requester can read the file of their ready export, and no other');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('exports', 'anything.pdf') $$,
  '42501', null, 'nobody but the worker writes export files'
);
reset role;
select pg_temp.sign_in(1);
select is_empty($$ select * from storage.objects where bucket_id = 'exports' $$, 'nor do others read them');
reset role;

update public.exports set expires_at = now() - interval '1 minute' where id = current_setting('test.export')::uuid;
select pg_temp.sign_in(2);
select is_empty($$ select * from storage.objects where bucket_id = 'exports' $$, 'an expired export can no longer be downloaded');
reset role;

-- The all-controls page, once the event has controls.
select pg_temp.sign_in(2);
select public.save_event(pg_temp.event(), '{"schemaVersion": 1, "controls": [{"id": "c", "kind": "control", "code": 31, "position": [0, 0]}], "courses": [{"id": "A"}]}', 2);
select lives_ok($$ select public.request_export(pg_temp.event(), array['A', 'all']) $$, 'a course and the all-controls page');
reset role;

-- Losing access to the event hides the export.
update public.exports set expires_at = now() + interval '1 hour' where id = current_setting('test.export')::uuid;
delete from public.club_members where user_id = pg_temp.uid(2);
select pg_temp.sign_in(2);
select is_empty($$ select * from public.exports $$, 'leaving the club hides one''s exports');
select is_empty($$ select * from storage.objects where bucket_id = 'exports' $$, 'and their files');
reset role;

select * from finish();
rollback;
