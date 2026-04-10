-- Lock down Nuna operational tables from browser clients.
-- Apply this in the Supabase SQL editor or your preferred migration workflow.

begin;

-- Application user roles are resolved server-side. Do not expose this table
-- directly to browser clients.
alter table if exists public.users enable row level security;
alter table if exists public.users force row level security;

revoke all on table public.users from anon;
revoke all on table public.users from authenticated;

-- Core ops tables should be accessed only through server-side endpoints.
alter table if exists public.locations enable row level security;
alter table if exists public.locations force row level security;

alter table if exists public.trips enable row level security;
alter table if exists public.trips force row level security;

alter table if exists public.session_states enable row level security;
alter table if exists public.session_states force row level security;

alter table if exists public.location_resolution_events enable row level security;
alter table if exists public.location_resolution_events force row level security;

alter table if exists public.location_aliases enable row level security;
alter table if exists public.location_aliases force row level security;

alter table if exists public.user_saved_places enable row level security;
alter table if exists public.user_saved_places force row level security;

alter table if exists public.profiles enable row level security;
alter table if exists public.profiles force row level security;

revoke all on table public.locations from anon;
revoke all on table public.locations from authenticated;

revoke all on table public.trips from anon;
revoke all on table public.trips from authenticated;

revoke all on table public.session_states from anon;
revoke all on table public.session_states from authenticated;

revoke all on table public.location_resolution_events from anon;
revoke all on table public.location_resolution_events from authenticated;

revoke all on table public.location_aliases from anon;
revoke all on table public.location_aliases from authenticated;

revoke all on table public.user_saved_places from anon;
revoke all on table public.user_saved_places from authenticated;

revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;

comment on table public.users is
  'Application users mirrored from auth.users. Browser clients must use server endpoints.';

comment on table public.locations is
  'Operational landmark data. Browser clients must use server endpoints.';

comment on table public.trips is
  'Operational trip data. Browser clients must use server endpoints.';

comment on table public.session_states is
  'WhatsApp session workflow state. Browser clients must not access this table.';

comment on table public.location_resolution_events is
  'Internal analytics trail. Browser clients must use server endpoints.';

comment on table public.location_aliases is
  'Operational alias data. Browser clients must use server endpoints.';

comment on table public.user_saved_places is
  'Operational user memory data. Browser clients must use server endpoints.';

comment on table public.profiles is
  'Phone-based rider profile data. Browser clients must use server endpoints.';

commit;
