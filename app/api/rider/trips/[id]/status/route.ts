import { NextRequest, NextResponse } from "next/server";

import { requireRiderAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type AllowedStatus = "confirmed" | "moving" | "picked_up" | "completed" | "canceled";

const ALLOWED_STATUS_TRANSITIONS: AllowedStatus[] = [
  "confirmed",
  "moving",
  "picked_up",
  "completed",
  "canceled",
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { riderUser, errorResponse } = await requireRiderAccess();

  if (errorResponse || !riderUser) {
    return errorResponse ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as { status?: AllowedStatus };
  const nextStatus = body.status;

  if (!nextStatus || !ALLOWED_STATUS_TRANSITIONS.includes(nextStatus)) {
    return NextResponse.json({ error: "Invalid rider trip status" }, { status: 400 });
  }

  const { data: trip, error: tripError } = await supabaseAdmin
    .from("trips")
    .select("id, rider_id, status")
    .eq("id", id)
    .maybeSingle();

  if (tripError || !trip) {
    console.error("Failed to load rider trip:", tripError);
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  if (trip.rider_id !== riderUser.rider.id) {
    return NextResponse.json({ error: "This trip is not assigned to you" }, { status: 403 });
  }

  const timestamp = new Date().toISOString();
  const tripUpdates: Record<string, string | null> = {
    status: nextStatus,
  };
  const riderUpdates: Record<string, string> = {
    updated_at: timestamp,
  };

  if (nextStatus === "confirmed") {
    tripUpdates.confirmed_at = timestamp;
    riderUpdates.status = "assigned";
  }

  if (nextStatus === "moving") {
    riderUpdates.status = "on_trip";
  }

  if (nextStatus === "picked_up") {
    tripUpdates.picked_up_at = timestamp;
    riderUpdates.status = "on_trip";
  }

  if (nextStatus === "completed") {
    tripUpdates.completed_at = timestamp;
    riderUpdates.status = "available";
  }

  if (nextStatus === "canceled") {
    tripUpdates.canceled_at = timestamp;
    riderUpdates.status = "available";
  }

  const [{ error: tripUpdateError }, { error: riderUpdateError }] = await Promise.all([
    supabaseAdmin
      .from("trips")
      .update(tripUpdates)
      .eq("id", id),
    supabaseAdmin
      .from("riders")
      .update(riderUpdates)
      .eq("id", riderUser.rider.id),
  ]);

  if (tripUpdateError || riderUpdateError) {
    console.error("Failed to update rider trip status:", tripUpdateError || riderUpdateError);
    return NextResponse.json({ error: "Failed to update trip status" }, { status: 500 });
  }

  return NextResponse.json({ success: true, status: nextStatus });
}
