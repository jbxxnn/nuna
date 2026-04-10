import { NextResponse, type NextRequest } from "next/server";

import { requireNunaAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { errorResponse } = await requireNunaAccess();

  if (errorResponse) {
    return errorResponse;
  }

  const { id } = await params;
  const { error } = await supabaseAdmin
    .from("locations")
    .update({ is_verified: true })
    .eq("id", id);

  if (error) {
    console.error("Failed to verify location:", error);
    return NextResponse.json({ error: "Failed to verify landmark" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
