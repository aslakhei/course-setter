-- Clubs, memberships and invite links, plus the Storage buckets for map files.
--
-- Anyone signed in can create a club and becomes its first admin. Admins invite members with a link
-- (a random token, valid 14 days, revocable, usable by many people). Members see the club and each
-- other's profile (name, avatar); admins also manage members and invites. A club always keeps at least
-- one admin. Everything else about a club (maps, events) is readable only by its members.

create type public.club_role as enum ('admin', 'member');

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.club_members (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.club_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

create index club_members_user_id_idx on public.club_members (user_id);

create table public.club_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  -- 144 random bits, URL-safe; the link is /invite/<token>.
  token text not null unique default translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '90 days')
);

create index club_invites_club_id_idx on public.club_invites (club_id);

comment on table public.clubs is 'An orienteering club; members see it, admins manage it.';
comment on table public.club_members is 'Who is in which club, as admin or member. A club always has an admin.';
comment on table public.club_invites is 'Invite links (token), managed by club admins; accepted through accept_invite().';

-- Membership checks for policies. Security definer, so policies on club_members can use them without
-- recursing into their own RLS. The schema is not exposed through the API.
grant usage on schema private to authenticated;

create function private.is_club_member(club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.club_members where club_id = club and user_id = (select auth.uid())
  );
$$;

create function private.is_club_admin(club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.club_members where club_id = club and user_id = (select auth.uid()) and role = 'admin'
  );
$$;

-- True when the signed-in user and `other` are in at least one club together.
create function private.shares_club_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_members me
    join public.club_members them on them.club_id = me.club_id
    where me.user_id = (select auth.uid()) and them.user_id = other
  );
$$;

-- The club a Storage object belongs to: the first folder of its path, or null if that is not a uuid.
create function private.club_of_object(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(object_name, '/', 1)::uuid
  end;
$$;

revoke execute on function private.is_club_member(uuid) from public, anon;
revoke execute on function private.is_club_admin(uuid) from public, anon;
revoke execute on function private.shares_club_with(uuid) from public, anon;
revoke execute on function private.club_of_object(text) from public, anon;
grant execute on function private.is_club_member(uuid) to authenticated;
grant execute on function private.is_club_admin(uuid) to authenticated;
grant execute on function private.shares_club_with(uuid) to authenticated;
grant execute on function private.club_of_object(text) to authenticated;

-- Grants: not signed in = nothing. Rows are limited by the policies below; columns by these grants.
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.club_invites enable row level security;
revoke all on public.clubs, public.club_members, public.club_invites from anon, authenticated;
grant all on public.clubs, public.club_members, public.club_invites to service_role;

-- Clubs are created with create_club() (club + first admin in one step), so there is no insert grant.
grant select, update (name) on public.clubs to authenticated;
create policy "clubs: members read" on public.clubs
  for select to authenticated
  using (private.is_club_member(id));
create policy "clubs: admins rename" on public.clubs
  for update to authenticated
  using (private.is_club_admin(id))
  with check (private.is_club_admin(id));

-- Members are added with accept_invite() or create_club(), so there is no insert grant.
grant select, update (role), delete on public.club_members to authenticated;
create policy "club members: members read" on public.club_members
  for select to authenticated
  using (private.is_club_member(club_id));
create policy "club members: admins change roles" on public.club_members
  for update to authenticated
  using (private.is_club_admin(club_id))
  with check (private.is_club_admin(club_id));
create policy "club members: admins remove, anyone leaves" on public.club_members
  for delete to authenticated
  using (private.is_club_admin(club_id) or user_id = (select auth.uid()));

-- Token and creator come from column defaults; admins choose the club and optionally the expiry.
grant select, insert (club_id, expires_at), update (revoked_at), delete on public.club_invites to authenticated;
create policy "club invites: admins read" on public.club_invites
  for select to authenticated
  using (private.is_club_admin(club_id));
create policy "club invites: admins create" on public.club_invites
  for insert to authenticated
  with check (private.is_club_admin(club_id));
create policy "club invites: admins revoke" on public.club_invites
  for update to authenticated
  using (private.is_club_admin(club_id))
  with check (private.is_club_admin(club_id));
create policy "club invites: admins delete" on public.club_invites
  for delete to authenticated
  using (private.is_club_admin(club_id));

-- Members of a shared club see each other's name and avatar (member lists, "last edited by").
create policy "profiles: read club mates" on public.profiles
  for select to authenticated
  using (private.shares_club_with(id));

-- A club must keep an admin: refuse to remove or demote the last one. Deletes cascading from a deleted
-- club or user account (pg_trigger_depth() > 1) are allowed; handling clubs left without an admin
-- belongs with account deletion.
create function private.keep_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 or old.role <> 'admin' or (tg_op = 'UPDATE' and new.role = 'admin') then
    return coalesce(new, old);
  end if;
  if not exists (
    select 1 from public.club_members
    where club_id = old.club_id and role = 'admin' and user_id <> old.user_id
  ) then
    raise exception 'a club must have at least one admin' using errcode = 'P0001', hint = 'last_admin';
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function private.keep_last_admin() from public, anon, authenticated;

create trigger club_members_keep_last_admin
  before update of role or delete on public.club_members
  for each row execute function private.keep_last_admin();

-- Create a club with the caller as its first admin. Returns the club id.
create function public.create_club(club_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.clubs (name, created_by) values (btrim(club_name), uid) returning id into new_id;
  insert into public.club_members (club_id, user_id, role) values (new_id, uid, 'admin');
  return new_id;
end;
$$;

-- What an invite link leads to, for the invite page: no row if the token is unknown.
-- status: 'valid', 'expired' or 'revoked'.
create function public.invite_info(invite_token text)
returns table (club_id uuid, club_name text, status text, already_member boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    case
      when i.revoked_at is not null then 'revoked'
      when i.expires_at <= now() then 'expired'
      else 'valid'
    end,
    exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = (select auth.uid()))
  from public.club_invites i
  join public.clubs c on c.id = i.club_id
  where i.token = invite_token;
$$;

-- Join the club of a valid invite link as member (no change if already in the club). Returns the club id.
create function public.accept_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  invite public.club_invites;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into invite from public.club_invites where token = invite_token;
  if not found or invite.revoked_at is not null or invite.expires_at <= now() then
    raise exception 'invite link is unknown, expired or revoked' using errcode = 'P0001', hint = 'invalid_invite';
  end if;
  insert into public.club_members (club_id, user_id, role)
  values (invite.club_id, uid, 'member')
  on conflict (club_id, user_id) do nothing;
  return invite.club_id;
end;
$$;

revoke execute on function public.create_club(text) from public, anon;
revoke execute on function public.invite_info(text) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.create_club(text) to authenticated;
grant execute on function public.invite_info(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;

-- Map files. Object paths start with the club id: <club_id>/<map_id>/<version_id>/...
-- Originals: club admins upload them; only the worker (service role) reads them, so users never
-- download an original map file. Tiles: only the worker writes them; club members read them, which is
-- what lets them create signed URLs for the editor.
insert into storage.buckets (id, name, public)
values ('map-originals', 'map-originals', false), ('map-tiles', 'map-tiles', false)
on conflict (id) do nothing;

create policy "map originals: club admins upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'map-originals' and private.is_club_admin(private.club_of_object(name)));

create policy "map tiles: club members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'map-tiles' and private.is_club_member(private.club_of_object(name)));
