import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";
import { canActorPerformPageAction, type AppActor } from "@/lib/db/app-repository";

type JsonRecord = Record<string, unknown>;

export type BranchInput = {
  code: string;
  name: string;
  fluigLabel?: string | null;
  region?: string | null;
  city?: string | null;
  uf?: string | null;
  active?: boolean;
  metadata?: JsonRecord;
};

type BranchDbRow = {
  id: string;
  code: string;
  name: string;
  fluig_label: string | null;
  region: string | null;
  city: string | null;
  uf: string | null;
  active: boolean;
  metadata: JsonRecord | null;
  last_fluig_sync_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

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

function normalizeCode(value: unknown) {
  const code = cleanText(value);
  if (!code) throw new Error("Codigo da filial e obrigatorio.");
  return code.toUpperCase();
}

function normalizeBranchPayload(input: BranchInput | Partial<BranchInput>) {
  const payload: Record<string, unknown> = {};
  if ("code" in input) payload.code = normalizeCode(input.code);
  if ("name" in input) {
    const name = cleanText(input.name);
    if (!name) throw new Error("Nome da filial e obrigatorio.");
    payload.name = name;
  }
  if ("fluigLabel" in input) payload.fluigLabel = cleanText(input.fluigLabel);
  if ("region" in input) payload.region = cleanText(input.region);
  if ("city" in input) payload.city = cleanText(input.city);
  if ("uf" in input) payload.uf = cleanText(input.uf)?.toUpperCase() || null;
  if ("active" in input) payload.active = input.active !== false;
  if ("metadata" in input) payload.metadata = input.metadata || {};
  return payload;
}

function mapBranch(row: BranchDbRow, counts: { users?: number; suppliers?: number; requests?: number } = {}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    fluigLabel: row.fluig_label,
    region: row.region,
    city: row.city,
    uf: row.uf,
    active: row.active,
    metadata: row.metadata || {},
    lastFluigSyncAt: row.last_fluig_sync_at,
    usersCount: counts.users || 0,
    suppliersCount: counts.suppliers || 0,
    openRequestsCount: counts.requests || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

async function listScopedBranchIds(client: SupabaseClient, actor: AppActor) {
  if (actor.isAdmin) return null;
  const { data, error } = await client
    .from("app_user_branch_access")
    .select("branch_id")
    .eq("user_id", actor.id)
    .eq("can_view", true);
  if (error) throw error;
  return Array.from(new Set((data || []).map((row) => String(row.branch_id)).filter(Boolean)));
}

async function countVisibleUsersByBranch(client: SupabaseClient, branchIds: string[]) {
  const counts = new Map<string, number>();
  if (!branchIds.length) return counts;
  const accessResult = await client
    .from("app_user_branch_access")
    .select("branch_id,user_id")
    .in("branch_id", branchIds)
    .eq("can_view", true);
  if (accessResult.error) throw accessResult.error;
  const userIds = Array.from(new Set((accessResult.data || []).map((row) => String(row.user_id)).filter(Boolean)));
  if (!userIds.length) return counts;
  const profilesResult = await client
    .from("app_user_profiles")
    .select("id")
    .in("id", userIds)
    .eq("active", true)
    .eq("approval_status", "APPROVED");
  if (profilesResult.error) throw profilesResult.error;
  const visibleUsers = new Set((profilesResult.data || []).map((row) => String(row.id)));
  for (const row of accessResult.data || []) {
    if (!visibleUsers.has(String(row.user_id))) continue;
    const branchId = String(row.branch_id || "");
    if (branchId) counts.set(branchId, (counts.get(branchId) || 0) + 1);
  }
  return counts;
}

async function countActiveSuppliersByBranch(client: SupabaseClient, branchIds: string[]) {
  const counts = new Map<string, number>();
  if (!branchIds.length) return counts;
  const linksResult = await client
    .from("app_supplier_branch_links")
    .select("branch_id,supplier_id")
    .in("branch_id", branchIds);
  if (linksResult.error) throw linksResult.error;
  const supplierIds = Array.from(new Set((linksResult.data || []).map((row) => String(row.supplier_id)).filter(Boolean)));
  if (!supplierIds.length) return counts;
  const suppliersResult = await client
    .from("app_suppliers")
    .select("id")
    .in("id", supplierIds)
    .is("deleted_at", null);
  if (suppliersResult.error) throw suppliersResult.error;
  const activeSuppliers = new Set((suppliersResult.data || []).map((row) => String(row.id)));
  for (const row of linksResult.data || []) {
    if (!activeSuppliers.has(String(row.supplier_id))) continue;
    const branchId = String(row.branch_id || "");
    if (branchId) counts.set(branchId, (counts.get(branchId) || 0) + 1);
  }
  return counts;
}

export function aggregateOpenRequestCounts(
  rows: Array<{ id?: string | null; branch_id?: string | null; branch_code?: string | null }>,
  ids: string[],
  codes: string[]
) {
  const counts = new Map<string, number>();
  const idByCode = new Map(codes.map((code, index) => [code, ids[index]]));
  const seen = new Set<string>();
  for (const row of rows) {
    const requestId = String(row.id || "");
    if (!requestId || seen.has(requestId)) continue;
    seen.add(requestId);
    const branchId = String(row.branch_id || idByCode.get(String(row.branch_code || "")) || "");
    if (branchId) counts.set(branchId, (counts.get(branchId) || 0) + 1);
  }
  return counts;
}

async function countOpenRequestsByBranch(client: SupabaseClient, ids: string[], codes: string[]) {
  if (!ids.length) return new Map<string, number>();

  const [byIdResult, byCodeResult] = await Promise.all([
    client.from("fluig_requests").select("id,branch_id,branch_code").in("branch_id", ids).eq("is_open", true),
    client
      .from("fluig_requests")
      .select("id,branch_id,branch_code")
      .is("branch_id", null)
      .in("branch_code", codes)
      .eq("is_open", true),
  ]);
  if (byIdResult.error) throw byIdResult.error;
  if (byCodeResult.error) throw byCodeResult.error;

  return aggregateOpenRequestCounts(
    [...(byIdResult.data || []), ...(byCodeResult.data || [])],
    ids,
    codes
  );
}

export async function listAdminBranches(
  actor: AppActor,
  input: { search?: string | null; active?: boolean | null; page?: number; pageSize?: number }
) {
  const client = assertServiceClient();
  const page = Math.max(Number(input.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(input.pageSize || 50), 1), 200);
  const from = (page - 1) * pageSize;

  const scopedBranchIds = await listScopedBranchIds(client, actor);
  if (scopedBranchIds?.length === 0) {
    return { page, pageSize, total: 0, items: [] };
  }

  let query = client
    .from("app_branches")
    .select("*", { count: "exact" })
    .order("code", { ascending: true });

  if (scopedBranchIds) query = query.in("id", scopedBranchIds);

  const search = cleanText(input.search);
  if (search) {
    const pattern = `%${search.replace(/[%_]/g, "")}%`;
    query = query.or(`code.ilike.${pattern},name.ilike.${pattern},fluig_label.ilike.${pattern}`);
  }
  if (typeof input.active === "boolean") query = query.eq("active", input.active);

  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) throw error;

  const rows = (data || []) as BranchDbRow[];
  const ids = rows.map((row) => row.id);
  const codes = rows.map((row) => row.code);
  const [users, suppliers, openRequests] = await Promise.all([
    countVisibleUsersByBranch(client, ids),
    countActiveSuppliersByBranch(client, ids),
    countOpenRequestsByBranch(client, ids, codes),
  ]);

  return {
    page,
    pageSize,
    total: count || 0,
    items: rows.map((row) =>
      mapBranch(row, {
        users: users.get(row.id) || 0,
        suppliers: suppliers.get(row.id) || 0,
        requests: openRequests.get(row.id) || 0,
      })
    ),
  };
}

export async function readAdminBranch(actor: AppActor, id: string) {
  const client = assertServiceClient();
  const scopedBranchIds = await listScopedBranchIds(client, actor);
  if (scopedBranchIds && !scopedBranchIds.includes(id)) return null;
  const { data, error } = await client.from("app_branches").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapBranch(data as BranchDbRow);
}

function assertBranchAction(actor: AppActor, action: "canCreate" | "canUpdate") {
  if (!canActorPerformPageAction(actor, "configuracoes", action)) {
    throw new Error("Usuario sem permissao para alterar filiais.");
  }
}

export async function createBranch(actor: AppActor, input: BranchInput) {
  assertBranchAction(actor, "canCreate");
  const client = assertServiceClient();
  const payload = normalizeBranchPayload(input);
  const { data, error } = await client.rpc("save_app_branch", {
    p_actor_user_id: actor.id,
    p_branch_id: null,
    p_payload: payload,
  });
  if (error) throw error;
  return mapBranch(data as BranchDbRow);
}

export async function updateBranch(actor: AppActor, id: string, input: Partial<BranchInput>) {
  assertBranchAction(actor, "canUpdate");
  const client = assertServiceClient();
  const payload = normalizeBranchPayload(input);
  const { data, error } = await client.rpc("save_app_branch", {
    p_actor_user_id: actor.id,
    p_branch_id: id,
    p_payload: payload,
  });
  if (error) throw error;
  return data ? mapBranch(data as BranchDbRow) : null;
}

export async function deleteBranch(actor: AppActor, id: string) {
  assertBranchAction(actor, "canUpdate");
  const client = assertServiceClient();
  const { data, error } = await client.rpc("delete_app_branch", {
    p_actor_user_id: actor.id,
    p_branch_id: id,
  });
  if (error) throw error;
  return data as { deleted: boolean; softDeleted: boolean; relationCount: number };
}
