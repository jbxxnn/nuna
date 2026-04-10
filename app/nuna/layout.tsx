import { getCurrentAppUser, canAccessNuna } from "@/lib/auth";
import { connection } from "next/server";
import { redirect } from "next/navigation";

export default async function NunaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();

  const appUser = await getCurrentAppUser();

  if (!appUser) {
    redirect("/auth/login");
  }

  if (!canAccessNuna(appUser.role)) {
    redirect("/rider");
  }

  return children;
}
