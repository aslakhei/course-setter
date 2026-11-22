-- Details of a map version that printed courses can show (fields in a print layout): the contour
-- interval, who made the map and the year it was made or revised. Set by the club's admins.

alter table public.map_versions
  add column contour_interval numeric(4, 1) check (contour_interval between 0.5 and 50),
  add column mapper text check (char_length(mapper) between 1 and 200),
  add column map_year smallint check (map_year between 1900 and 2100);

comment on column public.map_versions.contour_interval is 'Contour interval in metres, shown on printed courses ({contour}).';
comment on column public.map_versions.mapper is 'Who made the map (names, credits), shown on printed courses ({mapper}).';
comment on column public.map_versions.map_year is 'Year the map was made or last revised, shown on printed courses ({mapYear}).';

-- Set all three at once; a detail left out, null or blank clears it.
create function public.set_map_version_details(
  map_version_id uuid,
  contour_interval numeric default null,
  mapper text default null,
  map_year integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.map_versions;
begin
  select * into v from public.map_versions where id = set_map_version_details.map_version_id for update;
  if not found or not private.is_club_admin(v.club_id) or v.status = 'deleted' then
    raise exception 'map version not found' using errcode = '42501';
  end if;

  update public.map_versions
  set contour_interval = set_map_version_details.contour_interval,
      mapper = nullif(btrim(set_map_version_details.mapper), ''),
      map_year = set_map_version_details.map_year
  where id = v.id;
end;
$$;

revoke execute on function public.set_map_version_details(uuid, numeric, text, integer) from public, anon;
grant execute on function public.set_map_version_details(uuid, numeric, text, integer) to authenticated;
