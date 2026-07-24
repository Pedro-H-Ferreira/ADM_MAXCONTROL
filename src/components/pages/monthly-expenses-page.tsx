"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarCheck2,
  CheckCircle2,
  CircleAlert,
  Clock3,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import type {
  MonthlyExpenseBranchSummary,
  MonthlyExpenseDashboard,
  MonthlyExpenseMonthStatus,
} from "@/lib/monthly-expense-monitor";

type DashboardResponse = {
  success: true;
  dashboard: MonthlyExpenseDashboard & {
    scope: { allBranches: boolean; branchCodes: string[] };
  };
};

function monthLabel(month: string, short = false) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    month: short ? "short" : "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function cleanSupplierName(value: string) {
  return value.replace(/^\d+\s*-\s*/, "").replace(/\s*-\s*\d{11,14}\s*$/, "").trim() || value;
}

function MonthStatusCell({ item }: { item: MonthlyExpenseMonthStatus }) {
  if (item.status === "SEM_HISTORICO") {
    return <span className="text-xs text-muted-foreground">Sem histórico</span>;
  }
  if (item.status === "PENDENTE") {
    return (
      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
        Não lançada
      </Badge>
    );
  }
  return (
    <div>
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        <CheckCircle2 className="size-3" />
        Lançada
      </Badge>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {item.launchCount} lançamento{item.launchCount === 1 ? "" : "s"} · {money(item.amountCents)}
      </p>
    </div>
  );
}

function BranchSummary({ item }: { item: MonthlyExpenseBranchSummary }) {
  return (
    <div className={`rounded-lg border p-4 ${item.pending ? "border-red-200 bg-red-50/60" : "border-emerald-200 bg-emerald-50/50"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{item.branchCode}</p>
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.branchLabel}</p>
        </div>
        <Badge variant="outline" className={item.pending ? "border-red-200 bg-white text-red-700" : "border-emerald-200 bg-white text-emerald-700"}>
          {item.compliancePercent}%
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div><p className="font-semibold">{item.expected}</p><p className="text-muted-foreground">Esperadas</p></div>
        <div><p className="font-semibold text-emerald-700">{item.launched}</p><p className="text-muted-foreground">Lançadas</p></div>
        <div><p className="font-semibold text-red-700">{item.pending}</p><p className="text-muted-foreground">Pendentes</p></div>
      </div>
    </div>
  );
}

export function MonthlyExpensesPage() {
  const [dashboard, setDashboard] = useState<DashboardResponse["dashboard"] | null>(null);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("TODAS");
  const [statusFilter, setStatusFilter] = useState<"TODAS" | "PENDENTE" | "LANCADA">("TODAS");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (month?: string, background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch(`/api/fluig/adm/monthly-expenses${month ? `?month=${encodeURIComponent(month)}` : ""}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as DashboardResponse & { error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "Falha ao consultar contas mensais.");
      setDashboard(data.dashboard);
      setSelectedMonth(data.dashboard.selectedMonth);
      setBranchFilter((current) =>
        current === "TODAS" || data.dashboard.branches.some((branch) => branch.branchCode === current) ? current : "TODAS"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao consultar contas mensais.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filteredProfiles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return (dashboard?.profiles || []).filter((profile) => {
      if (branchFilter !== "TODAS" && profile.branchCode !== branchFilter) return false;
      if (statusFilter !== "TODAS" && profile.selectedMonth.status !== statusFilter) return false;
      if (!normalized) return true;
      return [
        profile.supplierName,
        profile.supplierCnpj,
        profile.branchCode,
        profile.branchLabel,
        profile.expenseNature,
        profile.category,
      ].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(normalized));
    });
  }, [branchFilter, dashboard?.profiles, query, statusFilter]);

  const visibleBranches = useMemo(
    () => (branchFilter === "TODAS" ? dashboard?.branches || [] : (dashboard?.branches || []).filter((branch) => branch.branchCode === branchFilter)),
    [branchFilter, dashboard?.branches]
  );

  const metricCards = dashboard
    ? [
        { label: "Contas esperadas", value: dashboard.metrics.expected, helper: monthLabel(dashboard.selectedMonth), icon: CalendarCheck2, tone: "" },
        { label: "Já lançadas", value: dashboard.metrics.launched, helper: `${dashboard.metrics.compliancePercent}% concluído`, icon: CheckCircle2, tone: "text-emerald-600" },
        { label: "Ainda não lançadas", value: dashboard.metrics.pending, helper: "Exigem conferência", icon: CircleAlert, tone: "text-red-600" },
        { label: "Filiais com pendência", value: dashboard.metrics.branchesWithPending, helper: dashboard.scope.allBranches ? "Visão de todas as lojas" : "Somente suas filiais", icon: Building2, tone: "text-amber-600" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Acompanhamento financeiro"
        title="Contas mensais"
        description={
          dashboard?.scope.allBranches
            ? "Visão consolidada de todas as filiais para identificar contas recorrentes ainda não lançadas."
            : "Acompanhe as contas recorrentes somente das filiais vinculadas ao seu usuário."
        }
      />

      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        <p className="font-semibold">O que entra neste acompanhamento</p>
        <p className="mt-1 leading-6">
          Água, energia, internet, telefonia, aluguel e outras despesas de baixa frequência que se repetem mensalmente.
          Frete de transferência de produtos — DANFE não é considerado conta mensal.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32" />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metricCards.map((metric) => (
            <Card key={metric.label}>
              <CardContent className="flex items-start justify-between p-5">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                  <p className={`mt-2 text-3xl font-semibold ${metric.tone}`}>{metric.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{metric.helper}</p>
                </div>
                <div className="grid size-9 place-items-center rounded-md border bg-muted/30">
                  <metric.icon className={`size-4 ${metric.tone || "text-muted-foreground"}`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <Select
              value={selectedMonth}
              onValueChange={(value) => {
                setSelectedMonth(value);
                void load(value, true);
              }}
              disabled={!dashboard || refreshing}
            >
              <SelectTrigger className="w-full xl:w-[210px]"><SelectValue placeholder="Competência" /></SelectTrigger>
              <SelectContent>
                {(dashboard?.availableMonths || []).map((month) => (
                  <SelectItem key={month} value={month}>{monthLabel(month)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-full xl:w-[260px]"><SelectValue placeholder="Filial" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">{dashboard?.scope.allBranches ? "Todas as filiais" : "Todas as minhas filiais"}</SelectItem>
                {(dashboard?.branches || []).map((branch) => (
                  <SelectItem key={branch.branchCode} value={branch.branchCode}>{branch.branchCode} - {branch.branchLabel}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
              <SelectTrigger className="w-full xl:w-[210px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Todas as situações</SelectItem>
                <SelectItem value="PENDENTE">Ainda não lançadas</SelectItem>
                <SelectItem value="LANCADA">Já lançadas</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar fornecedor, natureza ou filial" className="pl-9" />
            </div>
            <Button variant="outline" onClick={() => void load(selectedMonth, true)} disabled={refreshing}>
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </CardContent>
      </Card>

      {visibleBranches.length ? (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Resumo por filial</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {visibleBranches.map((branch) => <BranchSummary key={branch.branchCode} item={branch} />)}
          </div>
        </section>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">Acompanhamento por fornecedor</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {filteredProfiles.length} conta{filteredProfiles.length === 1 ? "" : "s"} no filtro atual. Os meses anteriores permitem identificar falhas de lançamento.
            </p>
          </div>
          {loading ? (
            <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-16" />)}</div>
          ) : filteredProfiles.length ? (
            <div className="overflow-x-auto">
              <Table className="min-w-[1500px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[170px]">Filial</TableHead>
                    <TableHead className="w-[300px]">Fornecedor</TableHead>
                    <TableHead className="w-[280px]">Despesa mensal</TableHead>
                    {filteredProfiles[0]?.history.map((month) => (
                      <TableHead key={month.month} className={month.month === selectedMonth ? "bg-primary/5" : ""}>
                        {monthLabel(month.month, true)}
                      </TableHead>
                    ))}
                    <TableHead>Último Fluig</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProfiles.map((profile) => (
                    <TableRow key={profile.id} className={profile.selectedMonth.status === "PENDENTE" ? "bg-red-50/40" : ""}>
                      <TableCell>
                        <p className="font-semibold">{profile.branchCode}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{profile.branchLabel}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{cleanSupplierName(profile.supplierName)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{profile.supplierCnpj || "CNPJ não informado"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{profile.category}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{profile.expenseNature}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {profile.detection === "NATUREZA_RECORRENTE" ? "Natureza mensal" : `${profile.observedMonthCount} meses recorrentes`}
                        </p>
                      </TableCell>
                      {profile.history.map((month) => (
                        <TableCell key={month.month} className={month.month === selectedMonth ? "bg-primary/5" : ""}>
                          <MonthStatusCell item={month} />
                        </TableCell>
                      ))}
                      <TableCell>
                        <p className="font-mono text-xs">{profile.latestFluigRequestId || "—"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{profile.latestStatus || "Status não informado"}</p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <Clock3 className="mx-auto size-9 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold">Nenhuma conta mensal neste filtro</p>
              <p className="mt-1 text-sm text-muted-foreground">Altere a competência, filial, situação ou termo de busca.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
