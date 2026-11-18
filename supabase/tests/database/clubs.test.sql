-- Clubs, memberships, invite links and map file access. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- People: Ada (admin of Club X), Mo (member of X), Oz (outsider, not in any club).
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ada@example.com', '{"full_name": "Ada"}', now(), now()),
  ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'mo@example.com', '{"full_name": "Mo"}', now(), now()),
  ('aaaaaaaa-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'oz@example.com', '{"full_name": "Oz"}', now(), now());

-- Act as a signed-in user (call as postgres; `reset role` goes back).
create function pg_temp.sign_in(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.club_x() returns uuid language sql as $$ select current_setting('test.club_x')::uuid $$;

-- Ada creates Club X; Mo is added as member; one tile and one original map file are stored for X.
select pg_temp.sign_in('aaaaaaaa-0000-0000-0000-000000000001');
select set_config('test.club_x', public.create_club('  Club X  ')::text, true);
reset role;
grant execute on function pg_temp.club_x() to authenticated;
insert into public.club_members (club_id, user_id) values (pg_temp.club_x(), 'aaaaaaaa-0000-0000-0000-000000000002');
insert into storage.objects (bucket_id, name) values
  ('map-tiles', pg_temp.club_x() || '/map1/v1/tiles.pmtiles'),
  ('map-originals', pg_temp.club_x() || '/map1/v1/map.ocd');

select results_eq(
  $$ select c.name, m.role::text from public.clubs c join public.club_members m on m.club_id = c.id
     where m.user_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values ('Club X', 'admin') $$,
  'create_club trims the name and makes the creator admin'
);

-- Outsider: sees nothing of the club and cannot change it.
select pg_temp.sign_in('aaaaaaaa-0000-0000-0000-000000000003');
select is_empty($$ select * from public.clubs $$, 'an outsider sees no clubs');
select is_empty($$ select * from public.club_members $$, 'an outsider sees no memberships');
select is_empty($$ select * from public.club_invites $$, 'an outsider sees no invites');
select results_eq(
  $$ select id from public.profiles $$,
  $$ values ('aaaaaaaa-0000-0000-0000-000000000003'::uuid) $$,
  'an outsider sees only their own profile'
);
select is_empty($$ select * from storage.objects where bucket_id = 'map-tiles' $$, 'an outsider sees no map tiles');
select is_empty($$ select * from storage.objects where bucket_id = 'map-originals' $$, 'an outsider sees no original maps');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('map-originals', pg_temp.club_x() || '/m/v/evil.ocd') $$,
  '42501', null, 'an outsider cannot upload a map to the club'
);
select throws_ok(
  $$ insert into public.club_members (club_id, user_id) values (pg_temp.club_x(), 'aaaaaaaa-0000-0000-0000-000000000003') $$,
  '42501', null, 'an outsider cannot add themselves to a club'
);
select throws_ok(
  $$ insert into public.club_invites (club_id) values (pg_temp.club_x()) $$,
  '42501', null, 'an outsider cannot create an invite'
);
select throws_ok(
  $$ insert into public.clubs (name) values ('Sneaky') $$,
  '42501', null, 'clubs can only be created with create_club'
);
select is_empty(
  $$ update public.clubs set name = 'Hacked' where id = pg_temp.club_x() returning id $$,
  'an outsider cannot rename the club'
);
reset role;

-- Member: sees the club, its members and their profiles, and the tiles; not invites or originals.
select pg_temp.sign_in('aaaaaaaa-0000-0000-0000-000000000002');
select results_eq($$ select name from public.clubs $$, $$ values ('Club X') $$, 'a member sees the club');
select results_eq(
  $$ select p.display_name, m.role::text from public.club_members m join public.profiles p on p.id = m.user_id order by 1 $$,
  $$ values ('Ada', 'admin'), ('Mo', 'member') $$,
  'a member sees the other members with name and role'
);
select is_empty($$ select * from public.club_invites $$, 'a member does not see invite links');
select results_eq(
  $$ select name from storage.objects where bucket_id = 'map-tiles' $$,
  $$ values (pg_temp.club_x() || '/map1/v1/tiles.pmtiles') $$,
  'a member can read the club''s map tiles'
);
select is_empty($$ select * from storage.objects where bucket_id = 'map-originals' $$, 'a member cannot read original maps');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('map-originals', pg_temp.club_x() || '/m/v/map.ocd') $$,
  '42501', null, 'a member cannot upload maps'
);
select is_empty(
  $$ update public.club_members set role = 'admin' where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' returning 1 $$,
  'a member cannot make themselves admin'
);
select is_empty(
  $$ delete from public.club_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1 $$,
  'a member cannot remove others'
);
select is_empty(
  $$ update public.clubs set name = 'Mo''s club' returning 1 $$,
  'a member cannot rename the club'
);
select throws_ok(
  $$ update public.club_members set user_id = 'aaaaaaaa-0000-0000-0000-000000000003' $$,
  '42501', null, 'nobody can move a membership to another user'
);
reset role;

-- Admin: renames, manages invites, uploads originals (but cannot read them back).
select pg_temp.sign_in('aaaaaaaa-0000-0000-0000-000000000001');
select results_eq(
  $$ update public.clubs set name = 'Club X OK' where id = pg_temp.club_x() returning name $$,
  $$ values ('Club X OK') $$,
  'an admin can rename the club'
);
select lives_ok(
  $$ insert into public.club_invites (club_id) values (pg_temp.club_x()) $$,
  'an admin can create an invite link'
);
select results_eq(
  $$ select char_length(token), token ~ '^[A-Za-z0-9_-]+$', expires_at::date - created_at::date, created_by from public.club_invites $$,
  $$ values (24, true, 14, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid) $$,
  'an invite gets a URL-safe random token, a 14 day expiry and its creator'
);
select throws_ok(
  $$ insert into public.club_invites (club_id, token) values (pg_temp.club_x(), 'chosen-token') $$,
  '42501', null, 'the token cannot be chosen'
);
select throws_ok(
  $$ insert into public.club_invites (club_id, expires_at) values (pg_temp.club_x(), now() + interval '1 year') $$,
  '23514', null, 'invite links expire within 90 days'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('map-originals', pg_temp.club_x() || '/map1/v2/map.ocd') $$,
  'an admin can upload an original map'
);
select is_empty($$ select * from storage.objects where bucket_id = 'map-originals' $$, 'not even admins can read originals');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('map-originals', 'not-a-club/map.ocd') $$,
  '42501', null, 'uploads must be inside a club folder'
);
reset role;
select set_config('test.token', (select token from public.club_invites limit 1), true);

-- Invite links.
select pg_temp.sign_in('aaaaaaaa-0000-0000-0000-000000000003');
select results_eq(
  $$ select club_name, status, already_member from public.invite_info(current_setting('test.token')) $$,
  $$ values ('Club X OK', 'valid', false) $$,
  'the invite page shows the club name to whoever has the link'
);
select is_empty($$ select * from public.invite_info('no-such-token') $$, 'an unknown token shows nothing');
select throws_ok($$ select public.accept_invite('no-such-token') $$, 'P0001', null, 'an unknown token cannot be accepted');
select is(public.accept_invite(current_setting('test.token')), pg_temp.club_x(), 'accepting a valid invite returns the club');
select results_eq(
  $$ select role::text from public.club_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000003' $$,
  $$ values ('member') $$,
  'accepting an invite joins the club as member'
);
select lives_ok($$ select public.accept_invite(current_setting('test.token')) $$, 'accepting twice is harmless');
select results_eq(
  $$ select already_member from public.invite_info(current_setting('test.token')) $$,
  $$ values (true) $$,
  'the invite page knows you are already a member'
);
select is_empty(
  $$ delete from public.club_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' returning 1 $$,
  'a member cannot remove another member'
);
select lives_ok(
  $$ delete from public.club_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000003' $$,
  'a member can leave the club'
);
select is_empty($$ select * from public.clubs $$, 'after leaving, the club is invisible again');
reset role;

select pg_temp.sign_in('aaaaaaaa-0000-0000-0000-000000000001');
update public.club_invites set revoked_at = now();
reset role;
select pg_temp.sign_in('aaaaaaaa-0000-0000-0000-000000000003');
select results_eq(
  $$ select status from public.invite_info(current_setting('test.token')) $$,
  $$ values ('revoked') $$,
  'a revoked link shows as revoked'
);
select throws_ok($$ select public.accept_invite(current_setting('test.token')) $$, 'P0001', null, 'a revoked link cannot be accepted');
reset role;

update public.club_invites set revoked_at = null, created_at = now() - interval '20 days', expires_at = now() - interval '6 days';
select pg_temp.sign_in('aaaaaaaa-0000-0000-0000-000000000003');
select results_eq(
  $$ select status from public.invite_info(current_setting('test.token')) $$,
  $$ values ('expired') $$,
  'an expired link shows as expired'
);
select throws_ok($$ select public.accept_invite(current_setting('test.token')) $$, 'P0001', null, 'an expired link cannot be accepted');
reset role;

-- The last admin stays.
select pg_temp.sign_in('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$ update public.club_members set role = 'member' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'P0001', 'a club must have at least one admin', 'the last admin cannot step down'
);
select throws_ok(
  $$ delete from public.club_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'P0001', 'a club must have at least one admin', 'the last admin cannot leave'
);
select lives_ok(
  $$ update public.club_members set role = 'admin' where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' $$,
  'an admin can make a member admin'
);
select lives_ok(
  $$ delete from public.club_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'an admin can leave when another admin remains'
);
reset role;

-- Deleting a user account removes their memberships, even as the last admin.
select lives_ok(
  $$ delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000002' $$,
  'a user account can be deleted although it is the last admin of a club'
);
select is(
  (select count(*) from public.club_members where club_id = pg_temp.club_x()),
  0::bigint,
  'their membership went with the account'
);

-- Not signed in: nothing at all.
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select * from public.clubs $$, '42501', null, 'anonymous visitors cannot read clubs');
select throws_ok($$ select * from public.club_members $$, '42501', null, 'anonymous visitors cannot read memberships');
select throws_ok($$ select public.create_club('x') $$, '42501', null, 'anonymous visitors cannot create clubs');
select throws_ok($$ select * from public.invite_info('x') $$, '42501', null, 'anonymous visitors cannot look up invites');
select throws_ok($$ select public.accept_invite('x') $$, '42501', null, 'anonymous visitors cannot accept invites');
select is_empty($$ select * from storage.objects where bucket_id in ('map-tiles', 'map-originals') $$, 'anonymous visitors see no map files');
reset role;

select * from finish();
rollback;
