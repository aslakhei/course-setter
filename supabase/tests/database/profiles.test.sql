-- Row-level security for profiles. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ada@example.com', '{"full_name": "Ada"}', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bo@example.com', '{"name": "Bo"}', now(), now());

select results_eq(
  $$ select display_name from public.profiles order by display_name $$,
  array['Ada', 'Bo'],
  'sign-up creates a profile with the name from Google'
);

-- Signed in as Ada.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select results_eq(
  $$ select id from public.profiles $$,
  array['11111111-1111-1111-1111-111111111111'::uuid],
  'a user sees only their own profile'
);

select lives_ok(
  $$ update public.profiles set display_name = 'Ada L' where id = '11111111-1111-1111-1111-111111111111' $$,
  'a user can rename themselves'
);

select throws_ok(
  $$ update public.profiles set avatar_url = 'https://evil.example/x.png' where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'a user cannot change columns other than display_name'
);

select throws_ok(
  $$ insert into public.profiles (id, display_name) values ('33333333-3333-3333-3333-333333333333', 'Fake') $$,
  '42501', null,
  'a user cannot insert profiles'
);

-- Ada tries to rename Bo: RLS hides the row, so nothing is updated (checked below as superuser).
update public.profiles set display_name = 'Hacked' where id = '22222222-2222-2222-2222-222222222222';

-- Not signed in.
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select throws_ok(
  $$ select * from public.profiles $$,
  '42501', null,
  'anonymous visitors cannot read profiles'
);

reset role;

select is(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'Bo',
  'a user cannot rename someone else'
);

select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Ada L',
  'the own rename was stored'
);

delete from auth.users where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'deleting a user deletes their profile'
);

select * from finish();
rollback;
