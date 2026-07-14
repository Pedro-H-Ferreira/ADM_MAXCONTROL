"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  ExternalLink,
  Filter,
  Laptop,
  Loader2,
  Plus,
  RefreshCcw,
  RotateCw,
  Search,
  Settings2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { waitForFluigJobs } from "@/lib/use-fluig-job-state";
import { useVisibleRefresh } from "@/lib/use-visible-refresh";
import { actionableRecentFluigJobFailures } from "@/lib/fluig-job-errors";
import { cn } from "@/lib/utils";

type OperationalModuleSlug = Extract<FluigModuleSlug, "pagamentos" | "compras">;

const terminalJobStatuses = new Set(["success", "error", "cancelled", "expired"]);
const recentFailureWindowMs = 24 * 60 * 60 * 1000;

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

function timestampMs(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isRecentTimestamp(value: string | null | undefined) {
  const timestamp = timestampMs(value);
  return timestamp != null && Date.now() - timestamp <= recentFailureWindowMs;
}

function isCurrentSyncStateError(state: FluigUserSyncStateRecord) {
  return state.status === "error" && isRecentTimestamp(state.lastErrorAt || state.updatedAt);
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

function describeAgent(agent: FluigAdmAgent | null) {
  if (!agent) return "Nenhum agente online para executar o Fluig nesta maquina.";
  return `${agent.display_name}${agent.machine_name ? ` em ${agent.machine_name}` : ""} - ${describeHeartbeatAge(agent.heartbeat_age_seconds)}`;
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
  const [taskTotal, setTaskTotal] = useState(0);
  const [requests, setRequests] = useState<FluigOpenRequestRecord[]>([]);
  const [requestTotal, setRequestTotal] = useState(0);
  const [requestPage, setRequestPage] = useState(1);
  const [requestPageSize, setRequestPageSize] = useState(50);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [states, setStates] = useState<FluigUserSyncStateRecord[]>([]);
  const [jobs, setJobs] = useState<FluigAdmJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [branchFilter, setBranchFilter] = useState("ALL");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [activeTab, setActiveTab] = useState("requests");
  const [selectedRequest, setSelectedRequest] = useState<FluigOpenRequestRecord | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<"launch" | "tools">("launch");
  const [requestRefreshing, setRequestRefreshing] = useState(false);
  const [referenceTime, setReferenceTime] = useState(0);
  const initialLoadCompleted = useRef(false);

  const onlineAgent = useMemo(() => agents.find((agent) => agent.status === "online") || null, [agents]);
  const sortedTasks = useMemo(() => [...tasks].sort(sortByRecentActivity), [tasks]);
  const sortedRequests = useMemo(() => [...requests].sort(sortByRecentActivity), [requests]);
  const moduleJobs = useMemo(() => jobs.filter((job) => job.module === moduleSlug), [jobs, moduleSlug]);
  const pendingJobs = useMemo(() => moduleJobs.filter((job) => !terminalJobStatuses.has(job.status)), [moduleJobs]);
  const failedJobs = useMemo(() => actionableRecentFluigJobFailures(moduleJobs), [moduleJobs]);
  const syncErrors = useMemo(() => states.filter(isCurrentSyncStateError), [states]);
  const latestState = useMemo(
    () => [...states].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || null,
    [states]
  );
  const branches = useMemo(() => Array.from(new Map([...tasks, ...requests].filter((row) => row.branchCode || row.branchLabel).map((row) => [row.branchCode || row.branchLabel || "", { code: row.branchCode || "", label: row.branchLabel || row.branchCode || "" }])).values()), [requests, tasks]);
  const requestTabActive = activeTab === "requests" || activeTab === "errors" || activeTab === "finished";
  const requestPageCount = Math.max(1, Math.ceil(requestTotal / requestPageSize));
  const visibleRows = useMemo(() => {
    const source = activeTab === "tasks" ? sortedTasks : sortedRequests;
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return source.filter((row) => {
      if (activeTab === "tasks" && statusFilter !== "ALL" && normalizeStatus(row.normalizedStatus || row.status) !== statusFilter) return false;
      if (activeTab === "tasks" && branchFilter !== "ALL" && row.branchCode !== branchFilter) return false;
      if (activeTab === "tasks" && onlyOverdue && (!referenceTime || !row.dueDate || Date.parse(row.dueDate) >= referenceTime)) return false;
      if (!normalizedQuery) return true;
      return [row.fluigRequestId, row.admReference, row.supplierName, row.supplierCnpj, row.requester, row.currentTask, row.taskOwner].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(normalizedQuery));
    });
  }, [activeTab, branchFilter, onlyOverdue, query, referenceTime, sortedRequests, sortedTasks, statusFilter]);

  const loadRequestPage = useCallback(
    () =>
      fluigAdmApi.listRequests({
        module: moduleSlug,
        page: requestPage,
        pageSize: requestPageSize,
        search: debouncedQuery || undefined,
        status: statusFilter === "ALL" ? undefined : statusFilter,
        branch: branchFilter === "ALL" ? undefined : branchFilter,
        open: activeTab === "finished" ? false : activeTab === "errors" ? null : true,
        overdue: onlyOverdue,
        errorOnly: activeTab === "errors",
      }),
    [activeTab, branchFilter, debouncedQuery, moduleSlug, onlyOverdue, requestPage, requestPageSize, statusFilter]
  );

  const refreshRequestTable = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const requestData = await loadRequestPage();
      setRequests(requestData.items || []);
      setRequestTotal(requestData.total || 0);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Falha ao carregar solicitacoes Fluig.";
      setError(message);
      toast.error(message);
    } finally {
      setRequestsLoading(false);
    }
  }, [loadRequestPage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRequestPage(1);
      setDebouncedQuery(query.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!initialLoadCompleted.current || !requestTabActive) return;
    void refreshRequestTable();
  }, [refreshRequestTable, requestTabActive]);

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);

      try {
        const [nextAgents, taskData, requestData, syncStateData, jobData] = await Promise.all([
          fluigAdmApi.listAgents(),
          fluigAdmApi.listMyTasks(40, moduleSlug),
          loadRequestPage(),
          fluigAdmApi.listSyncState(moduleSlug),
          fluigAdmApi.listJobs(30),
        ]);

        setAgents(nextAgents);
        setTasks(taskData.tasks || []);
        setTaskTotal(Number(taskData.total || 0));
        setRequests(requestData.items || []);
        setRequestTotal(requestData.total || 0);
        setStates(syncStateData.states || []);
        setJobs(jobData.jobs || []);
        setReferenceTime(new Date().getTime());
        initialLoadCompleted.current = true;
      } catch (refreshError) {
        const message = refreshError instanceof Error ? refreshError.message : `Falha ao carregar ${moduleLabels[moduleSlug]}.`;
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [loadRequestPage, moduleSlug]
  );

  useVisibleRefresh(refresh);

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

  async function syncThisModule() {
    if (!onlineAgent) {
      const message = "Pareie e inicie um agente Fluig para este usuario antes de sincronizar este modulo.";
      setError(message);
      toast.error(message);
      return;
    }

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

  async function refreshSelectedRequest() {
    if (!selectedRequest || requestRefreshing) return;
    if (!onlineAgent) { toast.error("O agente Fluig precisa estar online para consultar a solicitacao."); return; }
    setRequestRefreshing(true);
    try {
      const created = await fluigAdmApi.lookupRequest({ module: moduleSlug, fluigRequestId: selectedRequest.fluigRequestId, persist: true });
      await waitForFluigJobs([created.job]);
      const updated = await fluigAdmApi.getLookupRequest({ module: moduleSlug, fluigRequestId: selectedRequest.fluigRequestId });
      if (updated.request) setSelectedRequest(updated.request);
      await refresh(true);
      toast.success("Status da solicitacao atualizado.");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Falha ao atualizar solicitacao.");
    } finally {
      setRequestRefreshing(false);
    }
  }

  function openFluigWorkspace(view: "launch" | "tools") {
    setWorkspaceView(view);
    setTechnicalOpen(true);
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
          <Button type="button" variant="outline" className="stitch-soft-button" onClick={() => openFluigWorkspace("launch")}>
            <Plus className="size-4" />
            Nova solicitacao
          </Button>
          <Button type="button" className="stitch-soft-button" onClick={syncThisModule} disabled={syncing || !onlineAgent}>
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
        <MetricTile icon={ClipboardList} label="Tarefas abertas" value={String(taskTotal)} detail="Pendencias do usuario neste modulo" />
        <MetricTile icon={Workflow} label="Solicitacoes abertas" value={String(requestTotal)} detail="Total acompanhado pelo ADM, nao apenas a pagina atual" />
        <MetricTile icon={RefreshCcw} label="Jobs em andamento" value={String(pendingJobs.length)} detail="Execucoes aguardando agente local" />
        <MetricTile
          icon={AlertTriangle}
          label="Erros recentes"
          value={String(failedJobs.length + syncErrors.length)}
          detail="Falhas acionaveis das ultimas 24h"
          tone={failedJobs.length + syncErrors.length ? "danger" : "default"}
        />
        <MetricTile
          icon={RefreshCcw}
          label="Ultima sync"
          value={latestState?.lastSuccessAt ? formatDateTime(latestState.lastSuccessAt) : "-"}
          detail={latestState ? syncTypeLabels[latestState.syncType] : "Sem sync registrada"}
        />
      </div>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
      {pendingJobs.length ? <PendingJobs jobs={pendingJobs} /> : null}

      <section className="rounded-md border bg-background">
        <div className="grid gap-2 border-b p-3 lg:grid-cols-[minmax(0,1fr)_220px_220px_auto]">
          <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Numero Fluig, fornecedor, CNPJ, solicitante ou etapa" /></div>
          <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setRequestPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todos os status</SelectItem>{Array.from(new Set([...tasks, ...requests].map((row) => normalizeStatus(row.normalizedStatus || row.status)))).sort().map((status) => <SelectItem key={status} value={status}>{status.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select>
          <Select value={branchFilter} onValueChange={(value) => { setBranchFilter(value); setRequestPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas as filiais</SelectItem>{branches.map((branch) => <SelectItem key={branch.code || branch.label} value={branch.code}>{branch.code ? `${branch.code} - ${branch.label}` : branch.label}</SelectItem>)}</SelectContent></Select>
          <label className="flex items-center gap-2 rounded-md border px-3 text-sm"><Checkbox checked={onlyOverdue} onCheckedChange={(checked) => { setOnlyOverdue(checked === true); setRequestPage(1); }} /><Filter className="size-4" />Somente atrasados</label>
        </div>

        <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value); setRequestPage(1); }}>
          <div className="overflow-x-auto border-b"><TabsList className="h-auto w-max min-w-full justify-start rounded-none bg-transparent p-0"><TabsTrigger className="rounded-none px-4 py-3" value="tasks">Minhas tarefas ({taskTotal})</TabsTrigger><TabsTrigger className="rounded-none px-4 py-3" value="requests">Minhas solicitacoes ({requestTotal})</TabsTrigger><TabsTrigger className="rounded-none px-4 py-3" value="errors">Com erro</TabsTrigger><TabsTrigger className="rounded-none px-4 py-3" value="finished">Finalizadas</TabsTrigger><TabsTrigger className="rounded-none px-4 py-3" value="jobs">Jobs e sincronizacoes</TabsTrigger></TabsList></div>
          {activeTab === "jobs" ? <TabsContent value="jobs" className="m-0"><JobsTable jobs={moduleJobs} states={states} loading={loading} /></TabsContent> : <TabsContent value={activeTab} className="m-0"><RequestTable title={activeTab === "tasks" ? "Tarefas sob sua responsabilidade" : activeTab === "errors" ? "Solicitacoes com erro ou canceladas" : activeTab === "finished" ? "Solicitacoes finalizadas" : `Solicitacoes de ${moduleLabels[moduleSlug].toLowerCase()}`} emptyText={loading || requestsLoading ? "Carregando dados persistidos..." : "Nenhum registro encontrado para os filtros informados."} rows={visibleRows} onSelect={setSelectedRequest} /></TabsContent>}
        </Tabs>
        {requestTabActive ? (
          <div className="flex flex-col gap-3 border-t p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {requestTotal ? `${(requestPage - 1) * requestPageSize + 1}-${Math.min(requestPage * requestPageSize, requestTotal)} de ${requestTotal}` : "Nenhum registro"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={String(requestPageSize)} onValueChange={(value) => { setRequestPageSize(Number(value)); setRequestPage(1); }}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="20">20 por pagina</SelectItem><SelectItem value="50">50 por pagina</SelectItem><SelectItem value="100">100 por pagina</SelectItem></SelectContent>
              </Select>
              <Button type="button" size="icon" variant="outline" aria-label="Pagina anterior" onClick={() => setRequestPage((page) => Math.max(1, page - 1))} disabled={requestsLoading || requestPage <= 1}><ChevronLeft className="size-4" /></Button>
              <span className="min-w-20 text-center text-sm">{requestPage} de {requestPageCount}</span>
              <Button type="button" size="icon" variant="outline" aria-label="Proxima pagina" onClick={() => setRequestPage((page) => Math.min(requestPageCount, page + 1))} disabled={requestsLoading || requestPage >= requestPageCount}><ChevronRight className="size-4" /></Button>
            </div>
          </div>
        ) : null}
      </section>

      <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => openFluigWorkspace("tools")}><Settings2 className="size-4" />Agente, sincronizacao e ferramentas Fluig</Button>

      <Sheet open={technicalOpen} onOpenChange={setTechnicalOpen}>
        <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:max-w-none sm:data-[side=right]:w-[min(1180px,calc(100vw-2rem))] sm:data-[side=right]:max-w-none">
          <SheetHeader className="shrink-0 border-b bg-background/95 pr-14 supports-backdrop-filter:backdrop-blur">
            <SheetTitle>
              {workspaceView === "launch" ? `Nova solicitacao de ${moduleLabels[moduleSlug].toLowerCase()}` : `Ferramentas Fluig - ${moduleLabels[moduleSlug]}`}
            </SheetTitle>
            <SheetDescription>
              {workspaceView === "launch"
                ? "Preencha, valide e envie a solicitacao sem sair desta pagina."
                : "Sincronize dados, consulte solicitacoes e configure o agente local."}
            </SheetDescription>
            <div className="mt-3 flex w-fit rounded-lg border bg-muted/40 p-1" role="group" aria-label="Area de trabalho Fluig">
              <Button
                type="button"
                size="sm"
                variant={workspaceView === "launch" ? "secondary" : "ghost"}
                className="h-8"
                aria-pressed={workspaceView === "launch"}
                onClick={() => setWorkspaceView("launch")}
              >
                <Plus className="size-4" />
                Preencher solicitacao
              </Button>
              <Button
                type="button"
                size="sm"
                variant={workspaceView === "tools" ? "secondary" : "ghost"}
                className="h-8"
                aria-pressed={workspaceView === "tools"}
                onClick={() => setWorkspaceView("tools")}
              >
                <Settings2 className="size-4" />
                Sincronizacao e agente
              </Button>
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 px-4 py-4 sm:px-6 sm:py-6">
            {technicalOpen ? (
              <FluigIntegrationPanel
                moduleSlug={moduleSlug}
                agents={agents}
                onAgentsChange={setAgents}
                recoverJobs={false}
                workspaceView={workspaceView}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(selectedRequest)} onOpenChange={(open) => { if (!open) setSelectedRequest(null); }}><SheetContent className="w-full sm:max-w-2xl"><SheetHeader><SheetTitle>{selectedRequest ? `Fluig ${selectedRequest.fluigRequestId}` : "Solicitacao Fluig"}</SheetTitle><SheetDescription>{selectedRequest?.supplierName || selectedRequest?.requester || "Detalhes sincronizados"}</SheetDescription></SheetHeader>{selectedRequest ? <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6"><div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"><RequestDetail label="Referencia ADM" value={selectedRequest.admReference || "-"} /><RequestDetail label="Modulo" value={moduleLabels[moduleSlug]} /><RequestDetail label="Status" value={normalizeStatus(selectedRequest.normalizedStatus || selectedRequest.status)} /><RequestDetail label="Etapa atual" value={selectedRequest.currentTask || "-"} /><RequestDetail label="Responsavel" value={selectedRequest.taskOwner || "-"} /><RequestDetail label="Solicitante" value={selectedRequest.requester || "-"} /><RequestDetail label="Fornecedor" value={selectedRequest.supplierName || "-"} /><RequestDetail label="CNPJ" value={selectedRequest.supplierCnpj || "-"} /><RequestDetail label="Filial" value={selectedRequest.branchLabel || selectedRequest.branchCode || "-"} /><RequestDetail label="Prazo" value={formatDateTime(selectedRequest.dueDate)} /><RequestDetail label="Aberta em" value={formatDateTime(selectedRequest.openedAt)} /><RequestDetail label="Ultima sincronizacao" value={formatDateTime(selectedRequest.lastStatusCheckAt || selectedRequest.lastSyncedAt)} /></div><div className="flex flex-wrap gap-2"><Button type="button" onClick={() => void refreshSelectedRequest()} disabled={requestRefreshing}>{requestRefreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}Atualizar status</Button><Button type="button" variant="outline" onClick={() => { void navigator.clipboard.writeText(selectedRequest.fluigRequestId); toast.success("Numero Fluig copiado."); }}><Copy className="size-4" />Copiar numero</Button><Button type="button" variant="outline" asChild><a href={integration.openUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />Abrir no Fluig</a></Button></div><section><h3 className="mb-2 font-medium">Historico operacional</h3><div className="rounded-md border p-3 text-sm text-muted-foreground"><p>Registro persistido em {formatDateTime(selectedRequest.lastSyncedAt)}.</p><p className="mt-1">Ultima consulta de status em {formatDateTime(selectedRequest.lastStatusCheckAt)}.</p>{selectedRequest.syncSource ? <p className="mt-1">Origem: {selectedRequest.syncSource.replaceAll("_", " ")}.</p> : null}</div></section></div> : null}</SheetContent></Sheet>
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
  onSelect,
}: {
  title: string;
  rows: FluigOpenRequestRecord[];
  emptyText: string;
  onSelect: (row: FluigOpenRequestRecord) => void;
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
        <div className="overflow-x-auto"><Table>
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
              <TableRow key={`${row.module}-${row.fluigRequestId}-${row.id}`} className="cursor-pointer" onClick={() => onSelect(row)}>
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
        </Table></div>
      ) : (
        <EmptyTableText>{emptyText}</EmptyTableText>
      )}
    </section>
  );
}

function JobsTable({ jobs, states, loading }: { jobs: FluigAdmJobSummary[]; states: FluigUserSyncStateRecord[]; loading: boolean }) {
  if (loading && !jobs.length) return <EmptyTableText>Carregando jobs e sincronizacoes...</EmptyTableText>;
  if (!jobs.length && !states.length) return <EmptyTableText>Nenhum job ou sincronizacao registrado.</EmptyTableText>;
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Inicio</TableHead><TableHead>Operacao</TableHead><TableHead>Andamento</TableHead><TableHead>Tentativas</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{jobs.map((job) => <TableRow key={job.id}><TableCell className="whitespace-nowrap">{formatDateTime(job.createdAt)}</TableCell><TableCell><p className="font-medium">{job.operation.replaceAll("_", " ")}</p><p className="text-xs text-muted-foreground">{job.id.slice(0, 8)}</p></TableCell><TableCell className="min-w-72 whitespace-normal">{job.errorMessage || job.progressLabel || job.progressStage || "Aguardando agente local"}</TableCell><TableCell>{job.attempts}/{job.maxAttempts}</TableCell><TableCell><StatusBadge status={normalizeJobStatus(job.status)} /></TableCell></TableRow>)}</TableBody></Table>{states.length ? <div className="border-t p-3"><h3 className="mb-2 text-sm font-medium">Cursores de sincronizacao</h3><div className="grid gap-2 md:grid-cols-2">{states.map((state) => <div key={state.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs"><div><p className="font-medium">{syncTypeLabels[state.syncType]}</p><p className="text-muted-foreground">{formatDateTime(state.lastSuccessAt || state.lastErrorAt || state.updatedAt)}</p></div><Badge variant="outline">{state.status}</Badge></div>)}</div></div> : null}</div>;
}

function RequestDetail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{value}</p></div>;
}

function EmptyTableText({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center text-sm text-muted-foreground">{children}</div>;
}
