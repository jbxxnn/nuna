import { NextResponse } from "next/server";

import { requireNunaAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const { errorResponse } = await requireNunaAccess();
  const recentPerformanceWindowStart = new Date(
    Date.now() - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();

  if (errorResponse) {
    return errorResponse;
  }

  const [
    hotspotsResult,
    candidateLocationsResult,
    tripsResult,
    ridersResult,
    eventsResult,
    totalLocationsResult,
    verifiedLocationsResult,
    recentRiderTripsResult,
    assignmentEventsResult,
  ] = await Promise.all([
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
      .select("id, status, created_at, needs_manual_review, validation_notes, sender_phone, recipient_phone, rider_id, assigned_at, confirmed_at, picked_up_at, completed_at, canceled_at, sender_profile:profiles!trips_user_id_fkey(phone_number), assigned_rider:riders(id, full_name, phone_number, vehicle_type, bike_plate_number, status, is_verified, service_zone, current_latitude, current_longitude, last_seen_at), pickup:locations!trips_pickup_location_id_fkey(id, raw_text, latitude, longitude, is_verified, hit_count, confidence_score, created_at, metadata), dropoff:locations!trips_dropoff_location_id_fkey(id, raw_text, latitude, longitude, is_verified, hit_count, confidence_score, created_at, metadata)")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("riders")
      .select("id, user_id, full_name, phone_number, vehicle_type, bike_plate_number, status, is_verified, service_zone, ops_notes, current_latitude, current_longitude, last_seen_at, created_at, updated_at")
      .order("status", { ascending: true })
      .order("last_seen_at", { ascending: false, nullsFirst: false }),
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
    supabaseAdmin
      .from("trips")
      .select("rider_id, status")
      .not("rider_id", "is", null)
      .gte("created_at", recentPerformanceWindowStart),
    supabaseAdmin
      .from("rider_assignment_events")
      .select("trip_id, rider_id, action, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
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

  if (ridersResult.error) {
    console.error("Failed to fetch dashboard riders:", ridersResult.error);
    return NextResponse.json({ error: "Failed to load riders" }, { status: 500 });
  }

  if (eventsResult.error) {
    console.error("Failed to fetch dashboard events:", eventsResult.error);
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }

  if (recentRiderTripsResult.error) {
    console.error("Failed to fetch rider performance metrics:", recentRiderTripsResult.error);
    return NextResponse.json({ error: "Failed to load rider performance metrics" }, { status: 500 });
  }

  if (assignmentEventsResult.error) {
    console.error("Failed to fetch rider assignment events:", assignmentEventsResult.error);
    return NextResponse.json({ error: "Failed to load rider assignment history" }, { status: 500 });
  }

  const riderMetrics = Object.fromEntries(
    (recentRiderTripsResult.data ?? []).reduce<
      Map<
        string,
        {
          recentTrips: number;
          completedTrips: number;
          canceledTrips: number;
        }
      >
    >((metrics, trip) => {
      if (!trip.rider_id) {
        return metrics;
      }

      const current = metrics.get(trip.rider_id) ?? {
        recentTrips: 0,
        completedTrips: 0,
        canceledTrips: 0,
      };
      const normalizedStatus = trip.status.trim().toLowerCase();

      current.recentTrips += 1;
      if (normalizedStatus === "completed") {
        current.completedTrips += 1;
      }

      if (normalizedStatus === "canceled" || normalizedStatus === "cancelled") {
        current.canceledTrips += 1;
      }

      metrics.set(trip.rider_id, current);
      return metrics;
    }, new Map())
      .entries(),
  );

  const tripAssignmentHistory = Object.fromEntries(
    (assignmentEventsResult.data ?? []).reduce<
      Map<
        string,
        {
          declinedRiderIds: string[];
          timedOutRiderIds: string[];
        }
      >
    >((history, event) => {
      const current = history.get(event.trip_id) ?? {
        declinedRiderIds: [],
        timedOutRiderIds: [],
      };

      if (event.action === "declined" && !current.declinedRiderIds.includes(event.rider_id)) {
        current.declinedRiderIds.push(event.rider_id);
      }

      if (event.action === "timed_out" && !current.timedOutRiderIds.includes(event.rider_id)) {
        current.timedOutRiderIds.push(event.rider_id);
      }

      history.set(event.trip_id, current);
      return history;
    }, new Map()).entries(),
  );

  const riderAssignmentStats = Object.fromEntries(
    (assignmentEventsResult.data ?? []).reduce<
      Map<
        string,
        {
          declines: number;
          timeouts: number;
        }
      >
    >((stats, event) => {
      const current = stats.get(event.rider_id) ?? {
        declines: 0,
        timeouts: 0,
      };

      if (event.action === "declined") {
        current.declines += 1;
      }

      if (event.action === "timed_out") {
        current.timeouts += 1;
      }

      stats.set(event.rider_id, current);
      return stats;
    }, new Map()).entries(),
  );

  return NextResponse.json({
    hotspots: hotspotsResult.data ?? [],
    candidateLocations: candidateLocationsResult.data ?? [],
    trips: tripsResult.data ?? [],
    riders: ridersResult.data ?? [],
    events: eventsResult.data ?? [],
    riderMetrics,
    tripAssignmentHistory,
    riderAssignmentStats,
    stats: {
      totalLocations: totalLocationsResult.count ?? 0,
      verifiedLocations: verifiedLocationsResult.count ?? 0,
    },
  });
}
