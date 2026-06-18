"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DatabaseZap,
  ExternalLink,
  FileText,
  KeyRound,
  Laptop,
  RefreshCcw,
  Send,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared/status-badge";
import { fluigAdmApi, type FluigAdmSyncAction } from "@/lib/fluig-api";
import {
  getFluigIntegrationForModule,
  type FluigAdmSyncResponse,
  type FluigModuleSlug,
} from "@/lib/fluig-data";
import { cn } from "@/lib/utils";

type FluigIntegrationPanelProps = {
  moduleSlug: string;
  compact?: boolean;
};

export function FluigIntegrationPanel({ moduleSlug, compact = false }: FluigIntegrationPanelProps) {
  const integration = getFluigIntegrationForModule(moduleSlug);
  const [syncData, setSyncData] = useState<FluigAdmSyncResponse | null>(null);
  const [pendingAction, setPendingAction] = useState<FluigAdmSyncAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; display_name: string; machine_name: string | null; status: string; last_heartbeat_at: string | null }>>([]);
  const [activeJob, setActiveJob] = useState<{
    id: string;
    status: string;
    progressStage: string | null;
    progressLabel: string | null;
    events: Array<{ id: string; event_type: string; stage: string | null; label: string | null; created_at: string }>;
  } | null>(null);
  const [pairToken, setPairToken] = useState<string | null>(null);

  const rows = useMemo(() => syncData?.rows ?? [], [syncData?.rows]);
  const examples = useMemo(() => syncData?.examples ?? [], [syncData?.examples]);
  const supplierMatches = useMemo(() => syncData?.supplierMatches ?? [], [syncData?.supplierMatches]);
  const integrationSlug = integration?.slug;

  async function runSync(action: FluigAdmSyncAction) {
    if (!integration) {
      return;
    }

    setPendingAction(action);
    setError(null);

    try {
      if (action === "sync" || action === "examples") {
        const created = await fluigAdmApi.createJob({
          module: integration.slug as FluigModuleSlug,
          operation: "sync_history",
          payload: {
            action,
            module: integration.slug,
            days: 90,
            pageSize: 50,
            maxPages: 3,
            persist: true,
          },
        });
        await pollJobUntilDone(created.job.id);
      }

      const data = await fluigAdmApi.sync({ module: integration.slug as FluigModuleSlug, action });
      setSyncData(data);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Falha ao sincronizar Fluig");
    } finally {
      setPendingAction(null);
    }
  }

  async function pollJobUntilDone(jobId: string) {
    const terminal = new Set(["success", "error", "cancelled", "expired"]);

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const data = await fluigAdmApi.getJob(jobId);
      setActiveJob({
        id: data.job.id,
        status: data.job.status,
        progressStage: data.job.progressStage,
        progressLabel: data.job.progressLabel,
        events: data.events || [],
      });

      if (terminal.has(data.job.status)) {
        if (data.job.status !== "success") {
          throw new Error(data.job.errorMessage || `Job Fluig finalizado com status ${data.job.status}`);
        }
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }

    throw new Error("Tempo limite aguardando o agente local executar a tarefa Fluig.");
  }

  async function pairAgent() {
    setError(null);
    setPairToken(null);

    try {
      const data = await fluigAdmApi.pairAgent({
        displayName: "Agente Fluig desta maquina",
      });
      setPairToken(data.token);
      const nextAgents = await fluigAdmApi.listAgents();
      setAgents(nextAgents);
    } catch (pairError) {
      setError(pairError instanceof Error ? pairError.message : "Falha ao parear agente Fluig");
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

    void fluigAdmApi
      .listAgents()
      .then((data) => {
        if (active) setAgents(data);
      })
      .catch(() => {
        if (active) setAgents([]);
      });

    return () => {
      active = false;
    };
  }, [integrationSlug, moduleSlug]);

  if (!integration) {
    return null;
  }

  const visibleFields = compact ? integration.mappedFields.slice(0, 5) : integration.mappedFields;
  const visibleRows = compact ? rows.slice(0, 2) : rows;
  const visibleExamples = compact ? examples.slice(0, 1) : examples;
  const onlineAgent = agents.find((agent) => agent.status === "online");

  return (
    <Card className="stitch-animate-in stitch-hover-lift rounded-lg shadow-none">
      <CardHeader className="space-y-4">
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
              <span className="font-medium text-foreground">Origem mapeada</span>
              <span>{integration.stitch.screenTitle}</span>
              <span>Processo: {integration.processId}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="stitch-soft-button"
            onClick={() => runSync("sync")}
            disabled={Boolean(pendingAction)}
          >
            <RefreshCcw className={cn("size-4", pendingAction === "sync" ? "animate-spin" : "")} />
            {integration.syncAction}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="stitch-soft-button"
            onClick={() => runSync("examples")}
            disabled={Boolean(pendingAction)}
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
          <Button type="button" variant="outline" className="stitch-soft-button">
            <Send className="size-4" />
            {integration.primaryAction}
          </Button>
          <Button type="button" variant="outline" className="stitch-soft-button" onClick={pairAgent}>
            <KeyRound className="size-4" />
            Parear agente
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="rounded-md border bg-muted/20 p-3 text-xs">
            <div className="flex items-center gap-2 font-medium">
              <Laptop className="size-4" />
              Agente local
              <StatusBadge status={onlineAgent ? "ONLINE" : agents.length ? "OFFLINE" : "NAO_PAREADO"} />
            </div>
            <p className="mt-2 text-muted-foreground">
              {onlineAgent
                ? `${onlineAgent.display_name} ativo${onlineAgent.machine_name ? ` em ${onlineAgent.machine_name}` : ""}.`
                : agents.length
                  ? "Existe agente pareado, mas ele nao enviou heartbeat recente."
                  : "Nenhum agente local pareado para este usuario."}
            </p>
          </div>
          {activeJob ? (
            <div className="rounded-md border bg-muted/20 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                Execucao Fluig
                <StatusBadge status={activeJob.status.toUpperCase()} />
                <span className="font-mono text-muted-foreground">{activeJob.id.slice(0, 8)}</span>
              </div>
              <p className="mt-2 text-muted-foreground">{activeJob.progressLabel || "Aguardando agente local assumir a tarefa."}</p>
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
              As proximas consultas e lancamentos serao executados pelo agente local do usuario.
            </div>
          )}
        </div>
        {pairToken ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-semibold">Token gerado uma unica vez</p>
            <p className="mt-1 break-all font-mono">{pairToken}</p>
            <p className="mt-2">
              Use no instalador em <span className="font-mono">agent/fluig-agent/scripts/install-windows-agent.ps1</span>.
            </p>
          </div>
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
        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <InfoTile icon={DatabaseZap} label="Processo" value={integration.processLabel} />
          <InfoTile icon={FileText} label="Campos mapeados" value={String(integration.mappedFields.length)} />
          <InfoTile icon={Workflow} label="Registros sincronizados" value={String(rows.length)} />
        </div>

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
                          <span className="text-muted-foreground">{key}</span>
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
            <h3 className="text-sm font-semibold">Campos do formulario Fluig nesta pagina</h3>
            <p className="text-xs text-muted-foreground">Mapa usado para preencher, validar e espelhar retorno.</p>
          </header>
          <div className="grid gap-2 p-3 md:grid-cols-2">
            {visibleFields.map((field) => (
              <div key={`${field.fluigField}-${field.admField}`} className="rounded-md border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{field.fluigField}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{field.admField}</p>
                  </div>
                  <span className="rounded border bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                    {field.required ? "obrigatorio" : "opcional"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{field.rule}</p>
              </div>
            ))}
          </div>
        </section>

        {supplierMatches.length > 0 ? (
          <>
            <Separator />
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Fornecedores mapeados do historico Fluig</h3>
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
