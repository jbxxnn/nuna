-- Manual migration for authenticated application users.
-- Apply this in the Supabase SQL editor or your preferred migration workflow.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'user_role'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.user_role as enum ('rider', 'user', 'admin', 'moderator');
  end if;
end
$$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role public.user_role not null default 'rider',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

comment on table public.users is
  'Application-level user records mirrored from auth.users with role metadata.';

comment on column public.users.role is
  'Authorization role for the application. Defaults to rider.';

create or replace function public.handle_auth_user_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row
execute function public.handle_auth_user_sync();

insert into public.users (id, email)
select id, email
from auth.users
where email is not null
on conflict (id) do update
  set email = excluded.email,
      updated_at = now();

commit;
