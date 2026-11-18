-- Maps and map versions.
--
-- A map belongs to a club and has numbered versions; each version is one uploaded file (OCAD or PDF)
-- that the worker turns into tiles. Courses will be pinned to a version, so versions are never edited
-- in place: a changed map is a new version.
--
-- Upload, done by club admins only:
--   1. start_map_upload() creates the version (status 'uploading') and returns the Storage path;
--   2. the browser uploads the file to that path in the map-originals bucket (the only path it may use);
--   3. finish_map_upload() checks the file is there, sets 'processing' and queues a process_map_version
--      job. The worker fills in scale, extents, georeferencing and tiles, then sets 'ready' (or
--      'needs_alignment' when it cannot line the version up with the previous one, or 'failed').
-- delete_map_version() sets 'deleted' and queues a job that removes the files and then the row.
--
-- Members see a map once it has a ready version, and only its ready versions; admins see everything
-- except deleted versions.

create type public.map_kind as enum ('ocad', 'pdf');
create type public.map_version_status as enum ('uploading', 'processing', 'needs_alignment', 'ready', 'failed', 'deleted');

create table public.maps (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, club_id)
);

create index maps_club_id_idx on public.maps (club_id);

create table public.map_versions (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null,
  -- The map's club, repeated so policies and Storage paths need no join; the foreign key keeps it right.
  club_id uuid not null,
  version integer not null check (version > 0),
  kind public.map_kind not null,
  status public.map_version_status not null default 'uploading',
  -- The uploaded file's name, for display.
  file_name text not null check (char_length(file_name) between 1 and 255),
  original_path text not null unique,
  -- Map scale denominator (15000 for 1:15 000). Given at upload for PDF maps; read from the file for OCAD.
  scale integer check (scale between 500 and 100000),
  -- Filled in by the worker. Paper size in mm; frame = extent in ground metres in the version's map frame
  -- {minX, minY, maxX, maxY}; georef as read from the file; tiles = pyramid description for the viewer.
  paper_width_mm double precision,
  paper_height_mm double precision,
  frame jsonb,
  georef jsonb,
  ocad_version text,
  tiles_path text,
  tiles jsonb,
  -- Similarity transform from the previous version's frame to this one ({a, b, tx, ty}:
  -- x' = a·x − b·y + tx, y' = b·x + a·y + ty), how it was found and how well it fits (RMS, metres).
  transform_from_previous jsonb,
  transform_method text check (transform_method in ('identity', 'georef', 'points')),
  transform_rms_m double precision,
  -- Why processing failed: a code the app translates, plus technical detail for admins.
  error_code text,
  error_message text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  deleted_at timestamptz,
  unique (map_id, version),
  foreign key (map_id, club_id) references public.maps (id, club_id) on delete cascade,
  check (kind = 'ocad' or scale is not null)
);

create index map_versions_club_id_idx on public.map_versions (club_id);

comment on table public.maps is 'A club map; its content lives in map_versions.';
comment on table public.map_versions is 'One uploaded file of a map, processed into tiles by the worker. See migration create_maps.';

alter table public.maps enable row level security;
alter table public.map_versions enable row level security;
revoke all on public.maps, public.map_versions from anon, authenticated;
grant all on public.maps, public.map_versions to service_role;

-- Maps are created by start_map_upload(); admins rename them.
grant select, update (name) on public.maps to authenticated;
create policy "maps: admins read" on public.maps
  for select to authenticated
  using (private.is_club_admin(club_id));
create policy "maps: members read maps with a ready version" on public.maps
  for select to authenticated
  using (
    private.is_club_member(club_id)
    and exists (select 1 from public.map_versions v where v.map_id = maps.id and v.status = 'ready')
  );
create policy "maps: admins rename" on public.maps
  for update to authenticated
  using (private.is_club_admin(club_id))
  with check (private.is_club_admin(club_id));

-- Versions change only through the functions below and the worker.
grant select on public.map_versions to authenticated;
create policy "map versions: admins read" on public.map_versions
  for select to authenticated
  using (private.is_club_admin(club_id) and status <> 'deleted');
create policy "map versions: members read ready" on public.map_versions
  for select to authenticated
  using (private.is_club_member(club_id) and status = 'ready');

-- Start uploading a new map (map_id null, map_name given) or a new version of an existing map.
-- Returns the new version's id and the Storage path to upload the file to.
create function public.start_map_upload(
  club uuid,
  file_name text,
  kind public.map_kind,
  map_id uuid default null,
  map_name text default null,
  scale integer default null
)
returns table (version_id uuid, upload_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target_map uuid := map_id;
  next_version integer;
  new_id uuid := gen_random_uuid();
  path text;
begin
  if uid is null or not private.is_club_admin(club) then
    raise exception 'only club admins can upload maps' using errcode = '42501';
  end if;
  if kind = 'pdf' and scale is null then
    raise exception 'the scale of a PDF map must be given' using errcode = '22023', hint = 'scale_required';
  end if;
  if kind = 'ocad' and scale is not null then
    raise exception 'OCAD maps carry their own scale' using errcode = '22023';
  end if;

  if target_map is null then
    insert into public.maps (club_id, name, created_by) values (club, btrim(coalesce(map_name, '')), uid)
    returning id into target_map;
  else
    -- Lock the map so two uploads at once cannot get the same version number.
    perform 1 from public.maps m where m.id = target_map and m.club_id = club for update;
    if not found then
      raise exception 'map not found in this club' using errcode = '42501';
    end if;
  end if;

  select coalesce(max(v.version), 0) + 1 into next_version from public.map_versions v where v.map_id = target_map;
  path := club || '/' || target_map || '/' || new_id || '/original.' || case kind when 'ocad' then 'ocd' else 'pdf' end;

  insert into public.map_versions (id, map_id, club_id, version, kind, file_name, original_path, scale, created_by)
  values (new_id, target_map, club, next_version, kind, file_name, path, scale, uid);

  return query select new_id, path;
end;
$$;

-- The file is uploaded: queue processing.
create function public.finish_map_upload(map_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.map_versions;
begin
  select * into v from public.map_versions where id = map_version_id for update;
  if not found or not private.is_club_admin(v.club_id) then
    raise exception 'map version not found' using errcode = '42501';
  end if;
  if v.status <> 'uploading' then
    raise exception 'this map version is not waiting for an upload' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'map-originals' and o.name = v.original_path) then
    raise exception 'the map file has not been uploaded' using errcode = '22023', hint = 'file_missing';
  end if;

  update public.map_versions set status = 'processing' where id = v.id;
  insert into public.jobs (type, payload) values ('process_map_version', jsonb_build_object('map_version_id', v.id));
end;
$$;

-- Delete a version: hidden at once; the worker removes its files, then the row (and the map, if it
-- has no versions left). Deleting a version that courses use will be refused once courses exist.
create function public.delete_map_version(map_version_id uuid)
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

  update public.map_versions set status = 'deleted', deleted_at = now() where id = v.id;
  insert into public.jobs (type, payload) values ('delete_map_version', jsonb_build_object('map_version_id', v.id));
end;
$$;

revoke execute on function public.start_map_upload(uuid, text, public.map_kind, uuid, text, integer) from public, anon;
revoke execute on function public.finish_map_upload(uuid) from public, anon;
revoke execute on function public.delete_map_version(uuid) from public, anon;
grant execute on function public.start_map_upload(uuid, text, public.map_kind, uuid, text, integer) to authenticated;
grant execute on function public.finish_map_upload(uuid) to authenticated;
grant execute on function public.delete_map_version(uuid) to authenticated;

-- Originals may only be uploaded to the path start_map_upload() handed out, while that version waits
-- for its file (replaces the club-folder rule from create_clubs).
create function private.may_upload_original(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.map_versions v
    where v.original_path = object_name and v.status = 'uploading' and private.is_club_admin(v.club_id)
  );
$$;

revoke execute on function private.may_upload_original(text) from public, anon;
grant execute on function private.may_upload_original(text) to authenticated;

drop policy "map originals: club admins upload" on storage.objects;
create policy "map originals: admins upload to their upload path" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'map-originals' and private.may_upload_original(name));

-- 50 MB is the Supabase free plan's limit per file; OCAD maps are typically 5–10 MB.
update storage.buckets
set file_size_limit = 50 * 1024 * 1024, allowed_mime_types = array['application/pdf', 'application/octet-stream']
where id = 'map-originals';
