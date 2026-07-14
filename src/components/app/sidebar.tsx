"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  Bell,
  Boxes,
  Building2,
  ChartNoAxesColumn,
  ClipboardCheck,
  FileSignature,
  LayoutDashboard,
  ListTodo,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  UsersRound,
  WalletCards,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { navigationSections, type NavigationSection } from "@/lib/navigation";

const icons: Record<string, LucideIcon> = {
  BadgeCheck,
  Bell,
  Boxes,
  Building2,
  ChartNoAxesColumn,
  ClipboardCheck,
  FileSignature,
  LayoutDashboard,
  ListTodo,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  UsersRound,
  WalletCards,
  Wrench,
};

export function AppSidebar({
  collapsed,
  mobile = false,
  sections = navigationSections,
  onNavigate,
}: {
  collapsed: boolean;
  mobile?: boolean;
  sections?: NavigationSection[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const showLabels = !collapsed || mobile;

  return (
    <aside
      data-expanded={showLabels}
      className={cn(
        "flex h-full flex-col overflow-hidden bg-sidebar text-sidebar-foreground transition-[width,box-shadow] duration-300 ease-in-out motion-reduce:transition-none",
        mobile ? "w-full" : collapsed ? "w-[76px] shadow-lg" : "w-60 shadow-xl",
      )}
    >
      <div className="flex h-16 items-center px-4">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2" onClick={onNavigate}>
          <div
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground transition-transform duration-300",
              showLabels ? "rotate-12" : "rotate-0",
            )}
          >
            MC
          </div>
          <div
            className={cn(
              "min-w-0 overflow-hidden whitespace-nowrap transition-[opacity,transform,width] duration-300",
              showLabels ? "w-40 translate-x-0 opacity-100" : "w-0 -translate-x-2 opacity-0",
            )}
          >
            <p className="truncate text-sm font-semibold">MaxControLADM</p>
            <p className="truncate text-xs text-sidebar-foreground/60">CD Principal</p>
          </div>
        </Link>
      </div>
      <Separator className="bg-sidebar-border" />
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section) => (
          <div key={section.title} className="mb-5">
            <p
              className={cn(
                "mb-2 overflow-hidden whitespace-nowrap px-2 text-[11px] font-medium uppercase tracking-[0.12em] text-sidebar-foreground/45 transition-[opacity,transform,height] duration-300",
                showLabels ? "h-4 translate-x-0 opacity-100" : "h-0 -translate-x-2 opacity-0",
              )}
            >
              {section.title}
            </p>
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = icons[item.icon] ?? LayoutDashboard;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const link = (
                  <Link
                    href={item.href}
                    aria-label={item.title}
                    onClick={onNavigate}
                    className={cn(
                      "group/nav flex h-9 items-center gap-2 rounded-md px-2 text-sm transition-all duration-200 ease-in-out active:scale-[0.98]",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/72 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
                      collapsed && !mobile ? "justify-center" : "",
                    )}
                  >
                    <Icon className="size-4 shrink-0 transition-transform duration-300 group-hover/nav:scale-110" />
                    <span
                      className={cn(
                        "min-w-0 overflow-hidden whitespace-nowrap transition-[opacity,transform,width] duration-300",
                        showLabels ? "w-40 translate-x-0 opacity-100" : "w-0 -translate-x-2 opacity-0",
                      )}
                    >
                      {item.title}
                    </span>
                  </Link>
                );

                if (collapsed && !mobile) {
                  return (
                    <Tooltip key={item.href}>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.title}</TooltipContent>
                    </Tooltip>
                  );
                }

                return <div key={item.href}>{link}</div>;
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3 text-xs text-sidebar-foreground/50">
        <span
          className={cn(
            "block overflow-hidden whitespace-nowrap transition-[opacity,transform,width] duration-300",
            showLabels ? "w-40 translate-x-0 opacity-100" : "w-8 translate-x-0 opacity-100",
          )}
        >
          {showLabels ? "CD Principal" : "CD"}
        </span>
      </div>
    </aside>
  );
}
