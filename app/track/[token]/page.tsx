import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";

import { supabaseAdmin } from "@/lib/supabase-admin";

import TrackClient from "./track-client";

async function TrackPageContent({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
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

export default function TrackTripPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <TrackPageContent params={params} />
    </Suspense>
  );
}
