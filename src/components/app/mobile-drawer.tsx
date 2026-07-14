"use client";

import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();

  return <MobileDrawerContent key={pathname} navigationSections={navigationSections} />;
}

function MobileDrawerContent({ navigationSections }: { navigationSections: NavigationSection[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    const closeOnDesktop = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) setOpen(false);
    };

    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="stitch-soft-button lg:hidden" aria-label="Abrir menu">
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[290px] min-w-0 overflow-hidden p-0">
        <SheetTitle className="sr-only">Navegacao</SheetTitle>
        <AppSidebar collapsed={false} mobile sections={navigationSections} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
