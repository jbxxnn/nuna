import { redirect } from "next/navigation";

import { canImportLandmarks, getCurrentAppUser } from "@/lib/auth";

import { LandmarkImportForm } from "./import-form";

export default async function LandmarkImportPage() {
  const appUser = await getCurrentAppUser();

  if (!appUser) {
    redirect("/auth/login");
  }

  if (!canImportLandmarks(appUser.role)) {
    redirect("/nuna");
  }

  return <LandmarkImportForm />;
}
