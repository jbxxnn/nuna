create table if not exists public.rider_assignment_events (
  id uuid primary key default uuid_generate_v4(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  rider_id uuid not null references public.riders(id) on delete cascade,
  action text not null check (action in ('assigned', 'accepted', 'declined', 'timed_out', 'unassigned')),
  actor_role text not null check (actor_role in ('ops', 'rider', 'system')),
  created_at timestamptz not null default now()
);

create index if not exists rider_assignment_events_trip_created_idx
  on public.rider_assignment_events (trip_id, created_at desc);

create index if not exists rider_assignment_events_rider_created_idx
  on public.rider_assignment_events (rider_id, created_at desc);
