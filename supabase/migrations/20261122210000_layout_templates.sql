-- Saved print layout templates: a club's (members use them, admins save, rename and delete them) or a
-- person's own (only they see them, in any club's events). The layout is a print layout whose club logo,
-- colours and sponsors are tokens (see packages/core/src/print/templates.ts), so it takes the branding
-- of the club it is used in. The app checks the layout against the core schema when it reads it.

create table public.layout_templates (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  layout jsonb not null check (jsonb_typeof(layout) = 'object' and octet_length(layout::text) < 200000),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((club_id is null) <> (owner_id is null))
);

create index layout_templates_club_idx on public.layout_templates (club_id);
create index layout_templates_owner_idx on public.layout_templates (owner_id);

comment on table public.layout_templates is 'Saved print layout templates (club or personal). See migration layout_templates.';

-- Who may change a template, and whether its scope has room for another (100 each).
create function private.may_write_template(club uuid, owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when club is not null then owner is null and private.is_club_admin(club)
    else owner = (select auth.uid())
  end;
$$;

create function private.template_room(club uuid, owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select count(*) from public.layout_templates t
    where (club is not null and t.club_id = club) or (owner is not null and t.owner_id = owner)
  ) < 100;
$$;

revoke execute on function private.may_write_template(uuid, uuid) from public, anon;
revoke execute on function private.template_room(uuid, uuid) from public, anon;
grant execute on function private.may_write_template(uuid, uuid) to authenticated;
grant execute on function private.template_room(uuid, uuid) to authenticated;

alter table public.layout_templates enable row level security;
revoke all on public.layout_templates from anon, authenticated;
grant select, insert, delete, update (name, layout, updated_at) on public.layout_templates to authenticated;
grant all on public.layout_templates to service_role;

create policy "layout templates: read" on public.layout_templates
  for select to authenticated
  using ((club_id is not null and private.is_club_member(club_id)) or owner_id = (select auth.uid()));
create policy "layout templates: save" on public.layout_templates
  for insert to authenticated
  with check (private.may_write_template(club_id, owner_id) and private.template_room(club_id, owner_id) and created_by = (select auth.uid()));
create policy "layout templates: change" on public.layout_templates
  for update to authenticated
  using (private.may_write_template(club_id, owner_id))
  with check (private.may_write_template(club_id, owner_id));
create policy "layout templates: delete" on public.layout_templates
  for delete to authenticated
  using (private.may_write_template(club_id, owner_id));

-- "Download my data" also lists the templates the user saved.
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
    ),
    'templates', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', t.name, 'club', c.name, 'personal', t.owner_id is not null, 'createdAt', t.created_at, 'updatedAt', t.updated_at
      ) order by t.created_at), '[]'::jsonb)
      from public.layout_templates t left join public.clubs c on c.id = t.club_id
      where t.created_by = uid or t.owner_id = uid
    )
  );
end;
$$;
