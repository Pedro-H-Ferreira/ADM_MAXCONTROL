import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { isAppAuthError, resolveCurrentAppUser } from "@/lib/db/app-repository";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let redirectPath: string | null = null;
  let actor: Awaited<ReturnType<typeof resolveCurrentAppUser>> | null = null;

  try {
    actor = await resolveCurrentAppUser();
  } catch (error) {
    if (!isAppAuthError(error)) {
      throw error;
    }

    redirectPath = error.status === 401 ? "/login" : `/login?status=${error.code.toLowerCase()}`;
  }

  if (redirectPath) {
    redirect(redirectPath);
  }

  if (!actor) {
    redirect("/login");
  }

  return (
    <AppShell
      user={{
        name: actor.displayName,
        email: actor.email,
        role: actor.role,
        cd: actor.isAdmin ? "Todas as filiais" : actor.branchCodes.join(", ") || "Sem filial",
      }}
    >
      {children}
    </AppShell>
  );
}
