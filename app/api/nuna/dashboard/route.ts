import { NextResponse } from "next/server";

import { requireNunaAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const { errorResponse } = await requireNunaAccess();

  if (errorResponse) {
    return errorResponse;
  }

  const [hotspotsResult, candidateLocationsResult, tripsResult, eventsResult, totalLocationsResult, verifiedLocationsResult] = await Promise.all([
    supabaseAdmin
      .from("locations")
      .select("id, raw_text, latitude, longitude, is_verified, hit_count, confidence_score, created_at, metadata")
      .eq("is_verified", true)
      .order("hit_count", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("locations")
      .select("id, raw_text, latitude, longitude, is_verified, hit_count, confidence_score, created_at, metadata")
      .eq("is_verified", false)
      .order("hit_count", { ascending: false })
      .limit(12),
    supabaseAdmin
      .from("trips")
      .select("id, status, created_at, needs_manual_review, validation_notes, sender_profile:profiles!trips_user_id_fkey(phone_number), pickup:locations!trips_pickup_location_id_fkey(id, raw_text, latitude, longitude, is_verified, hit_count, confidence_score, created_at, metadata), dropoff:locations!trips_dropoff_location_id_fkey(id, raw_text, latitude, longitude, is_verified, hit_count, confidence_score, created_at, metadata)")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("location_resolution_events")
      .select("id, stage, action_taken, confidence, resolution_source, selected_location_id, created_at")
      .order("created_at", { ascending: false })
      .limit(150),
    supabaseAdmin
      .from("locations")
      .select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("is_verified", true),
  ]);

  if (hotspotsResult.error) {
    console.error("Failed to fetch dashboard hotspots:", hotspotsResult.error);
    return NextResponse.json({ error: "Failed to load hotspots" }, { status: 500 });
  }

  if (candidateLocationsResult.error) {
    console.error("Failed to fetch dashboard candidate landmarks:", candidateLocationsResult.error);
    return NextResponse.json({ error: "Failed to load candidate landmarks" }, { status: 500 });
  }

  if (tripsResult.error) {
    console.error("Failed to fetch dashboard trips:", tripsResult.error);
    return NextResponse.json({ error: "Failed to load trips" }, { status: 500 });
  }

  if (eventsResult.error) {
    console.error("Failed to fetch dashboard events:", eventsResult.error);
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }

  return NextResponse.json({
    hotspots: hotspotsResult.data ?? [],
    candidateLocations: candidateLocationsResult.data ?? [],
    trips: tripsResult.data ?? [],
    events: eventsResult.data ?? [],
    stats: {
      totalLocations: totalLocationsResult.count ?? 0,
      verifiedLocations: verifiedLocationsResult.count ?? 0,
    },
  });
}
