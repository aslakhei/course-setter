-- Images for print layouts: club logos, sponsors, one-off pictures (PNG, JPEG, SVG or PDF, up to 5 MB).
--
-- Three scopes, each with its own folder in the private layout-assets bucket:
--   club library  <club_id>/library/<asset_id>/original.<ext>        club admins add and delete, members read
--   event         <club_id>/events/<event_id>/<asset_id>/original.<ext>  anyone with access to the event
--   personal      users/<user_id>/<asset_id>/original.<ext>          only its owner
--
-- Upload, as for maps:
--   1. start_asset_upload() creates the row (status 'uploading') and returns the Storage path;
--   2. the browser uploads the file to that path (the only one it may use);
--   3. finish_asset_upload() checks the file is there, sets 'processing' and queues a
--      process_layout_asset job. The worker checks the file by its content, reads its natural size,
--      renders a PNG preview of a PDF (browsers cannot draw PDFs on a canvas) and sets 'ready' or
--      'failed'.
-- Rows are deleted by delete_layout_asset() or with their club, event or owner; a trigger then queues
-- the removal of their files, so no file outlives its row.
--
-- The worker prints an image only if event_layout_assets() says the event may use it (the event's club
-- library, the event's own images, personal images of people with access to the event): an event
-- document is written by the browser, so it could name any asset id.

create type public.asset_kind as enum ('png', 'jpeg', 'svg', 'pdf');
create type public.asset_status as enum ('uploading', 'processing', 'ready', 'failed');

create table public.layout_assets (
  id uuid primary key default gen_random_uuid(),
  -- Club library: club_id. Event image: club_id and event_id. Personal: owner_id only.
  club_id uuid references public.clubs (id) on delete cascade,
  event_id uuid,
  owner_id uuid references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  kind public.asset_kind not null,
  status public.asset_status not null default 'uploading',
  original_path text not null unique,
  -- A PNG rendering of a PDF image, for the browser.
  preview_path text,
  -- Natural size, filled in by the worker: pixels (PNG, JPEG), user units (SVG), points (PDF).
  width double precision check (width > 0),
  height double precision check (height > 0),
  bytes integer,
  -- Why processing failed: a code the app translates.
  error_code text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((owner_id is null) = (club_id is not null)),
  check (event_id is null or club_id is not null),
  -- An event image belongs to the event's club, and goes with the event.
  foreign key (event_id, club_id) references public.events (id, club_id) on delete cascade
);

create index layout_assets_club_idx on public.layout_assets (club_id) where event_id is null;
create index layout_assets_event_idx on public.layout_assets (event_id);
create index layout_assets_owner_idx on public.layout_assets (owner_id);
create index layout_assets_uploaded_by_idx on public.layout_assets (uploaded_by);

comment on table public.layout_assets is 'Images for print layouts (club library, event, personal). See migration create_layout_assets.';

-- Whether the signed-in user may see the images of a scope, and add or delete them.
create function private.can_read_asset_scope(club uuid, event uuid, owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when owner is not null then owner = (select auth.uid())
    when event is not null then private.can_access_event(event)
    else private.is_club_member(club)
  end;
$$;

create function private.can_write_asset_scope(club uuid, event uuid, owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when owner is not null then owner = (select auth.uid())
    when event is not null then private.can_access_event(event)
    else private.is_club_admin(club)
  end;
$$;

revoke execute on function private.can_read_asset_scope(uuid, uuid, uuid) from public, anon;
revoke execute on function private.can_write_asset_scope(uuid, uuid, uuid) from public, anon;
grant execute on function private.can_read_asset_scope(uuid, uuid, uuid) to authenticated;
grant execute on function private.can_write_asset_scope(uuid, uuid, uuid) to authenticated;

alter table public.layout_assets enable row level security;
revoke all on public.layout_assets from anon, authenticated;
grant select on public.layout_assets to authenticated;
grant all on public.layout_assets to service_role;

create policy "layout assets: read in their scope" on public.layout_assets
  for select to authenticated
  using (private.can_read_asset_scope(club_id, event_id, owner_id));

-- How many images a scope may hold (the free plan has 1 GB of Storage).
create function private.asset_limit_reached(club uuid, event uuid, owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when owner is not null then (select count(*) from public.layout_assets a where a.owner_id = owner) >= 100
    when event is not null then (select count(*) from public.layout_assets a where a.event_id = event) >= 50
    else (select count(*) from public.layout_assets a where a.club_id = club and a.event_id is null) >= 200
  end;
$$;

revoke execute on function private.asset_limit_reached(uuid, uuid, uuid) from public, anon, authenticated;

-- Start uploading an image to a scope: 'club' (the club library), 'event' or 'personal'. Returns the
-- new image's id and the Storage path to upload the file to.
create function public.start_asset_upload(
  scope text,
  asset_name text,
  kind public.asset_kind,
  club uuid default null,
  event uuid default null
)
returns table (asset_id uuid, upload_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid := gen_random_uuid();
  target_club uuid := club;
  owner uuid;
  folder text;
  path text;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if scope = 'club' then
    if event is not null or not private.is_club_admin(target_club) then
      raise exception 'only club admins add images to the club library' using errcode = '42501';
    end if;
    folder := target_club || '/library';
  elsif scope = 'event' then
    select e.club_id into target_club from public.events e where e.id = event;
    if target_club is null or not private.can_access_event(event) then
      raise exception 'event not found' using errcode = '42501';
    end if;
    folder := target_club || '/events/' || event;
  elsif scope = 'personal' then
    if club is not null or event is not null then
      raise exception 'a personal image belongs to no club or event' using errcode = '22023';
    end if;
    target_club := null;
    owner := uid;
    folder := 'users/' || uid;
  else
    raise exception 'unknown scope %', scope using errcode = '22023';
  end if;
  if private.asset_limit_reached(target_club, event, owner) then
    raise exception 'too many images' using errcode = 'P0001', hint = 'too_many_images';
  end if;

  path := folder || '/' || new_id || '/original.' || case kind when 'png' then 'png' when 'jpeg' then 'jpg' when 'svg' then 'svg' else 'pdf' end;
  insert into public.layout_assets (id, club_id, event_id, owner_id, name, kind, original_path, uploaded_by)
  values (new_id, target_club, case when scope = 'event' then event end, owner, btrim(coalesce(asset_name, '')), kind, path, uid);
  return query select new_id, path;
end;
$$;

-- The file is uploaded: queue processing.
create function public.finish_asset_upload(asset_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.layout_assets;
begin
  select * into a from public.layout_assets where id = finish_asset_upload.asset_id for update;
  if not found or a.uploaded_by is distinct from auth.uid() then
    raise exception 'image not found' using errcode = '42501';
  end if;
  if a.status <> 'uploading' then
    raise exception 'this image is not waiting for an upload' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'layout-assets' and o.name = a.original_path) then
    raise exception 'the image file has not been uploaded' using errcode = '22023', hint = 'file_missing';
  end if;

  update public.layout_assets set status = 'processing' where id = a.id;
  insert into public.jobs (type, payload) values ('process_layout_asset', jsonb_build_object('asset_id', a.id));
end;
$$;

-- Delete an image (its files go too, see the trigger below). Layouts that still use it do not print
-- with a gap: their export fails with a clear message until the image is replaced or removed.
create function public.delete_layout_asset(asset_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.layout_assets;
begin
  select * into a from public.layout_assets where id = delete_layout_asset.asset_id for update;
  if not found or not private.can_write_asset_scope(a.club_id, a.event_id, a.owner_id) then
    raise exception 'image not found' using errcode = '42501';
  end if;
  delete from public.layout_assets where id = a.id;
end;
$$;

revoke execute on function public.start_asset_upload(text, text, public.asset_kind, uuid, uuid) from public, anon;
revoke execute on function public.finish_asset_upload(uuid) from public, anon;
revoke execute on function public.delete_layout_asset(uuid) from public, anon;
grant execute on function public.start_asset_upload(text, text, public.asset_kind, uuid, uuid) to authenticated;
grant execute on function public.finish_asset_upload(uuid) to authenticated;
grant execute on function public.delete_layout_asset(uuid) to authenticated;

-- Deleted rows (one by one, or with their club, event or owner): queue the removal of their files.
create function private.delete_asset_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  files jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('bucket', 'layout-assets', 'name', f.name)), '[]'::jsonb) into files
  from (
    select g.original_path as name from gone g
    union all
    select g.preview_path from gone g where g.preview_path is not null
  ) f;
  if jsonb_array_length(files) > 0 then
    insert into public.jobs (type, payload) values ('delete_files', jsonb_build_object('files', files));
  end if;
  return null;
end;
$$;

revoke execute on function private.delete_asset_files() from public, anon, authenticated;

create trigger layout_assets_delete_files
  after delete on public.layout_assets
  referencing old table as gone
  for each statement execute function private.delete_asset_files();

-- Whether a user (not necessarily the signed-in one) has access to an event: for the worker.
create function private.user_can_access_event(usr uuid, event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = event
      and exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = usr)
      and (
        e.created_by = usr
        or exists (select 1 from public.club_members m where m.club_id = e.club_id and m.user_id = usr and m.role = 'admin')
        or exists (select 1 from public.event_members m where m.event_id = e.id and m.user_id = usr)
      )
  );
$$;

revoke execute on function private.user_can_access_event(uuid, uuid) from public, anon, authenticated;

-- The ready images among `ids` an event may print: its club's library, its own images, and personal
-- images of people with access to it. For the worker (service role) only.
create function public.event_layout_assets(event uuid, ids uuid[])
returns table (id uuid, kind public.asset_kind, original_path text, width double precision, height double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.kind, a.original_path, a.width, a.height
  from public.layout_assets a
  join public.events e on e.id = event_layout_assets.event
  where a.id = any (ids)
    and a.status = 'ready'
    and (
      (a.owner_id is null and a.club_id = e.club_id and (a.event_id is null or a.event_id = e.id))
      or (a.owner_id is not null and private.user_can_access_event(a.owner_id, e.id))
    );
$$;

revoke execute on function public.event_layout_assets(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.event_layout_assets(uuid, uuid[]) to service_role;

-- Storage: uploads only to the path start_asset_upload() handed out, by the person it was handed to,
-- while the image waits for its file; reading (signed URLs) by anyone who may see the image.
create function private.may_upload_asset(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.layout_assets a
    where a.original_path = object_name and a.status = 'uploading' and a.uploaded_by = (select auth.uid())
  );
$$;

create function private.may_read_asset_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.layout_assets a
    where (a.original_path = object_name or a.preview_path = object_name)
      and private.can_read_asset_scope(a.club_id, a.event_id, a.owner_id)
  );
$$;

revoke execute on function private.may_upload_asset(text) from public, anon;
revoke execute on function private.may_read_asset_file(text) from public, anon;
grant execute on function private.may_upload_asset(text) to authenticated;
grant execute on function private.may_read_asset_file(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('layout-assets', 'layout-assets', false, 5 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/svg+xml', 'application/pdf'])
on conflict (id) do nothing;

create policy "layout assets: upload to the handed-out path" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'layout-assets' and private.may_upload_asset(name));

create policy "layout assets: read in their scope" on storage.objects
  for select to authenticated
  using (bucket_id = 'layout-assets' and private.may_read_asset_file(name));

-- "Download my data" also lists the images the user uploaded.
create or replace function public.my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'exportedAt', now(),
    'account', (
      select jsonb_build_object(
        'id', u.id, 'email', u.email, 'name', p.display_name, 'avatarUrl', p.avatar_url,
        'signInWith', u.raw_app_meta_data -> 'providers', 'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at
      )
      from auth.users u left join public.profiles p on p.id = u.id
      where u.id = uid
    ),
    'clubs', (
      select coalesce(jsonb_agg(jsonb_build_object('club', c.name, 'role', m.role, 'joinedAt', m.joined_at) order by m.joined_at), '[]'::jsonb)
      from public.club_members m join public.clubs c on c.id = m.club_id
      where m.user_id = uid
    ),
    'clubsCreated', (
      select coalesce(jsonb_agg(jsonb_build_object('club', c.name, 'createdAt', c.created_at) order by c.created_at), '[]'::jsonb)
      from public.clubs c where c.created_by = uid
    ),
    'invitesCreated', (
      select coalesce(jsonb_agg(jsonb_build_object('club', c.name, 'createdAt', i.created_at, 'expiresAt', i.expires_at, 'revokedAt', i.revoked_at) order by i.created_at), '[]'::jsonb)
      from public.club_invites i join public.clubs c on c.id = i.club_id
      where i.created_by = uid
    ),
    'mapVersionsUploaded', (
      select coalesce(jsonb_agg(jsonb_build_object('club', c.name, 'map', mp.name, 'version', v.version, 'file', v.file_name, 'createdAt', v.created_at) order by v.created_at), '[]'::jsonb)
      from public.map_versions v join public.maps mp on mp.id = v.map_id join public.clubs c on c.id = v.club_id
      where v.created_by = uid
    ),
    'eventsCreated', (
      select coalesce(jsonb_agg(jsonb_build_object('club', c.name, 'event', e.name, 'date', e.event_date, 'createdAt', e.created_at) order by e.created_at), '[]'::jsonb)
      from public.events e join public.clubs c on c.id = e.club_id
      where e.created_by = uid
    ),
    'eventAccess', (
      select coalesce(jsonb_agg(jsonb_build_object('club', c.name, 'event', e.name, 'invitedAt', em.invited_at) order by em.invited_at), '[]'::jsonb)
      from public.event_members em join public.events e on e.id = em.event_id join public.clubs c on c.id = e.club_id
      where em.user_id = uid
    ),
    'eventSaves', (
      select coalesce(jsonb_agg(jsonb_build_object('club', c.name, 'event', e.name, 'savedAt', r.saved_at) order by r.saved_at), '[]'::jsonb)
      from public.event_revisions r join public.events e on e.id = r.event_id join public.clubs c on c.id = e.club_id
      where r.saved_by = uid
    ),
    'exports', (
      select coalesce(jsonb_agg(jsonb_build_object('club', c.name, 'event', e.name, 'file', x.file_name, 'status', x.status, 'createdAt', x.created_at) order by x.created_at), '[]'::jsonb)
      from public.exports x join public.events e on e.id = x.event_id join public.clubs c on c.id = x.club_id
      where x.requested_by = uid
    ),
    'imagesUploaded', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', a.name, 'kind', a.kind, 'club', c.name, 'event', e.name, 'personal', a.owner_id is not null, 'createdAt', a.created_at
      ) order by a.created_at), '[]'::jsonb)
      from public.layout_assets a left join public.clubs c on c.id = a.club_id left join public.events e on e.id = a.event_id
      where a.uploaded_by = uid
    )
  );
end;
$$;
