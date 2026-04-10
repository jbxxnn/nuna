import { NextRequest, NextResponse } from "next/server";

import { requireNunaAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const { errorResponse } = await requireNunaAccess();

  if (errorResponse) {
    return errorResponse;
  }

  const status = request.nextUrl.searchParams.get("status");

  let query = supabaseAdmin
    .from("riders")
    .select("id, user_id, full_name, phone_number, vehicle_type, bike_plate_number, status, is_verified, service_zone, current_latitude, current_longitude, last_seen_at, created_at, updated_at")
    .order("status", { ascending: true })
    .order("last_seen_at", { ascending: false, nullsFirst: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to fetch riders:", error);
    return NextResponse.json({ error: "Failed to load riders" }, { status: 500 });
  }

  return NextResponse.json({ riders: data ?? [] });
}
