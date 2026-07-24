"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  GripVertical,
  History,
  Laptop,
  Loader2,
  Plus,
  Paperclip,
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
import { FluigJobProgressCard } from "@/components/shared/fluig-job-progress-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  fluigAdmApi,
  type FluigAdmAgent,
  type FluigAdmJobSummary,
  type FluigFieldSetting,
  type FluigNatureFacet,
  type FluigOpenRequestRecord,
  type FluigRequestDetails,
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

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
}

function formatMoney(value: number | null | undefined, currency = "BRL") {
  if (value == null) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100);
}

function formatFileSize(value: number | null | undefined) {
  if (!value) return "Tamanho nao informado";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

const fluigFieldLabels: Record<string, string> = {
  nNotaFiscal: "Numero da NF",
  valorNF: "Valor da NF",
  valorNFT: "Valor total da NF",
  vencPagNota: "Data de vencimento",
  dataEmissaoNF: "Data de emissao",
  codigonaturezaC: "Natureza de despesa",
  fornecedorC: "Fornecedor",
  codCNPJ: "CNPJ",
  unidadeFilial: "Filial",
  centroCusto: "Centro de custo",
  formaPagamento: "Forma de pagamento",
  descricaoDemandaEnvio: "Descricao da demanda",
};

function fieldLabel(name: string) {
  if (fluigFieldLabels[name]) return fluigFieldLabels[name];
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function requestFluigUrl(row: FluigOpenRequestRecord, details: FluigRequestDetails | null, fallbackUrl: string) {
  if (details?.sourceUrl) return details.sourceUrl;
  if (row.sourceUrl) return row.sourceUrl;
  const url = new URL(fallbackUrl);
  url.search = "";
  url.searchParams.set("app_ecm_workflowview_detailsProcessInstanceID", row.fluigRequestId);
  return url.toString();
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
  const [natureFilter, setNatureFilter] = useState("ALL");
  const [natures, setNatures] = useState<FluigNatureFacet[]>([]);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [activeTab, setActiveTab] = useState("requests");
  const [selectedRequest, setSelectedRequest] = useState<FluigOpenRequestRecord | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<FluigRequestDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selectedAttachmentSequence, setSelectedAttachmentSequence] = useState<string | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<"launch" | "tools">("launch");
  const [requestRefreshing, setRequestRefreshing] = useState(false);
  const [fieldSettings, setFieldSettings] = useState<FluigFieldSetting[]>([]);
  const [fieldSettingsOpen, setFieldSettingsOpen] = useState(false);
  const [fieldSettingsLoading, setFieldSettingsLoading] = useState(false);
  const [fieldSettingsSaving, setFieldSettingsSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
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
      if (activeTab === "tasks" && natureFilter !== "ALL" && row.expenseNature !== natureFilter) return false;
      if (activeTab === "tasks" && onlyOverdue && (!referenceTime || !row.dueDate || Date.parse(row.dueDate) >= referenceTime)) return false;
      if (!normalizedQuery) return true;
      return [row.fluigRequestId, row.admReference, row.supplierName, row.supplierCnpj, row.requester, row.currentTask, row.taskOwner].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(normalizedQuery));
    });
  }, [activeTab, branchFilter, natureFilter, onlyOverdue, query, referenceTime, sortedRequests, sortedTasks, statusFilter]);

  const loadRequestPage = useCallback(
    () =>
      fluigAdmApi.listRequests({
        module: moduleSlug,
        page: requestPage,
        pageSize: requestPageSize,
        search: debouncedQuery || undefined,
        status: statusFilter === "ALL" ? undefined : statusFilter,
        branch: branchFilter === "ALL" ? undefined : branchFilter,
        nature: natureFilter === "ALL" ? undefined : natureFilter,
        open: activeTab === "finished" ? false : activeTab === "errors" ? null : true,
        overdue: onlyOverdue,
        errorOnly: activeTab === "errors",
      }),
    [activeTab, branchFilter, debouncedQuery, moduleSlug, natureFilter, onlyOverdue, requestPage, requestPageSize, statusFilter]
  );

  const refreshRequestTable = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const requestData = await loadRequestPage();
      setRequests(requestData.items || []);
      setRequestTotal(requestData.total || 0);
      setNatures(requestData.natures || []);
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
        const [nextAgents, taskData, requestData, syncStateData, jobData, fieldData] = await Promise.all([
          fluigAdmApi.listAgents(),
          fluigAdmApi.listMyTasks(40, moduleSlug),
          loadRequestPage(),
          fluigAdmApi.listSyncState(moduleSlug),
          fluigAdmApi.listJobs(30),
          fluigAdmApi.getFieldSettings(moduleSlug),
        ]);

        setAgents(nextAgents);
        setTasks(taskData.tasks || []);
        setTaskTotal(Number(taskData.total || 0));
        setNatures(requestData.natures || []);
        setIsAdmin(Boolean(fieldData.isAdmin || taskData.filters?.isAdmin));
        setFieldSettings(fieldData.settings || []);
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
      const message = "Cadastre o usuario e a senha Fluig antes de sincronizar este modulo pela VPS.";
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
    if (!onlineAgent) { toast.error("Cadastre o usuario e a senha Fluig antes de consultar a solicitacao pela VPS."); return; }
    setRequestRefreshing(true);
    try {
      const created = await fluigAdmApi.lookupRequest({ module: moduleSlug, fluigRequestId: selectedRequest.fluigRequestId, persist: true });
      await waitForFluigJobs([created.job]);
      const updated = await fluigAdmApi.getLookupRequest({ module: moduleSlug, fluigRequestId: selectedRequest.fluigRequestId });
      if (updated.request) setSelectedRequest(updated.request);
      const details = await fluigAdmApi.getRequestDetails({ module: moduleSlug, fluigRequestId: selectedRequest.fluigRequestId });
      setSelectedDetails(details.details);
      setDetailsError(null);
      await refresh(true);
      toast.success("Status da solicitacao atualizado.");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Falha ao atualizar solicitacao.");
    } finally {
      setRequestRefreshing(false);
    }
  }

  async function openRequestDetails(row: FluigOpenRequestRecord) {
    setSelectedRequest(row);
    setSelectedDetails(null);
    setDetailsError(null);
    setSelectedAttachmentSequence(null);
    setDetailsLoading(true);
    try {
      const response = await fluigAdmApi.getRequestDetails({ module: moduleSlug, fluigRequestId: row.fluigRequestId });
      setSelectedDetails(response.details);
    } catch (detailError) {
      setDetailsError(detailError instanceof Error ? detailError.message : "Falha ao consultar os detalhes no Fluig.");
    } finally {
      setDetailsLoading(false);
    }
  }

  function openFluigWorkspace(view: "launch" | "tools") {
    setWorkspaceView(view);
    setTechnicalOpen(true);
  }

  async function openFieldSettings() {
    if (fieldSettingsLoading) return;
    setFieldSettingsLoading(true);
    try {
      const result = await fluigAdmApi.getFieldSettings(moduleSlug, { discover: true });
      setFieldSettings(result.settings || []);
      setIsAdmin(Boolean(result.isAdmin));
      setFieldSettingsOpen(true);
    } catch (settingsError) {
      toast.error(settingsError instanceof Error ? settingsError.message : "Falha ao descobrir os campos Fluig.");
    } finally {
      setFieldSettingsLoading(false);
    }
  }

  async function saveFieldSettings(settings: FluigFieldSetting[]) {
    setFieldSettingsSaving(true);
    try {
      const result = await fluigAdmApi.saveFieldSettings(moduleSlug, settings);
      setFieldSettings(result.settings);
      setFieldSettingsOpen(false);
      toast.success("Campos e ordem salvos. A proxima sincronizacao atualizará os dados persistidos.");
    } catch (settingsError) {
      toast.error(settingsError instanceof Error ? settingsError.message : "Falha ao salvar campos Fluig.");
    } finally {
      setFieldSettingsSaving(false);
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
            Abertura, consulta e acompanhamento ficam nesta pagina; a VPS executa o Fluig em segundo plano.
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
          {isAdmin ? (
            <Button type="button" variant="outline" className="stitch-soft-button" onClick={() => void openFieldSettings()} disabled={fieldSettingsLoading}>
              {fieldSettingsLoading ? <Loader2 className="size-4 animate-spin" /> : <Settings2 className="size-4" />}Configurar campos
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="stitch-soft-button" asChild>
            <a href={integration.openUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
              Abrir Fluig
            </a>
          </Button>
        </div>
      </div>

      <div className="stitch-animate-in grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <MetricTile icon={Laptop} label="Executor da VPS" value={onlineAgent ? "Pronto" : "Sem credencial"} detail={describeAgent(onlineAgent)} />
        <MetricTile icon={ClipboardList} label="Tarefas abertas" value={String(taskTotal)} detail="Pendencias do usuario neste modulo" />
        <MetricTile icon={Workflow} label="Solicitacoes abertas" value={String(requestTotal)} detail="Total acompanhado pelo ADM, nao apenas a pagina atual" />
        <MetricTile icon={RefreshCcw} label="Jobs em andamento" value={String(pendingJobs.length)} detail="Execucoes processadas pela VPS" />
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
        <div className="grid gap-2 border-b p-3 xl:grid-cols-[minmax(260px,1fr)_180px_210px_260px_auto]">
          <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Numero Fluig, NF, fornecedor, CNPJ, solicitante ou etapa" /></div>
          <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setRequestPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todos os status</SelectItem>{Array.from(new Set([...tasks, ...requests].map((row) => normalizeStatus(row.normalizedStatus || row.status)))).sort().map((status) => <SelectItem key={status} value={status}>{status.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select>
          <Select value={branchFilter} onValueChange={(value) => { setBranchFilter(value); setRequestPage(1); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas as filiais</SelectItem>{branches.map((branch) => <SelectItem key={branch.code || branch.label} value={branch.code}>{branch.code ? `${branch.code} - ${branch.label}` : branch.label}</SelectItem>)}</SelectContent></Select>
          <Select value={natureFilter} onValueChange={(value) => { setNatureFilter(value); setRequestPage(1); }}><SelectTrigger className="w-full" aria-label="Filtrar por natureza de despesa"><SelectValue placeholder="Natureza de despesa" /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas as naturezas de despesa</SelectItem>{natures.map((nature) => <SelectItem key={nature.value} value={nature.value}>{nature.label} ({nature.count})</SelectItem>)}</SelectContent></Select>
          <label className="flex items-center gap-2 rounded-md border px-3 text-sm"><Checkbox checked={onlyOverdue} onCheckedChange={(checked) => { setOnlyOverdue(checked === true); setRequestPage(1); }} /><Filter className="size-4" />Somente atrasados</label>
        </div>

        <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value); setRequestPage(1); }}>
          <div className="overflow-x-auto border-b"><TabsList className="h-auto w-max min-w-full justify-start rounded-none bg-transparent p-0"><TabsTrigger className="rounded-none px-4 py-3" value="tasks">Minhas tarefas ({taskTotal})</TabsTrigger><TabsTrigger className="rounded-none px-4 py-3" value="requests">Minhas solicitacoes ({requestTotal})</TabsTrigger><TabsTrigger className="rounded-none px-4 py-3" value="errors">Com erro</TabsTrigger><TabsTrigger className="rounded-none px-4 py-3" value="finished">Finalizadas</TabsTrigger><TabsTrigger className="rounded-none px-4 py-3" value="jobs">Jobs e sincronizacoes</TabsTrigger></TabsList></div>
          {activeTab === "jobs" ? <TabsContent value="jobs" className="m-0"><JobsTable jobs={moduleJobs} states={states} loading={loading} /></TabsContent> : <TabsContent value={activeTab} className="m-0"><RequestTable title={activeTab === "tasks" ? "Tarefas sob sua responsabilidade" : activeTab === "errors" ? "Solicitacoes com erro ou canceladas" : activeTab === "finished" ? "Solicitacoes finalizadas" : `Solicitacoes de ${moduleLabels[moduleSlug].toLowerCase()}`} emptyText={loading || requestsLoading ? "Carregando dados persistidos..." : "Nenhum registro encontrado para os filtros informados."} rows={visibleRows} fieldSettings={fieldSettings} onSelect={(row) => void openRequestDetails(row)} /></TabsContent>}
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
                : "Sincronize dados, consulte solicitacoes e configure a credencial Fluig do usuario."}
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

      <RequestDetailSheet
        request={selectedRequest}
        details={selectedDetails}
        loading={detailsLoading}
        error={detailsError}
        moduleSlug={moduleSlug}
        fallbackFluigUrl={integration.openUrl}
        refreshing={requestRefreshing}
        selectedAttachmentSequence={selectedAttachmentSequence}
        onSelectedAttachmentSequenceChange={setSelectedAttachmentSequence}
        onRefresh={() => void refreshSelectedRequest()}
        onClose={() => {
          setSelectedRequest(null);
          setSelectedDetails(null);
          setDetailsError(null);
          setSelectedAttachmentSequence(null);
        }}
        fieldSettings={fieldSettings}
      />

      {fieldSettingsOpen ? (
        <FluigFieldSettingsSheet
          settings={fieldSettings}
          saving={fieldSettingsSaving}
          onOpenChange={setFieldSettingsOpen}
          onSave={saveFieldSettings}
        />
      ) : null}
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
        Execução em andamento
      </div>
      <div className="mt-3 grid gap-3">
        {jobs.map((job) => (
          <FluigJobProgressCard
            key={job.id}
            job={job}
            contextLabel={moduleLabels[job.module as OperationalModuleSlug] || job.module}
          />
        ))}
      </div>
    </section>
  );
}

function RequestTable({
  title,
  rows,
  emptyText,
  fieldSettings,
  onSelect,
}: {
  title: string;
  rows: FluigOpenRequestRecord[];
  emptyText: string;
  fieldSettings: FluigFieldSetting[];
  onSelect: (row: FluigOpenRequestRecord) => void;
}) {
  const columns = fieldSettings
    .filter((field) => field.active && field.visibleInList)
    .sort((left, right) => (left.listOrder ?? 9999) - (right.listOrder ?? 9999));
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
              {columns.map((field) => <TableHead key={field.fieldKey}>{field.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.module}-${row.fluigRequestId}-${row.id}`} className="cursor-pointer" onClick={() => onSelect(row)}>
                {columns.map((field) => <RequestFieldCell key={field.fieldKey} row={row} field={field} />)}
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

function requestFieldValue(row: FluigOpenRequestRecord, fieldKey: string) {
  const values: Record<string, string | number | null | undefined> = {
    fluigRequestId: row.fluigRequestId,
    admReference: row.admReference,
    status: row.normalizedStatus || row.status,
    currentTask: row.currentTask,
    taskOwner: row.taskOwner,
    requester: row.requester,
    branchCode: row.branchCode,
    branchLabel: row.branchLabel,
    supplierName: row.supplierName,
    supplierCnpj: row.supplierCnpj,
    invoiceNumber: row.invoiceNumber,
    invoiceDueDate: row.invoiceDueDate,
    amountCents: row.amountCents,
    dueDate: row.dueDate,
    expenseNature: row.expenseNature,
  };
  return values[fieldKey] ?? row.fieldValues?.[fieldKey] ?? null;
}

function requestFieldText(row: FluigOpenRequestRecord, field: FluigFieldSetting) {
  const value = requestFieldValue(row, field.fieldKey);
  if (field.fieldKey === "amountCents" || field.fieldKey === "valorNF" || field.fieldKey === "valorNFT") {
    return field.fieldKey === "amountCents"
      ? formatMoney(row.amountCents, row.currency || "BRL")
      : String(value || "-");
  }
  if (["dueDate", "invoiceDueDate", "vencPagNota", "dataEmissaoNF"].includes(field.fieldKey)) {
    return formatDate(String(value || ""));
  }
  return String(value ?? "").trim() || "-";
}

function RequestFieldCell({ row, field }: { row: FluigOpenRequestRecord; field: FluigFieldSetting }) {
  if (field.fieldKey === "status") {
    return <TableCell><StatusBadge status={normalizeStatus(row.normalizedStatus || row.status)} /></TableCell>;
  }
  if (field.fieldKey === "supplierName") {
    return <TableCell className="min-w-[240px] max-w-[360px] whitespace-normal"><p className="font-medium">{requestFieldText(row, field)}</p><p className="text-xs text-muted-foreground">{row.branchLabel || row.branchCode || row.supplierCnpj || "-"}</p></TableCell>;
  }
  if (field.fieldKey === "currentTask") {
    return <TableCell className="min-w-[220px] max-w-[340px] whitespace-normal"><p>{requestFieldText(row, field)}</p><p className="text-xs text-muted-foreground">{row.taskOwner || "Responsavel nao informado"}</p></TableCell>;
  }
  return <TableCell className="max-w-[320px] whitespace-normal">{requestFieldText(row, field)}</TableCell>;
}

function RequestDetailSheet({
  request,
  details,
  loading,
  error,
  moduleSlug,
  fallbackFluigUrl,
  refreshing,
  selectedAttachmentSequence,
  onSelectedAttachmentSequenceChange,
  onRefresh,
  onClose,
  fieldSettings,
}: {
  request: FluigOpenRequestRecord | null;
  details: FluigRequestDetails | null;
  loading: boolean;
  error: string | null;
  moduleSlug: OperationalModuleSlug;
  fallbackFluigUrl: string;
  refreshing: boolean;
  selectedAttachmentSequence: string | null;
  onSelectedAttachmentSequenceChange: (sequence: string | null) => void;
  onRefresh: () => void;
  onClose: () => void;
  fieldSettings: FluigFieldSetting[];
}) {
  if (!request) return null;
  const fluigUrl = requestFluigUrl(request, details, fallbackFluigUrl);
  const formFields = fieldSettings
    .filter((field) => field.active && field.visibleInForm && field.sourceType === "form")
    .sort((left, right) => (left.formOrder ?? 9999) - (right.formOrder ?? 9999))
    .map((field) => [field.fieldKey, details?.formFields?.[field.fieldKey] || "", field.label] as const)
    .filter(([, value]) => String(value || "").trim());
  const panelFields = fieldSettings
    .filter((field) => field.active && field.visibleInList && field.fieldKey !== "status")
    .sort((left, right) => (left.listOrder ?? 9999) - (right.listOrder ?? 9999));
  const selectedAttachment = details?.attachments.find((item) => item.sequence === selectedAttachmentSequence) || null;
  const attachmentUrl = selectedAttachment
    ? fluigAdmApi.requestAttachmentUrl({ module: moduleSlug, fluigRequestId: request.fluigRequestId, sequence: selectedAttachment.sequence })
    : null;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:max-w-none sm:data-[side=right]:w-[min(1180px,calc(100vw-2rem))] sm:data-[side=right]:max-w-none">
        <SheetHeader className="shrink-0 border-b pr-14">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SheetTitle>Solicitacao Fluig {request.fluigRequestId}</SheetTitle>
              <SheetDescription>{request.supplierName || request.requester || "Detalhes da solicitacao"}</SheetDescription>
            </div>
            <StatusBadge status={normalizeStatus(request.normalizedStatus || request.status)} />
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" size="sm" onClick={onRefresh} disabled={refreshing || loading}>
              {refreshing || loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
              Sincronizar esta solicitacao
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(request.fluigRequestId); toast.success("Numero Fluig copiado."); }}>
              <Copy className="size-4" />Copiar numero
            </Button>
            <Button type="button" size="sm" variant="outline" asChild>
              <a href={fluigUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />Abrir esta solicitacao no Fluig</a>
            </Button>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 p-4 sm:p-6">
          {loading ? <div className="mb-4 flex items-center gap-2 rounded-md border bg-background p-3 text-sm"><Loader2 className="size-4 animate-spin" />Carregando formulario, historico e anexos gravados...</div> : null}
          {error ? <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Os dados locais continuam disponiveis, mas a consulta detalhada ao Fluig falhou: {error}</div> : null}
          {details?.warnings?.length ? <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{details.warnings.join(" ")}</div> : null}

          <Tabs defaultValue="form" className="gap-4">
            <div className="overflow-x-auto rounded-md border bg-background">
              <TabsList className="h-auto w-max min-w-full justify-start rounded-none bg-transparent p-0">
                <TabsTrigger value="form" className="rounded-none px-4 py-3"><FileText className="size-4" />Formulario</TabsTrigger>
                <TabsTrigger value="info" className="rounded-none px-4 py-3"><Eye className="size-4" />Informacoes</TabsTrigger>
                <TabsTrigger value="history" className="rounded-none px-4 py-3"><History className="size-4" />Historico ({details?.history.length || 0})</TabsTrigger>
                <TabsTrigger value="attachments" className="rounded-none px-4 py-3"><Paperclip className="size-4" />Anexos ({details?.attachments.length || 0})</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="form" className="m-0 space-y-4">
              <section className="grid gap-3 rounded-md border bg-background p-4 sm:grid-cols-2 lg:grid-cols-4">
                {panelFields.map((field) => <RequestDetail key={field.fieldKey} label={field.label} value={requestFieldText(request, field)} />)}
              </section>
              <section className="rounded-md border bg-background p-4">
                <h3 className="mb-3 font-medium">Campos do formulario Fluig</h3>
                {formFields.length ? (
                  <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                    {formFields.map(([name, value, label]) => <RequestDetail key={name} label={label || fieldLabel(name)} value={value} />)}
                  </div>
                ) : <p className="text-sm text-muted-foreground">Aguardando a consulta do formulario no Fluig.</p>}
              </section>
            </TabsContent>

            <TabsContent value="info" className="m-0">
              <section className="grid gap-4 rounded-md border bg-background p-4 sm:grid-cols-2 lg:grid-cols-3">
                <RequestDetail label="Numero Fluig" value={request.fluigRequestId} />
                <RequestDetail label="Referencia ADM" value={request.admReference || "-"} />
                <RequestDetail label="Modulo" value={moduleLabels[moduleSlug]} />
                <RequestDetail label="Etapa atual" value={request.currentTask || "-"} />
                <RequestDetail label="Responsavel" value={request.taskOwner || "-"} />
                <RequestDetail label="Solicitante" value={request.requester || "-"} />
                <RequestDetail label="Fornecedor" value={request.supplierName || "-"} />
                <RequestDetail label="CNPJ" value={request.supplierCnpj || "-"} />
                <RequestDetail label="Filial" value={request.branchLabel || request.branchCode || "-"} />
                <RequestDetail label="Aberta em" value={formatDateTime(request.openedAt)} />
                <RequestDetail label="Ultima sincronizacao" value={formatDateTime(request.lastStatusCheckAt || request.lastSyncedAt)} />
                <RequestDetail label="Detalhes sincronizados em" value={formatDateTime(details?.fetchedAt)} />
              </section>
            </TabsContent>

            <TabsContent value="history" className="m-0">
              <section className="rounded-md border bg-background p-4">
                {details?.history.length ? (
                  <div className="space-y-0">
                    {details.history.map((entry, index) => (
                      <div key={`${entry.sequence}-${index}`} className="relative border-l-2 border-muted pb-6 pl-6 last:pb-0">
                        <span className="absolute -left-[7px] top-1 size-3 rounded-full border-2 border-background bg-primary" />
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{entry.user}</p>
                            <p className="text-sm">{entry.activity || entry.detail || "Movimentacao registrada"}{entry.destination ? ` para ${entry.destination}` : ""}</p>
                          </div>
                          <span className="text-xs text-muted-foreground">{formatDateTime(entry.date) === "-" ? entry.date || "Data nao informada" : formatDateTime(entry.date)}</span>
                        </div>
                        {entry.detail && entry.detail !== entry.activity ? <p className="mt-2 text-sm text-muted-foreground">{entry.detail}</p> : null}
                        {entry.observation ? <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">{entry.observation}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">Nenhum item de historico retornado pelo Fluig.</p>}
              </section>
            </TabsContent>

            <TabsContent value="attachments" className="m-0 space-y-4">
              {details?.attachments.length ? (
                <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                  <div className="space-y-2">
                    {details.attachments.map((attachment) => (
                      <button
                        type="button"
                        key={attachment.sequence}
                        onClick={() => onSelectedAttachmentSequenceChange(attachment.sequence)}
                        className={cn("w-full rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted/50", selectedAttachmentSequence === attachment.sequence ? "border-primary bg-primary/5" : "")}
                      >
                        <span className="flex items-start gap-3"><Paperclip className="mt-0.5 size-4 shrink-0" /><span className="min-w-0"><span className="block break-words text-sm font-medium">{attachment.name}</span><span className="mt-1 block text-xs text-muted-foreground">{formatFileSize(attachment.size)}{attachment.attachedBy ? ` - ${attachment.attachedBy}` : ""}</span></span></span>
                      </button>
                    ))}
                  </div>
                  <div className="min-h-[520px] overflow-hidden rounded-md border bg-background">
                    {attachmentUrl && selectedAttachment ? (
                      <iframe src={attachmentUrl} title={`Anexo ${selectedAttachment.name}`} className="h-[70vh] min-h-[520px] w-full bg-white" />
                    ) : <div className="flex min-h-[520px] items-center justify-center p-8 text-center text-sm text-muted-foreground">Selecione um anexo para visualizar nesta tela.</div>}
                  </div>
                </div>
              ) : <div className="rounded-md border bg-background p-8 text-center text-sm text-muted-foreground">Nenhum anexo retornado pelo Fluig.</div>}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FluigFieldSettingsSheet({
  settings,
  saving,
  onOpenChange,
  onSave,
}: {
  settings: FluigFieldSetting[];
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (settings: FluigFieldSetting[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<FluigFieldSetting[]>(settings);
  const [fieldSearch, setFieldSearch] = useState("");
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null);

  function normalizeDisplayOrders(fields: FluigFieldSetting[]) {
    let listPosition = 0;
    let formPosition = 0;
    return fields.map((field) => ({
      ...field,
      listOrder: field.active && field.visibleInList ? ++listPosition * 10 : null,
      formOrder: field.active && field.visibleInForm ? ++formPosition * 10 : null,
    }));
  }

  function updateField(id: string, changes: Partial<FluigFieldSetting>) {
    setDraft((current) => normalizeDisplayOrders(current.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...changes };
      if (changes.active === false) {
        next.visibleInList = false;
        next.visibleInForm = false;
      }
      if ((changes.visibleInList === true || changes.visibleInForm === true) && !next.active) next.active = true;
      return next;
    })));
  }

  function moveField(fieldId: string, targetFieldId: string) {
    if (fieldId === targetFieldId) return;
    setDraft((current) => {
      const fromIndex = current.findIndex((field) => field.id === fieldId);
      const targetIndex = current.findIndex((field) => field.id === targetFieldId);
      if (fromIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(targetIndex, 0, moved);
      return normalizeDisplayOrders(next);
    });
  }

  function moveFieldByOffset(fieldId: string, offset: -1 | 1) {
    setDraft((current) => {
      const index = current.findIndex((field) => field.id === fieldId);
      const targetIndex = index + offset;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return normalizeDisplayOrders(next);
    });
  }

  function addFormField() {
    setDraft((current) => normalizeDisplayOrders([...current, {
      id: `new:${crypto.randomUUID()}`,
      module: current[0]?.module || "pagamentos",
      fieldKey: "",
      label: "",
      sourceType: "form",
      active: true,
      visibleInList: false,
      listOrder: null,
      visibleInForm: true,
      formOrder: null,
    }]));
  }

  const normalizedSearch = fieldSearch.trim().toLocaleLowerCase("pt-BR");
  const formFieldDraft = draft.filter((field) => field.sourceType === "form");
  const visibleFields = normalizedSearch
    ? formFieldDraft.filter((field) =>
        [field.label, field.fieldKey, field.sampleValue || ""].some((value) =>
          value.toLocaleLowerCase("pt-BR").includes(normalizedSearch),
        ),
      )
    : formFieldDraft;
  const discoveredCount = formFieldDraft.filter((field) => field.discovered).length;
  const selectedCount = formFieldDraft.filter((field) => field.active && (field.visibleInList || field.visibleInForm)).length;

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:max-w-none sm:data-[side=right]:w-[min(980px,calc(100vw-2rem))] sm:data-[side=right]:max-w-none">
        <SheetHeader className="shrink-0 border-b pr-14">
          <SheetTitle>Campos preenchidos no formulário</SheetTitle>
          <SheetDescription>Somente os campos utilizados na solicitação aparecem aqui. O nome exibido e um exemplo ajudam a identificar cada campo antes de ativá-lo.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium">{formFieldDraft.length} campos preenchidos disponíveis</p>
              <p className="text-xs text-muted-foreground">{discoveredCount} encontrados automaticamente no formulário; {selectedCount} selecionados para exibição.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-72"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="Buscar nome, campo ou exemplo" /></div>
              <Button type="button" variant="outline" onClick={addFormField}><Plus className="size-4" />Adicionar campo</Button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead className="w-14"><span className="sr-only">Ordenar</span></TableHead><TableHead className="min-w-[420px]">Nome exibido e identificação</TableHead><TableHead className="w-24 text-center">Ativo</TableHead><TableHead className="w-24 text-center">Na lista</TableHead><TableHead className="w-32 text-center">No formulário</TableHead></TableRow></TableHeader>
              <TableBody>
                {visibleFields.map((field) => (
                  <TableRow
                    key={field.id}
                    className={cn("transition-colors", draggedFieldId === field.id && "bg-primary/5 opacity-60")}
                    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceId = event.dataTransfer.getData("text/plain") || draggedFieldId;
                      if (sourceId) moveField(sourceId, field.id);
                      setDraggedFieldId(null);
                    }}
                  >
                    <TableCell className="align-middle">
                      <button
                        type="button"
                        draggable
                        className="mx-auto flex size-9 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                        aria-label={`Arrastar ${field.label} para ordenar`}
                        title="Arraste para ordenar. Use as setas do teclado para mover."
                        onDragStart={(event) => {
                          setDraggedFieldId(field.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", field.id);
                        }}
                        onDragEnd={() => setDraggedFieldId(null)}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowUp") { event.preventDefault(); moveFieldByOffset(field.id, -1); }
                          if (event.key === "ArrowDown") { event.preventDefault(); moveFieldByOffset(field.id, 1); }
                        }}
                      >
                        <GripVertical className="size-5" />
                      </button>
                    </TableCell>
                    <TableCell className="min-w-[360px] whitespace-normal py-3">
                      <p className="mb-1 text-xs font-medium text-foreground">Nome que aparecerá no painel</p>
                      <Input value={field.label} onChange={(event) => updateField(field.id, { label: event.target.value })} placeholder="Digite o nome exibido" />
                      {field.id.startsWith("new:") ? (
                        <Input className="mt-2 font-mono text-xs" value={field.fieldKey} onChange={(event) => updateField(field.id, { fieldKey: event.target.value.trim() })} placeholder="nomeDoCampoNoFluig" />
                      ) : (
                        <p className="mt-2 break-all text-xs text-muted-foreground">
                          Campo no Fluig: <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{field.fieldKey}</code>
                        </p>
                      )}
                      <div className="mt-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs">
                        <span className="font-medium text-foreground">Exemplo preenchido: </span>
                        <span className="break-words text-muted-foreground">{field.sampleValue || "Ainda não há exemplo sincronizado para este campo."}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">Formulário Fluig</Badge>
                        {field.discovered ? <Badge variant="secondary">Detectado automaticamente</Badge> : null}
                        {field.occurrenceCount ? <span>Preenchido em {field.occurrenceCount.toLocaleString("pt-BR")} solicitação(ões)</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-center"><Checkbox checked={field.active} onCheckedChange={(checked) => updateField(field.id, { active: checked === true })} aria-label={`Ativar ${field.label}`} /></TableCell>
                    <TableCell className="text-center"><Checkbox checked={field.visibleInList} onCheckedChange={(checked) => updateField(field.id, { visibleInList: checked === true })} aria-label={`Mostrar ${field.label} na lista`} /></TableCell>
                    <TableCell className="text-center"><Checkbox checked={field.visibleInForm} disabled={field.sourceType !== "form"} onCheckedChange={(checked) => updateField(field.id, { visibleInForm: checked === true })} aria-label={`Mostrar ${field.label} no formulario`} /></TableCell>
                  </TableRow>
                ))}
                {!visibleFields.length ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">Nenhum campo encontrado para esta busca.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Os campos internos do Fluig ficam ocultos desta configuração. Histórico e metadados dos anexos continuam sincronizados nas abas detalhadas.</p>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t p-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={() => void onSave(draft)} disabled={saving || !draft.some((field) => field.active && field.visibleInList)}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Settings2 className="size-4" />}Salvar configuracao</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function JobsTable({ jobs, states, loading }: { jobs: FluigAdmJobSummary[]; states: FluigUserSyncStateRecord[]; loading: boolean }) {
  if (loading && !jobs.length) return <EmptyTableText>Carregando jobs e sincronizacoes...</EmptyTableText>;
  if (!jobs.length && !states.length) return <EmptyTableText>Nenhum job ou sincronizacao registrado.</EmptyTableText>;
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Inicio</TableHead><TableHead>Operacao</TableHead><TableHead>Andamento</TableHead><TableHead>Tentativas</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{jobs.map((job) => <TableRow key={job.id}><TableCell className="whitespace-nowrap">{formatDateTime(job.createdAt)}</TableCell><TableCell><p className="font-medium">{job.operation.replaceAll("_", " ")}</p><p className="text-xs text-muted-foreground">{job.id.slice(0, 8)}</p></TableCell><TableCell className="min-w-72 whitespace-normal">{job.errorMessage || job.progressLabel || job.progressStage || "Aguardando executor da VPS"}</TableCell><TableCell>{job.attempts}/{job.maxAttempts}</TableCell><TableCell><StatusBadge status={normalizeJobStatus(job.status)} /></TableCell></TableRow>)}</TableBody></Table>{states.length ? <div className="border-t p-3"><h3 className="mb-2 text-sm font-medium">Cursores de sincronizacao</h3><div className="grid gap-2 md:grid-cols-2">{states.map((state) => <div key={state.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs"><div><p className="font-medium">{syncTypeLabels[state.syncType]}</p><p className="text-muted-foreground">{formatDateTime(state.lastSuccessAt || state.lastErrorAt || state.updatedAt)}</p></div><Badge variant="outline">{state.status}</Badge></div>)}</div></div> : null}</div>;
}

function RequestDetail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{value}</p></div>;
}

function EmptyTableText({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center text-sm text-muted-foreground">{children}</div>;
}
