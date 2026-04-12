alter table public.trips
  add column if not exists tracking_token text unique;

create unique index if not exists trips_tracking_token_idx
  on public.trips (tracking_token)
  where tracking_token is not null;

update public.trips
set tracking_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
where tracking_token is null;

comment on column public.trips.tracking_token is
  'Public-safe tracking token used for customer tracking links.';
