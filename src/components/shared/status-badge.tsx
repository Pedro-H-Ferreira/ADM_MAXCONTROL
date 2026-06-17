import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusStyles: Record<string, string> = {
  ATIVO: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  SINCRONIZADO: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  MAPEADO: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  PAGO: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  LANCADO: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  APROVADA: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  CONCLUIDO: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  OK: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  PENDENTE: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ABERTO: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ABERTA: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  AGUARDANDO_ENVIO: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  AGUARDANDO_APROVACAO: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  AGUARDANDO_FORNECEDOR: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  AGUARDANDO_MATERIAL: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  AGUARDANDO_TERCEIRO: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  NAO_MAPEADO: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ATRIBUIDA: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  VENCENDO: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  EM_ANDAMENTO: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  EM_COTACAO: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  EM_ANALISE: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  PROCESSANDO: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  INICIADA: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  PRONTO: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  FORMULARIO_ABERTO: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  MODELO_VALIDO: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  FINALIZADA: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  VENCIDO: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  ATRASADA: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  CRITICO: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  DIVERGENTE: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  FALHA: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  CANCELADO: "border-zinc-500/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

const urgentStatuses = new Set(["VENCIDO", "ATRASADA", "CRITICO", "DIVERGENTE", "FALHA"]);

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[11px]",
        urgentStatuses.has(status) ? "stitch-pop-in-pulse" : "stitch-pop-in",
        statusStyles[status] ?? "bg-muted",
      )}
    >
      {status.replaceAll("_", " ")}
    </Badge>
  );
}
