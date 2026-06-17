"use client";

import { useEffect, useMemo, useState } from "react";
import { DatabaseZap, ExternalLink, FileText, RefreshCcw, Send, Workflow, type LucideIcon } from "lucide-react";
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
      if (action === "sync") {
        await fluigAdmApi.post(fluigAdmApi.historyPath, {
          module: integration.slug,
          days: 90,
          pageSize: 50,
          maxPages: 3,
          persist: true,
        });
      }

      const data = await fluigAdmApi.sync({ module: integration.slug as FluigModuleSlug, action });
      setSyncData(data);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Falha ao sincronizar Fluig");
    } finally {
      setPendingAction(null);
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
        </div>
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
                    <th className="p-3 text-left">Fornecedor</th>
                    <th className="p-3 text-left">Etapa</th>
                    <th className="p-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingAction === "sync" && !syncData ? (
                    <tr className="border-t">
                      <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                        Consultando Supabase...
                      </td>
                    </tr>
                  ) : visibleRows.length > 0 ? (
                    visibleRows.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="p-3 font-medium">{row.admReference}</td>
                        <td className="p-3 text-muted-foreground">{row.fluigNumber}</td>
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
                      <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
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
