import { redirect } from "next/navigation";
import { isAppAuthError, resolveCurrentAppUser } from "@/lib/db/app-repository";

export async function resolveCurrentAppUserForPage() {
  try {
    return await resolveCurrentAppUser();
  } catch (error) {
    if (!isAppAuthError(error)) {
      throw error;
    }

    const redirectPath =
      error.status === 401 ? "/login" : `/login?status=${encodeURIComponent(error.code.toLowerCase())}`;
    redirect(redirectPath);
  }
}
