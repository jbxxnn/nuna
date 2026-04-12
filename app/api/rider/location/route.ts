import { NextResponse } from "next/server";

import { requireRiderAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const { riderUser, errorResponse } = await requireRiderAccess();

  if (errorResponse || !riderUser) {
    return errorResponse ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { latitude?: number; longitude?: number } | null = null;

  try {
    body = (await request.json()) as { latitude?: number; longitude?: number };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const latitude = typeof body?.latitude === "number" ? body.latitude : NaN;
  const longitude = typeof body?.longitude === "number" ? body.longitude : NaN;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: "Latitude and longitude are required" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("riders")
    .update({
      current_latitude: latitude,
      current_longitude: longitude,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", riderUser.rider.id);

  if (error) {
    console.error("Failed to update rider location:", error);
    return NextResponse.json({ error: "Failed to update rider location" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
