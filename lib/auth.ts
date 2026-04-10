import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { NextResponse } from "next/server";

export type AppRole = "rider" | "user" | "admin" | "moderator";

export interface AppUser {
  id: string;
  email: string | null;
  role: AppRole;
}

export interface RiderUser extends AppUser {
  rider: {
    id: string;
    full_name: string | null;
    phone_number: string | null;
    vehicle_type: string | null;
    bike_plate_number: string | null;
    status: "offline" | "available" | "assigned" | "on_trip" | "suspended";
    is_verified: boolean;
    service_zone: string | null;
    current_latitude: number | null;
    current_longitude: number | null;
    last_seen_at: string | null;
  };
}

export interface RiderProfile {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  vehicle_type: string | null;
  bike_plate_number: string | null;
  status: "offline" | "available" | "assigned" | "on_trip" | "suspended";
  is_verified: boolean;
  service_zone: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  last_seen_at: string | null;
}

export async function getCurrentAppUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data: appUser, error: appUserError } = await supabaseAdmin
    .from("users")
    .select("role, email")
    .eq("id", user.id)
    .maybeSingle();

  if (appUserError) {
    console.error("Failed to load application user role:", appUserError);
  }

  const metadataRole =
    typeof user.app_metadata?.role === "string"
      ? user.app_metadata.role
      : typeof user.user_metadata?.role === "string"
        ? user.user_metadata.role
        : undefined;

  return {
    id: user.id,
    email: appUser?.email ?? user.email ?? null,
    role:
      (appUser?.role as AppRole | undefined) ??
      (metadataRole as AppRole | undefined) ??
      "rider",
  };
}

export function canAccessNuna(role: AppRole) {
  return role === "admin" || role === "moderator";
}

export function canImportLandmarks(role: AppRole) {
  return role === "admin";
}

export function canAccessRider(role: AppRole) {
  return role === "rider";
}

export async function requireNunaAccess() {
  const appUser = await getCurrentAppUser();

  if (!appUser) {
    return {
      appUser: null,
      errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!canAccessNuna(appUser.role)) {
    return {
      appUser: null,
      errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { appUser, errorResponse: null };
}

export async function getCurrentRiderState(): Promise<{
  appUser: AppUser;
  rider: RiderProfile | null;
} | null> {
  const appUser = await getCurrentAppUser();

  if (!appUser || !canAccessRider(appUser.role)) {
    return null;
  }

  const { data: rider, error } = await supabaseAdmin
    .from("riders")
    .select("id, full_name, phone_number, vehicle_type, bike_plate_number, status, is_verified, service_zone, current_latitude, current_longitude, last_seen_at")
    .eq("user_id", appUser.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load rider profile:", error);
    return null;
  }

  return { appUser, rider };
}

export async function getCurrentRiderUser(): Promise<RiderUser | null> {
  const riderState = await getCurrentRiderState();

  if (!riderState?.rider) {
    return null;
  }

  return {
    ...riderState.appUser,
    rider: riderState.rider,
  };
}

export async function requireRiderAccess() {
  const riderState = await getCurrentRiderState();

  if (!riderState) {
    return {
      riderUser: null,
      errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  if (!riderState.rider) {
    return {
      riderUser: null,
      errorResponse: NextResponse.json(
        { error: "Rider onboarding required", onboardingRequired: true },
        { status: 409 },
      ),
    };
  }

  return {
    riderUser: {
      ...riderState.appUser,
      rider: riderState.rider,
    },
    errorResponse: null,
  };
}
