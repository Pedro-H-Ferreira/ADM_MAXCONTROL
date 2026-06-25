import { filterRowsForActor, type AppActor } from "@/lib/db/app-repository";
import { buildFluigActorPostgrestFilter } from "@/lib/fluig-visibility";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";

type FluigDashboardRow = {
  id: string;
  module_slug: "pagamentos" | "compras" | "manutencao" | "fornecedores";
  status: string | null;
  normalized_status: string | null;
  is_open: boolean | null;
  due_date: string | null;
  opened_at: string | null;
  last_synced_at: string | null;
  branch_code: string | null;
  created_by_user_id: string | null;
  fluig_requester_login: string | null;
  fluig_requester_code: string | null;
  requester: string | null;
  sync_owner_user_id: string | null;
  supplier_name: string | null;
  amount_cents: number | null;
  current_task: string | null;
  task_owner: string | null;
};

type MaintenanceDashboardRow = {
  id: string;
  status: string;
  due_at: string | null;
  branch_code: string | null;
  created_by_user_id: string | null;
  requester_user_id: string | null;
  technician_user_id: string | null;
};

type SupplierDashboardRow = {
  id: string;
  status: string;
  sync_status: string;
};

type SupplierBranchLinkRow = {
  supplier_id: string;
  branch?: {
    code: string | null;
  } | null;
};

type FluigJobDashboardRow = {
  module_slug: string;
  operation: string;
  status: string;
  progress_label: string | null;
  error_message: string | null;
  updated_at: string | null;
};

export type DashboardOverviewData = {
  paymentsThisMonth: number;
  paymentsOpen: number;
  paymentsOverdue: number;
  maintenanceOpen: number;
  maintenanceOverdue: number;
  tasksOverdue: number;
  activeSuppliers: number;
  suppliersPendingReview: number;
  openFluigRequests: number;
  chartRows: { label: string; value: number }[];
  upcomingPayments: string[][];
  recentActivities: string[];
  warnings: string[];
};

const emptyDashboardOverviewData: DashboardOverviewData = {
  paymentsThisMonth: 0,
  paymentsOpen: 0,
  paymentsOverdue: 0,
  maintenanceOpen: 0,
  maintenanceOverdue: 0,
  tasksOverdue: 0,
  activeSuppliers: 0,
  suppliersPendingReview: 0,
  openFluigRequests: 0,
  chartRows: [],
  upcomingPayments: [],
  recentActivities: [],
  warnings: [],
};

function chunksOf<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function throwDashboardQueryError(source: string, error: { message: string }): never {
  throw new Error(`Dashboard: falha ao consultar ${source}: ${error.message}`, { cause: error });
}

function isOpenFluigRequest(row: Pick<FluigDashboardRow, "is_open" | "status" | "normalized_status">) {
  if (row.is_open === true) return true;
  if (row.is_open === false) return false;

  const status = `${row.normalized_status || ""} ${row.status || ""}`.toLowerCase();
  return !status.includes("finaliz") && !status.includes("cancel") && !status.includes("encerr");
}

function isCurrentMonth(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function isBeforeToday(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function isUpcoming(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date >= today;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatMoneyFromCents(value: number | null | undefined) {
  if (typeof value !== "number") return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

function moduleLabel(moduleSlug: string) {
  const labels: Record<string, string> = {
    pagamentos: "Pagamentos",
    compras: "Compras",
    manutencao: "Manutencao",
    fornecedores: "Fornecedores",
  };
  return labels[moduleSlug] || moduleSlug;
}

function operationLabel(operation: string) {
  const labels: Record<string, string> = {
    sync_history: "carga historica",
    sync_initial_history: "carga historica",
    sync_status: "consulta de status",
    sync_user_open_tasks: "tarefas abertas",
    sync_user_open_requests: "solicitacoes abertas",
    sync_user_incremental_batch: "sync incremental",
    sync_request_by_number: "consulta por numero",
    open_from_source: "abertura de solicitacao",
    cancel_request: "cancelamento",
    health_check: "teste do agente",
  };
  return labels[operation] || operation;
}

function maintenanceVisibleForActor(actor: AppActor, row: MaintenanceDashboardRow) {
  if (actor.isAdmin) return true;
  if (row.created_by_user_id === actor.id || row.requester_user_id === actor.id || row.technician_user_id === actor.id) {
    return true;
  }
  return Boolean(row.branch_code && actor.branchCodes.includes(row.branch_code));
}

function supplierVisibleForActor(
  actor: AppActor,
  supplierId: string,
  linksBySupplier: Map<string, SupplierBranchLinkRow[]>
) {
  if (actor.isAdmin) return true;
  const links = linksBySupplier.get(supplierId) || [];
  if (!links.length) return true;
  return links.some((link) => link.branch?.code && actor.branchCodes.includes(link.branch.code));
}

function buildChartRows(payments: FluigDashboardRow[]) {
  const totals = new Map<string, number>();

  for (const payment of payments) {
    const amount = Number(payment.amount_cents || 0);
    if (!amount) continue;
    const label = String(payment.supplier_name || "Fornecedor nao identificado").trim();
    totals.set(label, (totals.get(label) || 0) + amount);
  }

  const total = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
  if (!total) return [];

  return Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([label, value]) => ({
      label,
      value: Math.max(1, Math.round((value / total) * 100)),
    }));
}

function buildUpcomingPayments(payments: FluigDashboardRow[]) {
  return payments
    .filter((row) => isOpenFluigRequest(row) && isUpcoming(row.due_date))
    .sort((left, right) => new Date(left.due_date || 0).getTime() - new Date(right.due_date || 0).getTime())
    .slice(0, 6)
    .map((row) => [
      formatDate(row.due_date),
      row.supplier_name || "Fornecedor nao identificado",
      formatMoneyFromCents(row.amount_cents),
      row.due_date && isBeforeToday(row.due_date) ? "VENCIDO" : "PENDENTE",
    ]);
}

function buildRecentActivities(jobs: FluigJobDashboardRow[]) {
  return jobs.slice(0, 6).map((job) => {
    const status = job.status === "success" ? "concluiu" : job.status === "error" ? "falhou em" : "atualizou";
    const detail = job.error_message || job.progress_label || operationLabel(job.operation);
    return `${moduleLabel(job.module_slug)} ${status} ${operationLabel(job.operation)} - ${detail}`;
  });
}

async function loadSupplierSummary(actor: AppActor) {
  const client = getSupabaseServiceClient();
  if (!client) return { activeSuppliers: 0, suppliersPendingReview: 0 };

  const { data, error } = await client
    .from("app_suppliers")
    .select("id,status,sync_status")
    .is("deleted_at", null)
    .limit(5000);
  if (error) throwDashboardQueryError("fornecedores", error);

  const rows = (data || []) as SupplierDashboardRow[];
  const supplierIds = rows.map((row) => row.id);
  let linksBySupplier = new Map<string, SupplierBranchLinkRow[]>();

  if (!actor.isAdmin && supplierIds.length) {
    const linkResults = await Promise.all(
      chunksOf(supplierIds, 100).map((supplierIdBatch) =>
        client
          .from("app_supplier_branch_links")
          .select("supplier_id,branch:app_branches(code)")
          .in("supplier_id", supplierIdBatch)
      )
    );
    const linkRows: SupplierBranchLinkRow[] = [];

    for (const result of linkResults) {
      if (result.error) throwDashboardQueryError("filiais dos fornecedores", result.error);
      linkRows.push(...((result.data || []) as unknown as SupplierBranchLinkRow[]));
    }

    linksBySupplier = linkRows.reduce((map, link) => {
      map.set(link.supplier_id, [...(map.get(link.supplier_id) || []), link]);
      return map;
    }, new Map<string, SupplierBranchLinkRow[]>());
  }

  const visibleRows = rows.filter((row) => supplierVisibleForActor(actor, row.id, linksBySupplier));

  return {
    activeSuppliers: visibleRows.filter((row) => row.status === "ATIVO").length,
    suppliersPendingReview: visibleRows.filter(
      (row) => row.status === "PENDENTE_REVISAO" || row.sync_status === "PENDENTE_REVISAO"
    ).length,
  };
}

async function loadMaintenanceSummary(actor: AppActor) {
  const client = getSupabaseServiceClient();
  if (!client) return { maintenanceOpen: 0, maintenanceOverdue: 0 };

  const { data, error } = await client
    .from("app_maintenance_orders")
    .select("id,status,due_at,branch_code,created_by_user_id,requester_user_id,technician_user_id")
    .is("deleted_at", null)
    .limit(5000);
  if (error) throwDashboardQueryError("ordens de manutencao", error);

  const visibleRows = ((data || []) as MaintenanceDashboardRow[]).filter((row) =>
    maintenanceVisibleForActor(actor, row)
  );
  const openRows = visibleRows.filter((row) => row.status !== "FINALIZADA" && row.status !== "CANCELADA");

  return {
    maintenanceOpen: openRows.length,
    maintenanceOverdue: openRows.filter((row) => isBeforeToday(row.due_at)).length,
  };
}

async function loadFluigRows(actor: AppActor) {
  const client = getSupabaseServiceClient();
  if (!client) return [] as FluigDashboardRow[];

  let query = client
    .from("fluig_requests")
    .select(
      [
        "id",
        "module_slug",
        "status",
        "normalized_status",
        "is_open",
        "due_date",
        "opened_at",
        "last_synced_at",
        "branch_code",
        "created_by_user_id",
        "fluig_requester_login",
        "fluig_requester_code",
        "requester",
        "sync_owner_user_id",
        "supplier_name",
        "amount_cents",
        "current_task",
        "task_owner",
      ].join(",")
    )
    .order("last_synced_at", { ascending: false, nullsFirst: false })
    .limit(5000);
  const actorFilter = buildFluigActorPostgrestFilter(actor);
  if (actorFilter) query = query.or(actorFilter);

  const { data, error } = await query;
  if (error) throwDashboardQueryError("solicitacoes Fluig", error);

  const rows = (data || []) as unknown as FluigDashboardRow[];
  return filterRowsForActor(actor, rows);
}

async function loadRecentJobs(actor: AppActor) {
  const client = getSupabaseServiceClient();
  if (!client) return [] as FluigJobDashboardRow[];

  let query = client
    .from("fluig_jobs")
    .select("module_slug,operation,status,progress_label,error_message,updated_at")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(8);

  if (!actor.isAdmin) {
    query = query.eq("requested_by_user_id", actor.id);
  }

  const { data, error } = await query;
  if (error) throwDashboardQueryError("jobs Fluig", error);
  return (data || []) as FluigJobDashboardRow[];
}

export async function getDashboardOverviewData(actor: AppActor): Promise<DashboardOverviewData> {
  const status = getSupabaseServiceStatus();
  if (!status.configured) {
    return {
      ...emptyDashboardOverviewData,
      warnings: [`Supabase service role nao configurado. Faltando: ${status.missing.join(", ")}`],
    };
  }

  const [fluigRows, supplierSummary, maintenanceSummary, recentJobs] = await Promise.all([
    loadFluigRows(actor),
    loadSupplierSummary(actor),
    loadMaintenanceSummary(actor),
    loadRecentJobs(actor),
  ]);

  const openRows = fluigRows.filter(isOpenFluigRequest);
  const payments = fluigRows.filter((row) => row.module_slug === "pagamentos");
  const openPayments = payments.filter(isOpenFluigRequest);
  const openMaintenanceFluig = openRows.filter((row) => row.module_slug === "manutencao");
  const overdueTaskRows = openRows.filter((row) => row.current_task && isBeforeToday(row.due_date));

  return {
    paymentsThisMonth: payments.filter((row) => isCurrentMonth(row.opened_at || row.last_synced_at)).length,
    paymentsOpen: openPayments.length,
    paymentsOverdue: openPayments.filter((row) => isBeforeToday(row.due_date)).length,
    maintenanceOpen: maintenanceSummary.maintenanceOpen + openMaintenanceFluig.length,
    maintenanceOverdue: maintenanceSummary.maintenanceOverdue,
    tasksOverdue: overdueTaskRows.length,
    activeSuppliers: supplierSummary.activeSuppliers,
    suppliersPendingReview: supplierSummary.suppliersPendingReview,
    openFluigRequests: openRows.length,
    chartRows: buildChartRows(payments),
    upcomingPayments: buildUpcomingPayments(payments),
    recentActivities: buildRecentActivities(recentJobs),
    warnings: [],
  };
}
