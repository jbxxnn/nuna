import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { NextResponse } from "next/server";

export type AppRole = "rider" | "user" | "admin" | "moderator";

export interface AppUser {
  id: string;
  email: string | null;
  role: AppRole;
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
