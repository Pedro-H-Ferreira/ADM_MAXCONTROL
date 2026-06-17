import { Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function EmptyState({ title = "Nenhum registro encontrado" }: { title?: string }) {
  return (
    <Card className="stitch-animate-in rounded-lg border-dashed shadow-none">
      <CardContent className="flex min-h-44 flex-col items-center justify-center gap-3 text-center">
        <Inbox className="stitch-pop-in size-8 text-muted-foreground" />
        <p className="text-sm font-medium">{title}</p>
      </CardContent>
    </Card>
  );
}
