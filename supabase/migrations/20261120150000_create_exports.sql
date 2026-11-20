-- PDF exports of courses.
--
-- request_export() records which courses of an event to print (as the event was at its current
-- revision) and queues an export_pdf job. The worker renders the map from the original file (which
-- never leaves the server), draws the courses on top, uploads the PDF (or a zip of one PDF per course)
-- to the private exports bucket and marks the export ready. The person who asked for it can then
-- download it for 24 hours; after that the worker removes the file and marks the export expired.

create type public.export_status as enum ('queued', 'running', 'ready', 'failed', 'expired');

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete cascade,
  -- The event document as it was when the export was asked for (event_revisions holds it).
  revision integer not null,
  course_ids text[] not null check (cardinality(course_ids) between 1 and 100),
  -- One PDF with a page per course, or one PDF per course in a zip.
  separate boolean not null default false,
  status public.export_status not null default 'queued',
  -- In the exports bucket: <club_id>/<event_id>/<export_id>/<file_name>.
  path text,
  file_name text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null default now() + interval '24 hours'
);

create index exports_event_id_idx on public.exports (event_id);
create index exports_expires_idx on public.exports (expires_at) where status in ('ready', 'failed');

comment on table public.exports is 'PDF exports of courses, made by the worker. See migration create_exports.';

alter table public.exports enable row level security;
revoke all on public.exports from anon, authenticated;
grant all on public.exports to service_role;

-- People see their own exports of events they (still) have access to; only request_export() and the
-- worker write.
grant select on public.exports to authenticated;
create policy "exports: the requester reads" on public.exports
  for select to authenticated
  using (requested_by = (select auth.uid()) and private.can_access_event(event_id));

-- Ask for a PDF of some of an event's courses. Returns the export's id; its status shows progress.
create function public.request_export(event uuid, course_ids text[], separate boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  e public.events;
  known text[];
  new_id uuid;
begin
  select * into e from public.events where id = event;
  if not found or uid is null or not private.can_access_event(event) then
    raise exception 'event not found' using errcode = '42501';
  end if;
  if coalesce(cardinality(course_ids), 0) = 0 then
    raise exception 'choose at least one course' using errcode = '22023', hint = 'no_courses';
  end if;
  select coalesce(array_agg(c ->> 'id'), '{}') into known from jsonb_array_elements(e.doc -> 'courses') c;
  if not (course_ids <@ known) then
    raise exception 'no such course in the event' using errcode = '22023', hint = 'unknown_course';
  end if;

  insert into public.exports (event_id, club_id, requested_by, revision, course_ids, separate)
  values (e.id, e.club_id, uid, e.revision, course_ids, request_export.separate)
  returning id into new_id;
  insert into public.jobs (type, payload) values ('export_pdf', jsonb_build_object('export_id', new_id));
  return new_id;
end;
$$;

revoke execute on function public.request_export(uuid, text[], boolean) from public, anon;
grant execute on function public.request_export(uuid, text[], boolean) to authenticated;

-- Whether the signed-in user may download this export file: theirs, ready and not expired.
create function private.may_read_export(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.exports x
    where x.path = object_name
      and x.status = 'ready'
      and x.expires_at > now()
      and x.requested_by = (select auth.uid())
      and private.can_access_event(x.event_id)
  );
$$;

revoke execute on function private.may_read_export(text) from public, anon;
grant execute on function private.may_read_export(text) to authenticated;

-- Only the worker writes export files; 200 MB covers a zip of many A3 pages from OCAD maps.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exports', 'exports', false, 200 * 1024 * 1024, array['application/pdf', 'application/zip'])
on conflict (id) do nothing;

create policy "exports: the requester downloads" on storage.objects
  for select to authenticated
  using (bucket_id = 'exports' and private.may_read_export(name));
