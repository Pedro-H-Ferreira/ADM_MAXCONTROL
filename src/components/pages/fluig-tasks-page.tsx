"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  ClipboardList,
  History,
  Laptop,
  Loader2,
  RefreshCcw,
  RotateCw,
  Search,
  UserCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  fluigAdmApi,
  type FluigAdmAgent,
  type FluigAdmJobSummary,
  type FluigOpenRequestRecord,
  type FluigUserSyncStateRecord,
} from "@/lib/fluig-api";
import type { FluigModuleSlug } from "@/lib/fluig-data";
import type { ModuleConfig } from "@/lib/admin-data";
import { waitForFluigJobs } from "@/lib/use-fluig-job-state";
import { cn } from "@/lib/utils";

type ModuleFilter = "all" | FluigModuleSlug;
type OperationalLookupModule = Extract<FluigModuleSlug, "pagamentos" | "compras" | "manutencao">;
type LookupModuleFilter = "auto" | OperationalLookupModule;

const terminalJobStatuses = new Set(["success", "error", "cancelled", "expired"]);
const recentFailureWindowMs = 24 * 60 * 60 * 1000;

const moduleLabels: Record<FluigModuleSlug, string> = {
  pagamentos: "Pagamentos",
  compras: "Compras",
  manutencao: "Manutencao",
  fornecedores: "Fornecedores",
};

const moduleOptions: Array<{ value: ModuleFilter; label: string }> = [
  { value: "all", label: "Todos os modulos" },
  { value: "pagamentos", label: moduleLabels.pagamentos },
  { value: "compras", label: moduleLabels.compras },
  { value: "manutencao", label: moduleLabels.manutencao },
  { value: "fornecedores", label: moduleLabels.fornecedores },
];

const lookupModuleOptions: Array<{ value: LookupModuleFilter; label: string }> = [
  { value: "auto", label: "Detectar pelo ADM" },
  { value: "pagamentos", label: moduleLabels.pagamentos },
  { value: "compras", label: moduleLabels.compras },
  { value: "manutencao", label: moduleLabels.manutencao },
];

const syncTypeLabels: Record<FluigUserSyncStateRecord["syncType"], string> = {
  historical: "Historico",
  open_tasks: "Tarefas abertas",
  my_requests: "Minhas solicitacoes",
  status_check: "Consulta de status",
  supplier_lookup: "Consulta de fornecedor",
};

const operationLabels: Record<string, string> = {
  sync_history: "Historico",
  sync_status: "Status",
  open_from_source: "Abertura",
  cancel_request: "Cancelamento",
  health_check: "Teste de conexao",
  sync_initial_history: "Historico inicial",
  sync_user_open_tasks: "Tarefas do usuario",
  sync_user_open_requests: "Solicitacoes do usuario",
  sync_user_incremental_batch: "Incremental",
  sync_request_by_number: "Consulta por numero",
  supplier_lookup_by_cnpj: "Fornecedor por CNPJ",
};

function timestampMs(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isRecentTimestamp(value: string | null | undefined) {
  const timestamp = timestampMs(value);
  return timestamp != null && Date.now() - timestamp <= recentFailureWindowMs;
}

function isRecentJobFailure(job: Pick<FluigAdmJobSummary, "status" | "updatedAt" | "finishedAt">) {
  return (job.status === "error" || job.status === "expired") && isRecentTimestamp(job.finishedAt || job.updatedAt);
}

function isCurrentSyncStateError(state: FluigUserSyncStateRecord) {
  return state.status === "error" && isRecentTimestamp(state.lastErrorAt || state.updatedAt);
}

function isVisibleRecentJob(job: FluigAdmJobSummary) {
  if (job.status === "error" || job.status === "expired") return isRecentJobFailure(job);
  return true;
}

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
  if (status === "RUNNING" || status === "PROCESSING") return "PROCESSANDO";
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

function describeHeartbeatAge(seconds: number | null | undefined) {
  if (seconds == null) return "heartbeat sem registro";
  if (seconds < 60) return "heartbeat agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `heartbeat ha ${minutes} min`;
  return `heartbeat ha ${Math.floor(minutes / 60)} h`;
}

function sortByRecentActivity(a: FluigOpenRequestRecord, b: FluigOpenRequestRecord) {
  const left = Date.parse(a.lastStatusCheckAt || a.lastSyncedAt || a.lastSeenInUserOpenListAt || a.openedAt || "");
  const right = Date.parse(b.lastStatusCheckAt || b.lastSyncedAt || b.lastSeenInUserOpenListAt || b.openedAt || "");
  return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
}

function requestRowKey(row: Pick<FluigOpenRequestRecord, "module" | "fluigRequestId" | "id">) {
  return `${row.module}:${row.fluigRequestId || row.id}`;
}

function isCancelableRequest(row: FluigOpenRequestRecord | null | undefined) {
  if (!row || row.module === "fornecedores" || !row.fluigRequestId) return false;
  const status = normalizeStatus(row.normalizedStatus || row.status, row.isOpen === false ? "FINALIZADO" : "ABERTO");
  if (row.isOpen === false) return false;
  return !status.includes("FINALIZ") && !status.includes("CANCEL") && !status.includes("ENCERR");
}

function describeAgent(agent: FluigAdmAgent | null) {
  if (!agent) return "Nenhum agente online para o usuario atual.";
  return `${agent.display_name}${agent.machine_name ? ` em ${agent.machine_name}` : ""} - ${describeHeartbeatAge(agent.heartbeat_age_seconds)}`;
}

function selectedModule(value: ModuleFilter) {
  return value === "all" ? undefined : value;
}

function lookupModuleForRequest(moduleFilter: ModuleFilter, lookupModule: LookupModuleFilter): LookupModuleFilter {
  if (lookupModule !== "auto") return lookupModule;
  if (moduleFilter === "pagamentos" || moduleFilter === "compras" || moduleFilter === "manutencao") return moduleFilter;
  return "auto";
}

function lookupModuleLabel(value: LookupModuleFilter) {
  return value === "auto" ? "Detectar pelo ADM" : moduleLabels[value];
}

export function FluigTasksPage({ config }: { config: ModuleConfig }) {
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>("all");
  const [lookupModule, setLookupModule] = useState<LookupModuleFilter>("auto");
  const [agents, setAgents] = useState<FluigAdmAgent[]>([]);
  const [tasks, setTasks] = useState<FluigOpenRequestRecord[]>([]);
  const [requests, setRequests] = useState<FluigOpenRequestRecord[]>([]);
  const [states, setStates] = useState<FluigUserSyncStateRecord[]>([]);
  const [jobs, setJobs] = useState<FluigAdmJobSummary[]>([]);
  const [lookupNumber, setLookupNumber] = useState("");
  const [lastLookupNumber, setLastLookupNumber] = useState<string | null>(null);
  const [lookedUpRequest, setLookedUpRequest] = useState<FluigOpenRequestRecord | null>(null);
  const [cancelTarget, setCancelTarget] = useState<FluigOpenRequestRecord | null>(null);
  const [cancellingRequestKey, setCancellingRequestKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [testingAgent, setTestingAgent] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onlineAgent = useMemo(() => agents.find((agent) => agent.status === "online") || null, [agents]);
  const sortedTasks = useMemo(() => [...tasks].sort(sortByRecentActivity), [tasks]);
  const sortedRequests = useMemo(() => [...requests].sort(sortByRecentActivity), [requests]);
  const pendingJobs = useMemo(() => jobs.filter((job) => !terminalJobStatuses.has(job.status)), [jobs]);
  const failedJobs = useMemo(() => jobs.filter(isRecentJobFailure), [jobs]);
  const syncErrors = useMemo(() => states.filter(isCurrentSyncStateError), [states]);
  const latestState = useMemo(
    () => [...states].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || null,
    [states]
  );
  const lookedUpRecord = useMemo(() => {
    if (lookedUpRequest) return lookedUpRequest;
    if (!lastLookupNumber) return null;
    return [...tasks, ...requests].find((item) => item.fluigRequestId === lastLookupNumber) || null;
  }, [lastLookupNumber, lookedUpRequest, requests, tasks]);

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);

      try {
        const moduleSlug = selectedModule(moduleFilter);
        const [nextAgents, taskData, requestData, syncStateData, jobData] = await Promise.all([
          fluigAdmApi.listAgents(),
          fluigAdmApi.listMyTasks(60, moduleSlug),
          fluigAdmApi.listMyOpenRequests(60, moduleSlug),
          fluigAdmApi.listSyncState(moduleSlug),
          fluigAdmApi.listJobs(40),
        ]);

        setAgents(nextAgents);
        setTasks(taskData.tasks || []);
        setRequests(requestData.requests || []);
        setStates(syncStateData.states || []);
        setJobs(jobData.jobs || []);
      } catch (refreshError) {
        const message = refreshError instanceof Error ? refreshError.message : "Falha ao carregar Central Fluig.";
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [moduleFilter]
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
    await waitForFluigJobs(seedJobs, {
      onUpdate: (job) => {
        setJobs((current) => {
          const nextById = new Map(current.map((currentJob) => [currentJob.id, currentJob]));
          nextById.set(job.id, { ...(nextById.get(job.id) || job), ...job });
          return Array.from(nextById.values());
        });
      },
    });
  }

  async function syncMyFluig() {
    if (!onlineAgent) {
      const message =
        "Nenhum agente Fluig online esta pareado com este usuario. Gere o token em Pagamentos, Compras ou Manutencao e inicie o agente nesta maquina.";
      setError(message);
      toast.error(message);
      return;
    }

    setSyncing(true);
    setError(null);

    try {
      const data = await fluigAdmApi.syncUser({ module: moduleFilter, limit: 80 });
      const nextJobs = data.jobs || [];

      if (nextJobs.length) {
        setJobs((current) => [...nextJobs, ...current.filter((job) => !nextJobs.some((nextJob) => nextJob.id === job.id))]);
        await pollJobsUntilDone(nextJobs);
        toast.success("Sincronizacao do seu Fluig concluida.");
      } else if (data.skipped.length) {
        toast.info("Nenhum job novo foi necessario para este usuario agora.");
      } else {
        toast.info("Sincronizacao solicitada, mas nao havia dados pendentes.");
      }

      await refresh(true);
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Falha ao sincronizar o Fluig do usuario.";
      setError(message);
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  }

  async function lookupFluigRequest() {
    if (!onlineAgent) {
      const message = "Inicie um agente Fluig pareado com este usuario antes de consultar uma solicitacao.";
      setError(message);
      toast.error(message);
      return;
    }

    const fluigRequestId = lookupNumber.replace(/\D/g, "");
    if (!fluigRequestId) {
      toast.error("Informe o numero da solicitacao Fluig.");
      return;
    }

    setLookingUp(true);
    setError(null);
    setLastLookupNumber(fluigRequestId);
    setLookedUpRequest(null);

    try {
      const targetLookupModule = lookupModuleForRequest(moduleFilter, lookupModule);
      const data = await fluigAdmApi.lookupRequest({
        module: targetLookupModule,
        fluigRequestId,
        persist: true,
      });

      setJobs((current) => [data.job, ...current.filter((job) => job.id !== data.job.id)]);
      await pollJobsUntilDone([data.job]);
      await refresh(true);
      const lookupResult = await fluigAdmApi.getLookupRequest({
        module: targetLookupModule,
        fluigRequestId,
      });
      setLookedUpRequest(lookupResult.request || null);
      toast.success(`Solicitacao Fluig ${fluigRequestId} consultada e atualizada.`);
    } catch (lookupError) {
      const message = lookupError instanceof Error ? lookupError.message : "Falha ao consultar solicitacao Fluig.";
      setError(message);
      toast.error(message);
    } finally {
      setLookingUp(false);
    }
  }

  async function testAgentConnection() {
    if (!onlineAgent) {
      const message = "Nenhum agente local online para testar. Abra o agente nesta maquina e clique em Atualizar.";
      setError(message);
      toast.error(message);
      return;
    }

    setTestingAgent(true);
    setError(null);

    try {
      const jobModule = moduleFilter === "all" ? "pagamentos" : moduleFilter;
      const data = await fluigAdmApi.testAgentConnection({
        module: jobModule,
      });
      const testJob: FluigAdmJobSummary = data.job;

      setJobs((current) => [testJob, ...current.filter((job) => job.id !== testJob.id)]);
      await pollJobsUntilDone([testJob]);
      await refresh(true);
      toast.success("Conexao autenticada com o Fluig validada.");
    } catch (testError) {
      const message = testError instanceof Error ? testError.message : "Falha ao testar o agente local.";
      setError(message);
      toast.error(message);
    } finally {
      setTestingAgent(false);
    }
  }

  async function cancelFluigRequest(record: FluigOpenRequestRecord) {
    if (!onlineAgent) {
      const message = "Inicie um agente Fluig pareado com este usuario antes de cancelar a solicitacao.";
      setError(message);
      toast.error(message);
      return;
    }

    if (record.module === "fornecedores" || !isCancelableRequest(record)) {
      toast.error("Esta solicitacao nao esta disponivel para cancelamento pelo ADM.");
      return;
    }

    const targetKey = requestRowKey(record);
    setCancellingRequestKey(targetKey);
    setError(null);

    try {
      const data = await fluigAdmApi.cancelRequest({
        module: record.module,
        requestIds: [record.fluigRequestId],
        comment: "Cancelamento confirmado no ADM MaxControl.",
        confirm: true,
        persist: true,
      });

      setJobs((current) => [data.job, ...current.filter((job) => job.id !== data.job.id)]);
      await pollJobsUntilDone([data.job]);
      await refresh(true);

      const lookupResult = await fluigAdmApi.getLookupRequest({
        module: record.module,
        fluigRequestId: record.fluigRequestId,
      });
      if (lastLookupNumber === record.fluigRequestId) {
        setLookedUpRequest(lookupResult.request || null);
      }

      setCancelTarget(null);
      toast.success(`Cancelamento da solicitacao Fluig ${record.fluigRequestId} concluido.`);
    } catch (cancelError) {
      const message = cancelError instanceof Error ? cancelError.message : "Falha ao cancelar solicitacao Fluig.";
      setError(message);
      toast.error(message);
    } finally {
      setCancellingRequestKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operacao Fluig"
        title="Central Fluig e tarefas"
        description="Acompanhe tarefas sob sua responsabilidade, solicitacoes abertas, sincronizacoes e consultas por numero Fluig."
        action={config.primaryAction}
      />

      <div className="stitch-animate-in grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <MetricTile icon={Laptop} label="Agente local" value={onlineAgent ? "Online" : "Pendente"} detail={describeAgent(onlineAgent)} />
        <MetricTile icon={ClipboardList} label="Minhas tarefas" value={String(tasks.length)} detail="Pendencias abertas no Fluig" />
        <MetricTile icon={Workflow} label="Solicitacoes abertas" value={String(requests.length)} detail="Itens ainda acompanhados pelo ADM" />
        <MetricTile icon={Activity} label="Jobs em andamento" value={String(pendingJobs.length)} detail="Execucoes aguardando agente local" />
        <MetricTile icon={AlertTriangle} label="Erros recentes" value={String(failedJobs.length + syncErrors.length)} detail="Falhas acionaveis das ultimas 24h" tone={failedJobs.length + syncErrors.length ? "danger" : "default"} />
        <MetricTile
          icon={RefreshCcw}
          label="Ultima sync"
          value={latestState?.lastSuccessAt ? formatDateTime(latestState.lastSuccessAt) : "-"}
          detail={latestState ? `${moduleLabels[latestState.module]} - ${syncTypeLabels[latestState.syncType]}` : "Sem sync registrada"}
        />
      </div>

      <Card className="stitch-animate-in stitch-hover-lift rounded-lg shadow-none">
        <CardHeader className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCheck className="size-4" />
              Controle do meu Fluig
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Filtre por modulo, execute a sincronizacao incremental do usuario ou consulte uma solicitacao especifica.
            </p>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <Select value={moduleFilter} onValueChange={(value) => setModuleFilter(value as ModuleFilter)}>
              <SelectTrigger className="w-full md:w-[190px]">
                <SelectValue placeholder="Modulo" />
              </SelectTrigger>
              <SelectContent>
                {moduleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="stitch-soft-button" onClick={() => void refresh()} disabled={loading || syncing || lookingUp || testingAgent}>
              <RotateCw className={cn("size-4", loading ? "animate-spin" : "")} />
              Atualizar
            </Button>
            <Button
              type="button"
              variant="outline"
              className="stitch-soft-button"
              onClick={testAgentConnection}
              disabled={loading || syncing || lookingUp || testingAgent || !onlineAgent}
            >
              {testingAgent ? <Loader2 className="size-4 animate-spin" /> : <Laptop className="size-4" />}
              Testar agente
            </Button>
            <Button
              type="button"
              className="stitch-soft-button"
              onClick={syncMyFluig}
              disabled={syncing || lookingUp || testingAgent || !onlineAgent}
            >
              {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
              Sincronizar meu Fluig
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_auto]">
            <Select value={lookupModule} onValueChange={(value) => setLookupModule(value as LookupModuleFilter)} disabled={lookingUp || syncing}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Modulo da consulta" />
              </SelectTrigger>
              <SelectContent>
                {lookupModuleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={lookupNumber}
                onChange={(event) => setLookupNumber(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void lookupFluigRequest();
                }}
                className="pl-9"
                inputMode="numeric"
                placeholder="Consultar solicitacao por numero Fluig"
                disabled={lookingUp || !onlineAgent}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="stitch-soft-button"
              onClick={lookupFluigRequest}
              disabled={lookingUp || syncing || !onlineAgent}
            >
              {lookingUp ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Consultar numero
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Modulo usado na consulta: {lookupModuleLabel(lookupModuleForRequest(moduleFilter, lookupModule))}. Escolha Pagamentos, Compras ou
            Manutencao quando a solicitacao ainda nao foi sincronizada no ADM.
          </p>

          {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
          {pendingJobs.length ? <PendingJobs jobs={pendingJobs} /> : null}
          {lastLookupNumber ? (
            <LookupResult
              requestNumber={lastLookupNumber}
              record={lookedUpRecord}
              loading={lookingUp}
              onCancelRequest={setCancelTarget}
              cancellingRequestKey={cancellingRequestKey}
            />
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 2xl:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <RequestTable
            title="Tarefas sob minha responsabilidade"
            emptyText={loading ? "Carregando tarefas do Fluig..." : "Nenhuma tarefa aberta sincronizada para este usuario."}
            rows={sortedTasks}
            onCancelRequest={setCancelTarget}
            cancellingRequestKey={cancellingRequestKey}
          />
          <RequestTable
            title="Minhas solicitacoes abertas"
            emptyText={loading ? "Carregando solicitacoes do Fluig..." : "Nenhuma solicitacao aberta sincronizada para este usuario."}
            rows={sortedRequests}
            onCancelRequest={setCancelTarget}
            cancellingRequestKey={cancellingRequestKey}
          />
        </div>

        <div className="space-y-4">
          <AgentPanel agents={agents} loading={loading} />
          <SyncStatePanel states={states} loading={loading} />
          <RecentJobsPanel jobs={jobs} loading={loading} />
        </div>
      </div>

      <AlertDialog open={Boolean(cancelTarget)} onOpenChange={(open) => !open && !cancellingRequestKey && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar solicitacao Fluig?</AlertDialogTitle>
            <AlertDialogDescription>
              O agente local vai entrar no Fluig com o seu usuario e cancelar a solicitacao {cancelTarget?.fluigRequestId}. Esta acao nao e
              repetida automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(cancellingRequestKey)}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!cancelTarget || Boolean(cancellingRequestKey)}
              onClick={() => cancelTarget && void cancelFluigRequest(cancelTarget)}
            >
              {cancellingRequestKey ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
              Cancelar no Fluig
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
                <p className="truncate text-sm font-medium">{moduleLabels[job.module]}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{operationLabels[job.operation] || job.operation}</p>
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

function LookupResult({
  requestNumber,
  record,
  loading,
  onCancelRequest,
  cancellingRequestKey,
}: {
  requestNumber: string;
  record: FluigOpenRequestRecord | null;
  loading: boolean;
  onCancelRequest: (record: FluigOpenRequestRecord) => void;
  cancellingRequestKey: string | null;
}) {
  const cancelable = isCancelableRequest(record);
  const cancelling = record ? cancellingRequestKey === requestRowKey(record) : false;

  return (
    <section className="rounded-md border bg-muted/20 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium">Consulta Fluig {requestNumber}</p>
          <p className="text-xs text-muted-foreground">
            {loading ? "Consultando diretamente no Fluig pelo agente local." : record ? "Registro encontrado na base sincronizada." : "Consulta finalizada; atualize a lista se o job ainda estiver processando."}
          </p>
        </div>
        {record ? (
          <div className="flex items-center gap-2">
            <StatusBadge status={normalizeStatus(record.normalizedStatus || record.status)} />
            {cancelable ? (
              <Button type="button" variant="destructive" size="sm" onClick={() => onCancelRequest(record)} disabled={cancelling}>
                {cancelling ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
                Cancelar
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {record ? (
        <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
          <Field label="Modulo" value={moduleLabels[record.module]} />
          <Field label="Etapa" value={record.currentTask || "-"} />
          <Field label="Responsavel" value={record.taskOwner || "-"} />
          <Field label="Atualizado" value={formatDateTime(record.lastStatusCheckAt || record.lastSyncedAt)} />
        </div>
      ) : null}
    </section>
  );
}

function RequestTable({
  title,
  rows,
  emptyText,
  onCancelRequest,
  cancellingRequestKey,
}: {
  title: string;
  rows: FluigOpenRequestRecord[];
  emptyText: string;
  onCancelRequest: (record: FluigOpenRequestRecord) => void;
  cancellingRequestKey: string | null;
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
              <TableHead>Modulo</TableHead>
              <TableHead>Fornecedor / solicitante</TableHead>
              <TableHead>Filial</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Responsavel</TableHead>
              <TableHead>Atualizado</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Acoes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const cancelable = isCancelableRequest(row);
              const cancelling = cancellingRequestKey === requestRowKey(row);

              return (
                <TableRow key={`${row.module}-${row.fluigRequestId}-${row.id}`}>
                  <TableCell className="font-medium">{row.fluigRequestId}</TableCell>
                  <TableCell>{moduleLabels[row.module]}</TableCell>
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
                  <TableCell>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => onCancelRequest(row)}
                      disabled={!cancelable || cancelling}
                    >
                      {cancelling ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
                      Cancelar
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <div className="p-8 text-center text-sm text-muted-foreground">{emptyText}</div>
      )}
    </section>
  );
}

function AgentPanel({ agents, loading }: { agents: FluigAdmAgent[]; loading: boolean }) {
  return (
    <SidePanel icon={Laptop} title="Agentes locais">
      {agents.length ? (
        <div className="space-y-2">
          {agents.slice(0, 5).map((agent) => (
            <div key={agent.id} className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{agent.display_name}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{agent.machine_name || "Maquina nao informada"}</p>
                </div>
                <StatusBadge status={normalizeStatus(agent.status, "PENDENTE")} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Heartbeat: {formatDateTime(agent.last_heartbeat_at)}</p>
              <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                <span>Versao: {agent.agent_version || "-"}</span>
                <span>Ultimo sinal: {describeHeartbeatAge(agent.heartbeat_age_seconds)}</span>
                <span className="truncate">{agent.local_api_url || "API local nao informada"}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanelText>{loading ? "Carregando agentes..." : "Nenhum agente local pareado para este usuario."}</EmptyPanelText>
      )}
    </SidePanel>
  );
}

function SyncStatePanel({ states, loading }: { states: FluigUserSyncStateRecord[]; loading: boolean }) {
  const orderedStates = [...states].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8);

  return (
    <SidePanel icon={History} title="Ultimas sincronizacoes">
      {orderedStates.length ? (
        <div className="space-y-2">
          {orderedStates.map((state) => (
            <div key={state.id} className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{moduleLabels[state.module]}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{syncTypeLabels[state.syncType]}</p>
                </div>
                <StatusBadge status={state.status === "error" ? "FALHA" : state.status === "success" ? "SINCRONIZADO" : "PENDENTE"} />
              </div>
              <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                <span>Sucesso: {formatDateTime(state.lastSuccessAt)}</span>
                <span>Atualizado: {formatDateTime(state.updatedAt)}</span>
                {isCurrentSyncStateError(state) && state.lastErrorMessage ? <span className="text-red-700">{state.lastErrorMessage}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanelText>{loading ? "Carregando sincronizacoes..." : "Nenhum estado de sincronizacao registrado."}</EmptyPanelText>
      )}
    </SidePanel>
  );
}

function RecentJobsPanel({ jobs, loading }: { jobs: FluigAdmJobSummary[]; loading: boolean }) {
  const visibleJobs = jobs.filter(isVisibleRecentJob).slice(0, 8);

  return (
    <SidePanel icon={Workflow} title="Jobs recentes">
      {visibleJobs.length ? (
        <div className="space-y-2">
          {visibleJobs.map((job) => (
            <div key={job.id} className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{operationLabels[job.operation] || job.operation}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {moduleLabels[job.module]} - {job.id.slice(0, 8)}
                  </p>
                </div>
                <StatusBadge status={normalizeJobStatus(job.status)} />
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{job.errorMessage || job.progressLabel || "Sem detalhe adicional."}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanelText>{loading ? "Carregando jobs..." : "Nenhum job Fluig recente."}</EmptyPanelText>
      )}
    </SidePanel>
  );
}

function SidePanel({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="stitch-animate-in rounded-lg border bg-background shadow-none">
      <header className="flex items-center gap-2 border-b p-4">
        <Icon className="size-4" />
        <h2 className="text-base font-semibold">{title}</h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyPanelText({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">{children}</p>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="truncate font-medium">{value}</p>
    </div>
  );
}
