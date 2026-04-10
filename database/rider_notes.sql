alter table public.riders
  add column if not exists ops_notes text;

comment on column public.riders.ops_notes is
  'Internal ops review notes for rider approval, suspension, and dispatch readiness.';
