import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import { canAccessNuna, getCurrentAppUser } from "@/lib/auth";

async function RiderAccessGate({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();

  const appUser = await getCurrentAppUser();

  if (!appUser) {
    redirect("/auth/login");
  }

  if (canAccessNuna(appUser.role)) {
    redirect("/nuna");
  }

  if (appUser.role !== "rider") {
    redirect("/");
  }

  return children;
}

export default function RiderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Suspense fallback={null}><RiderAccessGate>{children}</RiderAccessGate></Suspense>;
}
