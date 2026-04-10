import { NextRequest, NextResponse } from "next/server";

import { getCurrentRiderState } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type RiderProfilePayload = {
  fullName?: string;
  phoneNumber?: string;
  serviceZone?: string;
  vehicleType?: string;
  bikePlateNumber?: string;
};

function normalizeValue(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function POST(request: NextRequest) {
  const riderState = await getCurrentRiderState();

  if (!riderState) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as RiderProfilePayload;
  const fullName = normalizeValue(body.fullName);
  const phoneNumber = normalizeValue(body.phoneNumber);
  const serviceZone = normalizeValue(body.serviceZone);
  const vehicleType = normalizeValue(body.vehicleType);
  const bikePlateNumber = normalizeValue(body.bikePlateNumber);

  if (!fullName || !phoneNumber || !serviceZone || !vehicleType || !bikePlateNumber) {
    return NextResponse.json(
      { error: "Full name, phone number, service zone, vehicle type, and bike plate number are required." },
      { status: 400 },
    );
  }

  const timestamp = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("riders")
    .upsert(
      {
        user_id: riderState.appUser.id,
        full_name: fullName,
        phone_number: phoneNumber,
        service_zone: serviceZone,
        vehicle_type: vehicleType,
        bike_plate_number: bikePlateNumber,
        status: riderState.rider?.status ?? "offline",
        is_verified: riderState.rider?.is_verified ?? false,
        updated_at: timestamp,
      },
      { onConflict: "user_id" },
    )
    .select("id, full_name, phone_number, vehicle_type, bike_plate_number, status, is_verified, service_zone, current_latitude, current_longitude, last_seen_at")
    .single();

  if (error || !data) {
    console.error("Failed to upsert rider profile:", error);
    return NextResponse.json({ error: "Failed to save rider profile" }, { status: 500 });
  }

  return NextResponse.json({ success: true, rider: data });
}
