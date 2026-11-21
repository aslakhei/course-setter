-- request_export() limits each person to 20 exports an hour: the worker runs on a small monthly budget,
-- and a PDF of many pages from an OCAD map takes it a while. Otherwise as in migration export_all_controls.

create or replace function public.request_export(event uuid, course_ids text[], separate boolean default false)
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
  if (select count(*) from public.exports x where x.requested_by = uid and x.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many exports in the last hour' using errcode = '54000', hint = 'too_many_exports';
  end if;
  if coalesce(cardinality(course_ids), 0) = 0 then
    raise exception 'choose at least one course' using errcode = '22023', hint = 'no_courses';
  end if;
  select coalesce(array_agg(c ->> 'id'), '{}') into known from jsonb_array_elements(e.doc -> 'courses') c;
  if jsonb_array_length(coalesce(e.doc -> 'controls', '[]'::jsonb)) > 0 then
    known := known || 'all'::text;
  end if;
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

-- For the count above and for "your recent PDFs".
create index if not exists exports_requested_by_idx on public.exports (requested_by, created_at);
