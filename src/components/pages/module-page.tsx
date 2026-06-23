import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AuditTimeline } from "@/components/shared/audit-timeline";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { FluigIntegrationPanel } from "@/components/shared/fluig-integration-panel";
import { FormSection } from "@/components/shared/form-section";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { UploadField } from "@/components/shared/upload-field";
import { UserBranchAccessPanel } from "@/components/shared/user-branch-access-panel";
import { BranchesPage } from "@/components/pages/branches-page";
import { FluigModuleOperationsPage } from "@/components/pages/fluig-module-operations-page";
import { FluigTasksPage } from "@/components/pages/fluig-tasks-page";
import { MaintenancePage } from "@/components/pages/maintenance-page";
import { SuppliersPage } from "@/components/pages/suppliers-page";
import type { ModuleConfig } from "@/lib/admin-data";

const stitchDelays = [
  "stitch-delay-100",
  "stitch-delay-200",
  "stitch-delay-300",
  "stitch-delay-400",
  "stitch-delay-500",
  "stitch-delay-600",
];

function toClientModuleConfig(config: ModuleConfig): ModuleConfig {
  return {
    slug: config.slug,
    title: config.title,
    eyebrow: config.eyebrow,
    description: config.description,
    primaryAction: config.primaryAction ? { ...config.primaryAction } : undefined,
    metrics: [],
    table: {
      columns: [...config.table.columns],
      rows: config.table.rows.map((row) => ({ ...row })),
    },
    statuses: [...config.statuses],
    formSections: config.formSections.map((section) => ({
      title: section.title,
      fields: [...section.fields],
    })),
  };
}

export function ModulePage({
  config,
  mode,
}: {
  config: ModuleConfig;
  mode: "list" | "new" | "detail";
}) {
  const clientConfig = toClientModuleConfig(config);

  if (config.slug === "fornecedores") {
    return <SuppliersPage config={clientConfig} initialOpenForm={mode === "new"} />;
  }

  if (config.slug === "configuracoes") {
    return <BranchesPage config={clientConfig} initialOpenForm={mode === "new"} />;
  }

  if (config.slug === "tarefas" && mode === "list") {
    return <FluigTasksPage config={clientConfig} />;
  }

  if (config.slug === "manutencao") {
    return <MaintenancePage config={clientConfig} initialOpenForm={mode === "new"} />;
  }

  if ((config.slug === "pagamentos" || config.slug === "compras") && mode === "list") {
    return <FluigModuleOperationsPage config={clientConfig} moduleSlug={config.slug} />;
  }

  if (mode === "new") {
    return <ModuleFormPage config={config} />;
  }

  if (mode === "detail") {
    return <ModuleDetailPage config={config} />;
  }

  return <ModuleListPage config={config} />;
}

function ModuleListPage({ config }: { config: ModuleConfig }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={config.eyebrow}
        title={config.title}
        description={config.description}
        action={config.primaryAction}
      />
      <div className="grid gap-4 md:grid-cols-3">
        {config.metrics.map((metric, index) => (
          <StatCard key={metric.title} item={metric} className={stitchDelays[index]} />
        ))}
      </div>
      <FilterBar placeholder={`Buscar em ${config.title.toLowerCase()}`} />
      {config.slug === "usuarios" ? <UserBranchAccessPanel /> : null}
      <FluigIntegrationPanel moduleSlug={config.slug} />
      {config.table.rows.length > 0 ? (
        <DataTable columns={config.table.columns} rows={config.table.rows} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function ModuleFormPage({ config }: { config: ModuleConfig }) {
  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild className="stitch-soft-button w-fit">
        <Link href={`/${config.slug}`}>
          <ArrowLeft className="size-4" />
          Voltar
        </Link>
      </Button>
      <PageHeader
        eyebrow={config.eyebrow}
        title={`Novo registro em ${config.title}`}
        description="Cadastro operacional vinculado ao CD Principal, anexos e trilha de auditoria."
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {config.formSections.length > 0 ? (
            config.formSections.map((section, index) => (
              <FormSection
                key={section.title}
                title={section.title}
                fields={section.fields}
                className={stitchDelays[index]}
              />
            ))
          ) : (
            <EmptyState title="Este módulo não possui formulário nesta etapa" />
          )}
        </div>
        <div className="space-y-4">
          <FluigIntegrationPanel moduleSlug={config.slug} compact />
          <Card className="stitch-animate-in stitch-hover-lift stitch-delay-300 rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Anexos</CardTitle>
            </CardHeader>
            <CardContent>
              <UploadField />
            </CardContent>
          </Card>
          <Card className="stitch-animate-in stitch-hover-lift stitch-delay-400 rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Ações</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button className="stitch-soft-button">Salvar registro</Button>
              <Button variant="outline" className="stitch-soft-button">
                Salvar rascunho
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ModuleDetailPage({ config }: { config: ModuleConfig }) {
  const firstRow = config.table.rows[0];

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild className="stitch-soft-button w-fit">
        <Link href={`/${config.slug}`}>
          <ArrowLeft className="size-4" />
          Voltar
        </Link>
      </Button>
      <PageHeader
        eyebrow={config.eyebrow}
        title={`Detalhes de ${config.title}`}
        description="Visão consolidada do registro, anexos, auditoria e ações críticas."
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card className="stitch-animate-in stitch-hover-lift stitch-delay-100 rounded-lg shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4" />
              Dados principais
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {firstRow
              ? Object.entries(firstRow).map(([key, value], index) => (
                  <div
                    key={key}
                    className="stitch-animate-in-fast rounded-md border bg-muted/30 p-3"
                    style={{ animationDelay: `${index * 80 + 200}ms` }}
                  >
                    <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{key}</p>
                    <div className="mt-1 text-sm font-medium">
                      {key === "Status" ? <StatusBadge status={value} /> : value}
                    </div>
                  </div>
                ))
              : null}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <FluigIntegrationPanel moduleSlug={config.slug} compact />
          <Card className="stitch-animate-in stitch-hover-lift stitch-delay-300 rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Auditoria</CardTitle>
            </CardHeader>
            <CardContent>
              <AuditTimeline />
            </CardContent>
          </Card>
          <Card className="stitch-animate-in stitch-hover-lift stitch-delay-400 rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Ações críticas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ConfirmDialog />
              <Separator />
              <p className="text-xs text-muted-foreground">
                A ação fica registrada na trilha de auditoria do CD.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
