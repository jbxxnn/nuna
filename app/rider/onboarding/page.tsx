import { connection } from "next/server";
import { redirect } from "next/navigation";

import OnboardingForm from "./onboarding-form";
import { getCurrentRiderState } from "@/lib/auth";

export default async function RiderOnboardingPage() {
  await connection();

  const riderState = await getCurrentRiderState();

  if (!riderState) {
    redirect("/auth/login");
  }

  if (riderState.rider) {
    redirect("/rider");
  }

  return (
    <OnboardingForm
      email={riderState.appUser.email}
      initialProfile={riderState.rider}
    />
  );
}
