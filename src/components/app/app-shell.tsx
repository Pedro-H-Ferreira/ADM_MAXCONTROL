"use client";

import { useState } from "react";
import { AppSidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";

export type AppShellUser = {
  name: string;
  email: string | null;
  role: string;
  cd: string;
};

export function AppShell({ children, user }: { children: React.ReactNode; user: AppShellUser }) {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  return (
    <div className="min-h-screen bg-background">
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
        <AppSidebar collapsed={!sidebarExpanded} />
      </div>
      <div className="transition-[padding] duration-300 ease-in-out lg:pl-[76px]">
        <Topbar user={user} />
        <main className="mx-auto w-full max-w-[1600px] p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
