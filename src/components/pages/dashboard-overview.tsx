import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  Building2,
  ListTodo,
  Plus,
  ReceiptText,
  Workflow,
  Wrench,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DashboardCard } from "@/components/shared/dashboard-card";
import { DashboardFluigOperations } from "@/components/shared/dashboard-fluig-operations";
import { PageHeader } from "@/components/shared/page-header";
import { PeriodFilter } from "@/components/shared/period-filter";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { getDashboardOverviewData, type DashboardOverviewData } from "@/lib/db/dashboard-repository";
import type { AppActor } from "@/lib/db/app-repository";
import type { StatItem, Tone } from "@/lib/admin-data";

const quickActions = [
  { label: "Nova despesa", href: "/despesas/nova" },
  { label: "Novo fornecedor", href: "/fornecedores/novo" },
  { label: "Novo contrato", href: "/contratos/novo" },
  { label: "Nova requisição", href: "/compras/nova" },
  { label: "Nova OS", href: "/manutencao/nova" },
  { label: "Nova tarefa", href: "/tarefas/nova" },
];

const stitchDelays = [
  "stitch-delay-100",
  "stitch-delay-200",
  "stitch-delay-300",
  "stitch-delay-400",
  "stitch-delay-500",
  "stitch-delay-600",
];

function countText(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function buildDashboardStats(data: DashboardOverviewData): StatItem[] {
  return [
    {
      title: "Pagamentos do mes",
      value: countText(data.paymentsThisMonth),
      helper: "Solicitacoes de pagamento sincronizadas no mes atual",
      change: `${countText(data.paymentsOverdue)} vencidas`,
      tone: data.paymentsOverdue ? "warning" : "info",
      icon: ReceiptText,
    },
    {
      title: "Pagamentos pendentes",
      value: countText(data.paymentsOpen),
      helper: "Pagamentos Fluig ainda abertos",
      change: `${countText(data.paymentsOverdue)} exigem atencao`,
      tone: data.paymentsOverdue ? "danger" : "info",
      icon: Banknote,
    },
    {
      title: "Solicitacoes Fluig",
      value: countText(data.openFluigRequests),
      helper: "Solicitacoes abertas no escopo do usuario",
      change: "Atualizado pelo historico e sync incremental",
      tone: "info",
      icon: Workflow,
    },
    {
      title: "OS abertas",
      value: countText(data.maintenanceOpen),
      helper: "Manutencoes manuais e Fluig ainda abertas",
      change: `${countText(data.maintenanceOverdue)} atrasadas`,
      tone: data.maintenanceOverdue ? "warning" : "info",
      icon: Wrench,
    },
    {
      title: "Tarefas atrasadas",
      value: countText(data.tasksOverdue),
      helper: "Itens Fluig abertos com vencimento anterior a hoje",
      change: data.tasksOverdue ? "Priorizar acompanhamento" : "Sem atraso identificado",
      tone: data.tasksOverdue ? "danger" : "success",
      icon: ListTodo,
    },
    {
      title: "Fornecedores ativos",
      value: countText(data.activeSuppliers),
      helper: "Cadastro oficial ativo no ADM",
      change: `${countText(data.suppliersPendingReview)} pendentes de revisao`,
      tone: data.suppliersPendingReview ? "warning" : "info",
      icon: Building2,
    },
  ];
}

function buildDashboardAlerts(data: DashboardOverviewData): { title: string; detail: string; tone: Tone }[] {
  return [
    ...data.warnings.map((warning) => ({
      title: "Configuracao pendente",
      detail: warning,
      tone: "danger" as Tone,
    })),
    data.paymentsOverdue
      ? {
          title: "Pagamentos vencidos",
          detail: `${countText(data.paymentsOverdue)} pagamentos sincronizados estao vencidos.`,
          tone: "danger" as Tone,
        }
      : null,
    data.maintenanceOverdue
      ? {
          title: "OS atrasadas",
          detail: `${countText(data.maintenanceOverdue)} ordens de servico passaram do prazo.`,
          tone: "warning" as Tone,
        }
      : null,
    data.suppliersPendingReview
      ? {
          title: "Fornecedores em revisao",
          detail: `${countText(data.suppliersPendingReview)} cadastros precisam de validacao administrativa.`,
          tone: "warning" as Tone,
        }
      : null,
  ].filter(Boolean) as { title: string; detail: string; tone: Tone }[];
}

export async function DashboardOverview({ actor }: { actor: AppActor }) {
  const dashboardData = await getDashboardOverviewData(actor);
  const dashboardStats = buildDashboardStats(dashboardData);
  const dashboardAlerts = buildDashboardAlerts(dashboardData);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <PageHeader
          eyebrow="CD Principal"
          title="Dashboard executivo"
          description="Indicadores operacionais, financeiros e de facilities para acompanhamento diário do Centro de Distribuição."
        />
        <PeriodFilter />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {dashboardStats.map((item, index) => (
          <StatCard key={item.title} item={item} className={stitchDelays[index]} />
        ))}
      </div>

      <DashboardFluigOperations />

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <Card className="stitch-animate-in stitch-hover-lift stitch-delay-200 rounded-lg shadow-none">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Pagamentos por fornecedor</CardTitle>
            <Button variant="ghost" size="sm" asChild className="stitch-soft-button">
              <Link href="/relatorios" prefetch={false}>
                Ver relatórios
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {dashboardData.chartRows.length > 0 ? (
              <div className="space-y-4">
                {dashboardData.chartRows.map((row, index) => (
                  <div
                    key={row.label}
                    className="stitch-animate-in-fast grid gap-2"
                    style={{ animationDelay: `${index * 100 + 250}ms` }}
                  >
                    <div className="flex justify-between text-sm">
                      <span>{row.label}</span>
                      <span className="font-mono text-muted-foreground">{row.value}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="stitch-bar-grow-x h-2 rounded-full bg-primary"
                        style={{ width: `${row.value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyDashboardMessage text="Sem pagamentos reais com valor para montar o grafico." />
            )}
          </CardContent>
        </Card>

        <DashboardCard title="Alertas críticos" className="stitch-delay-250">
          <div className="space-y-3">
            {dashboardAlerts.length > 0 ? (
              dashboardAlerts.map((alert, index) => (
                <Alert
                  key={alert.title}
                  variant={alert.tone === "danger" ? "destructive" : "default"}
                  className="stitch-pop-in"
                  style={{ animationDelay: `${index * 120 + 300}ms` }}
                >
                  <AlertTitle>{alert.title}</AlertTitle>
                  <AlertDescription>{alert.detail}</AlertDescription>
                </Alert>
              ))
            ) : (
              <EmptyDashboardMessage text="Nenhum alerta real gerado ainda." />
            )}
          </div>
        </DashboardCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <DashboardCard title="Proximas contas" className="stitch-delay-300">
          <div className="space-y-3">
            {dashboardData.upcomingPayments.length > 0 ? (
              dashboardData.upcomingPayments.map(([date, supplier, value, status], index) => (
                <div
                  key={`${date}-${supplier}`}
                  className="stitch-animate-in-fast flex items-center justify-between gap-3"
                  style={{ animationDelay: `${index * 90 + 350}ms` }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{supplier}</p>
                    <p className="text-xs text-muted-foreground">
                      {date} - {value}
                    </p>
                  </div>
                  <StatusBadge status={status.replaceAll(" ", "_")} />
                </div>
              ))
            ) : (
              <EmptyDashboardMessage text="Nenhuma conta real sincronizada ainda." />
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="Ultimas atividades" className="stitch-delay-400">
          <div className="space-y-3">
            {dashboardData.recentActivities.length > 0 ? (
              dashboardData.recentActivities.map((activity, index) => (
                <div
                  key={activity}
                  className="stitch-animate-in-fast"
                  style={{ animationDelay: `${index * 90 + 450}ms` }}
                >
                  <p className="text-sm">{activity}</p>
                  <p className="text-xs text-muted-foreground">ha {index + 1}h</p>
                  {index < dashboardData.recentActivities.length - 1 ? <Separator className="mt-3" /> : null}
                </div>
              ))
            ) : (
              <EmptyDashboardMessage text="Nenhuma atividade real registrada ainda." />
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="Ações rápidas" className="stitch-delay-500">
          <div className="grid gap-2">
            {quickActions.map((action, index) => (
              <Button
                key={action.href}
                variant="outline"
                asChild
                className="stitch-soft-button stitch-animate-in-fast justify-start"
                style={{ animationDelay: `${index * 80 + 500}ms` }}
              >
                <Link href={action.href} prefetch={false}>
                  <Plus className="size-4" />
                  {action.label}
                </Link>
              </Button>
            ))}
          </div>
        </DashboardCard>
      </div>
    </div>
  );
}

function EmptyDashboardMessage({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
