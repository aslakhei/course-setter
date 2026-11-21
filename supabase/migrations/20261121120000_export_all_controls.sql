-- request_export() also takes 'all': the page of every control of the event (for setting them out),
-- printed like a course from the settings in the event document's allControls. It needs at least one
-- control in the event.

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
