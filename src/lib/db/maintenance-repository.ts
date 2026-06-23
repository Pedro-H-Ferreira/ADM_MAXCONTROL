import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";
import type { AppActor, AppBranch } from "@/lib/db/app-repository";

type JsonRecord = Record<string, unknown>;

export type MaintenanceOrderSource = "manual" | "fluig";
export type MaintenanceOrderPriority = "CRITICA" | "ALTA" | "MEDIA" | "BAIXA";
export type MaintenanceOrderStatus =
  | "ABERTA"
  | "INICIADA"
  | "AGUARDANDO_MATERIAL"
  | "AGUARDANDO_TERCEIRO"
  | "FINALIZADA"
  | "CANCELADA";

export type MaintenancePhotoInput = {
  name: string;
  size?: number | null;
  type?: string | null;
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
  requester?: string | null;
  technician?: string | null;
  branchId?: string | null;
  dueAt?: string | null;
  materialSummary?: string | null;
  materialCostCents?: number | null;
  materials?: MaintenanceMaterialInput[];
  photos?: MaintenancePhotoInput[];
  pendingReason?: string | null;
  fluigRequestId?: string | null;
  fluigNumLancW?: string | null;
  fluigCurrentTask?: string | null;
  fluigTaskOwner?: string | null;
  metadata?: JsonRecord;
};

export type MaintenanceOrderUpdateInput = Partial<MaintenanceOrderInput> & {
  status?: MaintenanceOrderStatus;
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
  const status = upperText<MaintenanceOrderStatus>(input.status, "ABERTA");
  const now = new Date().toISOString();

  return {
    code: `OS-${Date.now().toString(36).toUpperCase()}`,
    source: input.source === "fluig" ? "fluig" : "manual",
    title,
    description,
    area,
    priority: upperText<MaintenanceOrderPriority>(input.priority, "MEDIA"),
    status,
    requester: cleanText(input.requester) || actor.displayName,
    requester_user_id: actor.id,
    technician: cleanText(input.technician),
    branch_id: branch?.id || null,
    branch_code: branch?.code || null,
    branch_label: branch?.fluigLabel || branch?.name || null,
    due_at: cleanText(input.dueAt),
    started_at: status === "INICIADA" ? now : null,
    finished_at: status === "FINALIZADA" ? now : null,
    material_summary: cleanText(input.materialSummary),
    material_cost_cents: centsFromInput(input.materialCostCents),
    materials: sanitizeMaterials(input.materials),
    photos: sanitizePhotos(input.photos),
    pending_reason: cleanText(input.pendingReason),
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

  if ("source" in input) payload.source = input.source === "fluig" ? "fluig" : "manual";
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
  if ("status" in input) {
    const nextStatus = upperText<MaintenanceOrderStatus>(input.status, current.status);
    payload.status = nextStatus;
    if (nextStatus === "INICIADA" && !current.started_at) payload.started_at = new Date().toISOString();
    if (nextStatus === "FINALIZADA" && !current.finished_at) payload.finished_at = new Date().toISOString();
    if (nextStatus !== "FINALIZADA") payload.finished_at = null;
  }
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
  return Boolean(order.branch_code && actor.branchCodes.includes(order.branch_code));
}

function actorCanMutateOrder(actor: AppActor, order: MaintenanceOrderDbRow) {
  if (actor.isAdmin) return true;
  if (order.created_by_user_id === actor.id || order.requester_user_id === actor.id || order.technician_user_id === actor.id) return true;
  return Boolean(order.branch_code && actor.branchCodes.includes(order.branch_code));
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

function buildCounts(rows: MaintenanceOrderDbRow[]): OrderCounts {
  return {
    open: rows.filter((row) => !terminalStatuses.has(row.status)).length,
    started: rows.filter((row) => row.status === "INICIADA").length,
    waitingMaterial: rows.filter((row) => row.status === "AGUARDANDO_MATERIAL").length,
    finished: rows.filter((row) => row.status === "FINALIZADA").length,
    fluig: rows.filter((row) => row.source === "fluig").length,
    manual: rows.filter((row) => row.source === "manual").length,
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
  const client = assertServiceClient();
  const page = Math.max(Number(input.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(input.pageSize || 50), 1), 200);
  let query = client
    .from("app_maintenance_orders")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (input.status && input.status !== "ALL") query = query.eq("status", input.status);
  if (input.source && input.source !== "ALL") query = query.eq("source", input.source);

  const { data, error } = await query;
  if (error) throw error;

  const search = cleanText(input.search)?.toLowerCase();
  const visibleRows = ((data || []) as MaintenanceOrderDbRow[])
    .filter((row) => actorCanSeeOrder(actor, row))
    .filter((row) => {
      if (!search) return true;
      return [row.code, row.title, row.area, row.description, row.technician, row.branch_label, row.fluig_request_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    })
    .sort(sortOrders);

  const from = (page - 1) * pageSize;
  const items = visibleRows.slice(from, from + pageSize).map(mapOrder);

  return {
    page,
    pageSize,
    total: visibleRows.length,
    counts: buildCounts(visibleRows),
    branches: actor.branches,
    items,
  };
}

export async function readMaintenanceOrder(actor: AppActor, id: string) {
  const client = assertServiceClient();
  const { data, error } = await client.from("app_maintenance_orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as MaintenanceOrderDbRow;
  if (!actorCanSeeOrder(actor, row)) return null;
  return mapOrder(row);
}

export async function createMaintenanceOrder(actor: AppActor, input: MaintenanceOrderInput) {
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
  const client = assertServiceClient();
  const { data: currentData, error: currentError } = await client.from("app_maintenance_orders").select("*").eq("id", id).maybeSingle();
  if (currentError) throw currentError;
  if (!currentData) return null;

  const current = currentData as MaintenanceOrderDbRow;
  if (!actorCanMutateOrder(actor, current)) {
    throw new Error("Usuario sem acesso para atualizar esta OS.");
  }

  const payload = normalizeUpdateInput(actor, current, input);
  const { data, error } = await client.from("app_maintenance_orders").update(payload).eq("id", id).select("*").maybeSingle();
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
