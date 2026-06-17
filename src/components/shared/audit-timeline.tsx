import { Clock3 } from "lucide-react";

const entries = [
  "Registro criado",
  "Anexo atualizado",
  "Status alterado",
];

export function AuditTimeline() {
  return (
    <div className="relative space-y-3">
      <div className="stitch-grow-down absolute left-[13px] top-3 h-[calc(100%-24px)] w-px bg-border" />
      {entries.map((entry, index) => (
        <div
          key={entry}
          className="stitch-animate-in-fast relative flex gap-3 text-sm"
          style={{ animationDelay: `${index * 100 + 150}ms` }}
        >
          <div className="stitch-pop-in mt-0.5 rounded-full bg-primary/10 p-1 text-primary">
            <Clock3 className="size-3.5" />
          </div>
          <div>
            <p className="font-medium">{entry}</p>
            <p className="text-xs text-muted-foreground">17/06/2026 {10 + index}:20</p>
          </div>
        </div>
      ))}
    </div>
  );
}
