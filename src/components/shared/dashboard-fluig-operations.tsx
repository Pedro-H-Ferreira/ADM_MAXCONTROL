"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, ClipboardList, Laptop, Loader2, RefreshCcw, RotateCw, UserCheck, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  fluigAdmApi,
  type FluigAdmAgent,
  type FluigAdmJobSummary,
  type FluigOpenRequestRecord,
  type FluigUserSyncStateRecord,
} from "@/lib/fluig-api";
import type { FluigModuleSlug } from "@/lib/fluig-data";
import { cn } from "@/lib/utils";

const terminalJobStatuses = new Set(["success", "error", "cancelled", "expired"]);

const moduleLabels: Record<FluigModuleSlug, string> = {
  pagamentos: "Pagamentos",
  compras: "Compras",
  manutencao: "Manutencao",
  fornecedores: "Fornecedores",
};

const syncTypeLabels: Record<FluigUserSyncStateRecord["syncType"], string> = {
  historical: "Historico",
  open_tasks: "Tarefas abertas",
  my_requests: "Minhas solicitacoes",
  status_check: "Status",
  supplier_lookup: "Fornecedores",
};

type DashboardJob = Pick<FluigAdmJobSummary, "id" | "module" | "operation" | "status" | "progressLabel" | "errorMessage">;
type SupplierReviewSummary = {
  total: number;
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

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sortByRecentActivity(a: FluigOpenRequestRecord, b: FluigOpenRequestRecord) {
  const left = Date.parse(a.lastStatusCheckAt || a.lastSyncedAt || a.openedAt || "");
  const right = Date.parse(b.lastStatusCheckAt || b.lastSyncedAt || b.openedAt || "");
  return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
}

function describeAgent(agent: FluigAdmAgent | null) {
  if (!agent) return "Nenhum agente online para este usuario.";
  return `${agent.display_name}${agent.machine_name ? ` em ${agent.machine_name}` : ""}`;
}

async function loadSupplierReviewSummary(): Promise<SupplierReviewSummary> {
  const params = new URLSearchParams({
    syncStatus: "PENDENTE_REVISAO",
    page: "1",
    pageSize: "1",
  });
  const response = await fetch(`/api/fornecedores?${params.toString()}`, { cache: "no-store" });
  const data = (await response.json()) as { success?: boolean; total?: number; error?: string };

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Falha ao consultar fornecedores pendentes de revisao.");
  }

  return { total: Number(data.total || 0) };
}

export function DashboardFluigOperations() {
  const [agents, setAgents] = useState<FluigAdmAgent[]>([]);
  const [tasks, setTasks] = useState<FluigOpenRequestRecord[]>([]);
  const [requests, setRequests] = useState<FluigOpenRequestRecord[]>([]);
  const [states, setStates] = useState<FluigUserSyncStateRecord[]>([]);
  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [supplierReviewSummary, setSupplierReviewSummary] = useState<SupplierReviewSummary>({ total: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const onlineAgent = useMemo(() => agents.find((agent) => agent.status === "online") || null, [agents]);
  const sortedRequests = useMemo(() => [...requests].sort(sortByRecentActivity), [requests]);
  const visibleTasks = tasks.slice(0, 5);
  const visibleRequests = sortedRequests.slice(0, 5);
  const pendingJobs = jobs.filter((job) => !terminalJobStatuses.has(job.status));
  const failedJobs = jobs.filter((job) => job.status === "error" || job.status === "expired");
  const syncStatesWithErrors = states.filter((state) => state.lastErrorAt || state.lastErrorMessage);
  const syncErrorCount = failedJobs.length + syncStatesWithErrors.length;

  const latestState = useMemo(() => {
    return [...states].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || null;
  }, [states]);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      const [nextAgents, taskData, requestData, syncStateData, jobData, nextSupplierReviewSummary] = await Promise.all([
        fluigAdmApi.listAgents(),
        fluigAdmApi.listMyTasks(20),
        fluigAdmApi.listMyOpenRequests(20),
        fluigAdmApi.listSyncState(),
        fluigAdmApi.listJobs(20),
        loadSupplierReviewSummary(),
      ]);

      setAgents(nextAgents);
      setTasks(taskData.tasks || []);
      setRequests(requestData.requests || []);
      setStates(syncStateData.states || []);
      setJobs(jobData.jobs || []);
      setSupplierReviewSummary(nextSupplierReviewSummary);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Falha ao carregar dados do Fluig.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(true), 30000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function pollJobsUntilDone(seedJobs: DashboardJob[]) {
    const jobIds = seedJobs.map((job) => job.id);
    const seedById = new Map(seedJobs.map((job) => [job.id, job]));
    if (!jobIds.length) return;

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const statuses = await Promise.all(jobIds.map((jobId) => fluigAdmApi.getJob(jobId)));
      const nextJobs = statuses.map(({ job }) => ({
        id: job.id,
        module: seedById.get(job.id)?.module || "pagamentos",
        operation: seedById.get(job.id)?.operation || "sync_status",
        status: job.status,
        progressLabel: job.progressLabel,
        errorMessage: job.errorMessage || null,
      })) satisfies DashboardJob[];

      setJobs((current) =>
        current.map((job) => {
          const replacement = nextJobs.find((nextJob) => nextJob.id === job.id);
          return replacement ? { ...job, ...replacement } : job;
        })
      );

      if (nextJobs.every((job) => terminalJobStatuses.has(job.status))) {
        const failed = nextJobs.find((job) => job.status !== "success");
        if (failed) {
          throw new Error(failed.errorMessage || `Sincronizacao Fluig finalizada com status ${failed.status}.`);
        }
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }

    throw new Error("Tempo limite aguardando o agente local sincronizar o Fluig.");
  }

  async function syncMyFluig() {
    setSyncing(true);
    setError(null);
    setMessage(null);

    try {
      const data = await fluigAdmApi.syncUser({ module: "all", limit: 80 });
      const nextJobs = data.jobs.map((job) => ({
        id: job.id,
        module: job.module,
        operation: job.operation,
        status: job.status,
        progressLabel: job.progressLabel,
        errorMessage: job.errorMessage || null,
      }));

      setJobs(nextJobs);

      if (nextJobs.length) {
        await pollJobsUntilDone(nextJobs);
        setMessage("Sincronizacao do seu Fluig concluida.");
      } else if (data.skipped.length) {
        setMessage("Nao havia solicitacoes abertas conhecidas para atualizar agora.");
      } else {
        setMessage("Sincronizacao solicitada, mas nenhum job novo foi necessario.");
      }

      await refresh(true);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Falha ao sincronizar o Fluig do usuario.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card className="stitch-animate-in stitch-hover-lift stitch-delay-150 rounded-lg border-border/70 shadow-none">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="size-4" />
            Operacao Fluig do usuario
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Tarefas, solicitacoes abertas e status sincronizados pelo agente local pareado.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="stitch-soft-button" onClick={() => void refresh()} disabled={loading || syncing}>
            <RotateCw className={cn("size-4", loading ? "animate-spin" : "")} />
            Atualizar
          </Button>
          <Button type="button" className="stitch-soft-button" onClick={syncMyFluig} disabled={syncing}>
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
            Sincronizar meu Fluig
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          <MetricTile icon={Laptop} label="Agente local" value={onlineAgent ? "Online" : "Pendente"} detail={describeAgent(onlineAgent)} />
          <MetricTile icon={ClipboardList} label="Minhas tarefas" value={String(tasks.length)} detail="Pendencias sob responsabilidade do usuario" />
          <MetricTile icon={Workflow} label="Solicitacoes abertas" value={String(requests.length)} detail="Pagamentos, compras e manutencoes" />
          <MetricTile icon={ClipboardCheck} label="Aguardando acao" value={String(tasks.length)} detail="Itens do Fluig que dependem do usuario logado" />
          <MetricTile icon={UserCheck} label="Fornecedores em revisao" value={String(supplierReviewSummary.total)} detail="Pre-cadastros Fluig pendentes de validacao" />
          <MetricTile icon={AlertTriangle} label="Erros de sync" value={String(syncErrorCount)} detail="Jobs e estados de sincronizacao com falha" tone={syncErrorCount ? "danger" : "default"} />
          <MetricTile
            icon={RefreshCcw}
            label="Ultima sync"
            value={latestState ? formatDateTime(latestState.lastSuccessAt || latestState.updatedAt) : "-"}
            detail={latestState ? `${moduleLabels[latestState.module]} - ${syncTypeLabels[latestState.syncType]}` : "Sem sincronizacao registrada"}
          />
        </div>

        {pendingJobs.length ? (
          <div className="rounded-md border bg-muted/20 p-3 text-xs">
            <div className="flex items-center gap-2 font-medium">
              <Loader2 className="size-4 animate-spin" />
              Execucao em andamento
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {pendingJobs.map((job) => (
                <div key={job.id} className="rounded bg-background px-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span>{moduleLabels[job.module]}</span>
                    <StatusBadge status={normalizeStatus(job.status, "PROCESSANDO")} />
                  </div>
                  <p className="mt-1 text-muted-foreground">{job.progressLabel || "Aguardando agente local."}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {failedJobs.length || syncStatesWithErrors.length ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" />
              Erros recentes de sincronizacao
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {failedJobs.slice(0, 4).map((job) => (
                <div key={job.id} className="rounded bg-background px-2 py-2 text-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <span>{moduleLabels[job.module]}</span>
                    <StatusBadge status="FALHA" />
                  </div>
                  <p className="mt-1 text-muted-foreground">{job.errorMessage || job.progressLabel || "Job Fluig finalizado com erro."}</p>
                </div>
              ))}
              {syncStatesWithErrors.slice(0, 4).map((state) => (
                <div key={state.id} className="rounded bg-background px-2 py-2 text-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <span>{moduleLabels[state.module]} - {syncTypeLabels[state.syncType]}</span>
                    <StatusBadge status="FALHA" />
                  </div>
                  <p className="mt-1 text-muted-foreground">{state.lastErrorMessage || "Estado de sincronizacao com falha registrada."}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">{message}</p> : null}
        {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">{error}</p> : null}

        <div className="grid gap-4 xl:grid-cols-2">
          <DashboardFluigList
            title="Tarefas sob minha responsabilidade"
            emptyText={loading ? "Carregando tarefas do Fluig..." : "Nenhuma tarefa aberta sincronizada para este usuario."}
            items={visibleTasks}
          />
          <DashboardFluigList
            title="Solicitacoes abertas acompanhadas"
            emptyText={loading ? "Carregando solicitacoes do Fluig..." : "Nenhuma solicitacao aberta sincronizada."}
            items={visibleRequests}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: typeof Laptop;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className={cn("rounded-md border bg-muted/20 p-3", tone === "danger" ? "border-red-200 bg-red-50/70" : "")}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <p className="mt-2 text-lg font-semibold">{value}</p>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function DashboardFluigList({
  title,
  emptyText,
  items,
}: {
  title: string;
  emptyText: string;
  items: FluigOpenRequestRecord[];
}) {
  return (
    <section className="rounded-md border bg-muted/20">
      <header className="border-b p-3">
        <h3 className="text-sm font-semibold">{title}</h3>
      </header>
      <div className="divide-y">
        {items.length ? (
          items.map((item) => (
            <div key={`${item.module}-${item.fluigRequestId}`} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {item.fluigRequestId} - {moduleLabels[item.module]}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {item.supplierName || item.requester || item.branchLabel || "Solicitacao Fluig"}
                  </p>
                </div>
                <StatusBadge status={normalizeStatus(item.normalizedStatus || item.status)} />
              </div>
              <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                <Field label="Etapa" value={item.currentTask || "Nao informada"} />
                <Field label="Responsavel" value={item.taskOwner || "Nao informado"} />
                <Field label="Filial" value={item.branchLabel || item.branchCode || "-"} />
                <Field label="Atualizado" value={formatDateTime(item.lastStatusCheckAt || item.lastSyncedAt)} />
              </div>
            </div>
          ))
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">{emptyText}</div>
        )}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="truncate font-medium">{value}</p>
      <Separator className="mt-2 md:hidden" />
    </div>
  );
}
