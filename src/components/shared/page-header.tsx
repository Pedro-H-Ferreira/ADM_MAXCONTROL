import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="stitch-slide-down flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {action ? (
        <Button asChild className="stitch-soft-button w-fit">
          <Link href={action.href} prefetch={false}>
            <Plus className="size-4" />
            {action.label}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
