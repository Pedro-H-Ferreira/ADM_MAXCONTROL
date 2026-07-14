"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  CalendarClock,
  ClipboardCheck,
  Gauge,
  PackageSearch,
  RefreshCcw,
  Settings2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { MaintenanceOrdersPanel } from "@/components/pages/maintenance-page";
import { maintenanceRequest } from "@/components/maintenance/maintenance-api";
import { MaintenanceAssetsPanel } from "@/components/maintenance/maintenance-assets-panel";
import { MaintenanceStockPanel } from "@/components/maintenance/maintenance-stock-panel";
import { MaintenanceInventoriesPanel } from "@/components/maintenance/maintenance-inventories-panel";
import { MaintenancePreventivePanel } from "@/components/maintenance/maintenance-preventive-panel";
import { MaintenanceMovementsPanel } from "@/components/maintenance/maintenance-movements-panel";
import { MaintenanceCalendarPanel } from "@/components/maintenance/maintenance-calendar-panel";
import { MaintenanceProvidersPanel } from "@/components/maintenance/maintenance-providers-panel";
import { MaintenanceReportsPanel } from "@/components/maintenance/maintenance-reports-panel";
import { MaintenanceSettingsPanel } from "@/components/maintenance/maintenance-settings-panel";
import type { ModuleConfig } from "@/lib/admin-data";

type MaintenanceView = "dashboard" | "orders" | "assets" | "stock" | "movements" | "inventories" | "preventive" | "calendar" | "providers" | "reports" | "settings";

type DashboardPayload = {
  success: true;
  counts: {
    assets: number;
    assetsStopped: number;
    ordersOpen: number;
    plansDue: number;
    inventoriesOpen: number;
  };
  capabilities: Record<string, boolean>;
};

const views: MaintenanceView[] = ["dashboard", "orders", "assets", "stock", "movements", "inventories", "preventive", "calendar", "providers", "reports", "settings"];

export function MaintenancePage({ config, initialOpenForm = false }: { config: ModuleConfig; initialOpenForm?: boolean }) {
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view") as MaintenanceView | null;
  const [view, setView] = useState<MaintenanceView>(() => initialOpenForm ? "orders" : requestedView && views.includes(requestedView) ? requestedView : "dashboard");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      setDashboard(await maintenanceRequest<DashboardPayload>("/api/manutencao/dashboard", { cache: "no-store" }, "Falha ao carregar manutencao."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar manutencao.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void loadDashboard());
    return () => window.cancelAnimationFrame(frame);
  }, [loadDashboard]);

  function changeView(next: string) {
    const nextView = next as MaintenanceView;
    setView(nextView);
    const params = new URLSearchParams(window.location.search);
    if (nextView === "dashboard") params.delete("view");
    else params.set("view", nextView);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        eyebrow={config.eyebrow}
        title={config.title}
        description="Gestao integrada de OS, ativos, estoque tecnico, inventarios, preventivas e prestadores por filial."
      />

      <Tabs value={view} onValueChange={changeView} className="min-w-0">
        <div className="overflow-x-auto border-b">
          <TabsList className="h-auto w-max min-w-full justify-start rounded-none bg-transparent p-0">
            <ViewTrigger value="dashboard" icon={Gauge} label="Visao geral" />
            <ViewTrigger value="orders" icon={Wrench} label="Ordens de servico" />
            <ViewTrigger value="assets" icon={Boxes} label="Ativos" />
            <ViewTrigger value="stock" icon={PackageSearch} label="Estoque" />
            <ViewTrigger value="movements" icon={ArrowLeftRight} label="Movimentacoes" />
            <ViewTrigger value="inventories" icon={ClipboardCheck} label="Inventarios" />
            <ViewTrigger value="preventive" icon={CalendarClock} label="Preventivas" />
            <ViewTrigger value="calendar" icon={CalendarDays} label="Calendario" />
            <ViewTrigger value="providers" icon={Building2} label="Prestadores" />
            <ViewTrigger value="reports" icon={BarChart3} label="Relatorios" />
            <ViewTrigger value="settings" icon={Settings2} label="Configuracoes" />
          </TabsList>
        </div>

        <TabsContent value="dashboard" className="mt-5 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Resumo operacional</h2>
              <p className="text-sm text-muted-foreground">Indicadores das filiais liberadas para o seu usuario.</p>
            </div>
            <Button type="button" variant="outline" size="icon" onClick={() => void loadDashboard()} disabled={loading} title="Atualizar indicadores">
              <RefreshCcw className={loading ? "size-4 animate-spin" : "size-4"} />
              <span className="sr-only">Atualizar indicadores</span>
            </Button>
          </div>
          {loading && !dashboard ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-28 rounded-md" />)}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <DashboardMetric label="Ativos cadastrados" value={dashboard?.counts.assets || 0} tone="default" />
              <DashboardMetric label="Ativos indisponiveis" value={dashboard?.counts.assetsStopped || 0} tone="warning" />
              <DashboardMetric label="OS em aberto" value={dashboard?.counts.ordersOpen || 0} tone="attention" />
              <DashboardMetric label="Preventivas vencidas" value={dashboard?.counts.plansDue || 0} tone="warning" />
              <DashboardMetric label="Inventarios abertos" value={dashboard?.counts.inventoriesOpen || 0} tone="default" />
            </div>
          )}
          <div className="grid gap-px overflow-hidden rounded-md border bg-border md:grid-cols-3">
            <QuickAccess icon={Wrench} label="Fila de OS" description="Prioridade, prazo e execucao" onClick={() => changeView("orders")} />
            <QuickAccess icon={Boxes} label="Cadastro de ativos" description="Historico, medidores e transferencia" onClick={() => changeView("assets")} />
            <QuickAccess icon={PackageSearch} label="Estoque tecnico" description="Saldo, reserva e movimentacao" onClick={() => changeView("stock")} />
          </div>
        </TabsContent>

        <TabsContent value="orders" className="mt-5"><MaintenanceOrdersPanel initialOpenForm={initialOpenForm} /></TabsContent>
        <TabsContent value="assets" className="mt-5"><MaintenanceAssetsPanel /></TabsContent>
        <TabsContent value="stock" className="mt-5"><MaintenanceStockPanel /></TabsContent>
        <TabsContent value="movements" className="mt-5"><MaintenanceMovementsPanel /></TabsContent>
        <TabsContent value="inventories" className="mt-5"><MaintenanceInventoriesPanel /></TabsContent>
        <TabsContent value="preventive" className="mt-5"><MaintenancePreventivePanel /></TabsContent>
        <TabsContent value="calendar" className="mt-5"><MaintenanceCalendarPanel /></TabsContent>
        <TabsContent value="providers" className="mt-5"><MaintenanceProvidersPanel /></TabsContent>
        <TabsContent value="reports" className="mt-5"><MaintenanceReportsPanel /></TabsContent>
        <TabsContent value="settings" className="mt-5"><MaintenanceSettingsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function ViewTrigger({ value, icon: Icon, label }: { value: MaintenanceView; icon: typeof Gauge; label: string }) {
  return (
    <TabsTrigger value={value} className="gap-2 rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
      <Icon className="size-4" />
      {label}
    </TabsTrigger>
  );
}

function DashboardMetric({ label, value, tone }: { label: string; value: number; tone: "default" | "warning" | "attention" }) {
  return (
    <div className="rounded-md border bg-background p-4">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className={tone === "warning" ? "mt-3 text-3xl font-semibold text-amber-700" : tone === "attention" ? "mt-3 text-3xl font-semibold text-sky-700" : "mt-3 text-3xl font-semibold"}>{value}</p>
    </div>
  );
}

function QuickAccess({ icon: Icon, label, description, onClick }: { icon: typeof Gauge; label: string; description: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-24 items-center gap-3 bg-background p-4 text-left transition-colors hover:bg-muted/40">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/30"><Icon className="size-4" /></span>
      <span className="min-w-0"><span className="block font-medium">{label}</span><span className="block text-sm text-muted-foreground">{description}</span></span>
    </button>
  );
}
