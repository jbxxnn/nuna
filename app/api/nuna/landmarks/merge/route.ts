import { NextRequest, NextResponse } from "next/server";

import { requireNunaAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: NextRequest) {
  const { errorResponse } = await requireNunaAccess();

  if (errorResponse) {
    return errorResponse;
  }

  const body = (await request.json()) as {
    sourceId?: string;
    targetId?: string;
    targetName?: string;
    sourceHitCount?: number;
    sourceConfidenceScore?: number;
    sourceRawText?: string;
  };

  if (!body.sourceId || !body.targetId) {
    return NextResponse.json({ error: "Source and target landmarks are required" }, { status: 400 });
  }

  if (body.sourceId === body.targetId) {
    return NextResponse.json({ error: "You cannot merge a landmark into itself" }, { status: 400 });
  }

  const { data: targetLocation, error: targetError } = await supabaseAdmin
    .from("locations")
    .select("id, hit_count, confidence_score")
    .eq("id", body.targetId)
    .single();

  if (targetError || !targetLocation) {
    console.error("Failed to load merge target:", targetError);
    return NextResponse.json({ error: "Could not load the target landmark" }, { status: 500 });
  }

  const updateResults = await Promise.all([
    supabaseAdmin.from("trips").update({ pickup_location_id: body.targetId }).eq("pickup_location_id", body.sourceId),
    supabaseAdmin.from("trips").update({ dropoff_location_id: body.targetId }).eq("dropoff_location_id", body.sourceId),
    supabaseAdmin.from("user_saved_places").update({ location_id: body.targetId }).eq("location_id", body.sourceId),
    supabaseAdmin
      .from("location_resolution_events")
      .update({ selected_location_id: body.targetId })
      .eq("selected_location_id", body.sourceId),
    supabaseAdmin.from("location_aliases").update({ location_id: body.targetId }).eq("location_id", body.sourceId),
  ]);

  const updateError = updateResults.find((result) => result.error)?.error;

  if (updateError) {
    console.error("Failed to re-point merge references:", updateError);
    return NextResponse.json({ error: "Failed to update duplicate references" }, { status: 500 });
  }

  const mergedHitCount = (targetLocation.hit_count || 0) + (body.sourceHitCount || 0);
  const mergedConfidence = Math.max(
    targetLocation.confidence_score || 0,
    body.sourceConfidenceScore || 0,
  );

  const { error: updateTargetError } = await supabaseAdmin
    .from("locations")
    .update({
      hit_count: mergedHitCount,
      confidence_score: mergedConfidence,
      is_verified: true,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", body.targetId);

  if (updateTargetError) {
    console.error("Failed to update merge target:", updateTargetError);
    return NextResponse.json({ error: "Failed to update merged landmark" }, { status: 500 });
  }

  const { error: eventError } = await supabaseAdmin.from("location_resolution_events").insert({
    stage: "ops_landmark",
    action_taken: "merge_duplicate_landmark",
    selected_location_id: body.targetId,
    resolution_source: "operator_dashboard",
    metadata: {
      merged_from_location_id: body.sourceId,
      merged_from_raw_text: body.sourceRawText ?? null,
      merged_into_location_id: body.targetId,
      merged_into_raw_text: body.targetName?.trim().toLowerCase() || null,
    },
  });

  if (eventError) {
    console.error("Failed to record landmark merge event:", eventError);
    return NextResponse.json({ error: "Failed to record merge event" }, { status: 500 });
  }

  const { error: deleteSourceError } = await supabaseAdmin
    .from("locations")
    .delete()
    .eq("id", body.sourceId);

  if (deleteSourceError) {
    console.error("Failed to delete merged landmark source:", deleteSourceError);
    return NextResponse.json({ error: "Failed to remove duplicate landmark" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: `Merged "${body.sourceRawText ?? "duplicate landmark"}" into the current landmark.`,
  });
}
