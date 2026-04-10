import { NextResponse } from "next/server";

import { requireRiderAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const { riderUser, errorResponse } = await requireRiderAccess();

  if (errorResponse || !riderUser) {
    return errorResponse ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: trips, error } = await supabaseAdmin
    .from("trips")
    .select("id, status, created_at, sender_phone, recipient_phone, assigned_at, confirmed_at, picked_up_at, completed_at, canceled_at, pickup:locations!trips_pickup_location_id_fkey(id, raw_text, latitude, longitude, metadata), dropoff:locations!trips_dropoff_location_id_fkey(id, raw_text, latitude, longitude, metadata)")
    .eq("rider_id", riderUser.rider.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch rider dashboard trips:", error);
    return NextResponse.json({ error: "Failed to load rider dashboard" }, { status: 500 });
  }

  return NextResponse.json({
    rider: riderUser.rider,
    trips: trips ?? [],
  });
}
