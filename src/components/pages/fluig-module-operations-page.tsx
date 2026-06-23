"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ClipboardList,
  ExternalLink,
  Laptop,
  Loader2,
  RefreshCcw,
  RotateCw,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FluigIntegrationPanel } from "@/components/shared/fluig-integration-panel";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  fluigAdmApi,
  type FluigAdmAgent,
  type FluigAdmJobSummary,
  type FluigOpenRequestRecord,
  type FluigUserSyncStateRecord,
} from "@/lib/fluig-api";
import { getFluigIntegrationForModule, type FluigModuleSlug } from "@/lib/fluig-data";
import type { ModuleConfig } from "@/lib/admin-data";
import { cn } from "@/lib/utils";

type OperationalModuleSlug = Extract<FluigModuleSlug, "pagamentos" | "compras">;

const terminalJobStatuses = new Set(["success", "error", "cancelled", "expired"]);

const moduleLabels: Record<OperationalModuleSlug, string> = {
  pagamentos: "Pagamentos",
  compras: "Compras",
};

const syncTypeLabels: Record<FluigUserSyncStateRecord["syncType"], string> = {
  historical: "Historico",
  open_tasks: "Tarefas abertas",
  my_requests: "Minhas solicitacoes",
  status_check: "Consulta de status",
  supplier_lookup: "Consulta de fornecedor",
};

function normalizeStatus(value: string | null | undefined, fallback = "ABERTO") {
  const normalized = (value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  return normalized || fallback;
}

function normalizeJobStatus(value: string | null | undefined) {
  const status = normalizeStatus(value, "PENDENTE");
  if (status === "SUCCESS") return "CONCLUIDO";
  if (status === "ERROR" || status === "EXPIRED" || status === "CANCELLED") return "FALHA";
  if (status === "RUNNING" || status === "PROCESSING" || status === "AGENT_CLAIMED") return "PROCESSANDO";
  if (status === "QUEUED" || status === "PENDING") return "PENDENTE";
  return status;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sortByRecentActivity(a: FluigOpenRequestRecord, b: FluigOpenRequestRecord) {
  const left = Date.parse(a.lastStatusCheckAt || a.lastSyncedAt || a.lastSeenInUserOpenListAt || a.openedAt || "");
  const right = Date.parse(b.lastStatusCheckAt || b.lastSyncedAt || b.lastSeenInUserOpenListAt || b.openedAt || "");
  return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
}

function describeAgent(agent: FluigAdmAgent | null) {
  if (!agent) return "Nenhum agente online para executar o Fluig nesta maquina.";
  return `${agent.display_name}${agent.machine_name ? ` em ${agent.machine_name}` : ""}`;
}

export function FluigModuleOperationsPage({
  config,
  moduleSlug,
}: {
  config: ModuleConfig;
  moduleSlug: OperationalModuleSlug;
}) {
  const integration = getFluigIntegrationForModule(moduleSlug);
  const [agents, setAgents] = useState<FluigAdmAgent[]>([]);
  const [tasks, setTasks] = useState<FluigOpenRequestRecord[]>([]);
  const [requests, setRequests] = useState<FluigOpenRequestRecord[]>([]);
  const [states, setStates] = useState<FluigUserSyncStateRecord[]>([]);
  const [jobs, setJobs] = useState<FluigAdmJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onlineAgent = useMemo(() => agents.find((agent) => agent.status === "online") || null, [agents]);
  const sortedTasks = useMemo(() => [...tasks].sort(sortByRecentActivity), [tasks]);
  const sortedRequests = useMemo(() => [...requests].sort(sortByRecentActivity), [requests]);
  const moduleJobs = useMemo(() => jobs.filter((job) => job.module === moduleSlug), [jobs, moduleSlug]);
  const pendingJobs = useMemo(() => moduleJobs.filter((job) => !terminalJobStatuses.has(job.status)), [moduleJobs]);
  const failedJobs = useMemo(() => moduleJobs.filter((job) => job.status === "error" || job.status === "expired"), [moduleJobs]);
  const syncErrors = useMemo(() => states.filter((state) => state.lastErrorAt || state.lastErrorMessage), [states]);
  const latestState = useMemo(
    () => [...states].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || null,
    [states]
  );

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);

      try {
        const [nextAgents, taskData, requestData, syncStateData, jobData] = await Promise.all([
          fluigAdmApi.listAgents(),
          fluigAdmApi.listMyTasks(40, moduleSlug),
          fluigAdmApi.listMyOpenRequests(40, moduleSlug),
          fluigAdmApi.listSyncState(moduleSlug),
          fluigAdmApi.listJobs(30),
        ]);

        setAgents(nextAgents);
        setTasks(taskData.tasks || []);
        setRequests(requestData.requests || []);
        setStates(syncStateData.states || []);
        setJobs(jobData.jobs || []);
      } catch (refreshError) {
        const message = refreshError instanceof Error ? refreshError.message : `Falha ao carregar ${moduleLabels[moduleSlug]}.`;
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [moduleSlug]
  );

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(true), 30000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function pollJobsUntilDone(seedJobs: FluigAdmJobSummary[]) {
    const jobIds = seedJobs.map((job) => job.id);
    const seedById = new Map(seedJobs.map((job) => [job.id, job]));

    if (!jobIds.length) return;

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const statuses = await Promise.all(jobIds.map((jobId) => fluigAdmApi.getJob(jobId)));
      const nextJobs = statuses.map(({ job }) => {
        const seed = seedById.get(job.id);
        const fallback = seed || seedJobs[0];
        return {
          ...fallback,
          id: job.id,
          status: job.status,
          progressStage: job.progressStage,
          progressLabel: job.progressLabel,
          errorMessage: job.errorMessage || null,
        };
      });

      setJobs((current) => {
        const nextById = new Map(current.map((job) => [job.id, job]));
        nextJobs.forEach((job) => nextById.set(job.id, { ...(nextById.get(job.id) || job), ...job }));
        return Array.from(nextById.values());
      });

      if (nextJobs.every((job) => terminalJobStatuses.has(job.status))) {
        const failed = nextJobs.find((job) => job.status !== "success");
        if (failed) {
          throw new Error(failed.errorMessage || `Execucao Fluig finalizada com status ${failed.status}.`);
        }
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }

    throw new Error("Tempo limite aguardando o agente local concluir a sincronizacao.");
  }

  async function syncThisModule() {
    setSyncing(true);
    setError(null);

    try {
      const data = await fluigAdmApi.syncUser({ module: moduleSlug, limit: 80 });
      const nextJobs = data.jobs || [];

      if (nextJobs.length) {
        setJobs((current) => [...nextJobs, ...current.filter((job) => !nextJobs.some((nextJob) => nextJob.id === job.id))]);
        await pollJobsUntilDone(nextJobs);
        toast.success(`${moduleLabels[moduleSlug]} sincronizado com o seu Fluig.`);
      } else if (data.skipped.length) {
        toast.info("Nenhum job novo foi necessario para este modulo agora.");
      } else {
        toast.info("Sincronizacao solicitada, mas nao havia dados pendentes.");
      }

      await refresh(true);
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : `Falha ao sincronizar ${moduleLabels[moduleSlug]}.`;
      setError(message);
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  }

  if (!integration) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={config.eyebrow}
        title={config.title}
        description={integration.intent}
      />

      <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 shadow-none lg:flex-row lg:items-center lg:justify-between">
        <div className="grid gap-1 text-sm">
          <span className="font-medium">{integration.processLabel}</span>
          <span className="text-muted-foreground">
            Abertura, consulta e acompanhamento ficam nesta pagina; o agente local executa o Fluig em segundo plano.
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="stitch-soft-button" onClick={() => void refresh()} disabled={loading || syncing}>
            <RotateCw className={cn("size-4", loading ? "animate-spin" : "")} />
            Atualizar
          </Button>
          <Button type="button" className="stitch-soft-button" onClick={syncThisModule} disabled={syncing}>
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
            Sincronizar {moduleLabels[moduleSlug].toLowerCase()}
          </Button>
          <Button type="button" variant="outline" className="stitch-soft-button" asChild>
            <a href={integration.openUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
              Abrir Fluig
            </a>
          </Button>
        </div>
      </div>

      <div className="stitch-animate-in grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <MetricTile icon={Laptop} label="Agente local" value={onlineAgent ? "Online" : "Pendente"} detail={describeAgent(onlineAgent)} />
        <MetricTile icon={ClipboardList} label="Tarefas abertas" value={String(tasks.length)} detail="Pendencias do usuario neste modulo" />
        <MetricTile icon={Workflow} label="Solicitacoes abertas" value={String(requests.length)} detail="Itens acompanhados pelo ADM" />
        <MetricTile icon={RefreshCcw} label="Jobs em andamento" value={String(pendingJobs.length)} detail="Execucoes aguardando agente local" />
        <MetricTile
          icon={AlertTriangle}
          label="Erros recentes"
          value={String(failedJobs.length + syncErrors.length)}
          detail="Falhas de job ou sincronizacao"
          tone={failedJobs.length + syncErrors.length ? "danger" : "default"}
        />
        <MetricTile
          icon={RefreshCcw}
          label="Ultima sync"
          value={latestState ? formatDateTime(latestState.lastSuccessAt || latestState.updatedAt) : "-"}
          detail={latestState ? syncTypeLabels[latestState.syncType] : "Sem sync registrada"}
        />
      </div>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
      {pendingJobs.length ? <PendingJobs jobs={pendingJobs} /> : null}

      <FluigIntegrationPanel moduleSlug={moduleSlug} />

      <div className="grid gap-4 2xl:grid-cols-2">
        <RequestTable
          title={`Solicitacoes abertas de ${moduleLabels[moduleSlug].toLowerCase()}`}
          emptyText={loading ? "Carregando solicitacoes do Fluig..." : "Nenhuma solicitacao aberta sincronizada para este modulo."}
          rows={sortedRequests}
        />
        <RequestTable
          title={`Tarefas do Fluig em ${moduleLabels[moduleSlug].toLowerCase()}`}
          emptyText={loading ? "Carregando tarefas do Fluig..." : "Nenhuma tarefa aberta sincronizada para este modulo."}
          rows={sortedTasks}
        />
      </div>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className={cn("rounded-lg border bg-background p-3 shadow-none", tone === "danger" ? "border-red-200 bg-red-50/80" : "")}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function PendingJobs({ jobs }: { jobs: FluigAdmJobSummary[] }) {
  return (
    <section className="rounded-md border bg-muted/20 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Loader2 className="size-4 animate-spin" />
        Execucao em andamento
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {jobs.map((job) => (
          <div key={job.id} className="rounded-md border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{job.operation.replaceAll("_", " ")}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{job.id.slice(0, 8)}</p>
              </div>
              <StatusBadge status={normalizeJobStatus(job.status)} />
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{job.progressLabel || "Aguardando resposta do agente local."}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RequestTable({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: FluigOpenRequestRecord[];
  emptyText: string;
}) {
  return (
    <section className="stitch-animate-in rounded-lg border bg-background shadow-none">
      <header className="flex flex-col gap-1 border-b p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{rows.length} registro(s) sincronizado(s)</p>
        </div>
      </header>
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fluig</TableHead>
              <TableHead>Fornecedor / solicitante</TableHead>
              <TableHead>Filial</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Responsavel</TableHead>
              <TableHead>Atualizado</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.module}-${row.fluigRequestId}-${row.id}`}>
                <TableCell className="font-medium">{row.fluigRequestId}</TableCell>
                <TableCell className="min-w-[240px] max-w-[360px] whitespace-normal">
                  <p className="font-medium">{row.supplierName || row.requester || "Solicitacao Fluig"}</p>
                  <p className="text-xs text-muted-foreground">{row.supplierCnpj || row.admReference || "-"}</p>
                </TableCell>
                <TableCell className="min-w-[160px] max-w-[260px] whitespace-normal">{row.branchLabel || row.branchCode || "-"}</TableCell>
                <TableCell className="min-w-[180px] max-w-[280px] whitespace-normal">{row.currentTask || "-"}</TableCell>
                <TableCell className="min-w-[160px] max-w-[240px] whitespace-normal">{row.taskOwner || "-"}</TableCell>
                <TableCell>{formatDateTime(row.lastStatusCheckAt || row.lastSyncedAt || row.lastSeenInUserOpenListAt)}</TableCell>
                <TableCell>
                  <StatusBadge status={normalizeStatus(row.normalizedStatus || row.status)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyTableText>{emptyText}</EmptyTableText>
      )}
    </section>
  );
}

function EmptyTableText({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center text-sm text-muted-foreground">{children}</div>;
}
