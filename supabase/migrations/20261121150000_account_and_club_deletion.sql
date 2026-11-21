-- Your own data, deleting your account, and deleting a club.
--
-- my_data() returns everything stored about the signed-in user, for "Download my data".
--
-- delete_club() lets an admin delete a club with everything in it: maps and their versions, events,
-- exports, members and invites. Files cannot be deleted from SQL (Storage refuses), so it queues a
-- delete_files job with the club's files (every path starts with the club's id) for the worker.
--
-- delete_my_account() deletes the signed-in user. It is refused while they are the only admin of a club
-- that has other members (someone else must be made admin first, so no club is left without one). Clubs
-- where they are the only member are deleted with them. Their export files are removed. Everything
-- else that points to them keeps its data and loses the name: clubs, maps, versions, events and
-- revisions they created stay with the club (created_by etc. become null); memberships, event access
-- and exports go with the account.

-- The club's files in every bucket, as [{bucket, name}].
create function private.club_files(club uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name)), '[]'::jsonb)
  from storage.objects o
  where o.bucket_id in ('map-originals', 'map-tiles', 'exports') and o.name like club::text || '/%';
$$;

revoke execute on function private.club_files(uuid) from public, anon, authenticated;

-- Delete a club and queue the removal of its files. Callers check who may.
create function private.remove_club(club uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  files jsonb := private.club_files(club);
begin
  if jsonb_array_length(files) > 0 then
    insert into public.jobs (type, payload) values ('delete_files', jsonb_build_object('files', files));
  end if;
  -- Events first: they point to map versions, which may not go while an event uses them.
  delete from public.events where club_id = club;
  delete from public.clubs where id = club;
end;
$$;

revoke execute on function private.remove_club(uuid) from public, anon, authenticated;

create function public.delete_club(club uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_club_admin(club) then
    raise exception 'club not found' using errcode = '42501';
  end if;
  perform private.remove_club(club);
end;
$$;

revoke execute on function public.delete_club(uuid) from public, anon;
grant execute on function public.delete_club(uuid) to authenticated;

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  blocking text[];
  club uuid;
  files jsonb;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Clubs that would be left without an admin while others are still in them.
  select array_agg(c.name order by c.name) into blocking
  from public.club_members m
  join public.clubs c on c.id = m.club_id
  where m.user_id = uid and m.role = 'admin'
    and not exists (select 1 from public.club_members o where o.club_id = m.club_id and o.role = 'admin' and o.user_id <> uid)
    and exists (select 1 from public.club_members o where o.club_id = m.club_id and o.user_id <> uid);
  if blocking is not null then
    raise exception 'you are the only admin of a club with other members'
      using errcode = 'P0001', hint = 'only_admin', detail = to_jsonb(blocking)::text;
  end if;

  -- Clubs where they are the only member go with them.
  for club in
    select m.club_id from public.club_members m
    where m.user_id = uid and not exists (select 1 from public.club_members o where o.club_id = m.club_id and o.user_id <> uid)
  loop
    perform private.remove_club(club);
  end loop;

  -- Their exports in the clubs that stay.
  select coalesce(jsonb_agg(jsonb_build_object('bucket', 'exports', 'name', x.path)), '[]'::jsonb) into files
  from public.exports x
  where x.requested_by = uid and x.path is not null;
  if jsonb_array_length(files) > 0 then
    insert into public.jobs (type, payload) values ('delete_files', jsonb_build_object('files', files));
  end if;

  -- The profile, memberships, event access and exports cascade from here.
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Everything stored about the signed-in user.
create function public.my_data()
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
    )
  );
end;
$$;

revoke execute on function public.my_data() from public, anon;
grant execute on function public.my_data() to authenticated;
