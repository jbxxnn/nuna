import { notFound } from "next/navigation";

import { supabaseAdmin } from "@/lib/supabase-admin";

import TrackClient from "./track-client";

export default async function TrackTripPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const { data: trip } = await supabaseAdmin
    .from("trips")
    .select(`
      id,
      status,
      created_at,
      distance_meters,
      estimated_price,
      assigned_rider:riders(full_name, status, current_latitude, current_longitude, last_seen_at),
      pickup:locations!trips_pickup_location_id_fkey(id, raw_text, latitude, longitude, metadata),
      dropoff:locations!trips_dropoff_location_id_fkey(id, raw_text, latitude, longitude, metadata)
    `)
    .eq("tracking_token", token)
    .maybeSingle();

  if (!trip) {
    notFound();
  }

  return <TrackClient token={token} initialTrip={trip} />;
}
