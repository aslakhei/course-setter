-- Club branding for print layout templates: the club's logo (a ready image of its club library) and two
-- colours, filled into templates where they say {club.logo}, {club.colour}, {club.colour2}; and club
-- images marked as sponsors ({club.sponsor.1} …, in the order they were added). Admins set them.

alter table public.clubs
  add column logo_asset_id uuid references public.layout_assets (id) on delete set null,
  add column colour text check (colour ~ '^#[0-9a-fA-F]{6}$'),
  add column colour2 text check (colour2 ~ '^#[0-9a-fA-F]{6}$');

comment on column public.clubs.logo_asset_id is 'The club logo for templates ({club.logo}): an image of the club library.';
comment on column public.clubs.colour is 'Club colour for templates ({club.colour}), #rrggbb.';
comment on column public.clubs.colour2 is 'Second club colour for templates ({club.colour2}), #rrggbb.';

alter table public.layout_assets add column sponsor boolean not null default false;
comment on column public.layout_assets.sponsor is 'A club library image of a sponsor: templates show sponsors where they say {club.sponsor.N}.';

-- Set the club's branding; null (or a blank colour) clears a part of it.
create function public.set_club_branding(club uuid, logo_asset_id uuid default null, colour text default null, colour2 text default null)
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
      colour2 = nullif(btrim(set_club_branding.colour2), '')
  where id = club;
end;
$$;

-- Mark a club library image as a sponsor (or not).
create function public.set_asset_sponsor(asset_id uuid, sponsor boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.layout_assets;
begin
  select * into a from public.layout_assets where id = set_asset_sponsor.asset_id for update;
  if not found or a.club_id is null or a.event_id is not null or not private.is_club_admin(a.club_id) then
    raise exception 'image not found' using errcode = '42501';
  end if;
  update public.layout_assets set sponsor = set_asset_sponsor.sponsor where id = a.id;
end;
$$;

revoke execute on function public.set_club_branding(uuid, uuid, text, text) from public, anon;
revoke execute on function public.set_asset_sponsor(uuid, boolean) from public, anon;
grant execute on function public.set_club_branding(uuid, uuid, text, text) to authenticated;
grant execute on function public.set_asset_sponsor(uuid, boolean) to authenticated;
