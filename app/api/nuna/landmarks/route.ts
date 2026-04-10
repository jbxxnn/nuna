import { NextRequest, NextResponse } from "next/server";

import { requireNunaAccess } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const LANDMARK_SELECT =
  "id, raw_text, latitude, longitude, is_verified, hit_count, confidence_score, metadata";

function parseAliases(rawAliases: unknown) {
  if (!Array.isArray(rawAliases)) {
    return [];
  }

  return Array.from(
    new Set(
      rawAliases
        .filter((alias): alias is string => typeof alias === "string")
        .map((alias) => alias.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export async function GET(request: NextRequest) {
  const { errorResponse } = await requireNunaAccess();

  if (errorResponse) {
    return errorResponse;
  }

  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("mode");

  if (mode === "queue") {
    const { data, error } = await supabaseAdmin
      .from("locations")
      .select(LANDMARK_SELECT)
      .eq("is_verified", false)
      .order("hit_count", { ascending: false })
      .limit(12);

    if (error) {
      console.error("Failed to load candidate queue:", error);
      return NextResponse.json({ error: "Failed to load candidate queue" }, { status: 500 });
    }

    return NextResponse.json({ candidates: data ?? [] });
  }

  if (mode === "search") {
    const query = searchParams.get("q")?.trim().toLowerCase();

    if (!query) {
      return NextResponse.json({ error: "Search query is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("locations")
      .select(LANDMARK_SELECT)
      .ilike("raw_text", `%${query}%`)
      .order("is_verified", { ascending: false })
      .order("hit_count", { ascending: false })
      .limit(5);

    if (error) {
      console.error("Failed to search landmarks:", error);
      return NextResponse.json({ error: "Failed to search landmarks" }, { status: 500 });
    }

    return NextResponse.json({ results: data ?? [] });
  }

  if (mode === "trip-context") {
    const tripId = searchParams.get("tripId");
    const leg = searchParams.get("leg");

    if (!tripId || (leg !== "pickup" && leg !== "dropoff")) {
      return NextResponse.json({ error: "Valid tripId and leg are required" }, { status: 400 });
    }

    const locationColumn = leg === "pickup" ? "pickup_location_id" : "dropoff_location_id";
    const { data: tripData, error: tripError } = await supabaseAdmin
      .from("trips")
      .select(`id, ${locationColumn}`)
      .eq("id", tripId)
      .maybeSingle();

    if (tripError) {
      console.error("Failed to load trip context:", tripError);
      return NextResponse.json({ error: "Failed to load trip context" }, { status: 500 });
    }

    if (!tripData) {
      return NextResponse.json({ location: null });
    }

    const locationId = tripData[locationColumn as keyof typeof tripData] as string | null | undefined;

    if (!locationId) {
      return NextResponse.json({ location: null });
    }

    const { data: locationData, error: locationError } = await supabaseAdmin
      .from("locations")
      .select(LANDMARK_SELECT)
      .eq("id", locationId)
      .maybeSingle();

    if (locationError) {
      console.error("Failed to load trip location context:", locationError);
      return NextResponse.json({ error: "Failed to load trip location" }, { status: 500 });
    }

    return NextResponse.json({ location: locationData ?? null });
  }

  return NextResponse.json({ error: "Unsupported landmark mode" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const { errorResponse } = await requireNunaAccess();

  if (errorResponse) {
    return errorResponse;
  }

  const body = (await request.json()) as {
    editingLocationId?: string | null;
    name?: string;
    aliases?: string[];
    address?: string | null;
    category?: string;
    notes?: string | null;
    selectedCoords?: { lat: number; lng: number } | null;
  };

  const trimmedName = body.name?.trim().toLowerCase();

  if (!trimmedName) {
    return NextResponse.json({ error: "Landmark name is required" }, { status: 400 });
  }

  if (!body.selectedCoords) {
    return NextResponse.json({ error: "Coordinates are required" }, { status: 400 });
  }

  const metadata = {
    category: body.category || "landmark",
    address: body.address?.trim() || null,
    notes: body.notes?.trim() || null,
    source: "operator_dashboard",
  };

  const payload = {
    raw_text: trimmedName,
    normalized_text: trimmedName,
    latitude: body.selectedCoords.lat,
    longitude: body.selectedCoords.lng,
    is_verified: true,
    confidence_score: 1,
    metadata,
    last_used_at: new Date().toISOString(),
  };

  const locationMutation = body.editingLocationId
    ? supabaseAdmin
        .from("locations")
        .update(payload)
        .eq("id", body.editingLocationId)
        .select("id")
        .single()
    : supabaseAdmin
        .from("locations")
        .upsert(payload, { onConflict: "raw_text" })
        .select("id")
        .single();

  const { data: locationRow, error: locationError } = await locationMutation;

  if (locationError || !locationRow) {
    console.error("Failed to save landmark:", locationError);
    return NextResponse.json({ error: "Failed to save landmark" }, { status: 500 });
  }

  const aliasList = parseAliases(body.aliases);

  if (aliasList.length > 0) {
    const aliasRows = aliasList.map((alias) => ({
      location_id: locationRow.id,
      alias_text: alias,
      normalized_alias: alias,
      source: "operator_dashboard",
      confidence_score: 1,
    }));

    const { error: aliasError } = await supabaseAdmin
      .from("location_aliases")
      .upsert(aliasRows, { onConflict: "location_id,normalized_alias" });

    if (aliasError) {
      console.error("Failed to save landmark aliases:", aliasError);
      return NextResponse.json({ error: "Failed to save landmark aliases" }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    locationId: locationRow.id,
    message: body.editingLocationId
      ? "Landmark updated successfully."
      : "Verified landmark saved successfully.",
  });
}
