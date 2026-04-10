import { NextRequest, NextResponse } from "next/server";

import { requireRiderAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type AssignmentResponse = "accept" | "decline";

const ALLOWED_RESPONSES: AssignmentResponse[] = ["accept", "decline"];

async function logAssignmentEvent(
  tripId: string,
  riderId: string,
  action: "accepted" | "declined",
) {
  const { error } = await supabaseAdmin
    .from("rider_assignment_events")
    .insert({
      trip_id: tripId,
      rider_id: riderId,
      action,
      actor_role: "rider",
    });

  if (error) {
    console.error("Failed to log rider assignment response event:", error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { riderUser, errorResponse } = await requireRiderAccess();

  if (errorResponse || !riderUser) {
    return errorResponse ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as { response?: AssignmentResponse };
  const responseMode = body.response;

  if (!responseMode || !ALLOWED_RESPONSES.includes(responseMode)) {
    return NextResponse.json({ error: "Invalid assignment response" }, { status: 400 });
  }

  const { data: trip, error: tripError } = await supabaseAdmin
    .from("trips")
    .select("id, rider_id, status, assigned_at, confirmed_at")
    .eq("id", id)
    .maybeSingle();

  if (tripError || !trip) {
    console.error("Failed to load rider assignment response trip:", tripError);
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  if (trip.rider_id !== riderUser.rider.id) {
    return NextResponse.json({ error: "This trip is not assigned to you" }, { status: 403 });
  }

  if (trip.status !== "pending") {
    return NextResponse.json({ error: "This assignment already has a response" }, { status: 400 });
  }

  const timestamp = new Date().toISOString();

  if (responseMode === "accept") {
    const [{ error: tripUpdateError }, { error: riderUpdateError }] = await Promise.all([
      supabaseAdmin
        .from("trips")
        .update({
          status: "confirmed",
          confirmed_at: timestamp,
        })
        .eq("id", id),
      supabaseAdmin
        .from("riders")
        .update({
          status: "assigned",
          updated_at: timestamp,
        })
        .eq("id", riderUser.rider.id),
    ]);

    if (tripUpdateError || riderUpdateError) {
      console.error("Failed to accept assignment:", tripUpdateError || riderUpdateError);
      return NextResponse.json({ error: "Failed to accept assignment" }, { status: 500 });
    }

    await logAssignmentEvent(id, riderUser.rider.id, "accepted");

    return NextResponse.json({ success: true, response: responseMode, status: "confirmed" });
  }

  const [{ error: tripUpdateError }, { error: riderUpdateError }] = await Promise.all([
    supabaseAdmin
      .from("trips")
      .update({
        rider_id: null,
        assigned_at: null,
        confirmed_at: null,
        status: "pending",
      })
      .eq("id", id),
    supabaseAdmin
      .from("riders")
      .update({
        status: "available",
        updated_at: timestamp,
      })
      .eq("id", riderUser.rider.id),
  ]);

  if (tripUpdateError || riderUpdateError) {
    console.error("Failed to decline assignment:", tripUpdateError || riderUpdateError);
    return NextResponse.json({ error: "Failed to decline assignment" }, { status: 500 });
  }

  await logAssignmentEvent(id, riderUser.rider.id, "declined");

  return NextResponse.json({ success: true, response: responseMode, status: "pending" });
}
