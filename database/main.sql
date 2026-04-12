-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.locations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  raw_text text UNIQUE,
  latitude double precision,
  longitude double precision,
  is_gps boolean DEFAULT false,
  hit_count integer DEFAULT 1,
  created_at timestamp with time zone DEFAULT now(),
  is_verified boolean DEFAULT false,
  confidence_score double precision DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  location_point USER-DEFINED,
  CONSTRAINT locations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  phone_number text NOT NULL UNIQUE,
  full_name text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id)
);
CREATE TABLE public.users (
  id uuid NOT NULL,
  email text NOT NULL UNIQUE,
  role USER-DEFINED NOT NULL DEFAULT 'rider'::public.user_role,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE TABLE public.riders (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL UNIQUE,
  full_name text,
  phone_number text UNIQUE,
  vehicle_type text,
  bike_plate_number text,
  status USER-DEFINED NOT NULL DEFAULT 'offline'::public.rider_status,
  is_verified boolean NOT NULL DEFAULT false,
  service_zone text,
  ops_notes text,
  current_latitude double precision,
  current_longitude double precision,
  last_seen_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT riders_pkey PRIMARY KEY (id),
  CONSTRAINT riders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);
CREATE TABLE public.rider_assignment_events (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  trip_id uuid NOT NULL,
  rider_id uuid NOT NULL,
  action text NOT NULL CHECK (action = ANY (ARRAY['assigned'::text, 'accepted'::text, 'declined'::text, 'timed_out'::text, 'unassigned'::text])),
  actor_role text NOT NULL CHECK (actor_role = ANY (ARRAY['ops'::text, 'rider'::text, 'system'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rider_assignment_events_pkey PRIMARY KEY (id),
  CONSTRAINT rider_assignment_events_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE,
  CONSTRAINT rider_assignment_events_rider_id_fkey FOREIGN KEY (rider_id) REFERENCES public.riders(id) ON DELETE CASCADE
);
CREATE TABLE public.session_states (
  phone_number text NOT NULL,
  current_step text NOT NULL,
  current_trip_id uuid,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT session_states_pkey PRIMARY KEY (phone_number),
  CONSTRAINT session_states_current_trip_id_fkey FOREIGN KEY (current_trip_id) REFERENCES public.trips(id)
);
CREATE TABLE public.spatial_ref_sys (
  srid integer NOT NULL CHECK (srid > 0 AND srid <= 998999),
  auth_name character varying,
  auth_srid integer,
  srtext character varying,
  proj4text character varying,
  CONSTRAINT spatial_ref_sys_pkey PRIMARY KEY (srid)
);
CREATE TABLE public.trips (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  rider_id uuid,
  pickup_location_id uuid,
  dropoff_location_id uuid,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  distance_meters double precision,
  estimated_price double precision,
  sender_phone text,
  recipient_phone text,
  tracking_token text UNIQUE,
  assigned_at timestamp with time zone,
  confirmed_at timestamp with time zone,
  picked_up_at timestamp with time zone,
  completed_at timestamp with time zone,
  canceled_at timestamp with time zone,
  CONSTRAINT trips_pkey PRIMARY KEY (id),
  CONSTRAINT trips_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT trips_rider_id_fkey FOREIGN KEY (rider_id) REFERENCES public.riders(id) ON DELETE SET NULL,
  CONSTRAINT trips_pickup_location_id_fkey FOREIGN KEY (pickup_location_id) REFERENCES public.locations(id),
  CONSTRAINT trips_dropoff_location_id_fkey FOREIGN KEY (dropoff_location_id) REFERENCES public.locations(id)
);
