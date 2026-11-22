-- Images for print layouts: who may upload, see and delete them in each scope, the upload path rule,
-- file removal on delete, and which images an event may print. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Ada: admin. Cleo: creates the event. Mo: other member (not invited). Oz: admin of another club.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select ('abababab-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       name || '@example.com', jsonb_build_object('full_name', name), now(), now()
from (values (1, 'Ada'), (2, 'Cleo'), (3, 'Mo'), (4, 'Oz')) as u (n, name);

create function pg_temp.sign_in(n integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'abababab-0000-0000-0000-00000000000' || n, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.uid(n integer) returns uuid language sql as $$ select ('abababab-0000-0000-0000-00000000000' || n)::uuid $$;
create function pg_temp.club() returns uuid language sql as $$ select current_setting('test.club')::uuid $$;
create function pg_temp.event() returns uuid language sql as $$ select current_setting('test.event')::uuid $$;
grant execute on function pg_temp.uid(integer), pg_temp.club(), pg_temp.event() to authenticated;

select pg_temp.sign_in(1);
select set_config('test.club', public.create_club('Club')::text, true);
reset role;
select pg_temp.sign_in(4);
select set_config('test.other_club', public.create_club('Other club')::text, true);
reset role;
insert into public.club_members (club_id, user_id) select pg_temp.club(), pg_temp.uid(n) from generate_series(2, 3) n;
insert into public.maps (id, club_id, name) values ('abababab-1111-0000-0000-000000000001', pg_temp.club(), 'Skogen');
insert into public.map_versions (id, map_id, club_id, version, kind, status, file_name, original_path, scale) values
  ('abababab-2222-0000-0000-000000000001', 'abababab-1111-0000-0000-000000000001', pg_temp.club(), 1, 'ocad', 'ready', 'a.ocd', 'assets-test/a', 15000);
select pg_temp.sign_in(2);
select set_config('test.event', public.create_event(pg_temp.club(), 'Training', 'abababab-2222-0000-0000-000000000001')::text, true);
reset role;

-- Club library: admins only.
select pg_temp.sign_in(1);
select set_config('test.logo', (select asset_id from public.start_asset_upload('club', ' Club logo ', 'png', pg_temp.club()))::text, true);
select results_eq(
  $$ select name, kind, status, club_id, event_id, owner_id, original_path from public.layout_assets where id = current_setting('test.logo')::uuid $$,
  $$ values ('Club logo', 'png'::public.asset_kind, 'uploading'::public.asset_status, pg_temp.club(), null::uuid, null::uuid,
             pg_temp.club() || '/library/' || current_setting('test.logo') || '/original.png') $$,
  'an admin starts an upload to the club library, with a path in its folder'
);
reset role;
select pg_temp.sign_in(3);
select throws_ok($$ select public.start_asset_upload('club', 'X', 'png', pg_temp.club()) $$, '42501', null, 'members cannot add to the club library');
reset role;
select pg_temp.sign_in(4);
select throws_ok($$ select public.start_asset_upload('club', 'X', 'png', pg_temp.club()) $$, '42501', null, 'outsiders cannot add to the club library');
reset role;

-- Event images: anyone with access to the event.
select pg_temp.sign_in(2);
select set_config('test.photo', (select asset_id from public.start_asset_upload('event', 'Photo', 'jpeg', null, pg_temp.event()))::text, true);
select is(
  (select original_path from public.layout_assets where id = current_setting('test.photo')::uuid),
  pg_temp.club() || '/events/' || pg_temp.event() || '/' || current_setting('test.photo') || '/original.jpg',
  'the event creator adds an image to the event, in its folder'
);
reset role;
select pg_temp.sign_in(3);
select throws_ok($$ select public.start_asset_upload('event', 'X', 'png', null, pg_temp.event()) $$, '42501', null, 'members without access to the event cannot add to it');
reset role;

-- Personal images: only the owner.
select pg_temp.sign_in(3);
select set_config('test.mine', (select asset_id from public.start_asset_upload('personal', 'My logo', 'svg'))::text, true);
select is(
  (select original_path from public.layout_assets where id = current_setting('test.mine')::uuid),
  'users/' || pg_temp.uid(3) || '/' || current_setting('test.mine') || '/original.svg',
  'anyone adds a personal image, in their own folder'
);
select throws_ok($$ select public.start_asset_upload('personal', 'X', 'png', pg_temp.club()) $$, '22023', null, 'a personal image has no club');
select throws_ok($$ select public.start_asset_upload('team', 'X', 'png') $$, '22023', null, 'unknown scopes are refused');
reset role;

-- Who sees what.
select pg_temp.sign_in(3);
select results_eq(
  $$ select name from public.layout_assets order by name $$,
  $$ values ('Club logo'), ('My logo') $$,
  'a member sees the club library and their own images, not an event they have no access to'
);
reset role;
select pg_temp.sign_in(2);
select results_eq($$ select name from public.layout_assets order by name $$, $$ values ('Club logo'), ('Photo') $$, 'the event creator sees the event images, not others'' personal images');
reset role;
select pg_temp.sign_in(4);
select is_empty($$ select * from public.layout_assets $$, 'outsiders see nothing');
reset role;

-- Uploading and finishing.
select pg_temp.sign_in(1);
select ok(private.may_upload_asset(pg_temp.club() || '/library/' || current_setting('test.logo') || '/original.png'), 'the uploader may upload to the handed-out path');
select ok(not private.may_upload_asset(pg_temp.club() || '/library/' || current_setting('test.logo') || '/other.png'), 'but nowhere else');
select throws_ok($$ select public.finish_asset_upload(current_setting('test.logo')::uuid) $$, '22023', null, 'finishing needs the file');
reset role;
select pg_temp.sign_in(2);
select ok(not private.may_upload_asset(pg_temp.club() || '/library/' || current_setting('test.logo') || '/original.png'), 'others may not upload to that path');
reset role;
insert into storage.objects (bucket_id, name) values ('layout-assets', pg_temp.club() || '/library/' || current_setting('test.logo') || '/original.png');
select pg_temp.sign_in(2);
select throws_ok($$ select public.finish_asset_upload(current_setting('test.logo')::uuid) $$, '42501', null, 'only the uploader finishes the upload');
reset role;
select pg_temp.sign_in(1);
select lives_ok($$ select public.finish_asset_upload(current_setting('test.logo')::uuid) $$, 'the uploader finishes the upload');
select ok(not private.may_upload_asset(pg_temp.club() || '/library/' || current_setting('test.logo') || '/original.png'), 'the path is closed once the file is in');
reset role;
select is(
  (select payload ->> 'asset_id' from public.jobs where type = 'process_layout_asset' order by id desc limit 1),
  current_setting('test.logo'),
  'finishing queues processing'
);
select ok(
  (select status = 'processing' from public.layout_assets where id = current_setting('test.logo')::uuid),
  'the image is being processed'
);

-- Reading files.
select pg_temp.sign_in(3);
select ok(private.may_read_asset_file(pg_temp.club() || '/library/' || current_setting('test.logo') || '/original.png'), 'members read club library files');
reset role;
select pg_temp.sign_in(4);
select ok(not private.may_read_asset_file(pg_temp.club() || '/library/' || current_setting('test.logo') || '/original.png'), 'outsiders do not');
reset role;

-- Which images an event may print (as the worker asks).
update public.layout_assets set status = 'ready', width = 100, height = 50;
select set_config('test.foreign', (
  select a.id::text from (
    select gen_random_uuid() as id
  ) a
), true);
insert into public.layout_assets (id, club_id, name, kind, status, original_path, width, height)
values (current_setting('test.foreign')::uuid, current_setting('test.other_club')::uuid, 'Their logo', 'png', 'ready', 'x/foreign.png', 10, 10);
select set_config('test.outsider_own', gen_random_uuid()::text, true);
insert into public.layout_assets (id, owner_id, name, kind, status, original_path, width, height)
values (current_setting('test.outsider_own')::uuid, pg_temp.uid(4), 'Oz''s logo', 'png', 'ready', 'users/oz/own.png', 10, 10);
select set_config('test.cleo_own', gen_random_uuid()::text, true);
insert into public.layout_assets (id, owner_id, name, kind, status, original_path, width, height)
values (current_setting('test.cleo_own')::uuid, pg_temp.uid(2), 'Cleo''s logo', 'png', 'ready', 'users/cleo/own.png', 10, 10);
select results_eq(
  $$ select name from public.layout_assets where id in (select id from public.event_layout_assets(pg_temp.event(), array(select id from public.layout_assets))) order by name $$,
  $$ values ('Cleo''s logo'), ('Club logo'), ('Photo') $$,
  'an event prints its club library, its own images and personal images of people with access, never another club''s or an outsider''s'
);
select results_eq(
  $$ select name from public.layout_assets where id in (select id from public.event_layout_assets(pg_temp.event(), array[current_setting('test.mine')::uuid])) $$,
  $$ select 'x'::text where false $$,
  'a personal image of a member without access to the event is not printed'
);
update public.layout_assets set status = 'processing' where id = current_setting('test.photo')::uuid;
select is_empty(
  $$ select * from public.event_layout_assets(pg_temp.event(), array[current_setting('test.photo')::uuid]) $$,
  'images that are not ready are not printed'
);
select pg_temp.sign_in(2);
select throws_ok($$ select * from public.event_layout_assets(pg_temp.event(), array[]::uuid[]) $$, '42501', null, 'only the worker asks');
reset role;

-- Deleting.
select pg_temp.sign_in(3);
select throws_ok($$ select public.delete_layout_asset(current_setting('test.logo')::uuid) $$, '42501', null, 'members cannot delete club library images');
reset role;
select pg_temp.sign_in(1);
select lives_ok($$ select public.delete_layout_asset(current_setting('test.logo')::uuid) $$, 'admins delete club library images');
reset role;
select ok(
  (select payload -> 'files' @> jsonb_build_array(jsonb_build_object('bucket', 'layout-assets', 'name', pg_temp.club() || '/library/' || current_setting('test.logo') || '/original.png'))
   from public.jobs where type = 'delete_files' order by id desc limit 1),
  'deleting queues the removal of its file'
);
update public.layout_assets set preview_path = 'p/preview.png' where id = current_setting('test.photo')::uuid;
delete from public.events where id = pg_temp.event();
select is_empty($$ select * from public.layout_assets where id = current_setting('test.photo')::uuid $$, 'event images go with their event');
select ok(
  (select payload -> 'files' @> '[{"bucket": "layout-assets", "name": "p/preview.png"}]'::jsonb from public.jobs where type = 'delete_files' order by id desc limit 1),
  'and their files, previews included, are queued for removal'
);

-- Download my data.
select pg_temp.sign_in(3);
select is((public.my_data() -> 'imagesUploaded' -> 0 ->> 'name'), 'My logo', 'my data lists the images I uploaded');
reset role;

select * from finish();
rollback;
