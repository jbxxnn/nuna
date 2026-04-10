import { NextRequest, NextResponse } from "next/server";

import { requireNunaAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type RiderAction = "approve" | "suspend" | "restore";

const ALLOWED_ACTIONS: RiderAction[] = ["approve", "suspend", "restore"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { errorResponse } = await requireNunaAccess();

  if (errorResponse) {
    return errorResponse;
  }

  const { id } = await params;
  const body = (await request.json()) as { action?: RiderAction };
  const action = body.action;

  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid rider action" }, { status: 400 });
  }

  const { data: rider, error: riderError } = await supabaseAdmin
    .from("riders")
    .select("id, status, is_verified")
    .eq("id", id)
    .maybeSingle();

  if (riderError || !rider) {
    console.error("Failed to load rider for status update:", riderError);
    return NextResponse.json({ error: "Rider not found" }, { status: 404 });
  }

  const timestamp = new Date().toISOString();
  const updates: Record<string, string | boolean> = {
    updated_at: timestamp,
  };

  if (action === "approve") {
    updates.is_verified = true;
    updates.status = rider.status === "suspended" ? "offline" : rider.status;
  }

  if (action === "suspend") {
    updates.status = "suspended";
  }

  if (action === "restore") {
    updates.status = "offline";
  }

  const { error } = await supabaseAdmin
    .from("riders")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error("Failed to update rider status:", error);
    return NextResponse.json({ error: "Failed to update rider" }, { status: 500 });
  }

  return NextResponse.json({ success: true, action });
}
