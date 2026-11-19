-- Lining up a map version with the previous one.
--
-- The worker sets previous_version_id to the newest earlier ready version of the same map, and
-- transform_from_previous when the files say how they line up (same georeferencing, or the same OCAD
-- map without georeferencing). Otherwise the version waits in 'needs_alignment' until an admin
-- matches points on both versions in the app, which saves the fitted transform here.

alter table public.map_versions
  add column previous_version_id uuid references public.map_versions (id) on delete set null;

comment on column public.map_versions.previous_version_id is
  'The version transform_from_previous starts from (the newest earlier ready version when processed).';

-- Save a transform from matched points. Also used to correct an automatic one.
create function public.set_map_version_alignment(map_version_id uuid, transform jsonb, rms_m double precision)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.map_versions;
  a double precision;
  b double precision;
begin
  select * into v from public.map_versions where id = map_version_id for update;
  if not found or not private.is_club_admin(v.club_id) or v.status not in ('needs_alignment', 'ready') then
    raise exception 'map version not found' using errcode = '42501';
  end if;
  if v.previous_version_id is null then
    raise exception 'this version has no previous version to line up with' using errcode = '22023';
  end if;
  if jsonb_typeof(transform) is distinct from 'object'
    or exists (
      select 1 from unnest(array['a', 'b', 'tx', 'ty']) k where jsonb_typeof(transform -> k) is distinct from 'number'
    )
  then
    raise exception 'transform must be {a, b, tx, ty} numbers' using errcode = '22023';
  end if;
  a := (transform ->> 'a')::double precision;
  b := (transform ->> 'b')::double precision;
  -- A new version of the same terrain is never drawn at a fifth or five times the size.
  if sqrt(a * a + b * b) not between 0.2 and 5 or rms_m is null or rms_m < 0 then
    raise exception 'transform is not plausible' using errcode = '22023';
  end if;

  update public.map_versions
  set transform_from_previous = jsonb_build_object('a', a, 'b', b, 'tx', (transform ->> 'tx')::double precision, 'ty', (transform ->> 'ty')::double precision),
      transform_method = 'points',
      transform_rms_m = rms_m,
      status = 'ready'
  where id = v.id;
end;
$$;

revoke execute on function public.set_map_version_alignment(uuid, jsonb, double precision) from public, anon;
grant execute on function public.set_map_version_alignment(uuid, jsonb, double precision) to authenticated;
