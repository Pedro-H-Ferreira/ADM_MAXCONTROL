import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const priorityStyles: Record<string, string> = {
  CRITICA: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  ALTA: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  MEDIA: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  BAIXA: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[11px]",
        priority === "ALTA" ? "stitch-pop-in-pulse" : "stitch-pop-in",
        priorityStyles[priority],
      )}
    >
      {priority}
    </Badge>
  );
}
