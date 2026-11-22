-- A third club colour for print layout templates ({club.colour3}). Universal templates are made for as
-- many colours as the club has set (one to three).

alter table public.clubs add column colour3 text check (colour3 ~ '^#[0-9a-fA-F]{6}$');
comment on column public.clubs.colour3 is 'Third club colour for templates ({club.colour3}), #rrggbb.';

drop function public.set_club_branding(uuid, uuid, text, text);

-- Set the club's branding; null (or a blank colour) clears a part of it.
create function public.set_club_branding(
  club uuid,
  logo_asset_id uuid default null,
  colour text default null,
  colour2 text default null,
  colour3 text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_club_admin(club) then
    raise exception 'club not found' using errcode = '42501';
  end if;
  if set_club_branding.logo_asset_id is not null and not exists (
    select 1 from public.layout_assets a
    where a.id = set_club_branding.logo_asset_id and a.club_id = club and a.event_id is null and a.status = 'ready'
  ) then
    raise exception 'the logo must be a ready image of the club library' using errcode = '22023';
  end if;

  update public.clubs
  set logo_asset_id = set_club_branding.logo_asset_id,
      colour = nullif(btrim(set_club_branding.colour), ''),
      colour2 = nullif(btrim(set_club_branding.colour2), ''),
      colour3 = nullif(btrim(set_club_branding.colour3), '')
  where id = club;
end;
$$;

revoke execute on function public.set_club_branding(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.set_club_branding(uuid, uuid, text, text, text) to authenticated;
