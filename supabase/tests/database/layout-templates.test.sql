-- Saved print layout templates: club templates (members read, admins write) and personal ones (only
-- the owner). Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Ada: admin. Mo: member. Oz: another club.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select ('cdcdcdcd-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       name || '@example.com', jsonb_build_object('full_name', name), now(), now()
from (values (1, 'Ada'), (2, 'Mo'), (3, 'Oz')) as u (n, name);

create function pg_temp.sign_in(n integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'cdcdcdcd-0000-0000-0000-00000000000' || n, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.uid(n integer) returns uuid language sql as $$ select ('cdcdcdcd-0000-0000-0000-00000000000' || n)::uuid $$;
create function pg_temp.club() returns uuid language sql as $$ select current_setting('test.club')::uuid $$;
grant execute on function pg_temp.uid(integer), pg_temp.club() to authenticated;

select pg_temp.sign_in(1);
select set_config('test.club', public.create_club('Club')::text, true);
reset role;
insert into public.club_members (club_id, user_id) values (pg_temp.club(), pg_temp.uid(2));

-- Club templates: admins save, members read.
select pg_temp.sign_in(1);
select lives_ok(
  $$ insert into public.layout_templates (club_id, name, layout) values (pg_temp.club(), 'Club night', '{"elements": []}') $$,
  'an admin saves a club template'
);
reset role;
select pg_temp.sign_in(2);
select results_eq($$ select name from public.layout_templates $$, $$ values ('Club night') $$, 'members see club templates');
select throws_ok(
  $$ insert into public.layout_templates (club_id, name, layout) values (pg_temp.club(), 'Mine', '{"elements": []}') $$,
  '42501', null, 'members cannot save club templates'
);
update public.layout_templates set name = 'Renamed';
select results_eq($$ select name from public.layout_templates $$, $$ values ('Club night') $$, 'members cannot rename club templates');
delete from public.layout_templates;
select results_eq($$ select count(*)::integer from public.layout_templates $$, $$ values (1) $$, 'members cannot delete club templates');

-- Personal templates: only the owner.
select lives_ok(
  $$ insert into public.layout_templates (owner_id, name, layout) values (pg_temp.uid(2), 'My training', '{"elements": []}') $$,
  'anyone saves a personal template'
);
select throws_ok(
  $$ insert into public.layout_templates (owner_id, name, layout) values (pg_temp.uid(1), 'Not mine', '{"elements": []}') $$,
  '42501', null, 'nobody saves a template for someone else'
);
select throws_ok(
  $$ insert into public.layout_templates (club_id, owner_id, name, layout) values (pg_temp.club(), pg_temp.uid(2), 'Both', '{"elements": []}') $$,
  '42501', null, 'a template is a club''s or a person''s, not both'
);
reset role;
select pg_temp.sign_in(1);
select results_eq($$ select name from public.layout_templates order by name $$, $$ values ('Club night') $$, 'others do not see a personal template');
update public.layout_templates set name = 'Club night 2', updated_at = now() where club_id = pg_temp.club();
select results_eq($$ select name from public.layout_templates $$, $$ values ('Club night 2') $$, 'admins rename club templates');
reset role;
select pg_temp.sign_in(3);
select is_empty($$ select * from public.layout_templates $$, 'outsiders see nothing');
reset role;

-- At most 100 per scope.
insert into public.layout_templates (owner_id, name, layout, created_by)
select pg_temp.uid(3), 'T' || n, '{"elements": []}', pg_temp.uid(3) from generate_series(1, 100) n;
select pg_temp.sign_in(3);
select throws_ok(
  $$ insert into public.layout_templates (owner_id, name, layout) values (pg_temp.uid(3), 'One more', '{"elements": []}') $$,
  '42501', null, 'a scope holds 100 templates'
);
reset role;

-- Download my data.
select pg_temp.sign_in(2);
select is((public.my_data() -> 'templates' -> 0 ->> 'name'), 'My training', 'my data lists my templates');
reset role;

select * from finish();
rollback;
