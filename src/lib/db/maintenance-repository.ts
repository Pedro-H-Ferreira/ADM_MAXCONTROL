import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";
import type { AppActor, AppBranch, FluigJobRecord } from "@/lib/db/app-repository";
import { AppAuthError } from "@/lib/db/app-repository";
import { assertMaintenanceAction } from "@/lib/db/maintenance-domain-repository";

type JsonRecord = Record<string, unknown>;

export type MaintenanceOrderSource = "manual" | "fluig" | "preventiva" | "checklist" | "alerta";
export type MaintenanceOrderPriority = "CRITICA" | "ALTA" | "MEDIA" | "BAIXA";
export type MaintenanceOrderWorkType = "CORRETIVA" | "PREVENTIVA" | "INSPECAO" | "MELHORIA" | "EMERGENCIA";
export type MaintenanceOrderStatus =
  | "ABERTA"
  | "EM_TRIAGEM"
  | "PLANEJADA"
  | "AGUARDANDO_APROVACAO"
  | "MATERIAL_RESERVADO"
  | "INICIADA"
  | "EM_EXECUCAO"
  | "AGUARDANDO_MATERIAL"
  | "AGUARDANDO_TERCEIRO"
  | "PROGRAMADA"
  | "PAUSADA"
  | "CONCLUIDA"
  | "AGUARDANDO_VALIDACAO"
  | "FINALIZADA"
  | "CANCELADA";

export type MaintenancePhotoInput = {
  name: string;
  size?: number | null;
  type?: string | null;
  bucket?: string | null;
  path?: string | null;
  uploadedAt?: string | null;
  uploadedByUserId?: string | null;
  signedUrl?: string | null;
};

export type MaintenanceMaterialInput = {
  item: string;
  quantity?: string | null;
  valueCents?: number | null;
};

export type MaintenanceOrderInput = {
  source?: MaintenanceOrderSource;
  title: string;
  description: string;
  area: string;
  priority?: MaintenanceOrderPriority;
  status?: MaintenanceOrderStatus;
  workType?: MaintenanceOrderWorkType;
  assetId?: string | null;
  serviceProviderId?: string | null;
  requester?: string | null;
  technician?: string | null;
  branchId?: string | null;
  dueAt?: string | null;
  materialSummary?: string | null;
  materialCostCents?: number | null;
  materials?: MaintenanceMaterialInput[];
  photos?: MaintenancePhotoInput[];
  pendingReason?: string | null;
  slaMinutes?: number | null;
  diagnosis?: string | null;
  rootCause?: string | null;
  executedSolution?: string | null;
  downtimeMinutes?: number | null;
  laborCostCents?: number | null;
  otherCostCents?: number | null;
  completionNotes?: string | null;
  completionApprovalRequired?: boolean;
  fluigRequestId?: string | null;
  fluigNumLancW?: string | null;
  fluigCurrentTask?: string | null;
  fluigTaskOwner?: string | null;
  metadata?: JsonRecord;
};

export type MaintenanceOrderUpdateInput = Partial<MaintenanceOrderInput> & {
  status?: MaintenanceOrderStatus;
  transitionComment?: string | null;
};

type MaintenanceOrderDbRow = {
  id: string;
  code: string;
  source: MaintenanceOrderSource;
  title: string;
  description: string;
  area: string;
  priority: MaintenanceOrderPriority;
  status: MaintenanceOrderStatus;
  work_type: MaintenanceOrderWorkType;
  asset_id: string | null;
  service_provider_id: string | null;
  requester: string | null;
  requester_user_id: string | null;
  technician: string | null;
  technician_user_id: string | null;
  branch_id: string | null;
  branch_code: string | null;
  branch_label: string | null;
  due_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  material_summary: string | null;
  material_cost_cents: number;
  materials: MaintenanceMaterialInput[] | null;
  photos: MaintenancePhotoInput[] | null;
  pending_reason: string | null;
  sla_minutes: number | null;
  diagnosis: string | null;
  root_cause: string | null;
  executed_solution: string | null;
  downtime_minutes: number;
  labor_cost_cents: number;
  other_cost_cents: number;
  total_cost_cents: number;
  completion_notes: string | null;
  approval_status: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  approved_by: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  fluig_request_id: string | null;
  fluig_num_lanc_w: string | null;
  fluig_current_task: string | null;
  fluig_task_owner: string | null;
  fluig_last_sync_at: string | null;
  metadata: JsonRecord | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  asset?: {
    id: string;
    internal_code: string;
    asset_tag: string | null;
    name: string;
    status: string;
    physical_location: string | null;
  } | null;
  service_provider?: {
    id: string;
    name: string;
    tax_id: string | null;
  } | null;
};

type OrderCounts = {
  open: number;
  started: number;
  waitingMaterial: number;
  finished: number;
  fluig: number;
  manual: number;
};

const terminalStatuses = new Set<MaintenanceOrderStatus>(["FINALIZADA", "CANCELADA"]);
const openStatuses: MaintenanceOrderStatus[] = [
  "ABERTA", "EM_TRIAGEM", "PLANEJADA", "AGUARDANDO_APROVACAO", "AGUARDANDO_MATERIAL",
  "MATERIAL_RESERVADO", "AGUARDANDO_TERCEIRO", "PROGRAMADA", "INICIADA", "EM_EXECUCAO",
  "PAUSADA", "CONCLUIDA", "AGUARDANDO_VALIDACAO",
];

const maintenanceOrderSelect = [
  "id", "code", "source", "title", "description", "area", "priority", "status", "work_type",
  "asset_id", "service_provider_id", "requester", "requester_user_id", "technician", "technician_user_id",
  "branch_id", "branch_code", "branch_label", "due_at", "started_at", "finished_at", "material_summary",
  "material_cost_cents", "materials", "photos", "pending_reason", "sla_minutes", "diagnosis", "root_cause",
  "executed_solution", "downtime_minutes", "labor_cost_cents", "other_cost_cents", "total_cost_cents",
  "completion_notes", "approval_status", "approved_by", "approved_at", "approval_notes", "fluig_request_id", "fluig_num_lanc_w", "fluig_current_task",
  "fluig_task_owner", "fluig_last_sync_at", "metadata", "created_by_user_id", "updated_by_user_id",
  "created_at", "updated_at", "deleted_at",
  "asset:app_maintenance_assets(id,internal_code,asset_tag,name,status,physical_location)",
  "service_provider:app_maintenance_service_providers(id,name,tax_id)",
].join(",");

function assertServiceClient(): SupabaseClient {
  const client = getSupabaseServiceClient();
  if (!client) {
    const missing = getSupabaseServiceStatus().missing.join(", ");
    throw new Error(`Supabase service role nao configurado. Faltando: ${missing}`);
  }
  return client;
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function escapeSearch(value: string) {
  return value.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
}

function maintenanceActorFilter(actor: AppActor) {
  if (actor.isAdmin) return null;

  const filters = [
    `created_by_user_id.eq.${actor.id}`,
    `requester_user_id.eq.${actor.id}`,
    `technician_user_id.eq.${actor.id}`,
  ];
  const branchIds = actor.branches.map((branch) => branch.id).filter(Boolean);
  const branchCodes = actor.branchCodes.filter((code) => /^[A-Za-z0-9_-]+$/.test(code));
  if (branchIds.length) filters.push(`branch_id.in.(${branchIds.join(",")})`);
  if (branchCodes.length) filters.push(`branch_code.in.(${branchCodes.join(",")})`);
  return filters.join(",");
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function upperText<T extends string>(value: unknown, fallback: T): T {
  return (cleanText(value)?.toUpperCase() || fallback) as T;
}

function centsFromInput(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function sanitizePhotos(photos: MaintenancePhotoInput[] | undefined) {
  return Array.isArray(photos)
    ? photos
        .map((photo) => ({
          name: cleanText(photo.name) || "foto",
          size: photo.size == null ? null : Number(photo.size) || null,
          type: cleanText(photo.type),
          bucket: cleanText(photo.bucket),
          path: cleanText(photo.path),
          uploadedAt: cleanText(photo.uploadedAt),
          uploadedByUserId: cleanText(photo.uploadedByUserId),
        }))
        .filter((photo) => photo.name)
    : [];
}

function sanitizeMaterials(materials: MaintenanceMaterialInput[] | undefined) {
  return Array.isArray(materials)
    ? materials
        .map((material) => ({
          item: cleanText(material.item) || "",
          quantity: cleanText(material.quantity),
          valueCents: material.valueCents == null ? null : centsFromInput(material.valueCents),
        }))
        .filter((material) => material.item)
    : [];
}

function findDeepStringByKey(value: unknown, keys: string[], depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value !== "object") return null;

  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, entryValue] of entries) {
    if (normalizedKeys.has(key.toLowerCase())) {
      const text = cleanText(entryValue);
      if (text) return text;
    }
  }

  for (const [, entryValue] of entries) {
    if (entryValue && typeof entryValue === "object") {
      const nested = findDeepStringByKey(entryValue, keys, depth + 1);
      if (nested) return nested;
    }
  }

  return null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function branchForInput(actor: AppActor, branchId?: string | null): AppBranch | null {
  if (branchId) {
    const branch = actor.branches.find((item) => item.id === branchId);
    if (!branch && !actor.isAdmin) {
      throw new Error("Usuario sem acesso a filial da OS.");
    }
    return branch || null;
  }

  return actor.branches[0] || null;
}

function normalizeCreateInput(actor: AppActor, input: MaintenanceOrderInput) {
  const title = cleanText(input.title);
  const description = cleanText(input.description);
  const area = cleanText(input.area);
  if (!title) throw new Error("Titulo da OS e obrigatorio.");
  if (!description) throw new Error("Descricao da OS e obrigatoria.");
  if (!area) throw new Error("Area da OS e obrigatoria.");

  const branch = branchForInput(actor, input.branchId);
  const status: MaintenanceOrderStatus = "ABERTA";
  const now = new Date().toISOString();

  return {
    source: input.source || "manual",
    title,
    description,
    area,
    priority: upperText<MaintenanceOrderPriority>(input.priority, "MEDIA"),
    status,
    work_type: upperText<MaintenanceOrderWorkType>(input.workType, "CORRETIVA"),
    asset_id: cleanText(input.assetId),
    service_provider_id: cleanText(input.serviceProviderId),
    requester: cleanText(input.requester) || actor.displayName,
    requester_user_id: actor.id,
    technician: cleanText(input.technician),
    branch_id: branch?.id || null,
    branch_code: branch?.code || null,
    branch_label: branch?.fluigLabel || branch?.name || null,
    due_at: cleanText(input.dueAt),
    started_at: null,
    finished_at: null,
    material_summary: cleanText(input.materialSummary),
    material_cost_cents: centsFromInput(input.materialCostCents),
    materials: sanitizeMaterials(input.materials),
    photos: sanitizePhotos(input.photos),
    pending_reason: cleanText(input.pendingReason),
    sla_minutes: input.slaMinutes == null ? null : Math.max(0, Number(input.slaMinutes) || 0),
    diagnosis: cleanText(input.diagnosis),
    root_cause: cleanText(input.rootCause),
    executed_solution: cleanText(input.executedSolution),
    downtime_minutes: Math.max(0, Number(input.downtimeMinutes) || 0),
    labor_cost_cents: centsFromInput(input.laborCostCents),
    other_cost_cents: centsFromInput(input.otherCostCents),
    completion_notes: cleanText(input.completionNotes),
    approval_status: input.completionApprovalRequired ? "PENDING" : "NOT_REQUIRED",
    fluig_request_id: cleanText(input.fluigRequestId),
    fluig_num_lanc_w: cleanText(input.fluigNumLancW),
    fluig_current_task: cleanText(input.fluigCurrentTask),
    fluig_task_owner: cleanText(input.fluigTaskOwner),
    fluig_last_sync_at: input.fluigRequestId ? now : null,
    metadata: input.metadata || {},
    created_by_user_id: actor.id,
    updated_by_user_id: actor.id,
  };
}

function normalizeUpdateInput(actor: AppActor, current: MaintenanceOrderDbRow, input: MaintenanceOrderUpdateInput) {
  const payload: Record<string, unknown> = {
    updated_by_user_id: actor.id,
  };

  if ("source" in input) payload.source = input.source || current.source;
  if ("title" in input) {
    const title = cleanText(input.title);
    if (!title) throw new Error("Titulo da OS e obrigatorio.");
    payload.title = title;
  }
  if ("description" in input) {
    const description = cleanText(input.description);
    if (!description) throw new Error("Descricao da OS e obrigatoria.");
    payload.description = description;
  }
  if ("area" in input) {
    const area = cleanText(input.area);
    if (!area) throw new Error("Area da OS e obrigatoria.");
    payload.area = area;
  }
  if ("priority" in input) payload.priority = upperText<MaintenanceOrderPriority>(input.priority, current.priority);
  if ("workType" in input) payload.work_type = upperText<MaintenanceOrderWorkType>(input.workType, current.work_type);
  if ("assetId" in input) payload.asset_id = cleanText(input.assetId);
  if ("serviceProviderId" in input) payload.service_provider_id = cleanText(input.serviceProviderId);
  if ("requester" in input) payload.requester = cleanText(input.requester);
  if ("technician" in input) payload.technician = cleanText(input.technician);
  if ("branchId" in input) {
    const branch = branchForInput(actor, input.branchId);
    payload.branch_id = branch?.id || null;
    payload.branch_code = branch?.code || null;
    payload.branch_label = branch?.fluigLabel || branch?.name || null;
  }
  if ("dueAt" in input) payload.due_at = cleanText(input.dueAt);
  if ("materialSummary" in input) payload.material_summary = cleanText(input.materialSummary);
  if ("materialCostCents" in input) payload.material_cost_cents = centsFromInput(input.materialCostCents);
  if ("materials" in input) payload.materials = sanitizeMaterials(input.materials);
  if ("photos" in input) payload.photos = sanitizePhotos(input.photos);
  if ("pendingReason" in input) payload.pending_reason = cleanText(input.pendingReason);
  if ("slaMinutes" in input) payload.sla_minutes = input.slaMinutes == null ? null : Math.max(0, Number(input.slaMinutes) || 0);
  if ("diagnosis" in input) payload.diagnosis = cleanText(input.diagnosis);
  if ("rootCause" in input) payload.root_cause = cleanText(input.rootCause);
  if ("executedSolution" in input) payload.executed_solution = cleanText(input.executedSolution);
  if ("downtimeMinutes" in input) payload.downtime_minutes = Math.max(0, Number(input.downtimeMinutes) || 0);
  if ("laborCostCents" in input) payload.labor_cost_cents = centsFromInput(input.laborCostCents);
  if ("otherCostCents" in input) payload.other_cost_cents = centsFromInput(input.otherCostCents);
  if ("completionNotes" in input) payload.completion_notes = cleanText(input.completionNotes);
  if ("completionApprovalRequired" in input) {
    if (!input.completionApprovalRequired) {
      payload.approval_status = "NOT_REQUIRED";
      payload.approved_by = null;
      payload.approved_at = null;
      payload.approval_notes = null;
    } else if (current.approval_status === "NOT_REQUIRED" || current.approval_status === "REJECTED") {
      payload.approval_status = "PENDING";
      payload.approved_by = null;
      payload.approved_at = null;
      payload.approval_notes = null;
    } else if (current.approval_status === "APPROVED") {
      const completionChanged =
        ("diagnosis" in input && cleanText(input.diagnosis) !== current.diagnosis) ||
        ("rootCause" in input && cleanText(input.rootCause) !== current.root_cause) ||
        ("executedSolution" in input && cleanText(input.executedSolution) !== current.executed_solution) ||
        ("completionNotes" in input && cleanText(input.completionNotes) !== current.completion_notes) ||
        ("downtimeMinutes" in input && Math.max(0, Number(input.downtimeMinutes) || 0) !== current.downtime_minutes) ||
        ("laborCostCents" in input && centsFromInput(input.laborCostCents) !== current.labor_cost_cents) ||
        ("otherCostCents" in input && centsFromInput(input.otherCostCents) !== current.other_cost_cents);
      if (completionChanged) {
        payload.approval_status = "PENDING";
        payload.approved_by = null;
        payload.approved_at = null;
        payload.approval_notes = null;
      }
    }
  }
  if ("fluigRequestId" in input) {
    payload.fluig_request_id = cleanText(input.fluigRequestId);
    payload.fluig_last_sync_at = input.fluigRequestId ? new Date().toISOString() : current.fluig_last_sync_at;
  }
  if ("fluigNumLancW" in input) payload.fluig_num_lanc_w = cleanText(input.fluigNumLancW);
  if ("fluigCurrentTask" in input) payload.fluig_current_task = cleanText(input.fluigCurrentTask);
  if ("fluigTaskOwner" in input) payload.fluig_task_owner = cleanText(input.fluigTaskOwner);
  if ("metadata" in input) payload.metadata = input.metadata || {};

  return payload;
}

function actorCanSeeOrder(actor: AppActor, order: MaintenanceOrderDbRow) {
  if (actor.isAdmin) return true;
  if (order.created_by_user_id === actor.id || order.requester_user_id === actor.id || order.technician_user_id === actor.id) return true;
  return Boolean(
    (order.branch_id && actor.branches.some((branch) => branch.id === order.branch_id)) ||
    (order.branch_code && actor.branchCodes.includes(order.branch_code))
  );
}

function actorCanMutateOrder(actor: AppActor, order: MaintenanceOrderDbRow) {
  if (actor.isAdmin) return true;
  if (order.created_by_user_id === actor.id || order.requester_user_id === actor.id || order.technician_user_id === actor.id) return true;
  return Boolean(
    (order.branch_id && actor.branches.some((branch) => branch.id === order.branch_id)) ||
    (order.branch_code && actor.branchCodes.includes(order.branch_code))
  );
}

function mapOrder(row: MaintenanceOrderDbRow) {
  return {
    id: row.id,
    code: row.code,
    source: row.source,
    title: row.title,
    description: row.description,
    area: row.area,
    priority: row.priority,
    status: row.status,
    workType: row.work_type,
    assetId: row.asset_id,
    asset: row.asset || null,
    serviceProviderId: row.service_provider_id,
    serviceProvider: row.service_provider || null,
    requester: row.requester,
    technician: row.technician,
    branch: {
      id: row.branch_id,
      code: row.branch_code,
      label: row.branch_label,
    },
    dueAt: row.due_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    materialSummary: row.material_summary,
    materialCostCents: row.material_cost_cents,
    materials: row.materials || [],
    photos: row.photos || [],
    pendingReason: row.pending_reason,
    slaMinutes: row.sla_minutes,
    diagnosis: row.diagnosis,
    rootCause: row.root_cause,
    executedSolution: row.executed_solution,
    downtimeMinutes: row.downtime_minutes,
    laborCostCents: row.labor_cost_cents,
    otherCostCents: row.other_cost_cents,
    totalCostCents: row.total_cost_cents,
    completionNotes: row.completion_notes,
    approvalStatus: row.approval_status,
    approval: {
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      notes: row.approval_notes,
    },
    fluig: {
      requestId: row.fluig_request_id,
      numLancW: row.fluig_num_lanc_w,
      currentTask: row.fluig_current_task,
      taskOwner: row.fluig_task_owner,
      lastSyncAt: row.fluig_last_sync_at,
    },
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function sortOrders(a: MaintenanceOrderDbRow, b: MaintenanceOrderDbRow) {
  const priorityRank: Record<MaintenanceOrderPriority, number> = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 };
  const statusRank = (status: MaintenanceOrderStatus) => (terminalStatuses.has(status) ? 1 : 0);
  return (
    statusRank(a.status) - statusRank(b.status) ||
    priorityRank[a.priority] - priorityRank[b.priority] ||
    Date.parse(a.due_at || a.created_at) - Date.parse(b.due_at || b.created_at)
  );
}

async function recordOrderEvent(client: SupabaseClient, input: {
  orderId: string;
  actorId: string;
  type: string;
  label: string;
  statusFrom?: string | null;
  statusTo?: string | null;
  payload?: JsonRecord;
}) {
  const { error } = await client.from("app_maintenance_order_events").insert({
    order_id: input.orderId,
    actor_user_id: input.actorId,
    event_type: input.type,
    event_label: input.label,
    status_from: input.statusFrom || null,
    status_to: input.statusTo || null,
    event_payload: input.payload || {},
  });
  if (error) throw error;
}

export async function listMaintenanceOrders(actor: AppActor, input: {
  search?: string | null;
  status?: MaintenanceOrderStatus | "ALL" | null;
  source?: MaintenanceOrderSource | "ALL" | null;
  page?: number;
  pageSize?: number;
}) {
  const capabilities = await assertMaintenanceAction(actor, "VIEW");
  const client = assertServiceClient();
  const page = Math.max(Number(input.page || 1), 1);
  const requestedPageSize = Number(input.pageSize || 20);
  const pageSize = ([20, 50, 100] as const).includes(requestedPageSize as 20 | 50 | 100) ? requestedPageSize : 20;
  const from = (page - 1) * pageSize;
  const actorFilter = maintenanceActorFilter(actor);
  const search = cleanText(input.search);
  const searchFilter = search
    ? ["code", "title", "area", "description", "technician", "branch_label", "fluig_request_id"]
        .map((column) => `${column}.ilike.%${escapeSearch(search)}%`)
        .join(",")
    : null;

  function applyFilters<T extends {
    eq(column: string, value: unknown): T;
    or(filter: string): T;
  }>(query: T, extra?: { status?: MaintenanceOrderStatus[]; source?: MaintenanceOrderSource }) {
    let filtered = query;
    if (actorFilter) filtered = filtered.or(actorFilter);
    if (searchFilter) filtered = filtered.or(searchFilter);
    if (input.status && input.status !== "ALL") filtered = filtered.eq("status", input.status);
    if (input.source && input.source !== "ALL") filtered = filtered.eq("source", input.source);
    if (extra?.status?.length === 1) filtered = filtered.eq("status", extra.status[0]);
    if (extra?.source) filtered = filtered.eq("source", extra.source);
    return filtered;
  }

  let pageQuery = client
    .from("app_maintenance_orders")
    .select(maintenanceOrderSelect, { count: "exact" })
    .is("deleted_at", null)
    .order("finished_at", { ascending: true, nullsFirst: true })
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  pageQuery = applyFilters(pageQuery);

  const countQuery = (extra?: { status?: MaintenanceOrderStatus[]; source?: MaintenanceOrderSource }) => {
    let query = client
      .from("app_maintenance_orders")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);
    query = applyFilters(query, extra);
    if (extra?.status && extra.status.length > 1) query = query.in("status", extra.status);
    return query;
  };

  const [pageResult, openResult, startedResult, waitingResult, finishedResult, fluigResult, manualResult] = await Promise.all([
    pageQuery.range(from, from + pageSize - 1),
    countQuery({ status: openStatuses }),
    countQuery({ status: ["INICIADA", "EM_EXECUCAO"] }),
    countQuery({ status: ["AGUARDANDO_MATERIAL"] }),
    countQuery({ status: ["FINALIZADA"] }),
    countQuery({ source: "fluig" }),
    countQuery({ source: "manual" }),
  ]);
  const error = [pageResult, openResult, startedResult, waitingResult, finishedResult, fluigResult, manualResult]
    .map((result) => result.error)
    .find(Boolean);
  if (error) throw error;

  const visibleRows = (pageResult.data || []) as unknown as MaintenanceOrderDbRow[];
  const items = visibleRows.sort(sortOrders).map(mapOrder);
  const counts: OrderCounts = {
    open: openResult.count || 0,
    started: startedResult.count || 0,
    waitingMaterial: waitingResult.count || 0,
    finished: finishedResult.count || 0,
    fluig: fluigResult.count || 0,
    manual: manualResult.count || 0,
  };

  return {
    page,
    pageSize,
    total: pageResult.count || 0,
    counts,
    branches: actor.branches,
    capabilities,
    items,
  };
}

export async function readMaintenanceOrder(actor: AppActor, id: string) {
  await assertMaintenanceAction(actor, "VIEW");
  const client = assertServiceClient();
  const { data, error } = await client.from("app_maintenance_orders").select(maintenanceOrderSelect).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as MaintenanceOrderDbRow;
  if (!actorCanSeeOrder(actor, row)) return null;
  const [eventResult, materialResult, reservationResult, movementResult, laborResult] = await Promise.all([
    client
      .from("app_maintenance_order_events")
      .select("id,event_type,event_label,status_from,status_to,event_payload,actor_user_id,created_at,actor:app_user_profiles(id,display_name,email)")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    client
      .from("app_maintenance_order_materials")
      .select("id,material_id,planned_quantity,reserved_quantity,consumed_quantity,returned_quantity,unit_cost_cents,notes,created_at,updated_at,material:app_maintenance_materials(id,code,name,unit,minimum_stock,reorder_point)")
      .eq("order_id", id)
      .order("created_at"),
    client
      .from("app_maintenance_stock_reservations")
      .select("id,material_id,location_id,requested_quantity,reserved_quantity,consumed_quantity,released_quantity,status,reserved_at,updated_at,material:app_maintenance_materials(id,code,name,unit),location:app_maintenance_storage_locations(id,code,warehouse_id,warehouse:app_maintenance_warehouses(id,code,name,branch_id))")
      .eq("order_id", id)
      .order("reserved_at", { ascending: false }),
    client
      .from("app_maintenance_stock_movements")
      .select("id,movement_type,material_id,quantity,unit,unit_cost_cents,total_cost_cents,reason,notes,occurred_at,material:app_maintenance_materials(id,code,name)")
      .eq("work_order_id", id)
      .order("occurred_at", { ascending: false })
      .limit(100),
    client
      .from("app_maintenance_order_labor")
      .select("id,professional_name,started_at,ended_at,minutes,hourly_cost_cents,total_cost_cents,notes,service_provider:app_maintenance_service_providers(id,name)")
      .eq("order_id", id)
      .order("started_at", { ascending: false }),
  ]);
  const detailError = [eventResult, materialResult, reservationResult, movementResult, laborResult]
    .map((result) => result.error)
    .find(Boolean);
  if (detailError) throw detailError;
  return {
    ...mapOrder(row),
    events: eventResult.data || [],
    materialItems: materialResult.data || [],
    reservations: reservationResult.data || [],
    stockMovements: movementResult.data || [],
    laborEntries: laborResult.data || [],
  };
}

export async function createMaintenanceOrder(actor: AppActor, input: MaintenanceOrderInput) {
  await assertMaintenanceAction(actor, "CREATE_ORDER");
  const client = assertServiceClient();
  const payload = normalizeCreateInput(actor, input);
  const { data, error } = await client.from("app_maintenance_orders").insert(payload).select("*").single();
  if (error) throw error;
  const row = data as MaintenanceOrderDbRow;
  await recordOrderEvent(client, {
    orderId: row.id,
    actorId: actor.id,
    type: "created",
    label: row.source === "fluig" ? "OS integrada ao Fluig criada no ADM." : "OS manual criada no ADM.",
    statusTo: row.status,
    payload: { source: row.source, branchCode: row.branch_code },
  });
  return mapOrder(row);
}

export async function updateMaintenanceOrder(actor: AppActor, id: string, input: MaintenanceOrderUpdateInput) {
  await assertMaintenanceAction(actor, "EDIT_ORDER");
  const client = assertServiceClient();
  const { data: currentData, error: currentError } = await client.from("app_maintenance_orders").select("*").eq("id", id).maybeSingle();
  if (currentError) throw currentError;
  if (!currentData) return null;

  const current = currentData as MaintenanceOrderDbRow;
  if (!actorCanMutateOrder(actor, current)) {
    throw new AppAuthError("Usuario sem acesso para atualizar esta OS.", 403, "MAINTENANCE_ORDER_DENIED");
  }

  const payload = normalizeUpdateInput(actor, current, input);
  const nextStatus = input.status ? upperText<MaintenanceOrderStatus>(input.status, current.status) : current.status;
  const statusChanged = nextStatus !== current.status;
  if (statusChanged) {
    await assertMaintenanceAction(actor, nextStatus === "FINALIZADA" ? "FINISH_ORDER" : "CHANGE_STATUS");
  }

  if (Object.keys(payload).length > 1) {
    const { error } = await client.from("app_maintenance_orders").update(payload).eq("id", id);
    if (error) throw error;
  }

  if (statusChanged) {
    const { error } = await client.rpc("app_maintenance_transition_order", {
      p_order_id: id,
      p_next_status: nextStatus,
      p_actor_user_id: actor.id,
      p_comment: cleanText(input.transitionComment) || cleanText(input.completionNotes) || cleanText(input.pendingReason),
    });
    if (error) throw error;
  }

  const { data, error } = await client.from("app_maintenance_orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const updated = data as MaintenanceOrderDbRow;
  await recordOrderEvent(client, {
    orderId: updated.id,
    actorId: actor.id,
    type: "updated",
    label: current.status !== updated.status ? `Status alterado para ${updated.status}.` : "OS atualizada.",
    statusFrom: current.status,
    statusTo: updated.status,
    payload: {
      materialCostCents: updated.material_cost_cents,
      photoCount: updated.photos?.length || 0,
      pendingReason: updated.pending_reason,
    },
  });
  return mapOrder(updated);
}

export async function reviewMaintenanceOrderCompletion(
  actor: AppActor,
  id: string,
  input: { decision: "APPROVE" | "REJECT"; notes: string }
) {
  await assertMaintenanceAction(actor, "APPROVE_COMPLETION");
  const client = assertServiceClient();
  const { data: currentData, error: currentError } = await client
    .from("app_maintenance_orders")
    .select(maintenanceOrderSelect)
    .eq("id", id)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!currentData) return null;
  const current = currentData as unknown as MaintenanceOrderDbRow;
  if (!actorCanSeeOrder(actor, current)) {
    throw new AppAuthError("Usuario sem acesso para revisar esta OS.", 403, "MAINTENANCE_ORDER_DENIED");
  }
  const { data, error } = await client.rpc("app_maintenance_review_completion", {
    p_order_id: id,
    p_decision: input.decision,
    p_actor_user_id: actor.id,
    p_notes: cleanText(input.notes),
  });
  if (error) throw error;
  return mapOrder(data as MaintenanceOrderDbRow);
}

export async function appendMaintenanceOrderPhotos(actor: AppActor, id: string, photos: MaintenancePhotoInput[]) {
  await assertMaintenanceAction(actor, "EDIT_ORDER");
  const client = assertServiceClient();
  const { data: currentData, error: currentError } = await client.from("app_maintenance_orders").select("*").eq("id", id).maybeSingle();
  if (currentError) throw currentError;
  if (!currentData) return null;

  const current = currentData as MaintenanceOrderDbRow;
  if (!actorCanMutateOrder(actor, current)) {
    throw new AppAuthError("Usuario sem acesso para anexar fotos nesta OS.", 403, "MAINTENANCE_ORDER_DENIED");
  }

  const uploadedAt = new Date().toISOString();
  const incomingPhotos = sanitizePhotos(
    photos.map((photo) => ({
      ...photo,
      uploadedAt: photo.uploadedAt || uploadedAt,
      uploadedByUserId: photo.uploadedByUserId || actor.id,
    }))
  ).filter((photo) => photo.path);
  if (!incomingPhotos.length) throw new Error("Nenhuma foto valida para anexar.");

  const nextPhotos = sanitizePhotos([...(current.photos || []), ...incomingPhotos]);
  const { data, error } = await client
    .from("app_maintenance_orders")
    .update({
      photos: nextPhotos,
      updated_by_user_id: actor.id,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  await recordOrderEvent(client, {
    orderId: current.id,
    actorId: actor.id,
    type: "photos_uploaded",
    label: `${incomingPhotos.length} foto(s) anexada(s) a OS.`,
    statusFrom: current.status,
    statusTo: current.status,
    payload: {
      uploadedCount: incomingPhotos.length,
      photoCount: nextPhotos.length,
      paths: incomingPhotos.map((photo) => photo.path).filter(Boolean),
    },
  });

  return mapOrder(data as MaintenanceOrderDbRow);
}

export async function completeMaintenanceOrderFluigOpenJob(input: {
  job: FluigJobRecord;
  generatedRequestId: string;
  resultPayload: JsonRecord;
}) {
  const maintenanceOrderId = firstText(
    input.job.requestPayload.maintenanceOrderId,
    input.job.requestPayload.orderId,
    asRecord(input.job.requestPayload.maintenanceOrder).id
  );

  if (!maintenanceOrderId || input.job.module !== "manutencao" || input.job.operation !== "open_from_source") {
    return null;
  }

  const client = assertServiceClient();
  const { data: currentData, error: currentError } = await client
    .from("app_maintenance_orders")
    .select("*")
    .eq("id", maintenanceOrderId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!currentData) return null;

  const current = currentData as MaintenanceOrderDbRow;
  const resultData = asRecord(input.resultPayload.data);
  const finalDetails = asRecord(resultData.finalDetails);
  const content = asRecord(finalDetails.content);
  const now = new Date().toISOString();
  const currentMetadata = asRecord(current.metadata);
  const sourceRequestId = firstText(resultData.sourceRequestId, input.job.requestPayload.sourceRequestId);

  const fluigNumLancW = firstText(
    findDeepStringByKey(input.resultPayload, ["NumLancW", "numLancW", "numeroLancamento", "lancamentoConsinco"]),
    current.fluig_num_lanc_w
  );
  const currentTask = firstText(
    content.stateDescription,
    findDeepStringByKey(input.resultPayload, ["stateDescription", "etapaAtual", "currentTask"]),
    "Solicitacao aberta pelo ADM"
  );
  const taskOwner = firstText(
    content.colleagueName,
    findDeepStringByKey(input.resultPayload, ["colleagueName", "responsavelAtual", "taskOwner"]),
    current.fluig_task_owner
  );

  const metadata = {
    ...currentMetadata,
    fluigSourceRequestId: sourceRequestId || currentMetadata.fluigSourceRequestId || null,
    fluigOpenJob: {
      id: input.job.id,
      status: "success",
      generatedRequestId: input.generatedRequestId,
      sourceRequestId,
      syncedAt: now,
      outputPath: firstText(input.resultPayload.outputPath, resultData.outputPath),
      attachmentCount: Number(resultData.attachmentCount || input.job.requestPayload.attachmentCount || 0),
      fieldOverrideCount: Number(resultData.fieldOverrideCount || 0),
    },
  };

  const { data, error } = await client
    .from("app_maintenance_orders")
    .update({
      source: "fluig",
      fluig_request_id: input.generatedRequestId,
      fluig_num_lanc_w: fluigNumLancW,
      fluig_current_task: currentTask,
      fluig_task_owner: taskOwner,
      fluig_last_sync_at: now,
      metadata,
      updated_by_user_id: input.job.requestedByUserId,
    })
    .eq("id", maintenanceOrderId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  await recordOrderEvent(client, {
    orderId: maintenanceOrderId,
    actorId: input.job.requestedByUserId,
    type: "fluig_opened",
    label: `OS aberta no Fluig ${input.generatedRequestId}.`,
    statusFrom: current.status,
    statusTo: current.status,
    payload: {
      jobId: input.job.id,
      generatedRequestId: input.generatedRequestId,
      sourceRequestId,
      currentTask,
      taskOwner,
      fluigNumLancW,
    },
  });

  return mapOrder(data as MaintenanceOrderDbRow);
}

export async function recordMaintenanceOrderFluigJobFailure(input: {
  job: FluigJobRecord;
  errorMessage?: string | null;
}) {
  const maintenanceOrderId = firstText(
    input.job.requestPayload.maintenanceOrderId,
    input.job.requestPayload.orderId,
    asRecord(input.job.requestPayload.maintenanceOrder).id
  );

  if (!maintenanceOrderId || input.job.module !== "manutencao" || input.job.operation !== "open_from_source") {
    return null;
  }

  const client = assertServiceClient();
  const { data: currentData, error: currentError } = await client
    .from("app_maintenance_orders")
    .select("*")
    .eq("id", maintenanceOrderId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!currentData) return null;

  const current = currentData as MaintenanceOrderDbRow;
  const now = new Date().toISOString();
  const metadata = {
    ...asRecord(current.metadata),
    fluigOpenJob: {
      id: input.job.id,
      status: "error",
      errorMessage: input.errorMessage || "Falha ao abrir OS no Fluig.",
      syncedAt: now,
      sourceRequestId: firstText(input.job.requestPayload.sourceRequestId),
    },
  };

  const { data, error } = await client
    .from("app_maintenance_orders")
    .update({
      metadata,
      updated_by_user_id: input.job.requestedByUserId,
    })
    .eq("id", maintenanceOrderId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  await recordOrderEvent(client, {
    orderId: maintenanceOrderId,
    actorId: input.job.requestedByUserId,
    type: "fluig_open_error",
    label: input.errorMessage || "Falha ao abrir OS no Fluig.",
    statusFrom: current.status,
    statusTo: current.status,
    payload: {
      jobId: input.job.id,
      sourceRequestId: firstText(input.job.requestPayload.sourceRequestId),
    },
  });

  return mapOrder(data as MaintenanceOrderDbRow);
}
