import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCnpj, isValidCnpj, normalizeCnpj, onlyDigits } from "@/lib/cnpj";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";
import type { AppActor } from "@/lib/db/app-repository";

type JsonRecord = Record<string, unknown>;

export type SupplierStatus = "ATIVO" | "PENDENTE_REVISAO" | "INATIVO";
export type SupplierSourceSystem = "LOCAL" | "FLUIG" | "LOCAL_FLUIG" | "PRE_CADASTRO_FLUIG";
export type SupplierSyncStatus = "NAO_SINCRONIZADO" | "SINCRONIZADO" | "PENDENTE_REVISAO" | "ERRO_SYNC";

export type SupplierInput = {
  cnpj?: string | null;
  razaoSocial: string;
  nomeFantasia?: string | null;
  inscricaoEstadual?: string | null;
  inscricaoMunicipal?: string | null;
  categoria?: string | null;
  status?: SupplierStatus;
  email?: string | null;
  telefone?: string | null;
  contatoPrincipal?: string | null;
  contatos?: JsonRecord[];
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  pais?: string | null;
  observacoes?: string | null;
  fluigName?: string | null;
  fluigCode?: string | null;
  fluigSupplierLabel?: string | null;
  defaultSourceRequestId?: string | null;
  defaultPayload?: JsonRecord;
  sourceSystem?: SupplierSourceSystem;
  syncStatus?: SupplierSyncStatus;
  branchIds?: string[];
};

type SupplierDbRow = {
  id: string;
  cnpj: string | null;
  cnpj_normalizado: string | null;
  razao_social: string;
  nome_fantasia: string | null;
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
  categoria: string | null;
  status: SupplierStatus;
  email: string | null;
  telefone: string | null;
  contato_principal: string | null;
  contatos: JsonRecord[] | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  pais: string | null;
  observacoes: string | null;
  fluig_name: string | null;
  fluig_code: string | null;
  fluig_supplier_label: string | null;
  default_source_request_id: string | null;
  default_payload: JsonRecord | null;
  source_system: SupplierSourceSystem;
  sync_status: SupplierSyncStatus;
  last_fluig_sync_at: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type BranchLinkRow = {
  supplier_id: string;
  branch_id: string;
  default_branch: boolean;
  branch?: {
    id: string;
    code: string;
    name: string;
    fluig_label: string | null;
    active: boolean;
  } | null;
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

function upperText(value: unknown) {
  return cleanText(value)?.toUpperCase() || null;
}

function normalizeSupplierInput(input: SupplierInput, actor: AppActor) {
  const normalizedCnpj = normalizeCnpj(input.cnpj);
  if (normalizedCnpj && !isValidCnpj(normalizedCnpj)) {
    throw new Error("CNPJ invalido.");
  }

  const razaoSocial = cleanText(input.razaoSocial);
  if (!razaoSocial) {
    throw new Error("Razao social e obrigatoria.");
  }

  return {
    cnpj: normalizedCnpj ? formatCnpj(normalizedCnpj) : null,
    cnpj_normalizado: normalizedCnpj,
    razao_social: razaoSocial,
    nome_fantasia: cleanText(input.nomeFantasia),
    inscricao_estadual: cleanText(input.inscricaoEstadual),
    inscricao_municipal: cleanText(input.inscricaoMunicipal),
    categoria: upperText(input.categoria),
    status: input.status || "ATIVO",
    email: cleanText(input.email)?.toLowerCase() || null,
    telefone: cleanText(input.telefone),
    contato_principal: cleanText(input.contatoPrincipal),
    contatos: Array.isArray(input.contatos) ? input.contatos : [],
    cep: cleanText(input.cep),
    endereco: cleanText(input.endereco),
    numero: cleanText(input.numero),
    complemento: cleanText(input.complemento),
    bairro: cleanText(input.bairro),
    cidade: cleanText(input.cidade),
    uf: upperText(input.uf),
    pais: upperText(input.pais) || "BR",
    observacoes: cleanText(input.observacoes),
    fluig_name: cleanText(input.fluigName),
    fluig_code: cleanText(input.fluigCode),
    fluig_supplier_label: cleanText(input.fluigSupplierLabel),
    default_source_request_id: cleanText(input.defaultSourceRequestId),
    default_payload: input.defaultPayload || {},
    source_system: input.sourceSystem || "LOCAL",
    sync_status: input.syncStatus || "NAO_SINCRONIZADO",
    updated_by_user_id: actor.id,
  };
}

function supplierCanBeSeenByActor(actor: AppActor, supplierId: string, linksBySupplier: Map<string, BranchLinkRow[]>) {
  if (actor.isAdmin) return true;
  const links = linksBySupplier.get(supplierId) || [];
  if (!links.length) return true;
  const branchCodes = new Set(actor.branchCodes);
  return links.some((link) => link.branch?.code && branchCodes.has(link.branch.code));
}

function mapSupplier(row: SupplierDbRow, links: BranchLinkRow[] = [], requestCount = 0) {
  return {
    id: row.id,
    cnpj: row.cnpj,
    cnpjNormalizado: row.cnpj_normalizado,
    cnpjFormatado: row.cnpj_normalizado ? formatCnpj(row.cnpj_normalizado) : null,
    razaoSocial: row.razao_social,
    nomeFantasia: row.nome_fantasia,
    inscricaoEstadual: row.inscricao_estadual,
    inscricaoMunicipal: row.inscricao_municipal,
    categoria: row.categoria,
    status: row.status,
    email: row.email,
    telefone: row.telefone,
    contatoPrincipal: row.contato_principal,
    contatos: row.contatos || [],
    endereco: {
      cep: row.cep,
      endereco: row.endereco,
      numero: row.numero,
      complemento: row.complemento,
      bairro: row.bairro,
      cidade: row.cidade,
      uf: row.uf,
      pais: row.pais,
    },
    observacoes: row.observacoes,
    fluig: {
      name: row.fluig_name,
      code: row.fluig_code,
      supplierLabel: row.fluig_supplier_label,
      defaultSourceRequestId: row.default_source_request_id,
      defaultPayload: row.default_payload || {},
      lastSyncAt: row.last_fluig_sync_at,
    },
    sourceSystem: row.source_system,
    syncStatus: row.sync_status,
    requestCount,
    branches: links.map((link) => ({
      id: link.branch_id,
      code: link.branch?.code || null,
      name: link.branch?.name || null,
      fluigLabel: link.branch?.fluig_label || null,
      active: Boolean(link.branch?.active),
      defaultBranch: link.default_branch,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

async function fetchLinks(client: SupabaseClient, supplierIds: string[]) {
  const linksBySupplier = new Map<string, BranchLinkRow[]>();
  if (!supplierIds.length) return linksBySupplier;

  const { data, error } = await client
    .from("app_supplier_branch_links")
    .select("supplier_id,branch_id,default_branch,branch:app_branches(id,code,name,fluig_label,active)")
    .in("supplier_id", supplierIds);
  if (error) throw error;

  for (const row of (data || []) as unknown as BranchLinkRow[]) {
    linksBySupplier.set(row.supplier_id, [...(linksBySupplier.get(row.supplier_id) || []), row]);
  }

  return linksBySupplier;
}

async function fetchRequestCounts(client: SupabaseClient, supplierIds: string[]) {
  const counts = new Map<string, number>();
  if (!supplierIds.length) return counts;

  const { data, error } = await client
    .from("fluig_requests")
    .select("app_supplier_id")
    .in("app_supplier_id", supplierIds);
  if (error) throw error;

  for (const row of data || []) {
    const supplierId = String((row as { app_supplier_id?: string }).app_supplier_id || "");
    if (supplierId) counts.set(supplierId, (counts.get(supplierId) || 0) + 1);
  }

  return counts;
}

export async function listSuppliers(
  actor: AppActor,
  input: {
    search?: string | null;
    status?: string | null;
    sourceSystem?: string | null;
    syncStatus?: string | null;
    page?: number;
    pageSize?: number;
  }
) {
  const client = assertServiceClient();
  const page = Math.max(Number(input.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(input.pageSize || 25), 1), 100);
  const from = (page - 1) * pageSize;

  let query = client
    .from("app_suppliers")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .order("razao_social", { ascending: true });

  const search = cleanText(input.search);
  if (search) {
    const cnpj = onlyDigits(search);
    const pattern = `%${search.replace(/[%_]/g, "")}%`;
    query = query.or(
      [
        `razao_social.ilike.${pattern}`,
        `nome_fantasia.ilike.${pattern}`,
        `fluig_code.ilike.${pattern}`,
        `fluig_name.ilike.${pattern}`,
        cnpj ? `cnpj_normalizado.ilike.%${cnpj}%` : "",
      ].filter(Boolean).join(",")
    );
  }

  if (input.status) query = query.eq("status", input.status);
  if (input.sourceSystem) query = query.eq("source_system", input.sourceSystem);
  if (input.syncStatus) query = query.eq("sync_status", input.syncStatus);

  const queryLimitMultiplier = actor.isAdmin ? 1 : 5;
  const { data, error, count } = await query.range(from, from + pageSize * queryLimitMultiplier - 1);
  if (error) throw error;

  const rows = (data || []) as SupplierDbRow[];
  const supplierIds = rows.map((row) => row.id);
  const [linksBySupplier, requestCounts] = await Promise.all([
    fetchLinks(client, supplierIds),
    fetchRequestCounts(client, supplierIds),
  ]);
  const visibleRows = rows.filter((row) => supplierCanBeSeenByActor(actor, row.id, linksBySupplier)).slice(0, pageSize);

  return {
    page,
    pageSize,
    total: actor.isAdmin ? count || 0 : visibleRows.length,
    items: visibleRows.map((row) => mapSupplier(row, linksBySupplier.get(row.id), requestCounts.get(row.id) || 0)),
  };
}

async function assertNoDuplicateCnpj(client: SupabaseClient, cnpj: string | null, exceptId?: string) {
  if (!cnpj) return;
  let query = client
    .from("app_suppliers")
    .select("id,razao_social")
    .eq("cnpj_normalizado", cnpj)
    .is("deleted_at", null)
    .limit(1);
  if (exceptId) query = query.neq("id", exceptId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (data) {
    throw new Error(`Fornecedor ja cadastrado para o CNPJ ${formatCnpj(cnpj)}.`);
  }
}

async function replaceBranchLinks(client: SupabaseClient, supplierId: string, branchIds: string[] | undefined) {
  if (!branchIds) return;
  const uniqueBranchIds = Array.from(new Set(branchIds.filter(Boolean)));
  const { error: deleteError } = await client.from("app_supplier_branch_links").delete().eq("supplier_id", supplierId);
  if (deleteError) throw deleteError;

  if (uniqueBranchIds.length) {
    const { error: insertError } = await client.from("app_supplier_branch_links").insert(
      uniqueBranchIds.map((branchId, index) => ({
        supplier_id: supplierId,
        branch_id: branchId,
        default_branch: index === 0,
      }))
    );
    if (insertError) throw insertError;
  }
}

async function recordSupplierAudit(
  client: SupabaseClient,
  input: {
    supplierId: string;
    actorId: string;
    eventType: string;
    beforePayload?: unknown;
    afterPayload?: unknown;
    metadata?: JsonRecord;
  }
) {
  const { error } = await client.from("app_supplier_audit_events").insert({
    supplier_id: input.supplierId,
    actor_user_id: input.actorId,
    event_type: input.eventType,
    before_payload: input.beforePayload || null,
    after_payload: input.afterPayload || null,
    metadata: input.metadata || {},
  });
  if (error) throw error;
}

export async function createSupplier(actor: AppActor, input: SupplierInput) {
  const client = assertServiceClient();
  const payload = normalizeSupplierInput(input, actor);
  await assertNoDuplicateCnpj(client, payload.cnpj_normalizado);

  const { data, error } = await client
    .from("app_suppliers")
    .insert({
      ...payload,
      created_by_user_id: actor.id,
    })
    .select("*")
    .single();
  if (error) throw error;

  const supplier = data as SupplierDbRow;
  await replaceBranchLinks(client, supplier.id, input.branchIds);
  await recordSupplierAudit(client, {
    supplierId: supplier.id,
    actorId: actor.id,
    eventType: "created",
    afterPayload: supplier,
  });

  return readSupplier(actor, supplier.id);
}

export async function readSupplier(actor: AppActor, id: string) {
  const client = assertServiceClient();
  const { data, error } = await client.from("app_suppliers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as SupplierDbRow;
  const [linksBySupplier, requestCounts] = await Promise.all([
    fetchLinks(client, [row.id]),
    fetchRequestCounts(client, [row.id]),
  ]);

  if (!supplierCanBeSeenByActor(actor, row.id, linksBySupplier)) return null;
  return mapSupplier(row, linksBySupplier.get(row.id), requestCounts.get(row.id) || 0);
}

export async function updateSupplier(actor: AppActor, id: string, input: Partial<SupplierInput>) {
  const client = assertServiceClient();
  const { data: before, error: beforeError } = await client.from("app_suppliers").select("*").eq("id", id).maybeSingle();
  if (beforeError) throw beforeError;
  if (!before) return null;

  const current = before as SupplierDbRow;
  const payload = normalizeSupplierInput(
    {
      razaoSocial: current.razao_social,
      cnpj: current.cnpj_normalizado,
      ...input,
    } as SupplierInput,
    actor
  );
  await assertNoDuplicateCnpj(client, payload.cnpj_normalizado, id);

  const { data, error } = await client.from("app_suppliers").update(payload).eq("id", id).select("*").single();
  if (error) throw error;
  await replaceBranchLinks(client, id, input.branchIds);
  await recordSupplierAudit(client, {
    supplierId: id,
    actorId: actor.id,
    eventType: "updated",
    beforePayload: before,
    afterPayload: data,
  });
  return readSupplier(actor, id);
}

export async function deleteSupplier(actor: AppActor, id: string) {
  const client = assertServiceClient();
  const { count: requestCount, error: requestError } = await client
    .from("fluig_requests")
    .select("id", { count: "exact", head: true })
    .eq("app_supplier_id", id);
  if (requestError) throw requestError;

  const { count: linkCount, error: linkError } = await client
    .from("fluig_supplier_links")
    .select("id", { count: "exact", head: true })
    .eq("app_supplier_id", id);
  if (linkError) throw linkError;

  if ((requestCount || 0) > 0 || (linkCount || 0) > 0) {
    const { data, error } = await client
      .from("app_suppliers")
      .update({
        status: "INATIVO",
        deleted_at: new Date().toISOString(),
        updated_by_user_id: actor.id,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    await recordSupplierAudit(client, {
      supplierId: id,
      actorId: actor.id,
      eventType: "soft_deleted",
      afterPayload: data,
      metadata: { requestCount, linkCount },
    });
    return { deleted: false, softDeleted: true };
  }

  await recordSupplierAudit(client, {
    supplierId: id,
    actorId: actor.id,
    eventType: "deleted",
    metadata: { requestCount, linkCount },
  });
  const { error } = await client.from("app_suppliers").delete().eq("id", id);
  if (error) throw error;
  return { deleted: true, softDeleted: false };
}

function suggestionFromCandidate(row: Record<string, unknown>) {
  const defaults = (row.suggested_defaults || {}) as JsonRecord;
  const sourceRequestIds = Array.isArray(row.source_request_ids) ? row.source_request_ids : [];
  return {
    candidateId: row.id,
    razaoSocial: row.supplier_name,
    cnpj: row.cnpj,
    fluigName: row.fluig_name,
    fluigCode: row.fluig_code,
    defaultSourceRequestId: defaults.sourceRequestId || sourceRequestIds[0] || null,
    defaultPayload: defaults,
    confidence: row.confidence,
    sourceRequestIds,
  };
}

export async function lookupSupplierByCnpj(actor: AppActor, rawCnpj: string) {
  const client = assertServiceClient();
  const cnpj = normalizeCnpj(rawCnpj);
  if (!cnpj || !isValidCnpj(cnpj)) {
    throw new Error("CNPJ invalido.");
  }

  const { data: local, error: localError } = await client
    .from("app_suppliers")
    .select("*")
    .eq("cnpj_normalizado", cnpj)
    .is("deleted_at", null)
    .maybeSingle();
  if (localError) throw localError;
  if (local) {
    const supplier = await readSupplier(actor, String(local.id));
    return {
      source: "local" as const,
      supplier,
      suggestions: {},
      warnings: ["Fornecedor ja cadastrado. Deseja abrir o cadastro existente?"],
    };
  }

  const { data: candidate, error: candidateError } = await client
    .from("fluig_supplier_candidates")
    .select("*")
    .eq("cnpj", cnpj)
    .neq("status", "IGNORADO")
    .order("confidence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (candidateError) throw candidateError;
  if (candidate) {
    return {
      source: "fluig_candidate" as const,
      supplier: null,
      suggestions: suggestionFromCandidate(candidate as Record<string, unknown>),
      warnings: [],
    };
  }

  const { data: catalogRows, error: catalogError } = await client
    .from("fluig_catalog_items")
    .select("label,value,code,source_request_id,metadata,last_seen_at")
    .eq("catalog_type", "supplier")
    .limit(1000);
  if (catalogError) throw catalogError;
  const catalog = (catalogRows || []).find((row) => {
    const metadata = ((row as { metadata?: JsonRecord }).metadata || {}) as JsonRecord;
    return onlyDigits(metadata.cnpj) === cnpj || onlyDigits((row as { value?: string }).value) === cnpj;
  }) as Record<string, unknown> | undefined;
  if (catalog) {
    const metadata = (catalog.metadata || {}) as JsonRecord;
    return {
      source: "fluig_catalog" as const,
      supplier: null,
      suggestions: {
        razaoSocial: catalog.label,
        cnpj,
        fluigCode: catalog.code || null,
        fluigName: metadata.fluigName || catalog.value || catalog.label,
        defaultSourceRequestId: catalog.source_request_id || metadata.latestRequest || null,
        defaultPayload: metadata,
      },
      warnings: [],
    };
  }

  const { data: request, error: requestError } = await client
    .from("fluig_requests")
    .select("fluig_request_id,supplier_name,supplier_cnpj,branch_code,branch_label,raw_payload,last_synced_at")
    .eq("supplier_cnpj", cnpj)
    .order("last_synced_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (requestError) throw requestError;
  if (request) {
    return {
      source: "fluig_request" as const,
      supplier: null,
      suggestions: {
        razaoSocial: request.supplier_name,
        cnpj: request.supplier_cnpj,
        defaultSourceRequestId: request.fluig_request_id,
        defaultPayload: {
          branchCode: request.branch_code,
          branchLabel: request.branch_label,
          latestRequest: request.fluig_request_id,
          rawPayload: request.raw_payload,
        },
      },
      warnings: [],
    };
  }

  return {
    source: "not_found" as const,
    supplier: null,
    suggestions: {},
    warnings: [],
  };
}

export async function approveSupplierCandidate(actor: AppActor, candidateId: string) {
  const client = assertServiceClient();
  const { data: candidate, error } = await client.from("fluig_supplier_candidates").select("*").eq("id", candidateId).maybeSingle();
  if (error) throw error;
  if (!candidate) throw new Error("Candidato Fluig nao encontrado.");

  const row = candidate as Record<string, unknown>;
  const suggestions = suggestionFromCandidate(row);
  const supplier = await createSupplier(actor, {
    cnpj: String(row.cnpj || ""),
    razaoSocial: String(row.supplier_name || row.fluig_name || "Fornecedor Fluig"),
    fluigName: String(row.fluig_name || row.supplier_name || ""),
    fluigCode: String(row.fluig_code || ""),
    fluigSupplierLabel: String(row.fluig_name || row.supplier_name || ""),
    defaultSourceRequestId: String(suggestions.defaultSourceRequestId || ""),
    defaultPayload: suggestions.defaultPayload as JsonRecord,
    sourceSystem: "PRE_CADASTRO_FLUIG",
    syncStatus: "PENDENTE_REVISAO",
  });

  const { error: updateError } = await client.from("fluig_supplier_candidates").update({ status: "APROVADO" }).eq("id", candidateId);
  if (updateError) throw updateError;

  const createdSupplier = supplier;
  const linkPayload = {
    candidate_id: candidateId,
    app_supplier_id: createdSupplier?.id,
    adm_supplier_id: createdSupplier?.id,
    supplier_name: createdSupplier?.razaoSocial || String(row.supplier_name || "Fornecedor Fluig"),
    cnpj: String(row.cnpj || "") || null,
    fluig_name: String(row.fluig_name || "") || null,
    fluig_code: String(row.fluig_code || "") || null,
    default_source_request_id: String(suggestions.defaultSourceRequestId || "") || null,
    default_payload: suggestions.defaultPayload || {},
    active: true,
  };
  const { data: existingLink, error: existingLinkError } = await client
    .from("fluig_supplier_links")
    .select("id")
    .eq("candidate_id", candidateId)
    .maybeSingle();
  if (existingLinkError) throw existingLinkError;

  if (existingLink) {
    const { error: linkUpdateError } = await client
      .from("fluig_supplier_links")
      .update(linkPayload)
      .eq("id", existingLink.id);
    if (linkUpdateError) throw linkUpdateError;
  } else {
    const { error: linkInsertError } = await client.from("fluig_supplier_links").insert(linkPayload);
    if (linkInsertError) throw linkInsertError;
  }

  return createdSupplier;
}

export async function ignoreSupplierCandidate(actor: AppActor, candidateId: string) {
  const client = assertServiceClient();
  const { data, error } = await client
    .from("fluig_supplier_candidates")
    .update({ status: "IGNORADO" })
    .eq("id", candidateId)
    .select("*")
    .single();
  if (error) throw error;

  await client.from("app_supplier_audit_events").insert({
    actor_user_id: actor.id,
    event_type: "candidate_ignored",
    after_payload: data,
  });

  return data;
}
