"use server";

import { redirect } from "next/navigation";
import { invalidateSession } from "@/lib/auth/session";

/** Server Action de logout: encerra a sessão server-side e volta ao /login. */
export async function logoutAction(): Promise<void> {
  await invalidateSession();
  redirect("/login");
}
