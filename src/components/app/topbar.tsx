"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MobileDrawer } from "@/components/app/mobile-drawer";
import { NotificationBell } from "@/components/app/notification-bell";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";
import type { AppShellUser } from "@/components/app/app-shell";

export function Topbar({ user }: { user: AppShellUser }) {
  return (
    <header className="stitch-slide-down sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur md:px-6">
      <MobileDrawer />
      <div className="stitch-animate-in-fast relative hidden w-full max-w-xl md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-9 pl-9 transition-all duration-300 focus:shadow-sm"
          placeholder="Buscar fornecedor, despesa, contrato ou OS"
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
