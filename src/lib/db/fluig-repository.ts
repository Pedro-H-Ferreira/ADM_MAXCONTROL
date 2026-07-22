import type { SupabaseClient } from "@supabase/supabase-js";
import { filterRowsForActor, fluigModuleSlugsForActor, type AppActor } from "@/lib/db/app-repository";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";
import type { FluigHistoryItem, FluigStatusItem } from "@/lib/fluig/server-client";
import type {
  FluigCatalogItem,
  FluigCatalogType,
  FluigExampleRequest,
  FluigLaunchTemplate,
  FluigModuleSlug,
  FluigSupplierMatch,
  FluigSyncRow,
} from "@/lib/fluig-data";
import type { FluigProcessMap } from "@/lib/fluig/process-map";
import { normalizeFluigBranch } from "@/lib/fluig-branch";
import { buildFluigActorPostgrestFilter } from "@/lib/fluig-visibility";

type JsonRecord = Record<string, unknown>;

type FluigRequestDbRow = {
  id: string;
  module_slug: FluigModuleSlug;
  adm_reference: string | null;
  process_id: string | null;
  fluig_request_id: string | null;
  status: string | null;
  current_task: string | null;
  task_owner: string | null;
  requester: string | null;
  branch_code: string | null;
  branch_label: string | null;
  created_by_user_id: string | null;
  fluig_requester_login: string | null;
  fluig_requester_code: string | null;
  supplier_name: string | null;
  supplier_cnpj: string | null;
  amount_cents: number | null;
  currency: string | null;
  due_date: string | null;
  expense_nature?: string | null;
  opened_at: string | null;
  last_synced_at: string | null;
  is_open?: boolean | null;
  normalized_status?: string | null;
  last_status_check_at?: string | null;
  last_seen_in_user_open_list_at?: string | null;
  open_task_fluig_user_id?: string | null;
  my_request_fluig_user_id?: string | null;
  last_seen_in_user_task_list_at?: string | null;
  last_seen_in_user_request_list_at?: string | null;
  sync_owner_user_id?: string | null;
  sync_source?: string | null;
  source_url?: string | null;
  raw_payload?: JsonRecord;
};

type FluigRequestUserMembershipDbRow = {
  fluig_user_id: string;
  membership_type: "open_task" | "my_request";
  last_seen_at: string;
  request: FluigRequestDbRow | FluigRequestDbRow[];
};

type FluigSupplierCandidateDbRow = {
  supplier_name: string;
  cnpj: string | null;
  fluig_name: string | null;
  confidence: number | string | null;
  source_request_ids: string[] | null;
  suggested_defaults: JsonRecord;
  status: string | null;
};

type FluigCatalogDbRow = {
  id: string;
  catalog_type: FluigCatalogType;
  module_slug: FluigModuleSlug | null;
  code: string | null;
  label: string;
  value: string;
  occurrence_count: number | null;
  last_seen_at: string | null;
  source_request_id: string | null;
  metadata: JsonRecord | null;
};

const fluigCatalogSelect =
  "id,catalog_type,module_slug,code,label,value,occurrence_count,last_seen_at,source_request_id,metadata";

type FluigCatalogCandidate = {
  catalogKey: string;
  catalogType: FluigCatalogType;
  moduleSlug: FluigModuleSlug | null;
  code: string | null;
  label: string;
  value: string;
  normalizedLabel: string;
  occurrenceCount: number;
  sourceRequestId: string | null;
  metadata: JsonRecord;
};

export type PersistenceResult = {
  configured: boolean;
  saved: Record<string, number>;
  errors: string[];
};

export type FluigSupplierCandidate = {
  candidateKey: string;
  supplierName: string;
  normalizedName: string;
  cnpj: string | null;
  fluigName: string | null;
  fluigCode: string | null;
  confidence: number;
  sourceRequestIds: string[];
  suggestedDefaults: JsonRecord;
  sourcePayload: JsonRecord;
};

type SupplierCnpjRow = {
  id: string;
  cnpj_normalizado: string | null;
};

const fluigRequestSelect = [
  "id",
  "module_slug",
  "adm_reference",
  "process_id",
  "fluig_request_id",
  "status",
  "current_task",
  "task_owner",
  "requester",
  "branch_code",
  "branch_label",
  "created_by_user_id",
  "fluig_requester_login",
  "fluig_requester_code",
  "supplier_name",
  "supplier_cnpj",
  "amount_cents",
  "currency",
  "due_date",
  "expense_nature",
  "opened_at",
  "last_synced_at",
  "is_open",
  "normalized_status",
  "last_status_check_at",
  "last_seen_in_user_open_list_at",
  "open_task_fluig_user_id",
  "my_request_fluig_user_id",
  "last_seen_in_user_task_list_at",
  "last_seen_in_user_request_list_at",
  "sync_owner_user_id",
  "sync_source",
  "source_url",
  "raw_payload",
].join(",");

const fluigRequestSummarySelect = [
  "id",
  "module_slug",
  "adm_reference",
  "process_id",
  "fluig_request_id",
  "status",
  "current_task",
  "task_owner",
  "requester",
  "branch_code",
  "branch_label",
  "created_by_user_id",
  "fluig_requester_login",
  "fluig_requester_code",
  "supplier_name",
  "supplier_cnpj",
  "amount_cents",
  "currency",
  "due_date",
  "expense_nature",
  "opened_at",
  "last_synced_at",
  "is_open",
  "normalized_status",
  "last_status_check_at",
  "last_seen_in_user_open_list_at",
  "open_task_fluig_user_id",
  "my_request_fluig_user_id",
  "last_seen_in_user_task_list_at",
  "last_seen_in_user_request_list_at",
  "sync_owner_user_id",
  "sync_source",
  "source_url",
  "raw_payload",
].join(",");

function emptyResult(): PersistenceResult {
  return {
    configured: getSupabaseServiceStatus().configured,
    saved: {},
    errors: getSupabaseServiceStatus().missing.map((item) => `Env ausente: ${item}`),
  };
}

function digitsOnly(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeName(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

export function normalizeFluigRequestLifecycle(
  status: unknown,
  observedAt: string,
  active?: boolean | null
) {
  const normalized = normalizeName(status);
  const canceled = normalized.includes("CANCEL");
  const finalized =
    !canceled &&
    (normalized.includes("FINALIZ") ||
      normalized.includes("CONCLUID") ||
      normalized.includes("ENCERRAD") ||
      normalized.includes("FECHAD") ||
      normalized === "COMPLETED" ||
      normalized === "DONE" ||
      active === false);
  const open =
    !canceled &&
    !finalized &&
    (active === true ||
      normalized === "OPEN" ||
      normalized.includes("ABERT") ||
      normalized.includes("ANDAMENTO") ||
      normalized.includes("PENDENT"));

  if (canceled) {
    return {
      normalizedStatus: "cancelado" as const,
      isOpen: false,
      finalizedAt: null,
      closedAt: observedAt,
      canceledAt: observedAt,
    };
  }

  if (finalized) {
    return {
      normalizedStatus: "finalizado" as const,
      isOpen: false,
      finalizedAt: observedAt,
      closedAt: observedAt,
      canceledAt: null,
    };
  }

  if (open) {
    return {
      normalizedStatus: "em_andamento" as const,
      isOpen: true,
      finalizedAt: null,
      closedAt: null,
      canceledAt: null,
    };
  }

  return {
    normalizedStatus: null,
    isOpen: null,
    finalizedAt: null,
    closedAt: null,
    canceledAt: null,
  };
}

function normalizedLifecycleTimestamp(value: unknown, fallback: string) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function parseMoneyToCents(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function parseDateOnly(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const ptBr = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (ptBr) return `${ptBr[3]}-${ptBr[2]}-${ptBr[1]}`;

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function formatCnpj(value: unknown) {
  const digits = digitsOnly(value);
  if (digits.length !== 14) return digits || "-";
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function normalizedCnpjList(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((value) => digitsOnly(value))
        .filter((value) => value.length === 14)
    )
  );
}

function mapFluigRequestRecord(row: FluigRequestDbRow) {
  const formFields = formFieldsFromPayload(row.raw_payload || {});
  return {
    id: row.id,
    module: row.module_slug,
    fluigRequestId: row.fluig_request_id || "",
    admReference: row.adm_reference,
    status: row.status,
    normalizedStatus: row.normalized_status || null,
    isOpen: row.is_open,
    currentTask: row.current_task,
    taskOwner: row.task_owner,
    requester: row.requester,
    branchCode: row.branch_code,
    branchLabel: row.branch_label,
    supplierName: row.supplier_name,
    supplierCnpj: row.supplier_cnpj,
    invoiceNumber: firstStringField(formFields, ["nNotaFiscal", "numeroNF", "notaFiscal", "numNota", "numeroNota"]) || null,
    invoiceDueDate: firstStringField(formFields, ["vencPagNota", "vencimentoNF", "dataVencimentoNF"]) || null,
    amountCents: row.amount_cents,
    currency: row.currency || "BRL",
    dueDate: row.due_date,
    expenseNature: row.expense_nature || null,
    sourceUrl: row.source_url || null,
    openedAt: row.opened_at,
    lastSyncedAt: row.last_synced_at,
    lastStatusCheckAt: row.last_status_check_at || null,
    lastSeenInUserOpenListAt: row.last_seen_in_user_open_list_at || null,
    syncOwnerUserId: row.sync_owner_user_id || null,
    syncSource: row.sync_source || null,
    assignedFluigUserId: null as string | null,
    membershipType: null as "open_task" | "my_request" | null,
    membershipLastSeenAt: null as string | null,
  };
}

export async function listFluigRequestsForActor(input: {
  actor: AppActor;
  module: FluigModuleSlug;
  page?: number;
  pageSize?: number;
  search?: string | null;
  status?: string | null;
  branch?: string | null;
  nature?: string | null;
  open?: boolean | null;
  overdue?: boolean;
  errorOnly?: boolean;
}) {
  return runWithDb(async (client) => {
    const allowedModules = new Set(fluigModuleSlugsForActor(input.actor));
    const page = Math.max(1, Number(input.page || 1));
    const pageSize = Math.min(Math.max(Number(input.pageSize || 30), 1), 100);
    if (!allowedModules.has(input.module)) return { page, pageSize, total: 0, items: [] };
    let query = client
      .from("fluig_requests")
      .select(fluigRequestSummarySelect, { count: "exact" })
      .eq("module_slug", input.module)
      .not("fluig_request_id", "is", null)
      .order("last_status_check_at", { ascending: false, nullsFirst: false })
      .order("last_synced_at", { ascending: false, nullsFirst: false });
    const actorFilter = buildFluigActorPostgrestFilter(input.actor);
    if (actorFilter) query = query.or(actorFilter);
    if (input.open != null) query = query.eq("is_open", input.open);
    if (input.status) query = query.ilike("normalized_status", input.status);
    if (input.branch) query = query.eq("branch_code", input.branch);
    if (input.nature) query = query.eq("expense_nature", input.nature);
    if (input.overdue) query = query.eq("is_open", true).lt("due_date", new Date().toISOString());
    if (input.errorOnly) {
      query = query.in("normalized_status", ["erro", "error", "falha", "failed", "cancelado", "cancelled"]);
    }
    const search = String(input.search || "").replace(/[%_,()]/g, " ").trim();
    if (search) {
      const pattern = `%${search}%`;
      query = query.or(`fluig_request_id.ilike.${pattern},adm_reference.ilike.${pattern},supplier_name.ilike.${pattern},supplier_cnpj.ilike.${pattern},requester.ilike.${pattern},current_task.ilike.${pattern},task_owner.ilike.${pattern},raw_payload->formFields->>nNotaFiscal.ilike.${pattern}`);
    }
    const from = (page - 1) * pageSize;
    const { data, error, count } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    const visible = filterRowsForActor(input.actor, (data || []) as unknown as FluigRequestDbRow[]).map(mapFluigRequestRecord);
    return { page, pageSize, total: count || 0, items: visible };
  }).then(({ result, persistence }) => ({ ...(result || { page: 1, pageSize: 30, total: 0, items: [] }), persistence }));
}

function compareOpenRequestPriority(left: FluigRequestDbRow, right: FluigRequestDbRow) {
  const leftStatusCheck = left.last_status_check_at ? Date.parse(left.last_status_check_at) : Number.NEGATIVE_INFINITY;
  const rightStatusCheck = right.last_status_check_at ? Date.parse(right.last_status_check_at) : Number.NEGATIVE_INFINITY;
  if (leftStatusCheck !== rightStatusCheck) return leftStatusCheck - rightStatusCheck;

  const leftSynced = left.last_synced_at ? Date.parse(left.last_synced_at) : 0;
  const rightSynced = right.last_synced_at ? Date.parse(right.last_synced_at) : 0;
  return rightSynced - leftSynced;
}

async function linkFluigRequestsToKnownSuppliersForCnpjs(client: SupabaseClient, cnpjs: unknown[]) {
  const normalizedCnpjs = normalizedCnpjList(cnpjs);
  if (!normalizedCnpjs.length) return 0;

  const { data: suppliers, error: suppliersError } = await client
    .from("app_suppliers")
    .select("id,cnpj_normalizado")
    .in("cnpj_normalizado", normalizedCnpjs)
    .is("deleted_at", null);
  if (suppliersError) throw suppliersError;

  let linked = 0;
  for (const supplier of (suppliers || []) as SupplierCnpjRow[]) {
    const cnpj = digitsOnly(supplier.cnpj_normalizado);
    if (cnpj.length !== 14) continue;
    const variants = Array.from(new Set([cnpj, formatCnpj(cnpj)]));
    const { count, error } = await client
      .from("fluig_requests")
      .update({ app_supplier_id: supplier.id }, { count: "exact" })
      .in("supplier_cnpj", variants)
      .or(`app_supplier_id.is.null,app_supplier_id.eq.${supplier.id}`);
    if (error) throw error;
    linked += count || 0;
  }

  return linked;
}

function formatMoneyFromCents(value: number | null) {
  if (typeof value !== "number") return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeStatus(value: unknown, fallback = "SINCRONIZADO") {
  const raw = String(value || fallback).trim();
  return raw ? raw.toUpperCase().replace(/[\s-]+/g, "_") : fallback;
}

function formFieldsFromPayload(payload: JsonRecord) {
  const formFields = payload.formFields;
  return formFields && typeof formFields === "object" && !Array.isArray(formFields)
    ? (formFields as Record<string, string>)
    : {};
}

function stringField(fields: Record<string, string>, fieldName: string) {
  return String(fields[fieldName] ?? "").trim();
}

function firstStringField(fields: Record<string, string>, fieldNames: string[]) {
  for (const fieldName of fieldNames) {
    const value = stringField(fields, fieldName);
    if (value) return value;
  }

  return "";
}

function suggestedDefaultString(value: unknown, label: string) {
  const raw = String(value ?? "").trim();
  return raw ? `${label} = ${raw}` : null;
}

function cleanCatalogLabel(value: unknown) {
  const raw = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!raw || raw === "-" || /^\[object/i.test(raw)) return "";
  return raw;
}

function extractLeadingCode(value: unknown) {
  const label = cleanCatalogLabel(value);
  if (!label) return null;
  const match = label.match(/^([A-Za-z0-9._-]+)\s*(?:-|\/|\s)/);
  return match?.[1]?.trim() || null;
}

function catalogKey(input: Pick<FluigCatalogCandidate, "catalogType" | "moduleSlug" | "code" | "normalizedLabel">) {
  return [input.catalogType, input.moduleSlug || "*", input.code || "*", input.normalizedLabel].join(":");
}

function extractBranchLabel(fields: Record<string, string>) {
  return normalizeFluigBranch({
    label: fields.unidadeFilial || fields.filial || fields.filialOrigem || fields.filialDestino,
    explicitCode: fields.codigoFilial || fields.codFilial || fields.branchCode,
  }).label || "";
}

function extractBranchCode(fields: Record<string, string>) {
  return normalizeFluigBranch({
    label: fields.unidadeFilial || fields.filial || fields.filialOrigem || fields.filialDestino,
    explicitCode: fields.codigoFilial || fields.codFilial || fields.branchCode,
  }).code;
}

function mapRequestRowToSyncRow(row: FluigRequestDbRow): FluigSyncRow {
  const fields = formFieldsFromPayload(row.raw_payload || {});
  const fluigStatus = normalizeStatus(row.status);

  return {
    id: row.id,
    module: row.module_slug,
    admReference: row.adm_reference || fields.numeroSolicitacao || fields.codigoPedido || "-",
    fluigNumber: row.fluig_request_id || "-",
    branch: row.branch_label || fields.unidadeFilial || row.branch_code || "-",
    branchCode: row.branch_code || undefined,
    supplier: row.supplier_name || fields.fornecedorC || fields.fornecedor || "Fornecedor nao identificado",
    cnpj: formatCnpj(row.supplier_cnpj || fields.codCNPJ || fields.cnpj),
    amount: formatMoneyFromCents(row.amount_cents),
    currentTask: row.current_task || "Etapa nao sincronizada",
    taskOwner: row.task_owner || row.requester || "-",
    fluigStatus,
    actionRequired: fluigStatus.includes("CANCEL")
      ? "Solicitacao cancelada no Fluig"
      : row.current_task
        ? "Acompanhar etapa atual"
        : "Consultar status atualizado no Fluig",
    updatedAt: formatDateTime(row.last_synced_at || row.opened_at),
  };
}

function mapRequestRowToExample(row: FluigRequestDbRow): FluigExampleRequest {
  const fields = formFieldsFromPayload(row.raw_payload || {});
  const defaults = [
    suggestedDefaultString(fields.formaPagamento, "formaPagamento"),
    suggestedDefaultString(fields.codigonaturezaC || fields.naturezaSalva, "natureza"),
    suggestedDefaultString(fields.unidadeFilial, "unidadeFilial"),
    suggestedDefaultString(fields.centroCusto || fields.codCentroCusto, "centroCusto"),
  ].filter(Boolean) as string[];

  return {
    id: row.fluig_request_id || row.id,
    title: `Solicitacao real Fluig ${row.fluig_request_id || row.id}`,
    processId: row.process_id || "Processo Fluig",
    source: "Historico real sincronizado no Supabase",
    openedBy: row.requester || "Fluig",
    status: normalizeStatus(row.status, "HISTORICO_REAL"),
    notes: "Registro sincronizado do Fluig para servir como referencia de preenchimento nesta pagina.",
    stableDefaults: defaults,
    variableFields: Object.keys(fields).slice(0, 12),
    payloadPreview: {
      fornecedorC: fields.fornecedorC || fields.fornecedor || row.supplier_name || "-",
      codCNPJ: formatCnpj(fields.codCNPJ || row.supplier_cnpj),
      unidadeFilial: fields.unidadeFilial || "-",
      valorNF: fields.valorNF || fields.valorNFT || formatMoneyFromCents(row.amount_cents),
    },
  };
}

function mapSupplierCandidateToMatch(row: FluigSupplierCandidateDbRow): FluigSupplierMatch {
  const confidence = Number(row.confidence ?? 0);
  const sourceRequestIds = Array.isArray(row.source_request_ids) ? row.source_request_ids : [];
  const suggestedSource = String(row.suggested_defaults?.sourceRequestId || "").trim();

  return {
    supplier: row.supplier_name,
    cnpj: formatCnpj(row.cnpj),
    fluigName: row.fluig_name || "Nao informado",
    previousRequest: sourceRequestIds[0] || suggestedSource || "-",
    confidence: `${Math.round((Number.isFinite(confidence) ? confidence : 0) * 100)}%`,
    status: normalizeStatus(row.status, "PRE_CADASTRO"),
  };
}

function mapCatalogRow(row: FluigCatalogDbRow): FluigCatalogItem {
  return {
    id: row.id,
    catalogType: row.catalog_type,
    moduleSlug: row.module_slug,
    code: row.code,
    label: row.label,
    value: row.value,
    occurrenceCount: Number(row.occurrence_count || 0),
    lastSeenAt: row.last_seen_at || new Date().toISOString(),
    sourceRequestId: row.source_request_id,
    metadata: row.metadata || {},
  };
}

function metadataString(metadata: JsonRecord | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function catalogDedupeKey(item: FluigCatalogItem) {
  const metadataCnpj = digitsOnly(metadataString(item.metadata, "cnpj"));
  const labelTaxId = extractSupplierTaxId(item.label || item.value);
  const code = String(item.code || "").trim();

  if (item.catalogType === "supplier") {
    const supplierTaxId = metadataCnpj || labelTaxId || (digitsOnly(code).length >= 11 ? digitsOnly(code) : "");
    if (supplierTaxId) return `supplier:${supplierTaxId}`;
  }

  if (item.catalogType === "branch" && code) {
    return `branch:${code}`;
  }

  if (code) {
    return `${item.catalogType}:${item.moduleSlug || "*"}:${code}`;
  }

  return `${item.catalogType}:${item.moduleSlug || "*"}:${normalizeName(item.value || item.label)}`;
}

function latestTimestamp(left: string | null | undefined, right: string | null | undefined) {
  const leftTime = left ? new Date(left).getTime() : 0;
  const rightTime = right ? new Date(right).getTime() : 0;
  return Math.max(Number.isNaN(leftTime) ? 0 : leftTime, Number.isNaN(rightTime) ? 0 : rightTime);
}

function mergeCatalogItem(current: FluigCatalogItem, incoming: FluigCatalogItem): FluigCatalogItem {
  const incomingIsNewer = latestTimestamp(incoming.lastSeenAt, null) >= latestTimestamp(current.lastSeenAt, null);
  const preferred = incoming.occurrenceCount > current.occurrenceCount || incomingIsNewer ? incoming : current;

  return {
    ...preferred,
    occurrenceCount: current.occurrenceCount + incoming.occurrenceCount,
    lastSeenAt: new Date(latestTimestamp(current.lastSeenAt, incoming.lastSeenAt)).toISOString(),
    sourceRequestId: incomingIsNewer ? incoming.sourceRequestId : current.sourceRequestId,
    metadata: {
      ...current.metadata,
      ...incoming.metadata,
    },
  };
}

function dedupeCatalogRows(rows: FluigCatalogItem[]) {
  const grouped = new Map<string, FluigCatalogItem>();

  for (const item of rows) {
    const key = catalogDedupeKey(item);
    const current = grouped.get(key);
    grouped.set(key, current ? mergeCatalogItem(current, item) : item);
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
    return a.label.localeCompare(b.label);
  });
}

function groupCatalogItems(rows: FluigCatalogItem[]) {
  return dedupeCatalogRows(rows).reduce<Partial<Record<FluigCatalogType, FluigCatalogItem[]>>>((acc, item) => {
    acc[item.catalogType] = [...(acc[item.catalogType] || []), item];
    return acc;
  }, {});
}

function supplierMatchDedupeKey(item: FluigSupplierMatch) {
  const cnpj = digitsOnly(item.cnpj);
  if (cnpj && cnpj !== "-") return cnpj;
  return normalizeName(item.fluigName || item.supplier);
}

function dedupeSupplierMatches(rows: FluigSupplierMatch[]) {
  const grouped = new Map<string, FluigSupplierMatch>();

  for (const item of rows) {
    const key = supplierMatchDedupeKey(item);
    const current = grouped.get(key);
    if (!current || Number.parseInt(item.confidence, 10) > Number.parseInt(current.confidence, 10)) {
      grouped.set(key, item);
    }
  }

  return Array.from(grouped.values()).sort((a, b) => a.supplier.localeCompare(b.supplier));
}

function extractSupplierCode(rawSupplier: unknown) {
  const first = String(rawSupplier ?? "").trim().split(" - ")[0] || "";
  return digitsOnly(first) || null;
}

function extractSupplierTaxId(rawSupplier: unknown) {
  const chunks = String(rawSupplier ?? "").match(/\d[\d./-]{10,24}/g) || [];
  for (const chunk of chunks) {
    const digits = digitsOnly(chunk);
    if (digits.length === 11 || digits.length === 14) return digits;
  }
  return "";
}

function supplierFromFields(fields: Record<string, string>) {
  const raw =
    fields.fornecedorC ||
    fields.fornecedor ||
    fields.nomeFornecedor ||
    fields.razaoSocial ||
    fields.prestador ||
    fields.fornecedorBruto ||
    "";
  const cnpj = digitsOnly(fields.codCNPJ || fields.cnpj || fields.CNPJ || extractSupplierTaxId(raw));

  return {
    raw: String(raw || "").trim(),
    name: String(raw || "").trim(),
    code: extractSupplierCode(raw),
    cnpj: cnpj || null,
  };
}

function addCatalogCandidate(
  grouped: Map<string, FluigCatalogCandidate>,
  input: {
    catalogType: FluigCatalogType;
    moduleSlug: FluigModuleSlug | null;
    label: unknown;
    code?: unknown;
    value?: unknown;
    sourceRequestId?: string | null;
    metadata?: JsonRecord;
  }
) {
  const label = cleanCatalogLabel(input.label);
  if (!label) return;

  const normalizedLabel = normalizeName(label);
  if (!normalizedLabel) return;

  const code = cleanCatalogLabel(input.code) || extractLeadingCode(label);
  const item: FluigCatalogCandidate = {
    catalogKey: catalogKey({
      catalogType: input.catalogType,
      moduleSlug: input.moduleSlug,
      code,
      normalizedLabel,
    }),
    catalogType: input.catalogType,
    moduleSlug: input.moduleSlug,
    code,
    label,
    value: cleanCatalogLabel(input.value) || label,
    normalizedLabel,
    occurrenceCount: 1,
    sourceRequestId: input.sourceRequestId || null,
    metadata: input.metadata || {},
  };

  const current = grouped.get(item.catalogKey);
  grouped.set(item.catalogKey, current ? { ...current, occurrenceCount: current.occurrenceCount + 1 } : item);
}

const catalogFieldMap: Record<
  FluigCatalogType,
  {
    moduleScoped: boolean;
    fields: string[];
  }
> = {
  supplier: {
    moduleScoped: false,
    fields: ["fornecedorC", "fornecedor", "nomeFornecedor", "razaoSocial", "prestador", "fornecedorBruto"],
  },
  branch: {
    moduleScoped: false,
    fields: ["unidadeFilial", "filial", "filialOrigem", "filialDestino", "codFilialPedido", "codigoFilial", "codFilial"],
  },
  natureza: {
    moduleScoped: true,
    fields: ["codigonaturezaC", "naturezaSalva", "natureza", "codNatureza", "categoriaFinanceira", "categoria"],
  },
  cost_center: {
    moduleScoped: true,
    fields: ["centroCusto", "codCentroCusto", "centroDeCusto", "ccusto", "codCCusto"],
  },
  payment_method: {
    moduleScoped: true,
    fields: ["formaPagamento", "tipoPagamento", "meioPagamento"],
  },
  account: {
    moduleScoped: true,
    fields: ["contaCentroCusto", "contaContabil", "conta", "planoConta", "tipoTransacao", "tipoSolicitacao"],
  },
};

function addMappedCatalogs(
  grouped: Map<string, FluigCatalogCandidate>,
  module: FluigModuleSlug,
  item: FluigHistoryItem,
  metadata: JsonRecord
) {
  const fields = item.formFields || {};

  for (const [catalogType, config] of Object.entries(catalogFieldMap) as Array<
    [FluigCatalogType, (typeof catalogFieldMap)[FluigCatalogType]]
  >) {
    for (const fieldName of config.fields) {
      addCatalogCandidate(grouped, {
        catalogType,
        moduleSlug: config.moduleScoped ? module : null,
        label: fields[fieldName],
        sourceRequestId: item.processInstanceId,
        metadata: {
          ...metadata,
          fieldName,
        },
      });
    }
  }
}

export function buildFluigCatalogItems(module: FluigModuleSlug, items: FluigHistoryItem[]): FluigCatalogCandidate[] {
  const grouped = new Map<string, FluigCatalogCandidate>();

  for (const item of items) {
    const fields = item.formFields || {};
    const supplier = supplierFromFields(fields);
    const branchLabel = extractBranchLabel(fields);
    const branchCode = extractBranchCode(fields);
    const metadata: JsonRecord = {
      branchCode,
      branchLabel,
      processId: item.processId,
      processVersion: item.processVersion,
      latestRequest: item.processInstanceId,
    };

    if (supplier.name) {
      addCatalogCandidate(grouped, {
        catalogType: "supplier",
        moduleSlug: null,
        label: supplier.name,
        code: supplier.code,
        value: supplier.raw || supplier.name,
        sourceRequestId: item.processInstanceId,
        metadata: {
          ...metadata,
          cnpj: supplier.cnpj,
          fluigName: supplier.raw,
        },
      });
    }

    if (branchLabel) {
      addCatalogCandidate(grouped, {
        catalogType: "branch",
        moduleSlug: null,
        label: branchLabel,
        code: branchCode,
        sourceRequestId: item.processInstanceId,
        metadata,
      });
    }

    addMappedCatalogs(grouped, module, item, metadata);
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
    return a.label.localeCompare(b.label);
  });
}

function monthKey(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function templateDefaultFields(module: FluigModuleSlug, fields: Record<string, string>) {
  const paymentFields = [
    "fornecedorC",
    "codCNPJ",
    "unidadeFilial",
    "centroCusto",
    "codCentroCusto",
    "codigonaturezaC",
    "naturezaSalva",
    "formaPagamento",
    "contaCentroCusto",
  ];
  const otherModuleFields = [
    ...paymentFields,
    "codFilialPedido",
    "responsavelPedido",
    "tipoTransacao",
    "filial",
    "filialDestino",
    "zoomDemandaPara",
    "obsFiscal",
  ];
  const keep = module === "pagamentos" ? paymentFields : otherModuleFields;

  return Object.fromEntries(keep.map((fieldName) => [fieldName, fields[fieldName] || ""]).filter(([, value]) => value));
}

function requestTimestamp(row: FluigRequestDbRow) {
  const value = row.opened_at || row.last_synced_at;
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function paymentTemplateFieldsAreComplete(fields: Record<string, string>) {
  return Boolean(
    firstStringField(fields, catalogFieldMap.natureza.fields) &&
      firstStringField(fields, catalogFieldMap.cost_center.fields) &&
      firstStringField(fields, catalogFieldMap.payment_method.fields)
  );
}

function templateBranchKey(row: FluigRequestDbRow, fields: Record<string, string>) {
  return normalizeName(row.branch_code || extractBranchCode(fields) || row.branch_label || extractBranchLabel(fields));
}

export function buildFluigLaunchTemplatesFromRequests(rows: FluigRequestDbRow[]): FluigLaunchTemplate[] {
  const grouped = new Map<
    string,
    {
      rows: FluigRequestDbRow[];
      months: Set<string>;
    }
  >();

  for (const row of rows) {
    const fields = formFieldsFromPayload(row.raw_payload || {});
    const supplier = supplierFromFields(fields);
    const supplierNameKey = normalizeName(row.supplier_name || supplier.name);
    const supplierCnpjKey = digitsOnly(row.supplier_cnpj || supplier.cnpj);
    const branchKey = templateBranchKey(row, fields);
    if (!supplierNameKey || !supplierCnpjKey || !branchKey || !row.fluig_request_id) continue;

    const key = [row.module_slug, supplierNameKey, supplierCnpjKey, branchKey].join(":");
    const current = grouped.get(key) || { rows: [], months: new Set<string>() };
    current.rows.push(row);
    const itemMonth = monthKey(row.opened_at || row.last_synced_at);
    if (itemMonth) current.months.add(itemMonth);
    grouped.set(key, current);
  }

  return Array.from(grouped.entries())
    .map(([key, group]) => {
      const latest = [...group.rows]
        .filter((row) => {
          if (row.module_slug !== "pagamentos") return true;
          return paymentTemplateFieldsAreComplete(formFieldsFromPayload(row.raw_payload || {}));
        })
        .sort((a, b) => requestTimestamp(b) - requestTimestamp(a))[0];
      if (!latest) return null;
      const fields = formFieldsFromPayload(latest.raw_payload || {});
      const supplier = supplierFromFields(fields);
      const supplierName = latest.supplier_name || supplier.name || firstStringField(fields, catalogFieldMap.supplier.fields) || null;
      const sourceRequestId = latest.fluig_request_id || latest.id;

      return {
        id: key,
        module: latest.module_slug,
        title: supplierName ? `Padrao ${supplierName}` : `Modelo ${sourceRequestId}`,
        recurrence: group.months.size >= 2 ? "monthly" : "model",
        sourceRequestId,
        supplierName,
        supplierCnpj: latest.supplier_cnpj || supplier.cnpj,
        branchCode: latest.branch_code || extractBranchCode(fields),
        branchLabel: latest.branch_label || extractBranchLabel(fields) || null,
        defaultFields: templateDefaultFields(latest.module_slug, fields),
        occurrenceCount: group.rows.length,
        monthCount: group.months.size,
        lastSeenAt: latest.last_synced_at || latest.opened_at,
      } satisfies FluigLaunchTemplate;
    })
    .filter((template): template is FluigLaunchTemplate => Boolean(template))
    .sort((a, b) => {
      if (a.recurrence !== b.recurrence) return a.recurrence === "monthly" ? -1 : 1;
      if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
      return a.title.localeCompare(b.title);
    });
}

function historyRequester(item: FluigHistoryItem, fields: Record<string, string>) {
  const name =
    item.requesterName ||
    firstStringField(fields, ["responsavelEnvio", "nomeColaborador", "colaboradorInput", "nomeSolicitante"]);
  const code =
    item.requesterId ||
    firstStringField(fields, ["matResponsavelEnvio", "matSolicitante", "codigoSolicitante"]);

  return {
    name: name || null,
    code: code || null,
  };
}

export function buildFluigHistoryRequestRow(
  module: FluigModuleSlug,
  item: FluigHistoryItem,
  actor?: Pick<AppActor, "id"> | null
) {
  const fields = item.formFields || {};
  const supplier = supplierFromFields(fields);
  const requester = historyRequester(item, fields);
  const amount =
    parseMoneyToCents(fields.valorNF || fields.valorNFT || fields.valorTotalExibicao || fields.valorPedido || fields.valorTotal) ??
    null;
  const branchLabel = extractBranchLabel(fields);
  const branchCode = extractBranchCode(fields);
  const syncedAt = new Date().toISOString();
  const lifecycleObservedAt = normalizedLifecycleTimestamp(item.endDate || item.raw?.endDate, syncedAt);
  const lifecycle = normalizeFluigRequestLifecycle(item.status, lifecycleObservedAt);

  return {
    module_slug: module,
    adm_reference: fields.numeroSolicitacao || fields.romaneioReferencia || fields.codigoPedido || null,
    process_id: item.processId,
    fluig_request_id: item.processInstanceId,
    source_request_id: null,
    status: item.status || null,
    current_task: null,
    task_owner: null,
    requester: requester.name || requester.code,
    branch_code: branchCode,
    branch_label: branchLabel || null,
    created_by_user_id: actor?.id || null,
    fluig_requester_login: requester.name,
    fluig_requester_code: requester.code,
    supplier_name: supplier.name || null,
    supplier_cnpj: supplier.cnpj,
    amount_cents: amount,
    currency: "BRL",
    due_date: parseDateOnly(fields.vencPagNota || fields.vencimento || fields.dataPrevRetorno),
    expense_nature: firstStringField(fields, catalogFieldMap.natureza.fields) || null,
    opened_at: item.startDate,
    normalized_status: lifecycle.normalizedStatus,
    is_open: lifecycle.isOpen,
    finalized_at: lifecycle.finalizedAt,
    closed_at: lifecycle.closedAt,
    last_synced_at: syncedAt,
    updated_at: syncedAt,
    canceled_at: lifecycle.canceledAt,
    source_url: item.sourceUrl,
    raw_payload: {
      formFields: fields,
      raw: item.raw,
    },
  };
}

export function buildFluigStatusRequestRow(
  module: FluigModuleSlug,
  item: FluigStatusItem,
  options: {
    ownerUserId?: string | null;
    syncSource?: string | null;
    markSeenOpen?: boolean;
    fluigUserId?: string | null;
  } = {},
  existing?: Partial<
    Pick<
      FluigRequestDbRow,
      | "process_id"
      | "status"
      | "current_task"
      | "task_owner"
      | "requester"
      | "fluig_requester_code"
      | "due_date"
      | "expense_nature"
      | "opened_at"
      | "raw_payload"
    >
  > | null
) {
  const checkedAt = item.dataUltimaConsulta || new Date().toISOString();
  const syncedAt = new Date().toISOString();
  const lifecycle = normalizeFluigRequestLifecycle(item.statusProcesso, checkedAt, item.active);
  const open = lifecycle.isOpen === true;
  const currentTask = String(item.etapaAtual || "").trim() || existing?.current_task || null;
  const taskOwner =
    String(item.responsavelAtual || item.responsavelLogin || item.responsavelCodigo || "").trim() ||
    existing?.task_owner ||
    null;
  const syncTypes = Array.isArray(item.syncTypes) ? item.syncTypes : [];
  const fluigUserId = String(item.syncFluigUserId || options.fluigUserId || "").trim() || null;
  const seenAsTask = open && Boolean(fluigUserId) && syncTypes.includes("open_tasks");
  const seenAsRequest = open && Boolean(fluigUserId) && syncTypes.includes("my_requests");

  return {
    module_slug: module,
    process_id: item.processId || existing?.process_id || undefined,
    fluig_request_id: item.numeroFluig,
    status: item.statusProcesso || existing?.status || (item.active === false ? "finalizado" : "em_andamento"),
    current_task: currentTask,
    task_owner: taskOwner,
    requester: item.requesterName || existing?.requester || undefined,
    fluig_requester_code: item.requesterId || existing?.fluig_requester_code || undefined,
    due_date: item.dueDate || item.vencimentoPagamento || existing?.due_date || null,
    expense_nature: existing?.expense_nature || undefined,
    opened_at: item.openedAt || existing?.opened_at || undefined,
    normalized_status: lifecycle.normalizedStatus,
    is_open: lifecycle.isOpen,
    finalized_at: lifecycle.finalizedAt,
    closed_at: lifecycle.closedAt,
    canceled_at: lifecycle.canceledAt,
    last_status_check_at: checkedAt,
    last_seen_in_user_open_list_at: options.markSeenOpen && open ? checkedAt : undefined,
    open_task_fluig_user_id: seenAsTask ? fluigUserId : undefined,
    my_request_fluig_user_id: seenAsRequest ? fluigUserId : undefined,
    last_seen_in_user_task_list_at: seenAsTask ? checkedAt : undefined,
    last_seen_in_user_request_list_at: seenAsRequest ? checkedAt : undefined,
    sync_source: options.syncSource || "status_check",
    sync_owner_user_id: options.ownerUserId || null,
    last_synced_at: checkedAt,
    updated_at: syncedAt,
    raw_payload: {
      ...(existing?.raw_payload || {}),
      statusSnapshot: item as unknown as JsonRecord,
    },
  };
}

async function runWithDb<T>(callback: (client: SupabaseClient) => Promise<T>) {
  const client = getSupabaseServiceClient();

  if (!client) {
    return { result: null, persistence: emptyResult() };
  }

  const persistence: PersistenceResult = { configured: true, saved: {}, errors: [] };

  try {
    const result = await callback(client);
    return { result, persistence };
  } catch (error) {
    persistence.errors.push(error instanceof Error ? error.message : String(error));
    return { result: null, persistence };
  }
}

export async function persistProcessMaps(processMaps: FluigProcessMap[]) {
  return runWithDb(async (client) => {
    const rows = processMaps.map((map) => ({
      module_slug: map.module,
      route: map.route,
      process_id: map.processId,
      process_label: map.processLabel,
      open_url: map.openUrl,
      status: map.status,
      capabilities: map.capabilities,
      mapped_fields: map.mappedFields,
      export_files: map.exportFiles,
      examples: map.defaultSourceRequestIds,
      raw_metadata: {
        processVersions: map.processVersions,
        defaultTaskUserId: map.defaultTaskUserId,
      },
    }));
    const { error } = await client.from("fluig_process_mappings").upsert(rows, { onConflict: "module_slug" });
    if (error) throw error;
    return rows.length;
  }).then(({ result, persistence }) => {
    if (result) persistence.saved.processMappings = result;
    return persistence;
  });
}

export async function persistHistoryItems(module: FluigModuleSlug, items: FluigHistoryItem[], actor?: Pick<AppActor, "id"> | null) {
  return runWithDb(async (client) => {
    const rows = items.map((item) => buildFluigHistoryRequestRow(module, item, actor)).filter((item) => item.fluig_request_id);
    if (!rows.length) return { requests: 0, supplierRequestLinks: 0 };

    const branches = Array.from(
      new Map(
        rows
          .filter((row) => row.branch_code)
          .map((row) => [
            row.branch_code,
            {
              code: row.branch_code,
              name: row.branch_label || row.branch_code,
              fluig_label: row.branch_label || row.branch_code,
              metadata: { source: "fluig_history" },
            },
          ])
      ).values()
    );
    if (branches.length) {
      const { error: branchError } = await client.from("app_branches").upsert(branches, { onConflict: "code" });
      if (branchError) throw branchError;
    }

    const { error } = await client.from("fluig_requests").upsert(rows, { onConflict: "module_slug,fluig_request_id" });
    if (error) throw error;
    const linkedRequests = await linkFluigRequestsToKnownSuppliersForCnpjs(client, rows.map((row) => row.supplier_cnpj));
    return {
      requests: rows.length,
      supplierRequestLinks: linkedRequests,
    };
  }).then(({ result, persistence }) => {
    if (result !== null) {
      persistence.saved.requests = result.requests;
      if (result.supplierRequestLinks) persistence.saved.supplierRequestLinks = result.supplierRequestLinks;
    }
    return persistence;
  });
}

function mergePersistenceResults(...items: PersistenceResult[]): PersistenceResult {
  return {
    configured: items.some((item) => item.configured),
    saved: items.reduce<Record<string, number>>((acc, item) => {
      for (const [key, value] of Object.entries(item.saved)) {
        acc[key] = (acc[key] || 0) + value;
      }
      return acc;
    }, {}),
    errors: items.flatMap((item) => item.errors),
  };
}

export async function persistHistoryItemsInChunks(
  module: FluigModuleSlug,
  items: FluigHistoryItem[],
  actor?: Pick<AppActor, "id"> | null,
  chunkSize = 200
) {
  if (!items.length) {
    return persistHistoryItems(module, items, actor);
  }

  const results: PersistenceResult[] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize);
    const result = await persistHistoryItems(module, chunk, actor);

    if (result.errors.length && chunkSize > 20 && chunk.length > 20) {
      results.push(await persistHistoryItemsInChunks(module, chunk, actor, 20));
    } else {
      results.push(result);
    }
  }

  return mergePersistenceResults(...results);
}

function isKnownHistoryModule(value: unknown): value is FluigModuleSlug {
  return value === "pagamentos" || value === "compras" || value === "manutencao" || value === "fornecedores";
}

function historyItemModule(fallback: FluigModuleSlug, item: FluigHistoryItem) {
  const explicit = (item as FluigHistoryItem & { module?: unknown }).moduleSlug || (item as FluigHistoryItem & { module?: unknown }).module;
  return isKnownHistoryModule(explicit) ? explicit : fallback;
}

export function groupHistoryItemsByModule(fallback: FluigModuleSlug, items: FluigHistoryItem[]) {
  const grouped = new Map<FluigModuleSlug, FluigHistoryItem[]>();

  for (const item of items) {
    const moduleSlug = historyItemModule(fallback, item);
    grouped.set(moduleSlug, [...(grouped.get(moduleSlug) || []), item]);
  }

  return grouped;
}

export async function persistHistoryItemsInChunksByModule(
  fallback: FluigModuleSlug,
  items: FluigHistoryItem[],
  actor?: Pick<AppActor, "id"> | null
) {
  const results: PersistenceResult[] = [];

  for (const [moduleSlug, moduleItems] of groupHistoryItemsByModule(fallback, items)) {
    results.push(await persistHistoryItemsInChunks(moduleSlug, moduleItems, actor));
  }

  return results.length ? mergePersistenceResults(...results) : emptyResult();
}

export function buildFluigCatalogItemsByModule(fallback: FluigModuleSlug, items: FluigHistoryItem[]) {
  return Array.from(groupHistoryItemsByModule(fallback, items)).flatMap(([moduleSlug, moduleItems]) =>
    buildFluigCatalogItems(moduleSlug, moduleItems)
  );
}

export async function persistStatusItems(
  module: FluigModuleSlug,
  items: FluigStatusItem[],
  options: {
    ownerUserId?: string | null;
    syncSource?: string | null;
    markSeenOpen?: boolean;
    fluigUserId?: string | null;
  } = {}
) {
  return runWithDb(async (client) => {
    const statusItems = items.filter(
      (item) => item.numeroFluig && !(item as FluigStatusItem & { error?: unknown }).error
    );
    if (!statusItems.length) return { requests: 0, memberships: 0 };

    const requestIds = Array.from(new Set(statusItems.map((item) => String(item.numeroFluig))));
    const { data: existingRows, error: existingError } = await client
      .from("fluig_requests")
      .select("fluig_request_id,process_id,status,current_task,task_owner,requester,fluig_requester_code,due_date,expense_nature,opened_at,raw_payload")
      .eq("module_slug", module)
      .in("fluig_request_id", requestIds);
    if (existingError) throw existingError;

    const existingByRequestId = new Map(
      ((existingRows || []) as Array<
        Pick<
          FluigRequestDbRow,
          | "fluig_request_id"
          | "process_id"
          | "status"
          | "current_task"
          | "task_owner"
          | "requester"
          | "fluig_requester_code"
          | "due_date"
          | "expense_nature"
          | "opened_at"
          | "raw_payload"
        >
      >).map((row) => [String(row.fluig_request_id || ""), row])
    );
    const rows = statusItems.map((item) =>
      buildFluigStatusRequestRow(module, item, options, existingByRequestId.get(String(item.numeroFluig)))
    );
    if (!rows.length) return { requests: 0, memberships: 0 };
    const { data: savedRequests, error } = await client
      .from("fluig_requests")
      .upsert(rows, { onConflict: "module_slug,fluig_request_id" })
      .select("id,fluig_request_id");
    if (error) throw error;
    const requestIdByFluigId = new Map(
      (savedRequests || []).map((row) => [String(row.fluig_request_id || ""), String(row.id)])
    );
    const membershipRows = statusItems.flatMap((item) => {
      const requestId = requestIdByFluigId.get(String(item.numeroFluig || ""));
      const fluigUserId = String(item.syncFluigUserId || options.fluigUserId || "").trim();
      if (!requestId || !fluigUserId || item.active === false) return [];
      const observedAt = String(item.dataUltimaConsulta || new Date().toISOString());
      const syncTypes = Array.isArray(item.syncTypes) ? item.syncTypes : [];
      return syncTypes.flatMap((syncType) => {
        const membershipType = syncType === "open_tasks"
          ? "open_task"
          : syncType === "my_requests"
            ? "my_request"
            : null;
        return membershipType
          ? [{
              request_id: requestId,
              fluig_user_id: fluigUserId,
              membership_type: membershipType,
              synced_by_user_id: options.ownerUserId || null,
              last_seen_at: observedAt,
              updated_at: new Date().toISOString(),
            }]
          : [];
      });
    });
    if (membershipRows.length) {
      const { error: membershipsError } = await client
        .from("fluig_request_user_memberships")
        .upsert(membershipRows, { onConflict: "request_id,fluig_user_id,membership_type" });
      if (membershipsError) throw membershipsError;
    }
    return { requests: rows.length, memberships: membershipRows.length };
  }).then(({ result, persistence }) => {
    if (result !== null) {
      persistence.saved.requests = result.requests;
      if (result.memberships) persistence.saved.userMemberships = result.memberships;
    }
    return persistence;
  });
}

export async function clearStaleFluigUserTaskMemberships(input: {
  fluigUserId: string;
  syncStartedAt: string;
}) {
  return runWithDb(async (client) => {
    const fluigUserId = String(input.fluigUserId || "").trim();
    if (!fluigUserId || !input.syncStartedAt) return 0;

    const { data: staleMemberships, error: staleMembershipsError } = await client
      .from("fluig_request_user_memberships")
      .delete()
      .eq("fluig_user_id", fluigUserId)
      .lt("last_seen_at", input.syncStartedAt)
      .select("request_id");
    if (staleMembershipsError) throw staleMembershipsError;

    const { data: staleTasks, error: staleTasksError } = await client
      .from("fluig_requests")
      .update({ open_task_fluig_user_id: null, last_seen_in_user_task_list_at: null })
      .eq("open_task_fluig_user_id", fluigUserId)
      .or(`last_seen_in_user_task_list_at.is.null,last_seen_in_user_task_list_at.lt.${input.syncStartedAt}`)
      .select("id");
    if (staleTasksError) throw staleTasksError;

    const { data: staleRequests, error: staleRequestsError } = await client
      .from("fluig_requests")
      .update({ my_request_fluig_user_id: null, last_seen_in_user_request_list_at: null })
      .eq("my_request_fluig_user_id", fluigUserId)
      .or(`last_seen_in_user_request_list_at.is.null,last_seen_in_user_request_list_at.lt.${input.syncStartedAt}`)
      .select("id");
    if (staleRequestsError) throw staleRequestsError;

    return (staleMemberships || []).length + (staleTasks || []).length + (staleRequests || []).length;
  }).then(({ result, persistence }) => {
    if (result !== null) persistence.saved.staleUserMembershipsCleared = result;
    return persistence;
  });
}

export async function readKnownOpenFluigRequestsForActor(input: {
  actor: AppActor;
  module?: FluigModuleSlug | null;
  limit?: number;
  onlyTasks?: boolean;
  membershipType?: "open_task" | "my_request";
  scope?: "self" | "all";
  userId?: string | null;
  nature?: string | null;
}) {
  return runWithDb(async (client) => {
    const allowedModules = new Set(fluigModuleSlugsForActor(input.actor));
    const requestedModules = input.module
      ? ([input.module] satisfies FluigModuleSlug[])
      : (["pagamentos", "compras", "manutencao", "fornecedores"] satisfies FluigModuleSlug[]);
    const modules = requestedModules.filter((moduleSlug) => allowedModules.has(moduleSlug));
    if (!modules.length) return { requests: [], total: 0 };
    const limit = Math.min(Math.max(Number(input.limit || 50), 1), 200);
    const adminAllScope = input.actor.isAdmin && input.scope === "all";
    let targetFluigUserId = adminAllScope ? null : String(input.actor.fluigUserId || "").trim() || null;

    if (adminAllScope && input.userId) {
      const { data: selectedUser, error: selectedUserError } = await client
        .from("app_user_profiles")
        .select("fluig_user_id")
        .eq("id", input.userId)
        .eq("active", true)
        .eq("approval_status", "APPROVED")
        .maybeSingle();
      if (selectedUserError) throw selectedUserError;
      targetFluigUserId = String(selectedUser?.fluig_user_id || "").trim() || null;
      if (!targetFluigUserId) return { requests: [], total: 0 };
    }

    if (targetFluigUserId || adminAllScope) {
      const membershipTypes = input.membershipType
        ? [input.membershipType]
        : input.onlyTasks
          ? ["open_task" as const]
          : (["open_task", "my_request"] as const);
      let membershipQuery = client
        .from("fluig_request_user_memberships")
        .select(
          `fluig_user_id,membership_type,last_seen_at,request:fluig_requests!inner(${fluigRequestSelect})`,
          { count: "exact" }
        )
        .in("membership_type", membershipTypes)
        .eq("request.is_open", true)
        .in("request.module_slug", modules);
      if (targetFluigUserId) membershipQuery = membershipQuery.eq("fluig_user_id", targetFluigUserId);
      if (input.nature) membershipQuery = membershipQuery.eq("request.expense_nature", input.nature);

      const { data, error, count } = await membershipQuery
        .order("last_seen_at", { ascending: false })
        .limit(Math.min(limit * membershipTypes.length, 400));
      if (error) throw error;

      const unique = new Map<string, ReturnType<typeof mapFluigRequestRecord> & {
        assignedFluigUserId: string;
        membershipType: "open_task" | "my_request";
        membershipLastSeenAt: string;
      }>();
      for (const membership of (data || []) as unknown as FluigRequestUserMembershipDbRow[]) {
        const request = Array.isArray(membership.request) ? membership.request[0] : membership.request;
        if (!request) continue;
        const key = `${membership.fluig_user_id}:${request.id}`;
        if (unique.has(key)) continue;
        unique.set(key, {
          ...mapFluigRequestRecord(request),
          assignedFluigUserId: membership.fluig_user_id,
          membershipType: membership.membership_type,
          membershipLastSeenAt: membership.last_seen_at,
        });
      }
      const requests = Array.from(unique.values()).slice(0, limit);
      return {
        requests,
        total: membershipTypes.length === 1 ? count || 0 : requests.length,
      };
    }

    let query = client
      .from("fluig_requests")
      .select(fluigRequestSelect, { count: "exact" })
      .in("module_slug", modules)
      .eq("is_open", true)
      .not("fluig_request_id", "is", null);

    if (input.nature) query = query.eq("expense_nature", input.nature);

    const fluigUserId = String(input.actor.fluigUserId || "").trim();
    if (fluigUserId) {
      query = input.onlyTasks
        ? query.eq("open_task_fluig_user_id", fluigUserId)
        : query.or(
            `my_request_fluig_user_id.eq.${JSON.stringify(fluigUserId)},open_task_fluig_user_id.eq.${JSON.stringify(fluigUserId)}`
          );
    } else {
      query = query.eq("sync_owner_user_id", input.actor.id);
      const actorFilter = buildFluigActorPostgrestFilter(input.actor);
      if (actorFilter) query = query.or(actorFilter);
      if (input.onlyTasks) query = query.or("current_task.not.is.null,task_owner.not.is.null");
    }

    const { data, error, count } = await query
      .order("last_status_check_at", { ascending: true, nullsFirst: true })
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw error;

    const rows = (data || []) as unknown as FluigRequestDbRow[];
    const visibleRows = fluigUserId ? rows : filterRowsForActor(input.actor, rows);
    return {
      requests: visibleRows.sort(compareOpenRequestPriority).slice(0, limit).map(mapFluigRequestRecord),
      total: count || 0,
    };
  }).then(({ result, persistence }) => ({
    requests: result?.requests || [],
    total: result?.total || 0,
    persistence,
  }));
}

type FluigAccountIdentityInput = {
  id: string;
  email: string | null;
  fluigUsername: string | null;
  fluigUserId: string | null;
};

function normalizeFluigAccountIdentity(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

export function countDistinctFluigAccounts(users: FluigAccountIdentityInput[]) {
  const groups: Array<Set<string>> = [];

  for (const user of users) {
    const identities = new Set(
      [user.fluigUserId, user.fluigUsername, user.email]
        .map(normalizeFluigAccountIdentity)
        .filter(Boolean)
    );
    if (!identities.size) identities.add(`profile:${user.id}`);

    const matchingIndexes = groups
      .map((group, index) => Array.from(identities).some((identity) => group.has(identity)) ? index : -1)
      .filter((index) => index >= 0);
    if (!matchingIndexes.length) {
      groups.push(identities);
      continue;
    }

    const primary = groups[matchingIndexes[0]];
    for (const identity of identities) primary.add(identity);
    for (const index of matchingIndexes.slice(1).reverse()) {
      for (const identity of groups[index]) primary.add(identity);
      groups.splice(index, 1);
    }
  }

  return groups.length;
}

export async function listFluigTaskDashboardFilters(
  actor: AppActor,
  input: { module?: FluigModuleSlug | null } = {}
) {
  return runWithDb(async (client) => {
    const allowedModules = fluigModuleSlugsForActor(actor);
    const modules = input.module && allowedModules.includes(input.module) ? [input.module] : allowedModules;
    let profilesQuery = client
      .from("app_user_profiles")
      .select("id,display_name,email,fluig_username,fluig_user_id,role")
      .eq("active", true)
      .eq("approval_status", "APPROVED")
      .order("display_name", { ascending: true });
    if (!actor.isAdmin) profilesQuery = profilesQuery.eq("id", actor.id);

    let natureQuery = client
      .from("fluig_catalog_items")
      .select("value,label,module_slug")
      .eq("catalog_type", "natureza")
      .order("label", { ascending: true })
      .limit(1000);
    if (input.module) natureQuery = natureQuery.eq("module_slug", input.module);
    else if (modules.length) natureQuery = natureQuery.in("module_slug", modules);

    const [profilesResult, credentialsResult, syncStatesResult, naturesResult] = await Promise.all([
      profilesQuery,
      client.from("fluig_user_credentials").select("user_id"),
      client
        .from("fluig_user_sync_state")
        .select("user_id,fluig_user_id,last_success_at")
        .eq("sync_type", "open_tasks")
        .not("last_success_at", "is", null),
      natureQuery,
    ]);
    if (profilesResult.error) throw profilesResult.error;
    if (credentialsResult.error) throw credentialsResult.error;
    if (syncStatesResult.error) throw syncStatesResult.error;
    if (naturesResult.error) throw naturesResult.error;

    const credentialUserIds = new Set((credentialsResult.data || []).map((row) => String(row.user_id)));
    const syncedUserIds = new Set((syncStatesResult.data || []).map((row) => String(row.user_id)));
    const users = (profilesResult.data || []).map((row) => ({
      id: String(row.id),
      displayName: String(row.display_name || row.email || "Usuario"),
      email: row.email ? String(row.email) : null,
      role: String(row.role || "LEITURA"),
      fluigUsername: row.fluig_username ? String(row.fluig_username) : null,
      fluigUserId: row.fluig_user_id ? String(row.fluig_user_id) : null,
      credentialConfigured: credentialUserIds.has(String(row.id)),
      taskSyncCompleted: syncedUserIds.has(String(row.id)),
    }));
    const natures = Array.from(
      new Map(
        (naturesResult.data || [])
          .map((row) => ({ value: String(row.value || "").trim(), label: String(row.label || row.value || "").trim() }))
          .filter((row) => row.value)
          .map((row) => [row.value, row])
      ).values()
    );

    return {
      isAdmin: actor.isAdmin,
      users,
      natures,
      coverage: {
        totalUsers: countDistinctFluigAccounts(users),
        configuredUsers: countDistinctFluigAccounts(users.filter((user) => user.credentialConfigured)),
        syncedUsers: countDistinctFluigAccounts(users.filter((user) => user.taskSyncCompleted)),
      },
    };
  }).then(({ result, persistence }) => ({
    ...(result || {
      isAdmin: actor.isAdmin,
      users: [],
      natures: [],
      coverage: { totalUsers: 0, configuredUsers: 0, syncedUsers: 0 },
    }),
    persistence,
  }));
}

export async function readFluigRequestByNumberForActor(input: {
  actor: AppActor;
  fluigRequestId: string;
  module?: FluigModuleSlug | null;
}) {
  const fluigRequestId = digitsOnly(input.fluigRequestId);

  return runWithDb(async (client) => {
    if (!fluigRequestId) return null;

    const allowedModules = new Set(fluigModuleSlugsForActor(input.actor));
    const requestedModules = input.module
      ? ([input.module] satisfies FluigModuleSlug[])
      : (["pagamentos", "compras", "manutencao", "fornecedores"] satisfies FluigModuleSlug[]);
    const modules = requestedModules.filter((moduleSlug) => allowedModules.has(moduleSlug));
    if (!modules.length) return null;
    let query = client
      .from("fluig_requests")
      .select(fluigRequestSelect)
      .eq("fluig_request_id", fluigRequestId)
      .in("module_slug", modules)
      .order("last_status_check_at", { ascending: false, nullsFirst: false })
      .order("last_synced_at", { ascending: false, nullsFirst: false });
    const actorFilter = buildFluigActorPostgrestFilter(input.actor);
    if (actorFilter) query = query.or(actorFilter);

    const { data, error } = await query;
    if (error) throw error;

    const row = filterRowsForActor(input.actor, (data || []) as unknown as FluigRequestDbRow[])[0];
    return row ? mapFluigRequestRecord(row) : null;
  }).then(({ result, persistence }) => ({
    request: result,
    persistence,
  }));
}

export async function recordFluigOperationRun(input: {
  module: FluigModuleSlug | null;
  operation: string;
  status: "dry_run" | "success" | "error";
  sourceMode: string;
  requestPayload?: JsonRecord;
  responsePayload?: JsonRecord;
  errorMessage?: string | null;
}) {
  return runWithDb(async (client) => {
    const { error } = await client.from("fluig_operation_runs").insert({
      module_slug: input.module,
      operation: input.operation,
      status: input.status,
      source_mode: input.sourceMode,
      request_payload: input.requestPayload || {},
      response_payload: input.responsePayload || {},
      error_message: input.errorMessage || null,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });
    if (error) throw error;
    return 1;
  }).then(({ result, persistence }) => {
    if (result) persistence.saved.operationRuns = result;
    return persistence;
  });
}

export function buildSupplierCandidates(items: FluigHistoryItem[]): FluigSupplierCandidate[] {
  const grouped = new Map<string, FluigSupplierCandidate>();

  for (const item of items) {
    const fields = item.formFields || {};
    const supplier = supplierFromFields(fields);
    const normalizedName = normalizeName(supplier.name);
    const candidateKey = supplier.cnpj || normalizedName;

    if (!candidateKey || !supplier.name) continue;

    const current = grouped.get(candidateKey);
    const sourceRequestIds = new Set(current?.sourceRequestIds || []);
    if (item.processInstanceId) sourceRequestIds.add(item.processInstanceId);

    grouped.set(candidateKey, {
      candidateKey,
      supplierName: current?.supplierName || supplier.name,
      normalizedName: current?.normalizedName || normalizedName,
      cnpj: current?.cnpj || supplier.cnpj,
      fluigName: current?.fluigName || supplier.raw || null,
      fluigCode: current?.fluigCode || supplier.code,
      confidence: supplier.cnpj ? 0.95 : 0.7,
      sourceRequestIds: Array.from(sourceRequestIds).slice(0, 20),
      suggestedDefaults: {
        sourceRequestId: current?.suggestedDefaults.sourceRequestId || item.processInstanceId,
        processId: item.processId,
        processVersion: item.processVersion,
        centroCusto: fields.centroCusto || null,
        codCentroCusto: fields.codCentroCusto || null,
        natureza: fields.codigonaturezaC || fields.naturezaSalva || null,
        formaPagamento: fields.formaPagamento || null,
        unidadeFilial: fields.unidadeFilial || null,
        fornecedorBruto: supplier.raw || null,
      },
      sourcePayload: {
        latestRequest: item.processInstanceId,
        latestFields: fields,
      },
    });
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.supplierName.localeCompare(b.supplierName);
  });
}

export async function persistSupplierCandidates(candidates: FluigSupplierCandidate[]) {
  return runWithDb(async (client) => {
    if (!candidates.length) return 0;
    const rows = candidates.map((candidate) => ({
      candidate_key: candidate.candidateKey,
      supplier_name: candidate.supplierName,
      normalized_name: candidate.normalizedName,
      cnpj: candidate.cnpj,
      fluig_name: candidate.fluigName,
      fluig_code: candidate.fluigCode,
      confidence: candidate.confidence,
      source_request_ids: candidate.sourceRequestIds,
      suggested_defaults: candidate.suggestedDefaults,
      source_payload: candidate.sourcePayload,
    }));
    const { error } = await client
      .from("fluig_supplier_candidates")
      .upsert(rows, { onConflict: "candidate_key" });
    if (error) throw error;
    return rows.length;
  }).then(({ result, persistence }) => {
    if (result !== null) persistence.saved.supplierCandidates = result;
    return persistence;
  });
}

export async function persistFluigCatalogItems(candidates: FluigCatalogCandidate[]) {
  return runWithDb(async (client) => {
    if (!candidates.length) return 0;
    const rows = candidates.map((candidate) => ({
      catalog_key: candidate.catalogKey,
      catalog_type: candidate.catalogType,
      module_slug: candidate.moduleSlug,
      code: candidate.code,
      label: candidate.label,
      value: candidate.value,
      normalized_label: candidate.normalizedLabel,
      occurrence_count: candidate.occurrenceCount,
      source_request_id: candidate.sourceRequestId,
      metadata: candidate.metadata,
      last_seen_at: new Date().toISOString(),
    }));
    const { error } = await client.from("fluig_catalog_items").upsert(rows, { onConflict: "catalog_key" });
    if (error) throw error;
    return rows.length;
  }).then(({ result, persistence }) => {
    if (result !== null) persistence.saved.catalogItems = result;
    return persistence;
  });
}

function catalogRowsForActor(actor: AppActor | null | undefined, rows: FluigCatalogDbRow[]) {
  if (!actor || actor.isAdmin) return rows;

  const branchCodes = new Set(actor.branchCodes);
  return rows.filter((row) => {
    const metadata = row.metadata || {};
    const metadataBranchCode = String(metadata.branchCode || metadata.branch_code || "").trim();

    if (row.catalog_type === "branch") {
      return !row.code || branchCodes.has(row.code);
    }

    return !metadataBranchCode || branchCodes.has(metadataBranchCode);
  });
}

async function fetchAllCatalogRows(client: SupabaseClient, module: FluigModuleSlug) {
  const rows: FluigCatalogDbRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    let catalogQuery = client.from("fluig_catalog_items").select(fluigCatalogSelect);

    if (module !== "fornecedores") {
      catalogQuery = catalogQuery.or(`module_slug.eq.${module},module_slug.is.null`);
    }

    const { data, error } = await catalogQuery
      .order("occurrence_count", { ascending: false })
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const page = (data || []) as unknown as FluigCatalogDbRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function fetchAllSupplierCandidateRows(client: SupabaseClient) {
  const rows: FluigSupplierCandidateDbRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from("fluig_supplier_candidates")
      .select("supplier_name,cnpj,fluig_name,confidence,source_request_ids,suggested_defaults,status")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const page = (data || []) as unknown as FluigSupplierCandidateDbRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function fetchAllPaymentTemplateRows(client: SupabaseClient, actor?: AppActor | null) {
  const rows: FluigRequestDbRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    let query = client
      .from("fluig_requests")
      .select(fluigRequestSelect)
      .eq("module_slug", "pagamentos")
      .not("fluig_request_id", "is", null);
    const actorFilter = buildFluigActorPostgrestFilter(actor);
    if (actorFilter) query = query.or(actorFilter);

    const { data, error } = await query
      .order("opened_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;

    const page = (data || []) as unknown as FluigRequestDbRow[];
    rows.push(...filterRowsForActor(actor, page));
    if (page.length < pageSize) break;
  }

  return rows;
}

export async function readFluigSyncSnapshot(module: FluigModuleSlug, limit = 50, actor?: AppActor | null) {
  return runWithDb(async (client) => {
    const requestModules =
      module === "fornecedores"
        ? (["pagamentos", "compras", "manutencao"] satisfies FluigModuleSlug[])
        : ([module] satisfies FluigModuleSlug[]);

    let requestsQuery = client
      .from("fluig_requests")
      .select(
        [
          "id",
          "module_slug",
          "adm_reference",
          "process_id",
          "fluig_request_id",
          "status",
          "current_task",
          "task_owner",
          "requester",
          "branch_code",
          "branch_label",
          "created_by_user_id",
          "sync_owner_user_id",
          "fluig_requester_login",
          "fluig_requester_code",
          "supplier_name",
          "supplier_cnpj",
          "amount_cents",
          "currency",
          "due_date",
          "opened_at",
          "last_synced_at",
          "raw_payload",
        ].join(",")
      )
      .in("module_slug", requestModules)
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    const actorFilter = buildFluigActorPostgrestFilter(actor);
    if (actorFilter) requestsQuery = requestsQuery.or(actorFilter);

    const [
      { data: requestRows, error: requestsError },
      supplierRows,
      catalogRows,
      paymentTemplateRows,
    ] = await Promise.all([
      requestsQuery,
      fetchAllSupplierCandidateRows(client),
      fetchAllCatalogRows(client, module),
      module === "pagamentos" ? fetchAllPaymentTemplateRows(client, actor) : Promise.resolve(null),
    ]);

    if (requestsError) throw requestsError;

    const typedRequestRows = filterRowsForActor(actor, (requestRows || []) as unknown as FluigRequestDbRow[]).slice(0, limit);
    const typedSupplierRows = supplierRows;
    const typedCatalogRows = catalogRowsForActor(actor, catalogRows);
    const rows = typedRequestRows.map(mapRequestRowToSyncRow);
    const examples = typedRequestRows
      .filter((row) => row.fluig_request_id)
      .slice(0, module === "fornecedores" ? 6 : 3)
      .map(mapRequestRowToExample);
    const supplierMatches = dedupeSupplierMatches(typedSupplierRows.map(mapSupplierCandidateToMatch));
    const catalogs = groupCatalogItems(typedCatalogRows.map(mapCatalogRow));
    const launchTemplates = buildFluigLaunchTemplatesFromRequests(paymentTemplateRows || typedRequestRows);

    return {
      rows,
      examples,
      supplierMatches,
      catalogs,
      launchTemplates,
    };
  }).then(({ result, persistence }) => ({
    rows: result?.rows || [],
    examples: result?.examples || [],
    supplierMatches: result?.supplierMatches || [],
    catalogs: result?.catalogs || {},
    launchTemplates: result?.launchTemplates || [],
    persistence,
  }));
}
