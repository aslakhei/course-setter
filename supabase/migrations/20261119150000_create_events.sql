-- Events: a training or race with its courses, set on one map version.
--
-- The courses (control pool, courses, print settings) are one JSON document per event, validated by
-- packages/core. Saving goes through save_event(), which refuses a save based on an out-of-date
-- revision (someone else saved meanwhile) and keeps every saved revision in event_revisions.
--
-- Access: an event is visible only to its creator, the club's admins and the club members invited to
-- it, and only while they are in the club. Everyone with access edits it and may invite other members
-- of the club. The creator and admins remove access and delete the event; invitees may leave.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  event_date date,
  -- Courses are pinned to this version; moving to a newer one goes through its transform.
  map_version_id uuid not null references public.map_versions (id) on delete restrict,
  doc jsonb not null,
  schema_version integer not null default 1,
  revision integer not null default 1,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (id, club_id),
  check (jsonb_typeof(doc) = 'object' and octet_length(doc::text) < 2000000)
);

create index events_club_id_idx on public.events (club_id);
create index events_map_version_id_idx on public.events (map_version_id);

create table public.event_members (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid default auth.uid() references public.profiles (id) on delete set null,
  invited_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index event_members_user_id_idx on public.event_members (user_id);

create table public.event_revisions (
  event_id uuid not null references public.events (id) on delete cascade,
  revision integer not null,
  doc jsonb not null,
  saved_by uuid references public.profiles (id) on delete set null,
  saved_at timestamptz not null default now(),
  primary key (event_id, revision)
);

comment on table public.events is 'An event and its courses (doc). See migration create_events for access and saving.';
comment on table public.event_members is 'Club members invited to an event (besides its creator and the club admins).';
comment on table public.event_revisions is 'Every saved revision of an event document.';

-- Access check for policies (security definer: no RLS recursion through events and event_members).
create function private.can_access_event(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = event
      and private.is_club_member(e.club_id)
      and (
        e.created_by = (select auth.uid())
        or private.is_club_admin(e.club_id)
        or exists (select 1 from public.event_members m where m.event_id = e.id and m.user_id = (select auth.uid()))
      )
  );
$$;

-- The creator (while in the club) or a club admin: may delete the event and remove access.
create function private.can_manage_event(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = event
      and (
        (e.created_by = (select auth.uid()) and private.is_club_member(e.club_id))
        or private.is_club_admin(e.club_id)
      )
  );
$$;

revoke execute on function private.can_access_event(uuid) from public, anon;
revoke execute on function private.can_manage_event(uuid) from public, anon;
grant execute on function private.can_access_event(uuid) to authenticated;
grant execute on function private.can_manage_event(uuid) to authenticated;

alter table public.events enable row level security;
alter table public.event_members enable row level security;
alter table public.event_revisions enable row level security;
revoke all on public.events, public.event_members, public.event_revisions from anon, authenticated;
grant all on public.events, public.event_members, public.event_revisions to service_role;

-- Events are created with create_event() and their document saved with save_event(); name and date
-- can be changed directly.
grant select, update (name, event_date), delete on public.events to authenticated;
create policy "events: people with access read" on public.events
  for select to authenticated
  using (private.can_access_event(id));
create policy "events: people with access rename" on public.events
  for update to authenticated
  using (private.can_access_event(id))
  with check (private.can_access_event(id));
create policy "events: creator and admins delete" on public.events
  for delete to authenticated
  using (private.can_manage_event(id));

grant select, insert (event_id, user_id), delete on public.event_members to authenticated;
create policy "event members: people with access see who has access" on public.event_members
  for select to authenticated
  using (private.can_access_event(event_id));
create policy "event members: people with access invite" on public.event_members
  for insert to authenticated
  with check (private.can_access_event(event_id));
create policy "event members: creator and admins remove, anyone leaves" on public.event_members
  for delete to authenticated
  using (private.can_manage_event(event_id) or user_id = (select auth.uid()));

grant select on public.event_revisions to authenticated;
create policy "event revisions: people with access read" on public.event_revisions
  for select to authenticated
  using (private.can_access_event(event_id));

-- Only members of the event's club can be invited.
create function private.event_member_in_club()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.events e join public.club_members m on m.club_id = e.club_id
    where e.id = new.event_id and m.user_id = new.user_id
  ) then
    raise exception 'only members of the club can be invited to its events' using errcode = '23514', hint = 'not_club_member';
  end if;
  return new;
end;
$$;

revoke execute on function private.event_member_in_club() from public, anon, authenticated;
create trigger event_members_in_club
  before insert on public.event_members
  for each row execute function private.event_member_in_club();

-- Leaving (or being removed from) a club ends access to its events.
create function private.remove_event_access_on_leaving_club()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.event_members em
  using public.events e
  where em.event_id = e.id and e.club_id = old.club_id and em.user_id = old.user_id;
  return old;
end;
$$;

revoke execute on function private.remove_event_access_on_leaving_club() from public, anon, authenticated;
create trigger club_members_remove_event_access
  after delete on public.club_members
  for each row execute function private.remove_event_access_on_leaving_club();

-- Create an event with an empty course document on a ready version of one of the club's maps.
create function public.create_event(club uuid, event_name text, map_version uuid, event_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
  empty jsonb := '{"schemaVersion": 1, "controls": [], "courses": []}';
begin
  if uid is null or not private.is_club_member(club) then
    raise exception 'only club members can create events' using errcode = '42501';
  end if;
  if not exists (select 1 from public.map_versions v where v.id = map_version and v.club_id = club and v.status = 'ready') then
    raise exception 'map version not found or not ready' using errcode = '22023';
  end if;
  insert into public.events (club_id, name, event_date, map_version_id, doc, created_by, updated_by)
  values (club, btrim(event_name), event_date, map_version, empty, uid, uid)
  returning id into new_id;
  insert into public.event_revisions (event_id, revision, doc, saved_by) values (new_id, 1, empty, uid);
  return new_id;
end;
$$;

-- Save the course document. `expected_revision` is the revision the editor started from; when someone
-- else saved in between, nothing is written and the error's detail says who saved which revision and
-- when ({"revision", "savedBy", "savedAt"}), so the editor can offer "keep mine" or "use theirs".
-- Returns the new revision.
create function public.save_event(event uuid, doc jsonb, expected_revision integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  current public.events;
  next_revision integer;
begin
  select * into current from public.events where id = event for update;
  if not found or not private.can_access_event(event) then
    raise exception 'event not found' using errcode = '42501';
  end if;
  if current.revision <> expected_revision then
    raise exception 'someone else saved this event'
      using errcode = 'P0001', hint = 'conflict', detail = jsonb_build_object(
        'revision', current.revision,
        'savedBy', (select p.display_name from public.profiles p where p.id = current.updated_by),
        'savedAt', current.updated_at
      )::text;
  end if;
  if jsonb_typeof(doc) is distinct from 'object' or jsonb_typeof(doc -> 'schemaVersion') is distinct from 'number' then
    raise exception 'not a course document' using errcode = '22023';
  end if;

  next_revision := current.revision + 1;
  update public.events
  set doc = save_event.doc, schema_version = (save_event.doc ->> 'schemaVersion')::integer, revision = next_revision,
      updated_by = uid, updated_at = now()
  where id = event;
  insert into public.event_revisions (event_id, revision, doc, saved_by) values (event, next_revision, save_event.doc, uid);
  return next_revision;
end;
$$;

revoke execute on function public.create_event(uuid, text, uuid, date) from public, anon;
revoke execute on function public.save_event(uuid, jsonb, integer) from public, anon;
grant execute on function public.create_event(uuid, text, uuid, date) to authenticated;
grant execute on function public.save_event(uuid, jsonb, integer) to authenticated;

-- A map version that events are set on cannot be deleted (the courses would lose their map).
create or replace function public.delete_map_version(map_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.map_versions;
begin
  select * into v from public.map_versions where id = map_version_id for update;
  if not found or not private.is_club_admin(v.club_id) or v.status = 'deleted' then
    raise exception 'map version not found' using errcode = '42501';
  end if;
  if exists (select 1 from public.events e where e.map_version_id = v.id) then
    raise exception 'events use this map version' using errcode = '23503', hint = 'version_in_use';
  end if;

  update public.map_versions set status = 'deleted', deleted_at = now() where id = v.id;
  insert into public.jobs (type, payload) values ('delete_map_version', jsonb_build_object('map_version_id', v.id));
end;
$$;
