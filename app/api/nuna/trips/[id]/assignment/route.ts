import { NextRequest, NextResponse } from "next/server";

import { requireNunaAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const ASSIGNMENT_RESPONSE_TIMEOUT_MINUTES = 5;

async function logAssignmentEvent(
  tripId: string,
  riderId: string,
  action: "assigned" | "timed_out" | "unassigned",
  actorRole: "ops" | "system",
) {
  const { error } = await supabaseAdmin
    .from("rider_assignment_events")
    .insert({
      trip_id: tripId,
      rider_id: riderId,
      action,
      actor_role: actorRole,
    });

  if (error) {
    console.error("Failed to log rider assignment event:", error);
  }
}

async function resetPreviousRiderStatus(riderId: string | null) {
  if (!riderId) return;

  const { data: rider } = await supabaseAdmin
    .from("riders")
    .select("id, status")
    .eq("id", riderId)
    .maybeSingle();

  if (!rider) return;

  if (rider.status === "assigned") {
    await supabaseAdmin
      .from("riders")
      .update({ status: "available", updated_at: new Date().toISOString() })
      .eq("id", riderId);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { errorResponse } = await requireNunaAccess();

  if (errorResponse) {
    return errorResponse;
  }

  const { id } = await params;
  const body = (await request.json()) as { riderId?: string | null };
  const nextRiderId = body.riderId ?? null;

  const { data: trip, error: tripError } = await supabaseAdmin
    .from("trips")
    .select("id, rider_id, status, assigned_at")
    .eq("id", id)
    .maybeSingle();

  if (tripError || !trip) {
    console.error("Failed to load trip for assignment:", tripError);
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  if (!nextRiderId) {
    await resetPreviousRiderStatus(trip.rider_id ?? null);

    if (trip.rider_id) {
      await logAssignmentEvent(id, trip.rider_id, "unassigned", "ops");
    }

    const { error } = await supabaseAdmin
      .from("trips")
      .update({
        rider_id: null,
        assigned_at: null,
      })
      .eq("id", id);

    if (error) {
      console.error("Failed to unassign rider from trip:", error);
      return NextResponse.json({ error: "Failed to unassign rider" }, { status: 500 });
    }

    return NextResponse.json({ success: true, riderId: null });
  }

  const { data: rider, error: riderError } = await supabaseAdmin
    .from("riders")
    .select("id, status, is_verified")
    .eq("id", nextRiderId)
    .maybeSingle();

  if (riderError || !rider) {
    console.error("Failed to load rider for assignment:", riderError);
    return NextResponse.json({ error: "Rider not found" }, { status: 404 });
  }

  if (!rider.is_verified) {
    return NextResponse.json({ error: "Only verified riders can be assigned" }, { status: 400 });
  }

  if (rider.status !== "available") {
    return NextResponse.json(
      { error: "Only riders marked available can be assigned right now" },
      { status: 400 },
    );
  }

  if (trip.rider_id && trip.rider_id !== nextRiderId) {
    const assignedAt = trip.assigned_at ? new Date(trip.assigned_at).getTime() : null;
    const isTimedOutPendingAssignment =
      trip.status === "pending" &&
      assignedAt !== null &&
      Date.now() - assignedAt >= ASSIGNMENT_RESPONSE_TIMEOUT_MINUTES * 60 * 1000;

    if (isTimedOutPendingAssignment) {
      await logAssignmentEvent(id, trip.rider_id, "timed_out", "system");
    } else {
      await logAssignmentEvent(id, trip.rider_id, "unassigned", "ops");
    }

    await resetPreviousRiderStatus(trip.rider_id);
  }

  const assignedAt = new Date().toISOString();

  const [{ error: riderUpdateError }, { error: tripUpdateError }] = await Promise.all([
    supabaseAdmin
      .from("riders")
      .update({ status: "assigned", updated_at: assignedAt })
      .eq("id", nextRiderId),
    supabaseAdmin
      .from("trips")
      .update({
        rider_id: nextRiderId,
        assigned_at: assignedAt,
      })
      .eq("id", id),
  ]);

  if (riderUpdateError || tripUpdateError) {
    console.error("Failed to assign rider:", riderUpdateError || tripUpdateError);
    return NextResponse.json({ error: "Failed to assign rider" }, { status: 500 });
  }

  await logAssignmentEvent(id, nextRiderId, "assigned", "ops");

  return NextResponse.json({ success: true, riderId: nextRiderId, assignedAt });
}
