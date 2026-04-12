import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const { data: trip, error } = await supabaseAdmin
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

  if (error) {
    console.error("Failed to load tracking trip:", error);
    return NextResponse.json({ error: "Failed to load tracking trip" }, { status: 500 });
  }

  if (!trip) {
    return NextResponse.json({ error: "Tracking link not found" }, { status: 404 });
  }

  return NextResponse.json({ trip });
}
