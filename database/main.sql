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
  pickup_location_id uuid,
  dropoff_location_id uuid,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  distance_meters double precision,
  estimated_price double precision,
  CONSTRAINT trips_pkey PRIMARY KEY (id),
  CONSTRAINT trips_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT trips_pickup_location_id_fkey FOREIGN KEY (pickup_location_id) REFERENCES public.locations(id),
  CONSTRAINT trips_dropoff_location_id_fkey FOREIGN KEY (dropoff_location_id) REFERENCES public.locations(id)
);