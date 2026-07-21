"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DatabaseZap,
  ExternalLink,
  FileText,
  Laptop,
  RefreshCcw,
  Search,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { FluigLaunchForm } from "@/components/shared/fluig-launch-form";
import { StatusBadge } from "@/components/shared/status-badge";
import { fluigAdmApi, type FluigAdmAgent, type FluigAdmSyncAction } from "@/lib/fluig-api";
import {
  fluigCatalogLabels,
  getFluigFieldLabel,
  getFluigIntegrationForModule,
  type FluigAdmSyncResponse,
  type FluigCatalogItem,
  type FluigCatalogType,
  type FluigModuleSlug,
  type FluigSyncRow,
} from "@/lib/fluig-data";
import { cn } from "@/lib/utils";
import { useFluigJobState } from "@/lib/use-fluig-job-state";

type FluigIntegrationPanelProps = {
  moduleSlug: string;
  compact?: boolean;
  agents?: FluigAdmAgent[];
  onAgentsChange?: (agents: FluigAdmAgent[]) => void;
  recoverJobs?: boolean;
  workspaceView?: "all" | "launch" | "tools";
};

const catalogOrder: FluigCatalogType[] = ["supplier", "branch", "natureza", "cost_center", "payment_method", "account"];

function normalizeCatalogValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\D+/g, "")
    .trim();
}

function catalogMetadataText(item: FluigCatalogItem, key: string) {
  const value = item.metadata?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function catalogDedupeKey(item: FluigCatalogItem) {
  const cnpj = normalizeCatalogValue(catalogMetadataText(item, "cnpj"));
  const code = normalizeCatalogValue(item.code || "");
  const label = (item.label || item.value || "").trim().toLowerCase();
  return `${item.catalogType}:${cnpj || code || label}`;
}

function dedupeCatalogItems(items: FluigCatalogItem[]) {
  const byKey = new Map<string, FluigCatalogItem>();

  for (const item of items) {
    const key = catalogDedupeKey(item);
    const current = byKey.get(key);
    if (!current || item.occurrenceCount > current.occurrenceCount || item.lastSeenAt > current.lastSeenAt) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.label.localeCompare(b.label));
}

function normalizeFluigRequestNumber(value: string) {
  return value.replace(/\D+/g, "").trim();
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
  if (seconds == null) return "sem heartbeat";
  if (seconds < 60) return "agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min atras`;
  return `${Math.floor(minutes / 60)} h atras`;
}

export function FluigIntegrationPanel({
  moduleSlug,
  compact = false,
  agents: externalAgents,
  onAgentsChange,
  recoverJobs = true,
  workspaceView = "all",
}: FluigIntegrationPanelProps) {
  const integration = getFluigIntegrationForModule(moduleSlug);
  const [syncData, setSyncData] = useState<FluigAdmSyncResponse | null>(null);
  const [pendingAction, setPendingAction] = useState<FluigAdmSyncAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localAgents, setLocalAgents] = useState<FluigAdmAgent[]>([]);
  const [pendingUserSync, setPendingUserSync] = useState(false);
  const [historicalPending, setHistoricalPending] = useState(false);
  const [testingAgent, setTestingAgent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lookupRequestId, setLookupRequestId] = useState("");
  const [lookupPersist, setLookupPersist] = useState(true);
  const [lookupPending, setLookupPending] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<FluigSyncRow | null>(null);
  const agents = externalAgents ?? localAgents;
  const updateAgents = useCallback((nextAgents: FluigAdmAgent[]) => {
    setLocalAgents(nextAgents);
    onAgentsChange?.(nextAgents);
  }, [onAgentsChange]);

  const rows = useMemo(() => syncData?.rows ?? [], [syncData?.rows]);
  const examples = useMemo(() => syncData?.examples ?? [], [syncData?.examples]);
  const supplierMatches = useMemo(() => syncData?.supplierMatches ?? [], [syncData?.supplierMatches]);
  const catalogs = useMemo(() => {
    const next: Partial<Record<FluigCatalogType, FluigCatalogItem[]>> = {};

    for (const catalogType of catalogOrder) {
      next[catalogType] = dedupeCatalogItems(syncData?.catalogs?.[catalogType] || []);
    }

    return next;
  }, [syncData?.catalogs]);
  const displaySyncData = useMemo(
    () => (syncData ? { ...syncData, catalogs } : null),
    [catalogs, syncData]
  );
  const integrationSlug = integration?.slug;
  const matchesJob = useCallback(
    (job: { module: FluigModuleSlug }) => Boolean(integrationSlug && job.module === integrationSlug),
    [integrationSlug]
  );
  const jobTracker = useFluigJobState({ matches: matchesJob, recover: recoverJobs });
  const activeJob = jobTracker.job ? { ...jobTracker.job, events: jobTracker.events } : null;
  const onlineAgent = useMemo(() => agents.find((agent) => agent.status === "online") || null, [agents]);

  async function runSync(action: FluigAdmSyncAction) {
    if (!integration) {
      return;
    }
    if (!onlineAgent) {
      setError("Cadastre o usuario e a senha Fluig deste usuario antes de executar a consulta na VPS.");
      return;
    }

    setPendingAction(action);
    setError(null);
    setNotice(null);

    try {
      const data = await fluigAdmApi.sync({ module: integration.slug as FluigModuleSlug, action });
      setSyncData(data);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Falha ao sincronizar Fluig");
    } finally {
      setPendingAction(null);
    }
  }

  async function runHistoricalSync() {
    if (!integration || !onlineAgent) {
      setError("Cadastre o usuario e a senha Fluig antes de reconstruir o historico na VPS.");
      return;
    }
    const confirmed = window.confirm(
      "Esta operacao administrativa consulta ate 730 dias do Fluig e pode demorar. Deseja reconstruir o historico deste modulo?"
    );
    if (!confirmed) return;

    setHistoricalPending(true);
    setError(null);
    setNotice(null);
    try {
      const created = await fluigAdmApi.syncHistorical({
        module: integration.slug,
        action: "sync",
        days: 730,
        pageSize: 100,
        maxPages: 100,
      });
      for (const job of created.jobs) await pollJobUntilDone(job.id);
      const refreshed = await fluigAdmApi.sync({ module: integration.slug as FluigModuleSlug, action: "sync" });
      setSyncData(refreshed);
      setNotice("Historico Fluig reconstruido com os dados disponiveis.");
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Falha ao reconstruir historico Fluig");
    } finally {
      setHistoricalPending(false);
    }
  }

  async function runUserIncrementalSync() {
    if (!integration) {
      return;
    }
    if (!onlineAgent) {
      setError("Cadastre o usuario e a senha Fluig deste usuario antes de sincronizar.");
      return;
    }

    setPendingUserSync(true);
    setError(null);
    setNotice(null);

    try {
      const data = await fluigAdmApi.syncUser({
        module: integration.slug === "fornecedores" ? "all" : integration.slug,
        limit: 80,
      });

      for (const job of data.jobs) {
        await pollJobUntilDone(job.id);
      }

      if (!data.jobs.length && data.skipped.length) {
        setNotice("Nao havia solicitacoes abertas conhecidas para atualizar neste momento.");
      } else {
        setNotice("Sincronizacao incremental concluida.");
      }

      const refreshed = await fluigAdmApi.sync({ module: integration.slug as FluigModuleSlug, action: "sync" });
      setSyncData(refreshed);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Falha ao sincronizar pendencias Fluig");
    } finally {
      setPendingUserSync(false);
    }
  }

  async function runRequestLookup() {
    if (!integration) {
      return;
    }
    if (!onlineAgent) {
      setLookupError("Cadastre o usuario e a senha Fluig deste usuario antes de consultar.");
      return;
    }

    const fluigRequestId = lookupRequestId.trim();
    if (!fluigRequestId) {
      setLookupError("Informe o numero da solicitacao Fluig.");
      return;
    }

    setLookupPending(true);
    setLookupError(null);
    setLookupResult(null);
    setError(null);
    setNotice(null);

    try {
      const created = await fluigAdmApi.lookupRequest({
        module: integration.slug,
        fluigRequestId,
        persist: lookupPersist,
      });

      await pollJobUntilDone(created.job.id);

      const refreshed = await fluigAdmApi.sync({ module: integration.slug as FluigModuleSlug, action: "sync" });
      setSyncData(refreshed);

      const requestedNumber = normalizeFluigRequestNumber(fluigRequestId);
      const matchedRow =
        refreshed.rows.find((row) => normalizeFluigRequestNumber(row.fluigNumber) === requestedNumber) || null;

      setLookupResult(matchedRow);
      setNotice(
        matchedRow
          ? "Consulta por numero Fluig atualizada."
          : "Consulta executada. O retorno sera exibido na tabela quando o Fluig enviar dados persistidos para este modulo."
      );
    } catch (lookupErrorValue) {
      setLookupError(lookupErrorValue instanceof Error ? lookupErrorValue.message : "Falha ao consultar numero Fluig");
    } finally {
      setLookupPending(false);
    }
  }

  async function pollJobUntilDone(jobId: string) {
    return jobTracker.wait(jobId);
  }

  async function testAgentConnection() {
    if (!integration) {
      return;
    }
    if (!onlineAgent) {
      setError("Credenciais Fluig nao cadastradas para este usuario.");
      return;
    }

    setTestingAgent(true);
    setError(null);
    setNotice(null);

    try {
      const created = await fluigAdmApi.testAgentConnection({ module: integration.slug });
      await pollJobUntilDone(created.job.id);
      setNotice("Conexao autenticada com o Fluig validada diretamente pela VPS.");
      const nextAgents = await fluigAdmApi.listAgents();
      updateAgents(nextAgents);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Falha ao testar a conexao Fluig na VPS.");
    } finally {
      setTestingAgent(false);
    }
  }

  useEffect(() => {
    if (!integrationSlug) {
      return;
    }

    let active = true;
    void fluigAdmApi
      .sync({ module: integrationSlug as FluigModuleSlug, action: "sync" })
      .then((data) => {
        if (active) setSyncData(data);
      })
      .catch((syncError) => {
        if (active) setError(syncError instanceof Error ? syncError.message : "Falha ao sincronizar Fluig");
      });

    if (!externalAgents) {
      void fluigAdmApi
        .listAgents()
        .then((data) => {
          if (active) updateAgents(data);
        })
        .catch(() => {
          if (active) updateAgents([]);
        });
    }

    return () => {
      active = false;
    };
  }, [externalAgents, integrationSlug, moduleSlug, updateAgents]);

  if (!integration) {
    return null;
  }

  const visibleRows = compact ? rows.slice(0, 2) : rows;
  const visibleExamples = compact ? examples.slice(0, 1) : examples;
  const visibleCatalogs = catalogOrder
    .map((catalogType) => ({ catalogType, items: catalogs[catalogType] || [] }))
    .filter((group) => group.items.length > 0)
    .slice(0, compact ? 3 : 6);
  const catalogItemCount = catalogOrder.reduce((sum, catalogType) => sum + (catalogs[catalogType]?.length || 0), 0);
  const launchTemplateCount = syncData?.launchTemplates?.filter((template) => template.module === integration.slug).length || 0;
  const monthlyTemplateCount =
    syncData?.launchTemplates?.filter((template) => template.module === integration.slug && template.recurrence === "monthly")
      .length || 0;
  const fluigBusy = Boolean(pendingAction) || pendingUserSync || historicalPending || lookupPending || testingAgent || jobTracker.active;

  if (workspaceView === "launch") {
    return (
      <div className="stitch-animate-in min-w-0 space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border bg-background p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <Laptop className="size-4" />
              Executor da VPS
              <StatusBadge status={onlineAgent ? "PRONTO" : "SEM_CREDENCIAL"} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {onlineAgent
                ? `${onlineAgent.display_name} pronto para validar e enviar a solicitacao.`
                : "Cadastre usuario e senha Fluig na Gestao de usuarios para consultar modelos e enviar ao Fluig."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="stitch-soft-button"
              onClick={() => runSync("examples")}
              disabled={fluigBusy || !onlineAgent}
            >
              <RefreshCcw className={cn("size-4", pendingAction === "examples" ? "animate-spin" : "")} />
              Atualizar listas e modelos
            </Button>
            <Button type="button" variant="outline" className="stitch-soft-button" asChild>
              <a href={integration.openUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Abrir no Fluig
              </a>
            </Button>
          </div>
        </div>

        {activeJob ? (
          <div className="rounded-lg border bg-background p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              Execucao Fluig
              <StatusBadge status={activeJob.status.toUpperCase()} />
              <span className="font-mono text-muted-foreground">{activeJob.id.slice(0, 8)}</span>
            </div>
            <p className="mt-1 text-muted-foreground">{activeJob.progressLabel || "Aguardando o executor da VPS assumir a tarefa."}</p>
          </div>
        ) : null}
        {notice ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">{notice}</p> : null}
        {error ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-900">{error}</p> : null}

        <FluigLaunchForm
          moduleSlug={integration.slug}
          integration={integration}
          syncData={displaySyncData}
          onSynced={setSyncData}
          focused
        />
      </div>
    );
  }

  return (
    <Card className="stitch-animate-in stitch-hover-lift min-w-0 rounded-lg shadow-none">
      <CardHeader className="min-w-0 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border bg-muted/50 px-2 py-1 text-xs font-medium text-muted-foreground">
                Fluig nesta pagina
              </span>
              <StatusBadge status={integration.status} />
            </div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Workflow className="size-4" />
              {integration.title}
            </CardTitle>
            <p className="max-w-3xl text-sm text-muted-foreground">{integration.intent}</p>
          </div>
          {!compact ? (
            <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground lg:w-72">
              <span className="font-medium text-foreground">Fluxo operacional</span>
              <span>{integration.processLabel}</span>
              <span>Execucao direta pelo runner interno da VPS.</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="stitch-soft-button"
            onClick={() => runUserIncrementalSync()}
            disabled={fluigBusy || !onlineAgent}
          >
            <RefreshCcw className={cn("size-4", pendingUserSync ? "animate-spin" : "")} />
            {integration.syncAction}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="stitch-soft-button"
            onClick={() => runSync("examples")}
            disabled={fluigBusy || !onlineAgent}
          >
            <FileText className="size-4" />
            Consultar modelos reais
          </Button>
          <Button type="button" variant="outline" className="stitch-soft-button" asChild>
            <a href={integration.openUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
              Abrir formulario Fluig
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="stitch-soft-button"
            onClick={testAgentConnection}
            disabled={fluigBusy || !onlineAgent}
          >
            {testingAgent ? <RefreshCcw className="size-4 animate-spin" /> : <Laptop className="size-4" />}
            Testar conexao VPS
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="rounded-md border bg-muted/20 p-3 text-xs">
            <div className="flex items-center gap-2 font-medium">
              <Laptop className="size-4" />
              Executor da VPS
              <StatusBadge status={onlineAgent ? "PRONTO" : "SEM_CREDENCIAL"} />
            </div>
            <p className="mt-2 text-muted-foreground">
              {onlineAgent
                ? `${onlineAgent.display_name} ativo${onlineAgent.machine_name ? ` em ${onlineAgent.machine_name}` : ""}.`
                : "Credenciais Fluig nao cadastradas para este usuario."}
            </p>
            {onlineAgent ? (
              <div className="mt-2 grid gap-1 text-muted-foreground md:grid-cols-2">
                <span>Disponivel: {formatDateTime(onlineAgent.last_heartbeat_at)}</span>
                <span>Versao: {onlineAgent.agent_version || "-"}</span>
                <span>Estado: {describeHeartbeatAge(onlineAgent.heartbeat_age_seconds)}</span>
                <span>Integracao interna do Coolify</span>
              </div>
            ) : null}
          </div>
          {activeJob ? (
            <div className="rounded-md border bg-muted/20 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                Execucao Fluig
                <StatusBadge status={activeJob.status.toUpperCase()} />
                <span className="font-mono text-muted-foreground">{activeJob.id.slice(0, 8)}</span>
              </div>
              <p className="mt-2 text-muted-foreground">{activeJob.progressLabel || "Aguardando o executor da VPS assumir a tarefa."}</p>
              {activeJob.events.length ? (
                <div className="mt-2 max-h-24 space-y-1 overflow-auto">
                  {activeJob.events.slice(-4).map((event) => (
                    <div key={event.id} className="flex justify-between gap-3 rounded bg-background px-2 py-1">
                      <span className="truncate">{event.label || event.stage || event.event_type}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {new Date(event.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              As proximas consultas e lancamentos serao executados diretamente pela VPS com a credencial deste usuario.
            </div>
          )}
        </div>
        {!compact ? (
          <form
            className="grid gap-3 rounded-md border bg-muted/20 p-3 text-xs lg:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void runRequestLookup();
            }}
          >
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <Search className="size-4" />
                Consultar solicitacao por numero
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,0.9fr)_minmax(220px,0.45fr)]">
                <Input
                  value={lookupRequestId}
                  onChange={(event) => setLookupRequestId(event.target.value)}
                  inputMode="numeric"
                  placeholder="Ex.: 1163476"
                  disabled={fluigBusy || !onlineAgent}
                  aria-label="Numero da solicitacao Fluig"
                />
                <Label className="h-8 rounded-md border bg-background px-3 text-xs text-muted-foreground">
                  <Checkbox
                    checked={lookupPersist}
                    onCheckedChange={(checked) => setLookupPersist(checked === true)}
                    disabled={fluigBusy || !onlineAgent}
                  />
                  Salvar no ADM
                </Label>
              </div>
              {lookupResult ? (
                <div className="grid gap-2 rounded-md border bg-background p-3 md:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">Fluig</p>
                    <p className="font-semibold">{lookupResult.fluigNumber}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Etapa</p>
                    <p className="font-semibold">{lookupResult.currentTask || "-"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Responsavel</p>
                    <p className="font-semibold">{lookupResult.taskOwner || "-"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <StatusBadge status={lookupResult.fluigStatus} />
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-muted-foreground">Fornecedor</p>
                    <p className="font-semibold">{lookupResult.supplier || "-"}</p>
                    <p className="text-muted-foreground">{lookupResult.cnpj || "-"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Filial</p>
                    <p className="font-semibold">{lookupResult.branch || "-"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Referencia ADM</p>
                    <p className="font-semibold">{lookupResult.admReference || "-"}</p>
                  </div>
                </div>
              ) : null}
              {lookupError ? <p className="font-medium text-destructive">{lookupError}</p> : null}
            </div>
            <Button type="submit" className="stitch-soft-button self-start" disabled={fluigBusy || !onlineAgent}>
              <Search className={cn("size-4", lookupPending ? "animate-pulse" : "")} />
              {lookupPending ? "Consultando" : "Consultar numero"}
            </Button>
          </form>
        ) : null}
        {syncData ? (
          <p className="text-xs text-muted-foreground">
            Ultima sincronizacao: {new Date(syncData.generatedAt).toLocaleString("pt-BR")} - Fonte:{" "}
            {syncData.persistence?.configured ? "Supabase / Fluig real" : "banco ainda sem service role local"}
          </p>
        ) : null}
        {syncData?.persistence?.errors.length ? (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
            {syncData.persistence.errors.join(" | ")}
          </p>
        ) : null}
        {notice ? <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{notice}</p> : null}
        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <InfoTile icon={DatabaseZap} label="Processo" value={integration.processLabel} />
          <InfoTile icon={FileText} label="Modelos de lancamento" value={String(launchTemplateCount)} />
          <InfoTile icon={FileText} label="Contas mensais" value={String(monthlyTemplateCount)} />
          <InfoTile icon={FileText} label="Listas Fluig" value={String(catalogItemCount)} />
          <InfoTile icon={Workflow} label="Registros sincronizados" value={String(rows.length)} />
        </div>

        {workspaceView !== "tools" ? (
          <FluigLaunchForm
            moduleSlug={integration.slug}
            integration={integration}
            syncData={displaySyncData}
            onSynced={setSyncData}
          />
        ) : null}

        <div className={cn("grid gap-4", compact ? "" : "xl:grid-cols-[1.15fr_0.85fr]")}>
          <section className="rounded-md border bg-muted/20">
            <header className="flex items-center justify-between gap-3 border-b p-3">
              <div>
                <h3 className="text-sm font-semibold">Dados trazidos do Fluig</h3>
                <p className="text-xs text-muted-foreground">Numero, etapa, responsavel e acao esperada no ADM.</p>
              </div>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">ADM</th>
                    <th className="p-3 text-left">Fluig</th>
                    <th className="p-3 text-left">Filial</th>
                    <th className="p-3 text-left">Fornecedor</th>
                    <th className="p-3 text-left">Etapa</th>
                    <th className="p-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingAction === "sync" && !syncData ? (
                    <tr className="border-t">
                      <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                        Consultando Supabase...
                      </td>
                    </tr>
                  ) : visibleRows.length > 0 ? (
                    visibleRows.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="p-3 font-medium">{row.admReference}</td>
                        <td className="p-3 text-muted-foreground">{row.fluigNumber}</td>
                        <td className="p-3">
                          <div className="font-medium">{row.branch || "-"}</div>
                          {row.branchCode ? <div className="text-xs text-muted-foreground">{row.branchCode}</div> : null}
                        </td>
                        <td className="p-3">
                          <div className="font-medium">{row.supplier}</div>
                          <div className="text-xs text-muted-foreground">{row.cnpj}</div>
                        </td>
                        <td className="p-3">
                          <div>{row.currentTask}</div>
                          <div className="text-xs text-muted-foreground">{row.taskOwner}</div>
                        </td>
                        <td className="p-3">
                          <StatusBadge status={row.fluigStatus} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-t">
                      <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                        Nenhum dado real sincronizado para este modulo.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-md border bg-muted/20 p-3">
            <h3 className="text-sm font-semibold">Modelos ja abertos</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Base para preenchimento automatico sem importar o fluxo antigo de lancamentos.
            </p>
            <div className="mt-3 space-y-3">
              {visibleExamples.length > 0 ? (
                visibleExamples.map((example) => (
                  <div key={example.id} className="rounded-md border bg-background p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{example.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{example.id}</p>
                      </div>
                      <StatusBadge status={example.status} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{example.notes}</p>
                    <div className="mt-3 grid gap-2 text-xs">
                      {Object.entries(example.payloadPreview).map(([key, value]) => (
                        <div key={key} className="flex min-w-0 items-center justify-between gap-3 rounded bg-muted/40 px-2 py-1">
                          <span className="text-muted-foreground">
                            {getFluigFieldLabel({ fluigField: key, admField: key })}
                          </span>
                          <span className="truncate font-medium">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed bg-background p-3 text-xs text-muted-foreground">
                  Sincronize o historico Fluig para criar modelos reais de preenchimento.
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-md border bg-muted/20">
          <header className="border-b p-3">
            <h3 className="text-sm font-semibold">Listas para preenchimento</h3>
            <p className="text-xs text-muted-foreground">
              Opcoes reais do historico Fluig para preencher os lancamentos desta pagina.
            </p>
          </header>
          <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleCatalogs.length > 0 ? (
              visibleCatalogs.map((group) => (
                <div key={group.catalogType} className="rounded-md border bg-background p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{fluigCatalogLabels[group.catalogType]}</p>
                    <span className="rounded border bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                      {group.items.length} opcoes
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {group.items.slice(0, 4).map((item) => (
                      <div key={item.id} className="rounded bg-muted/40 px-2 py-1 text-xs">
                        <div className="truncate font-medium">{item.label}</div>
                        <div className="truncate text-muted-foreground">
                          {item.code ? `${item.code} - ` : ""}
                          Modelo {item.sourceRequestId || "historico"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed bg-background p-3 text-xs text-muted-foreground md:col-span-2 xl:col-span-3">
                Sincronize o historico Fluig para preencher fornecedores, filiais, naturezas e centros de custo.
              </div>
            )}
          </div>
        </section>

        {supplierMatches.length > 0 ? (
          <>
            <Separator />
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Fornecedores do historico Fluig</h3>
              <div className="grid gap-2 md:grid-cols-3">
                {supplierMatches.slice(0, compact ? 2 : 3).map((match) => (
                  <div key={`${match.supplier}-${match.cnpj}`} className="rounded-md border bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{match.supplier}</p>
                        <p className="text-xs text-muted-foreground">{match.cnpj}</p>
                      </div>
                      <StatusBadge status={match.status} />
                    </div>
                    <p className="mt-2 truncate text-xs text-muted-foreground">{match.fluigName}</p>
                    <p className="mt-1 text-xs">Modelo: {match.previousRequest}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {!compact ? (
          <details className="rounded-md border bg-muted/20 p-3">
            <summary className="cursor-pointer text-sm font-medium">Administracao avancada</summary>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-2xl text-xs text-muted-foreground">
                Reconstrucao completa para catalogos e modelos. A operacao normal usa somente sincronizacao incremental.
              </p>
              <Button type="button" variant="outline" onClick={() => void runHistoricalSync()} disabled={fluigBusy || !onlineAgent}>
                <DatabaseZap className={cn("size-4", historicalPending ? "animate-pulse" : "")} />
                Reconstruir historico (admin)
              </Button>
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InfoTile({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}
