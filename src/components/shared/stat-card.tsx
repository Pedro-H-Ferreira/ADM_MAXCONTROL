import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { StatItem } from "@/lib/admin-data";

const toneClasses = {
  default: "text-foreground bg-muted",
  success: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300",
  warning: "text-amber-700 bg-amber-500/10 dark:text-amber-300",
  danger: "text-red-700 bg-red-500/10 dark:text-red-300",
  info: "text-sky-700 bg-sky-500/10 dark:text-sky-300",
};

export function StatCard({ item, className }: { item: StatItem; className?: string }) {
  const Icon = item.icon;

  return (
    <Card
      className={cn(
        "stitch-animate-in stitch-hover-lift rounded-lg border-border/70 shadow-none",
        className,
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {item.title}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{item.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.helper}</p>
          </div>
          <div className={cn("stitch-pop-in rounded-md p-2", toneClasses[item.tone])}>
            <Icon className="size-4" />
          </div>
        </div>
        <div className="mt-4 text-xs font-medium text-muted-foreground">{item.change}</div>
      </CardContent>
    </Card>
  );
}
