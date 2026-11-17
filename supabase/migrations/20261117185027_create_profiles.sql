-- Profiles: the minimum we keep about a user (GDPR: name and avatar from Google, nothing else).
-- One row per auth user, created automatically on sign-up, deleted with the user.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Public profile of a signed-in user; created by trigger on auth.users insert.';

alter table public.profiles enable row level security;

-- Explicit grants (the hosted project does not expose new tables automatically):
-- not signed in = nothing; signed in = read + update of display_name (rows limited by RLS below).
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- Signed in: read and update only your own row. Rows are inserted by the trigger and deleted by
-- cascade, so there are no insert/delete policies. Club members seeing each other comes with clubs.
create policy "profiles: read own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

-- The trigger function must not be callable through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
