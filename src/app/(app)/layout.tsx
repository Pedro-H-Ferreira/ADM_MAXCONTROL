import { AppShell } from "@/components/app/app-shell";
import { formatAppShellUserLabel } from "@/lib/app-shell-user-label";
import { filterNavigationSectionsForAccess } from "@/lib/navigation";
import { resolveCurrentAppUserForPage } from "@/lib/page-auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await resolveCurrentAppUserForPage();

  return (
    <AppShell
      navigationSections={filterNavigationSectionsForAccess(actor.pageSlugs)}
      user={{
        name: actor.displayName,
        displayLabel: formatAppShellUserLabel(actor.displayName, actor.branchCodes),
        email: actor.email,
      }}
    >
      {children}
    </AppShell>
  );
}
