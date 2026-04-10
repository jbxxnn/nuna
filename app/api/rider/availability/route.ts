import { NextRequest, NextResponse } from "next/server";

import { requireRiderAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type AllowedAvailabilityStatus = "available" | "offline";

const ALLOWED_AVAILABILITY_STATUSES: AllowedAvailabilityStatus[] = [
  "available",
  "offline",
];

export async function POST(request: NextRequest) {
  const { riderUser, errorResponse } = await requireRiderAccess();

  if (errorResponse || !riderUser) {
    return errorResponse ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { status?: AllowedAvailabilityStatus };
  const nextStatus = body.status;

  if (!nextStatus || !ALLOWED_AVAILABILITY_STATUSES.includes(nextStatus)) {
    return NextResponse.json({ error: "Invalid rider availability status" }, { status: 400 });
  }

  const { count, error: activeTripsError } = await supabaseAdmin
    .from("trips")
    .select("id", { count: "exact", head: true })
    .eq("rider_id", riderUser.rider.id)
    .in("status", ["pending", "confirmed", "moving", "picked_up"]);

  if (activeTripsError) {
    console.error("Failed to check rider active trips:", activeTripsError);
    return NextResponse.json({ error: "Failed to update rider availability" }, { status: 500 });
  }

  if (nextStatus === "offline" && (count ?? 0) > 0) {
    return NextResponse.json(
      { error: "Finish or decline your active assignment before going offline" },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("riders")
    .update({
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", riderUser.rider.id);

  if (error) {
    console.error("Failed to update rider availability:", error);
    return NextResponse.json({ error: "Failed to update rider availability" }, { status: 500 });
  }

  return NextResponse.json({ success: true, status: nextStatus });
}
