-- Let the API embed a member's profile (name, avatar) in club_members queries: PostgREST follows
-- foreign keys, and club_members.user_id only pointed at auth.users. Every user has a profile (created
-- on sign-up and backfilled), and profiles are deleted with their user, so this changes no behaviour.
alter table public.club_members
  add constraint club_members_user_id_profile_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;
