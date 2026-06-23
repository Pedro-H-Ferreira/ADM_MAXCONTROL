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
  if ("fluigLabel" in input) payload.fluig_label = cleanText(input.fluigLabel);
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

async function countByField(client: SupabaseClient, table: string, field: string, ids: string[], extra?: { field: string; value: unknown }) {
  const counts = new Map<string, number>();
  if (!ids.length) return counts;
  let query = client.from(table).select(field).in(field, ids);
  if (extra) query = query.eq(extra.field, extra.value);
  const { data, error } = await query;
  if (error) throw error;
  for (const row of (data || []) as unknown as Array<Record<string, unknown>>) {
    const id = String((row as Record<string, unknown>)[field] || "");
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

export async function listAdminBranches(input: { search?: string | null; active?: boolean | null; page?: number; pageSize?: number }) {
  const client = assertServiceClient();
  const page = Math.max(Number(input.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(input.pageSize || 50), 1), 200);
  const from = (page - 1) * pageSize;

  let query = client
    .from("app_branches")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .order("code", { ascending: true });

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
  const [users, suppliers, openRequestsById, openRequestsByCode] = await Promise.all([
    countByField(client, "app_user_branch_access", "branch_id", ids),
    countByField(client, "app_supplier_branch_links", "branch_id", ids),
    countByField(client, "fluig_requests", "branch_id", ids, { field: "is_open", value: true }),
    countByField(client, "fluig_requests", "branch_code", codes, { field: "is_open", value: true }),
  ]);

  return {
    page,
    pageSize,
    total: count || 0,
    items: rows.map((row) =>
      mapBranch(row, {
        users: users.get(row.id) || 0,
        suppliers: suppliers.get(row.id) || 0,
        requests: (openRequestsById.get(row.id) || 0) + (openRequestsByCode.get(row.code) || 0),
      })
    ),
  };
}

export async function readAdminBranch(id: string) {
  const client = assertServiceClient();
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
  const { data, error } = await client
    .from("app_branches")
    .insert({
      ...payload,
      active: input.active !== false,
      metadata: input.metadata || {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapBranch(data as BranchDbRow);
}

export async function updateBranch(actor: AppActor, id: string, input: Partial<BranchInput>) {
  assertBranchAction(actor, "canUpdate");
  const client = assertServiceClient();
  const payload = normalizeBranchPayload(input);
  const { data, error } = await client.from("app_branches").update(payload).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data ? mapBranch(data as BranchDbRow) : null;
}

export async function deleteBranch(actor: AppActor, id: string) {
  assertBranchAction(actor, "canUpdate");
  const client = assertServiceClient();
  const [userLinks, supplierLinks, requests] = await Promise.all([
    client.from("app_user_branch_access").select("branch_id", { count: "exact", head: true }).eq("branch_id", id),
    client.from("app_supplier_branch_links").select("branch_id", { count: "exact", head: true }).eq("branch_id", id),
    client.from("fluig_requests").select("branch_id", { count: "exact", head: true }).eq("branch_id", id),
  ]);
  if (userLinks.error) throw userLinks.error;
  if (supplierLinks.error) throw supplierLinks.error;
  if (requests.error) throw requests.error;

  const hasLinks = Boolean((userLinks.count || 0) + (supplierLinks.count || 0) + (requests.count || 0));
  if (hasLinks) {
    const { error } = await client
      .from("app_branches")
      .update({ active: false, deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return { deleted: false, softDeleted: true };
  }

  const { error } = await client.from("app_branches").delete().eq("id", id);
  if (error) throw error;
  return { deleted: true, softDeleted: false };
}
