-- Moving an event to a newer version of its map.
--
-- The editor computes the moved document (every control and bend point through the version-to-version
-- transforms, see packages/core move.ts) and saves it together with the new map version in one step,
-- with the same out-of-date check as save_event(). Each saved revision now also records the map version
-- it was set on, so an earlier revision always pairs with the right map.

alter table public.event_revisions add column map_version_id uuid references public.map_versions (id) on delete restrict;
update public.event_revisions r set map_version_id = e.map_version_id from public.events e where e.id = r.event_id;
comment on column public.event_revisions.map_version_id is 'The map version this revision''s positions refer to.';

-- save_event and create_event record the map version with each revision. A refused save now also says
-- which map version the event is on, so the editor knows when someone moved it to another version
-- (then "keep my version" would put positions on the wrong map).
create or replace function public.save_event(event uuid, doc jsonb, expected_revision integer)
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
        'savedAt', current.updated_at,
        'mapVersionId', current.map_version_id
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
  insert into public.event_revisions (event_id, revision, doc, saved_by, map_version_id)
  values (event, next_revision, save_event.doc, uid, current.map_version_id);
  return next_revision;
end;
$$;

create or replace function public.create_event(club uuid, event_name text, map_version uuid, event_date date default null)
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
  insert into public.event_revisions (event_id, revision, doc, saved_by, map_version_id) values (new_id, 1, empty, uid, map_version);
  return new_id;
end;
$$;

-- Move an event to a newer ready version of the same map, with its moved document. Returns the new
-- revision; a save based on an out-of-date revision fails like save_event().
create function public.move_event_to_version(event uuid, map_version uuid, doc jsonb, expected_revision integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  current public.events;
  from_version public.map_versions;
  to_version public.map_versions;
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
        'savedAt', current.updated_at,
        'mapVersionId', current.map_version_id
      )::text;
  end if;
  select * into from_version from public.map_versions where id = current.map_version_id;
  select * into to_version from public.map_versions where id = map_version;
  if not found or to_version.map_id <> from_version.map_id or to_version.status <> 'ready' or to_version.version <= from_version.version then
    raise exception 'not a newer ready version of the same map' using errcode = '22023', hint = 'invalid_version';
  end if;
  if jsonb_typeof(doc) is distinct from 'object' or jsonb_typeof(doc -> 'schemaVersion') is distinct from 'number' then
    raise exception 'not a course document' using errcode = '22023';
  end if;

  next_revision := current.revision + 1;
  update public.events
  set map_version_id = to_version.id, doc = move_event_to_version.doc,
      schema_version = (move_event_to_version.doc ->> 'schemaVersion')::integer, revision = next_revision,
      updated_by = uid, updated_at = now()
  where id = event;
  insert into public.event_revisions (event_id, revision, doc, saved_by, map_version_id)
  values (event, next_revision, move_event_to_version.doc, uid, to_version.id);
  return next_revision;
end;
$$;

revoke execute on function public.move_event_to_version(uuid, uuid, jsonb, integer) from public, anon;
grant execute on function public.move_event_to_version(uuid, uuid, jsonb, integer) to authenticated;
