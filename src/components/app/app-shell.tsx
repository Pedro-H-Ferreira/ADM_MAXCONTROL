"use client";

import { useState } from "react";
import { AppSidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import type { NavigationSection } from "@/lib/navigation";

export type AppShellUser = {
  name: string;
  email: string | null;
  role: string;
  cd: string;
};

export function AppShell({
  children,
  user,
  navigationSections,
}: {
  children: React.ReactNode;
  user: AppShellUser;
  navigationSections: NavigationSection[];
}) {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  return (
    <div className="min-h-dvh min-w-0 bg-background">
      <div
        className="fixed inset-y-0 left-0 z-40 hidden w-[76px] overflow-visible lg:block"
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        onFocus={() => setSidebarExpanded(true)}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;

          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
            return;
          }

          setSidebarExpanded(false);
        }}
      >
        <AppSidebar collapsed={!sidebarExpanded} sections={navigationSections} />
      </div>
      <div className="min-w-0 transition-[padding] duration-300 ease-in-out motion-reduce:transition-none lg:pl-[76px]">
        <Topbar user={user} navigationSections={navigationSections} />
        <main tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[1600px] p-4 pb-10 md:p-6 md:pb-12">
          {children}
        </main>
      </div>
    </div>
  );
}
