-- Manual migration for rider operations foundation.
-- Apply this in the Supabase SQL editor or your preferred migration workflow.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'rider_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.rider_status as enum (
      'offline',
      'available',
      'assigned',
      'on_trip',
      'suspended'
    );
  end if;
end
$$;

create table if not exists public.riders (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  full_name text,
  phone_number text unique,
  vehicle_type text,
  bike_plate_number text,
  status public.rider_status not null default 'offline',
  is_verified boolean not null default false,
  service_zone text,
  current_latitude double precision,
  current_longitude double precision,
  last_seen_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

comment on table public.riders is
  'Operational rider profiles linked to authenticated users.';

comment on column public.riders.status is
  'Current rider availability state used for assignment and dispatch operations.';

alter table public.trips
  add column if not exists rider_id uuid references public.riders(id) on delete set null,
  add column if not exists sender_phone text,
  add column if not exists recipient_phone text,
  add column if not exists assigned_at timestamp with time zone,
  add column if not exists confirmed_at timestamp with time zone,
  add column if not exists picked_up_at timestamp with time zone,
  add column if not exists completed_at timestamp with time zone,
  add column if not exists canceled_at timestamp with time zone;

comment on column public.trips.user_id is
  'Sender profile id from the WhatsApp intake flow.';

comment on column public.trips.rider_id is
  'Assigned rider responsible for fulfillment.';

comment on column public.trips.sender_phone is
  'Sender contact number captured at trip creation time.';

comment on column public.trips.recipient_phone is
  'Recipient contact number captured for delivery coordination.';

comment on column public.trips.assigned_at is
  'Timestamp when ops or automation assigned the rider.';

comment on column public.trips.confirmed_at is
  'Timestamp when the rider confirmed the job.';

comment on column public.trips.picked_up_at is
  'Timestamp when the package was picked up.';

comment on column public.trips.completed_at is
  'Timestamp when the delivery was completed.';

comment on column public.trips.canceled_at is
  'Timestamp when the trip was canceled.';

update public.trips t
set sender_phone = p.phone_number
from public.profiles p
where t.sender_phone is null
  and t.user_id = p.id;

create index if not exists idx_riders_status
  on public.riders (status);

create index if not exists idx_riders_last_seen_at
  on public.riders (last_seen_at desc);

create index if not exists idx_trips_rider_id
  on public.trips (rider_id);

create index if not exists idx_trips_status_created_at
  on public.trips (status, created_at desc);

commit;
