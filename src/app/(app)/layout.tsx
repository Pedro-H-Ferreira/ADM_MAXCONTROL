import { AppShell } from "@/components/app/app-shell";
import { filterNavigationSectionsForAccess } from "@/lib/navigation";
import { resolveCurrentAppUserForPage } from "@/lib/page-auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await resolveCurrentAppUserForPage();

  return (
    <AppShell
      navigationSections={filterNavigationSectionsForAccess(actor.pageSlugs)}
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
