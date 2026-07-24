import { Badge } from "@/components/ui/badge";
import type { FluigAdmJobSummary } from "@/lib/fluig-api";
import { getFluigJobProgress } from "@/lib/fluig-job-progress";
import { cn } from "@/lib/utils";

type FluigJobProgressCardJob = Pick<
  FluigAdmJobSummary,
  "id" | "operation" | "status" | "progressStage" | "progressLabel"
>;

export function FluigJobProgressCard({
  job,
  contextLabel,
  className,
}: {
  job: FluigJobProgressCardJob;
  contextLabel?: string;
  className?: string;
}) {
  const progress = getFluigJobProgress(job);
  const completedThrough =
    progress.terminalState === "success"
      ? progress.steps.length - 1
      : Math.max(-1, progress.currentStepIndex - 1);

  return (
    <article className={cn("rounded-lg border bg-background p-4 shadow-sm", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {contextLabel ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {contextLabel}
            </p>
          ) : null}
          <h3 className="mt-0.5 text-sm font-semibold leading-5">{progress.operationLabel}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Execução <span className="font-mono">{job.id.slice(0, 8)}</span>
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "w-fit shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            progress.terminalState === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-primary/30 bg-primary/10 text-primary",
          )}
        >
          Etapa {progress.currentStepIndex + 1} de {progress.steps.length}: {progress.currentStepLabel}
        </Badge>
      </div>

      <p className="mt-3 text-sm leading-5 text-muted-foreground">{progress.description}</p>

      <div className="mt-4 overflow-x-auto pb-1">
        <ol
          aria-label={`Progresso da execução: ${progress.operationLabel}`}
          className="grid min-w-[640px]"
          style={{ gridTemplateColumns: `repeat(${progress.steps.length}, minmax(80px, 1fr))` }}
        >
          {progress.steps.map((step, index) => {
            const completed = index <= completedThrough;
            const current = index === progress.currentStepIndex;
            const failed = current && progress.terminalState === "error";

            return (
              <li
                key={step.id}
                aria-current={current ? "step" : undefined}
                className="relative flex min-w-0 flex-col items-center px-1 text-center"
              >
                {index < progress.steps.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute left-1/2 top-[9px] h-0.5 w-full",
                      index < completedThrough || (completed && progress.terminalState === "success")
                        ? "bg-primary"
                        : "bg-border",
                    )}
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative z-10 grid size-[18px] place-items-center rounded-full border-2 bg-background text-[9px] font-bold",
                    completed && "border-primary bg-primary text-primary-foreground",
                    current && !failed && "border-primary bg-primary ring-4 ring-primary/15",
                    failed && "border-destructive bg-destructive text-destructive-foreground ring-4 ring-destructive/15",
                    !completed && !current && "border-border text-muted-foreground",
                  )}
                >
                  {completed || (current && progress.terminalState === "success") ? "✓" : index + 1}
                </span>
                <span
                  className={cn(
                    "mt-2 text-[10px] font-medium leading-3.5",
                    current ? "text-foreground" : completed ? "text-foreground/75" : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
                <span className="sr-only">
                  {current ? "Etapa atual" : completed ? "Etapa concluída" : "Etapa pendente"}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </article>
  );
}
