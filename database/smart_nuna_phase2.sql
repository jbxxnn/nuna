-- Manual migration for smarter Nuna bot flows
-- Apply this in Supabase SQL editor or your preferred migration workflow.

begin;

-- Expand session state so the bot can persist clarification context,
-- candidate choices, and retry behavior between WhatsApp messages.
alter table public.session_states
  add column if not exists pending_resolution_type text,
  add column if not exists pending_candidates jsonb not null default '[]'::jsonb,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_prompt_type text,
  add column if not exists context_payload jsonb not null default '{}'::jsonb;

comment on column public.session_states.pending_resolution_type is
  'Current resolution mode, e.g. pickup_selection, pickup_clarification, dropoff_selection, dropoff_pin.';

comment on column public.session_states.pending_candidates is
  'Temporary ranked location candidates shown to the user for numeric or text selection.';

comment on column public.session_states.retry_count is
  'How many times the bot has retried clarification or pin collection in the current step.';

comment on column public.session_states.last_prompt_type is
  'Last prompt emitted by the bot, used to avoid repeating the same clarification strategy.';

comment on column public.session_states.context_payload is
  'Arbitrary JSON context for the active step, such as original user text, selected leg, or validation hints.';

-- Add trip-level resolution metadata so bot quality can be measured over time.
alter table public.trips
  add column if not exists pickup_confidence text,
  add column if not exists dropoff_confidence text,
  add column if not exists pickup_resolution_source text,
  add column if not exists dropoff_resolution_source text,
  add column if not exists needs_manual_review boolean not null default false,
  add column if not exists validation_notes text;

comment on column public.trips.pickup_confidence is
  'Confidence band used when accepting pickup: high, medium, low, very_low.';

comment on column public.trips.dropoff_confidence is
  'Confidence band used when accepting drop-off: high, medium, low, very_low.';

comment on column public.trips.pickup_resolution_source is
  'How pickup was resolved: pin, local, mapbox, user_history, etc.';

comment on column public.trips.dropoff_resolution_source is
  'How drop-off was resolved: pin, local, mapbox, user_history, etc.';

comment on column public.trips.needs_manual_review is
  'Flags trips that should be reviewed by operations before dispatch.';

comment on column public.trips.validation_notes is
  'Free-text notes describing why a trip was flagged or what validation issue occurred.';

-- Add richer learning fields to locations so local matching and cleanup improve over time.
alter table public.locations
  add column if not exists normalized_text text,
  add column if not exists selection_count integer not null default 0,
  add column if not exists clarification_count integer not null default 0,
  add column if not exists pin_confirmation_count integer not null default 0,
  add column if not exists last_used_at timestamp with time zone;

comment on column public.locations.normalized_text is
  'Normalized form of raw_text for fuzzy and token-based matching.';

comment on column public.locations.selection_count is
  'How many times users explicitly selected this location from suggested candidates.';

comment on column public.locations.clarification_count is
  'How many times this location was accepted after a clarification step.';

comment on column public.locations.pin_confirmation_count is
  'How many times a shared pin confirmed this location.';

comment on column public.locations.last_used_at is
  'Last time this location was used in a booking flow.';

update public.locations
set normalized_text = lower(trim(raw_text))
where normalized_text is null;

create index if not exists idx_locations_normalized_text
  on public.locations (normalized_text);

create index if not exists idx_session_states_pending_resolution_type
  on public.session_states (pending_resolution_type);

-- User memory for repeat riders.
create table if not exists public.user_saved_places (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  location_id uuid not null references public.locations(id) on delete cascade,
  is_home boolean not null default false,
  is_work boolean not null default false,
  use_count integer not null default 1,
  last_used_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

create unique index if not exists idx_user_saved_places_user_label
  on public.user_saved_places (user_id, lower(label));

create index if not exists idx_user_saved_places_user_last_used
  on public.user_saved_places (user_id, last_used_at desc);

-- Location aliases for common alternate landmark spellings/names.
create table if not exists public.location_aliases (
  id uuid primary key default uuid_generate_v4(),
  location_id uuid not null references public.locations(id) on delete cascade,
  alias_text text not null,
  normalized_alias text not null,
  source text not null default 'manual',
  confidence_score double precision not null default 1.0,
  created_at timestamp with time zone default now()
);

create unique index if not exists idx_location_aliases_location_normalized_alias
  on public.location_aliases (location_id, normalized_alias);

create index if not exists idx_location_aliases_normalized_alias
  on public.location_aliases (normalized_alias);

-- Optional analytics trail for understanding resolution quality.
create table if not exists public.location_resolution_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete set null,
  trip_id uuid references public.trips(id) on delete set null,
  stage text not null,
  input_text text,
  action_taken text not null,
  confidence text,
  resolution_source text,
  selected_location_id uuid references public.locations(id) on delete set null,
  was_corrected boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

create index if not exists idx_location_resolution_events_trip
  on public.location_resolution_events (trip_id);

create index if not exists idx_location_resolution_events_stage_created
  on public.location_resolution_events (stage, created_at desc);

commit;
