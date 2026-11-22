-- Club branding (logo, three colours) and sponsor images. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Ada: admin. Mo: member. Oz: admin of another club.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select ('bcbcbcbc-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       name || '@example.com', jsonb_build_object('full_name', name), now(), now()
from (values (1, 'Ada'), (2, 'Mo'), (3, 'Oz')) as u (n, name);

create function pg_temp.sign_in(n integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'bcbcbcbc-0000-0000-0000-00000000000' || n, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.club() returns uuid language sql as $$ select current_setting('test.club')::uuid $$;
grant execute on function pg_temp.club() to authenticated;

select pg_temp.sign_in(1);
select set_config('test.club', public.create_club('Club')::text, true);
reset role;
select pg_temp.sign_in(3);
select set_config('test.other', public.create_club('Other')::text, true);
reset role;
insert into public.club_members (club_id, user_id) values (pg_temp.club(), 'bcbcbcbc-0000-0000-0000-000000000002');
insert into public.layout_assets (id, club_id, name, kind, status, original_path) values
  ('bcbcbcbc-1111-0000-0000-000000000001', pg_temp.club(), 'Logo', 'svg', 'ready', 'branding-test/logo.svg'),
  ('bcbcbcbc-1111-0000-0000-000000000002', pg_temp.club(), 'Waiting', 'png', 'processing', 'branding-test/wait.png'),
  ('bcbcbcbc-1111-0000-0000-000000000003', current_setting('test.other')::uuid, 'Theirs', 'png', 'ready', 'branding-test/theirs.png');

select pg_temp.sign_in(1);
select lives_ok(
  $$ select public.set_club_branding(pg_temp.club(), 'bcbcbcbc-1111-0000-0000-000000000001', '#1F5A3A', ' #d9b44a ', '#c8102e') $$,
  'an admin sets the logo and three colours'
);
select results_eq(
  $$ select logo_asset_id, colour, colour2, colour3 from public.clubs where id = pg_temp.club() $$,
  $$ values ('bcbcbcbc-1111-0000-0000-000000000001'::uuid, '#1F5A3A', '#d9b44a', '#c8102e') $$,
  'the branding is saved'
);
select throws_ok(
  $$ select public.set_club_branding(pg_temp.club(), 'bcbcbcbc-1111-0000-0000-000000000002') $$,
  '22023', null, 'the logo must be ready'
);
select throws_ok(
  $$ select public.set_club_branding(pg_temp.club(), 'bcbcbcbc-1111-0000-0000-000000000003') $$,
  '22023', null, 'the logo must be the club''s own'
);
select throws_ok($$ select public.set_club_branding(pg_temp.club(), null, 'green') $$, '23514', null, 'colours are #rrggbb');
select throws_ok($$ select public.set_club_branding(pg_temp.club(), null, null, null, 'red') $$, '23514', null, 'the third colour too');
select lives_ok($$ select public.set_asset_sponsor('bcbcbcbc-1111-0000-0000-000000000001', true) $$, 'an admin marks a sponsor');
select ok((select sponsor from public.layout_assets where id = 'bcbcbcbc-1111-0000-0000-000000000001'), 'it is a sponsor');
select throws_ok($$ select public.set_asset_sponsor('bcbcbcbc-1111-0000-0000-000000000003', true) $$, '42501', null, 'not another club''s image');
reset role;

select pg_temp.sign_in(2);
select throws_ok($$ select public.set_club_branding(pg_temp.club(), null, '#000000') $$, '42501', null, 'members cannot set the branding');
select throws_ok($$ select public.set_asset_sponsor('bcbcbcbc-1111-0000-0000-000000000001', false) $$, '42501', null, 'members cannot mark sponsors');
select is((select colour from public.clubs where id = pg_temp.club()), '#1F5A3A', 'members read the branding');
reset role;

-- Deleting the logo image leaves the club without a logo.
delete from public.layout_assets where id = 'bcbcbcbc-1111-0000-0000-000000000001';
select is((select logo_asset_id from public.clubs where id = pg_temp.club()), null, 'a deleted logo image clears the logo');

select pg_temp.sign_in(1);
select lives_ok($$ select public.set_club_branding(pg_temp.club()) $$, 'an admin clears the branding');
select results_eq(
  $$ select logo_asset_id, colour, colour2, colour3 from public.clubs where id = pg_temp.club() $$,
  $$ values (null::uuid, null::text, null::text, null::text) $$,
  'nothing is left'
);
reset role;

select * from finish();
rollback;
