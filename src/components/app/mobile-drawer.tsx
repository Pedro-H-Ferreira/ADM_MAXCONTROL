"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AppSidebar } from "@/components/app/sidebar";
import type { NavigationSection } from "@/lib/navigation";

export function MobileDrawer({ navigationSections }: { navigationSections: NavigationSection[] }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="stitch-soft-button lg:hidden" aria-label="Abrir menu">
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[290px] p-0">
        <SheetTitle className="sr-only">Navegação</SheetTitle>
        <AppSidebar collapsed={false} mobile sections={navigationSections} />
      </SheetContent>
    </Sheet>
  );
}
