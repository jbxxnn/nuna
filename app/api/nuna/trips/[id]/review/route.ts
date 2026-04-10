import { NextResponse, type NextRequest } from "next/server";

import { requireNunaAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { errorResponse } = await requireNunaAccess();

  if (errorResponse) {
    return errorResponse;
  }

  const { id } = await params;
  const body = (await request.json()) as {
    mode?: "resolve" | "note";
    note?: string | null;
    existingNotes?: string | null;
  };

  if (body.mode !== "resolve" && body.mode !== "note") {
    return NextResponse.json({ error: "Invalid review mode" }, { status: 400 });
  }

  let updates: Record<string, string | boolean | null>;

  if (body.mode === "resolve") {
    const note = body.note?.trim();
    updates = {
      needs_manual_review: false,
      validation_notes: note ? `Resolved by ops: ${note}` : null,
    };
  } else {
    const note = body.note?.trim();

    if (!note) {
      return NextResponse.json({ error: "Review note is required" }, { status: 400 });
    }

    updates = {
      needs_manual_review: true,
      validation_notes: body.existingNotes
        ? `${body.existingNotes}\n\nOps note: ${note}`
        : `Ops note: ${note}`,
    };
  }

  const { error } = await supabaseAdmin
    .from("trips")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error("Failed to update trip review:", error);
    return NextResponse.json({ error: "Failed to update trip review" }, { status: 500 });
  }

  return NextResponse.json({ success: true, updates });
}
