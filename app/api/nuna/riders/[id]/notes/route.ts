import { NextRequest, NextResponse } from "next/server";

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
  const body = (await request.json()) as { notes?: string | null };
  const notes = body.notes?.trim() || null;

  const { error } = await supabaseAdmin
    .from("riders")
    .update({
      ops_notes: notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("Failed to save rider ops notes:", error);
    return NextResponse.json({ error: "Failed to save rider notes" }, { status: 500 });
  }

  return NextResponse.json({ success: true, notes });
}
