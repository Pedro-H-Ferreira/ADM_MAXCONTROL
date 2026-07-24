import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalHistoricalCnpj, formatCnpj, isValidCnpj, normalizeCnpj, onlyDigits } from "@/lib/cnpj";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";
import { AppAuthError, filterRowsForActor, type AppActor } from "@/lib/db/app-repository";
import type { FluigHistoryItem } from "@/lib/fluig/server-client";
import { buildFluigActorPostgrestFilter } from "@/lib/fluig-visibility";
import type { SupplierListFilters } from "@/lib/supplier-list-filters";
import { canActorAccessSupplierBranches } from "@/lib/supplier-permissions";
import {
  historicalCnpjMatches,
  historicalCnpjVariants,
  mergeSuggestionWithEvidence,
  normalizedLookupDefaults,
  payloadFormFields,
  withLookupReview,
  type SupplierRequestEvidence,
} from "@/lib/supplier-lookup";
import {
  consolidateSupplierPreRegistrations,
  supplierLegalName,
  type SupplierPreRegistrationCandidate,
} from "@/lib/supplier-pre-registration";

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

type SupplierLinkedRequestDbRow = {
  id: string;
  app_supplier_id: string;
  module_slug: string;
  fluig_request_id: string | null;
  status: string | null;
  normalized_status: string | null;
  is_open: boolean | null;
  current_task: string | null;
  task_owner: string | null;
  requester: string | null;
  branch_code: string | null;
  branch_label: string | null;
  supplier_name: string | null;
  opened_at: string | null;
  due_date: string | null;
  last_synced_at: string | null;
  last_status_check_at: string | null;
  last_seen_in_user_open_list_at: string | null;
  created_by_user_id: string | null;
  sync_owner_user_id: string | null;
  fluig_requester_login: string | null;
  fluig_requester_code: string | null;
};

type SupplierPreRegistrationDbRow = {
  id: string;
  candidate_key: string;
  supplier_name: string;
  cnpj: string | null;
  fluig_name: string | null;
  fluig_code: string | null;
  confidence: number | string | null;
  source_request_ids: string[] | null;
  suggested_defaults: JsonRecord | null;
  status: string;
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

function firstText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = cleanText(record[key]);
    if (value) return value;
  }

  return null;
}

function upperText(value: unknown) {
  return cleanText(value)?.toUpperCase() || null;
}

function leadingCode(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const match = text.match(/^([A-Za-z0-9._-]+)\s*(?:-|\/|\s)/);
  return match?.[1]?.trim() || null;
}

function supplierDefaultsFromHistory(item: FluigHistoryItem | null, resultPayload?: JsonRecord) {
  if (!item) return {};
  const fields = item.formFields || {};
  return {
    sourceRequestId: item.processInstanceId || null,
    processId: item.processId || null,
    processVersion: item.processVersion || null,
    centroCusto: fields.centroCusto || null,
    codCentroCusto: fields.codCentroCusto || null,
    natureza: fields.codigonaturezaC || fields.naturezaSalva || null,
    formaPagamento: fields.formaPagamento || null,
    unidadeFilial: fields.unidadeFilial || null,
    fornecedorBruto: fields.fornecedorC || fields.fornecedor || null,
    latestFields: fields,
    lookup: resultPayload?.lookup || (resultPayload?.data as JsonRecord | undefined)?.lookup || null,
  };
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
  const links = linksBySupplier.get(supplierId) || [];
  return canActorAccessSupplierBranches(actor, links.map((link) => link.branch?.code));
}

async function validateSupplierBranchScope(
  client: SupabaseClient,
  actor: AppActor,
  branchIds: string[] | undefined,
  options: { requiredForScopedActor?: boolean } = {}
) {
  if (branchIds === undefined) return undefined;
  const uniqueBranchIds = Array.from(new Set(branchIds.filter(Boolean)));

  if (!actor.isAdmin && options.requiredForScopedActor && uniqueBranchIds.length === 0) {
    throw new AppAuthError(
      "Selecione ao menos uma filial permitida para o fornecedor.",
      403,
      "SUPPLIER_BRANCH_REQUIRED"
    );
  }

  if (!uniqueBranchIds.length) return [];
  const { data, error } = await client
    .from("app_branches")
    .select("id,code,active")
    .in("id", uniqueBranchIds)
    .is("deleted_at", null);
  if (error) throw error;

  const existing = new Set((data || []).filter((branch) => branch.active).map((branch) => String(branch.id)));
  if (existing.size !== uniqueBranchIds.length) {
    throw new Error("Uma ou mais filiais selecionadas nao existem ou estao inativas.");
  }

  if (!actor.isAdmin) {
    const allowed = new Set(actor.branches.filter((branch) => branch.active).map((branch) => branch.id));
    if (uniqueBranchIds.some((branchId) => !allowed.has(branchId))) {
      throw new AppAuthError(
        "Usuario sem permissao para vincular fornecedor a uma das filiais selecionadas.",
        403,
        "SUPPLIER_BRANCH_FORBIDDEN"
      );
    }
  }

  return uniqueBranchIds;
}

async function assertSupplierMutationScope(client: SupabaseClient, actor: AppActor, supplierId: string) {
  if (actor.isAdmin) return;
  const links = await fetchLinks(client, [supplierId]);
  if (!supplierCanBeSeenByActor(actor, supplierId, links)) {
    throw new AppAuthError(
      "Usuario sem permissao para alterar fornecedor desta filial.",
      403,
      "SUPPLIER_SCOPE_FORBIDDEN"
    );
  }
}

function requestActivityTimestamp(row: SupplierLinkedRequestDbRow) {
  const value = row.last_status_check_at || row.last_synced_at || row.last_seen_in_user_open_list_at || row.opened_at || "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapSupplierLinkedRequest(row: SupplierLinkedRequestDbRow) {
  return {
    id: row.id,
    module: row.module_slug,
    fluigRequestId: row.fluig_request_id || "",
    status: row.status,
    normalizedStatus: row.normalized_status,
    isOpen: row.is_open,
    currentTask: row.current_task,
    taskOwner: row.task_owner,
    requester: row.requester,
    branchCode: row.branch_code,
    branchLabel: row.branch_label,
    supplierName: row.supplier_name,
    openedAt: row.opened_at,
    dueDate: row.due_date,
    lastSyncedAt: row.last_synced_at,
    lastStatusCheckAt: row.last_status_check_at,
    lastSeenInUserOpenListAt: row.last_seen_in_user_open_list_at,
  };
}

function mapSupplier(
  row: SupplierDbRow,
  links: BranchLinkRow[] = [],
  requestCount = 0,
  requests: SupplierLinkedRequestDbRow[] = []
) {
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
    requests: requests.map(mapSupplierLinkedRequest),
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

async function fetchRequestCounts(client: SupabaseClient, actor: AppActor, supplierIds: string[]) {
  const counts = new Map<string, number>();
  if (!supplierIds.length) return counts;

  let query = client
    .from("fluig_requests")
    .select(
      "app_supplier_id,branch_code,created_by_user_id,sync_owner_user_id,fluig_requester_login,fluig_requester_code,requester"
    )
    .in("app_supplier_id", supplierIds);
  const actorFilter = buildFluigActorPostgrestFilter(actor);
  if (actorFilter) query = query.or(actorFilter);
  const { data, error } = await query;
  if (error) throw error;

  const visibleRows = filterRowsForActor(actor, (data || []) as unknown as SupplierLinkedRequestDbRow[]);
  for (const row of visibleRows) {
    const supplierId = String((row as { app_supplier_id?: string }).app_supplier_id || "");
    if (supplierId) counts.set(supplierId, (counts.get(supplierId) || 0) + 1);
  }

  return counts;
}

async function fetchSupplierRequestSummaries(
  client: SupabaseClient,
  actor: AppActor,
  supplierIds: string[],
  perSupplier = 3
) {
  const requestsBySupplier = new Map<string, SupplierLinkedRequestDbRow[]>();
  if (!supplierIds.length || perSupplier <= 0) return requestsBySupplier;

  for (const supplierIdBatch of chunksOf(supplierIds, 50)) {
    let query = client
      .from("fluig_requests")
      .select(
        [
          "id",
          "app_supplier_id",
          "module_slug",
          "fluig_request_id",
          "status",
          "normalized_status",
          "is_open",
          "current_task",
          "task_owner",
          "requester",
          "branch_code",
          "branch_label",
          "supplier_name",
          "opened_at",
          "due_date",
          "last_synced_at",
          "last_status_check_at",
          "last_seen_in_user_open_list_at",
          "created_by_user_id",
          "sync_owner_user_id",
          "fluig_requester_login",
          "fluig_requester_code",
        ].join(",")
      )
      .in("app_supplier_id", supplierIdBatch);
    const actorFilter = buildFluigActorPostgrestFilter(actor);
    if (actorFilter) query = query.or(actorFilter);
    const { data, error } = await query
      .order("last_status_check_at", { ascending: false, nullsFirst: false })
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(Math.min(Math.max(supplierIdBatch.length * perSupplier * 3, perSupplier), 300));
    if (error) throw error;

    const visibleRows = filterRowsForActor(actor, (data || []) as unknown as SupplierLinkedRequestDbRow[]);
    for (const row of visibleRows) {
      const supplierId = String(row.app_supplier_id || "");
      if (!supplierId) continue;
      const current = requestsBySupplier.get(supplierId) || [];
      current.push(row);
      current.sort((left, right) => requestActivityTimestamp(right) - requestActivityTimestamp(left));
      requestsBySupplier.set(supplierId, current.slice(0, perSupplier));
    }
  }

  return requestsBySupplier;
}

export async function listSuppliers(
  actor: AppActor,
  input: SupplierListFilters
) {
  const client = assertServiceClient();
  const page = Math.max(Number(input.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(input.pageSize || 25), 1), 100);
  const from = (page - 1) * pageSize;
  const branchScoped = Boolean(input.branchId);
  const actorBranchIds = actor.branches.map((branch) => branch.id).filter(Boolean);
  if (!actor.isAdmin && actorBranchIds.length === 0) {
    return { page, pageSize, total: 0, items: [] };
  }

  const actorBranchScoped = !actor.isAdmin && !branchScoped;
  const branchFiltered = branchScoped || actorBranchScoped;

  let query = client
    .from("app_suppliers")
    .select(branchFiltered ? "*,app_supplier_branch_links!inner(branch_id)" : "*", { count: "exact" })
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
  if (input.branchId) query = query.eq("app_supplier_branch_links.branch_id", input.branchId);
  if (actorBranchScoped) query = query.in("app_supplier_branch_links.branch_id", actorBranchIds);
  if (input.attention === "PENDING") {
    query = query.or("status.eq.PENDENTE_REVISAO,sync_status.eq.PENDENTE_REVISAO");
  }
  if (input.attention === "ERROR") query = query.eq("sync_status", "ERRO_SYNC");

  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) throw error;

  const rows = (data || []) as unknown as SupplierDbRow[];
  const supplierIds = rows.map((row) => row.id);
  const [linksBySupplier, requestCounts] = await Promise.all([
    fetchLinks(client, supplierIds),
    fetchRequestCounts(client, actor, supplierIds),
  ]);
  const visibleRows = rows.filter((row) => supplierCanBeSeenByActor(actor, row.id, linksBySupplier)).slice(0, pageSize);
  const requestsBySupplier = await fetchSupplierRequestSummaries(client, actor, visibleRows.map((row) => row.id), 2);

  return {
    page,
    pageSize,
    total: count || 0,
    items: visibleRows.map((row) =>
      mapSupplier(
        row,
        linksBySupplier.get(row.id),
        requestCounts.get(row.id) || 0,
        requestsBySupplier.get(row.id) || []
      )
    ),
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

async function recordSupplierAudit(
  client: SupabaseClient,
  input: {
    supplierId: string;
    actorId: string | null;
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

async function ensureSupplierLinkFromLatestRequest(
  client: SupabaseClient,
  input: {
    supplierId: string;
    cnpj: string;
    supplierName: string;
  }
) {
  const { data: existing, error: existingError } = await client
    .from("fluig_supplier_links")
    .select("id")
    .eq("app_supplier_id", input.supplierId)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return 0;

  const variants = Array.from(new Set([input.cnpj, formatCnpj(input.cnpj)]));
  const { data: latestRequest, error: requestError } = await client
    .from("fluig_requests")
    .select("fluig_request_id,supplier_name,supplier_cnpj,raw_payload,last_synced_at")
    .in("supplier_cnpj", variants)
    .order("last_synced_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!latestRequest) return 0;

  const { error: insertError } = await client.from("fluig_supplier_links").insert({
    app_supplier_id: input.supplierId,
    adm_supplier_id: input.supplierId,
    supplier_name: String(latestRequest.supplier_name || input.supplierName || "Fornecedor Fluig"),
    cnpj: input.cnpj,
    fluig_name: String(latestRequest.supplier_name || input.supplierName || ""),
    fluig_code: null,
    default_source_request_id: latestRequest.fluig_request_id || null,
    default_payload: {
      source: "auto_link_from_fluig_request_cnpj",
      latestRequest: latestRequest.fluig_request_id || null,
      rawPayload: latestRequest.raw_payload || {},
    },
    active: true,
  });
  if (insertError) throw insertError;
  return 1;
}

async function linkSupplierFluigReferences(
  client: SupabaseClient,
  input: {
    supplierId: string;
    cnpj?: string | null;
    supplierName: string;
  }
) {
  const cnpj = normalizeCnpj(input.cnpj);
  if (!cnpj || !isValidCnpj(cnpj)) {
    return { requests: 0, links: 0, insertedLinks: 0 };
  }

  const variants = Array.from(new Set([cnpj, formatCnpj(cnpj)]));
  const { count: requestCount, error: requestError } = await client
    .from("fluig_requests")
    .update({ app_supplier_id: input.supplierId }, { count: "exact" })
    .in("supplier_cnpj", variants)
    .or(`app_supplier_id.is.null,app_supplier_id.eq.${input.supplierId}`);
  if (requestError) throw requestError;

  const { count: linkCount, error: linkError } = await client
    .from("fluig_supplier_links")
    .update(
      {
        app_supplier_id: input.supplierId,
        adm_supplier_id: input.supplierId,
        active: true,
      },
      { count: "exact" }
    )
    .in("cnpj", variants)
    .or(`app_supplier_id.is.null,app_supplier_id.eq.${input.supplierId}`);
  if (linkError) throw linkError;

  const insertedLinks = await ensureSupplierLinkFromLatestRequest(client, {
    supplierId: input.supplierId,
    cnpj,
    supplierName: input.supplierName,
  });

  return {
    requests: requestCount || 0,
    links: linkCount || 0,
    insertedLinks,
  };
}

function candidateFromDbRow(row: SupplierPreRegistrationDbRow): SupplierPreRegistrationCandidate {
  return {
    id: row.id,
    candidateKey: row.candidate_key,
    supplierName: row.supplier_name,
    cnpj: row.cnpj,
    fluigName: row.fluig_name,
    fluigCode: row.fluig_code,
    confidence: row.confidence,
    sourceRequestIds: row.source_request_ids || [],
    suggestedDefaults: row.suggested_defaults || {},
  };
}

function chunksOf<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function loadSupplierPreRegistrationCandidates(client: SupabaseClient, candidateKeys?: string[]) {
  const rows: SupplierPreRegistrationDbRow[] = [];
  const select =
    "id,candidate_key,supplier_name,cnpj,fluig_name,fluig_code,confidence,source_request_ids,suggested_defaults,status";

  if (candidateKeys) {
    const uniqueKeys = Array.from(new Set(candidateKeys.filter(Boolean)));
    for (const keys of chunksOf(uniqueKeys, 100)) {
      if (!keys.length) continue;
      const { data, error } = await client
        .from("fluig_supplier_candidates")
        .select(select)
        .in("candidate_key", keys)
        .in("status", ["PRE_CADASTRO", "EM_REVISAO"]);
      if (error) throw error;
      rows.push(...((data || []) as unknown as SupplierPreRegistrationDbRow[]));
    }
    return rows;
  }

  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from("fluig_supplier_candidates")
      .select(select)
      .in("status", ["PRE_CADASTRO", "EM_REVISAO"])
      .order("updated_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data || []) as unknown as SupplierPreRegistrationDbRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export async function reconcileSupplierPreRegistrations(input: {
  actorId?: string | null;
  candidateKeys?: string[];
} = {}) {
  const client = assertServiceClient();
  const candidateRows = await loadSupplierPreRegistrationCandidates(client, input.candidateKeys);
  const consolidated = consolidateSupplierPreRegistrations(candidateRows.map(candidateFromDbRow));
  const canonicalCnpjs = consolidated.items.map((item) => item.cnpj);
  const existingRows: Array<Pick<SupplierDbRow, "id" | "cnpj_normalizado" | "source_system" | "status">> = [];

  for (const cnpjs of chunksOf(canonicalCnpjs, 200)) {
    if (!cnpjs.length) continue;
    const { data, error } = await client
      .from("app_suppliers")
      .select("id,cnpj_normalizado,source_system,status")
      .in("cnpj_normalizado", cnpjs)
      .is("deleted_at", null);
    if (error) throw error;
    existingRows.push(
      ...((data || []) as unknown as Array<Pick<SupplierDbRow, "id" | "cnpj_normalizado" | "source_system" | "status">>)
    );
  }

  const existingByCnpj = new Map(existingRows.map((row) => [row.cnpj_normalizado, row]));
  const createdRows: Array<{ id: string; cnpj_normalizado: string }> = [];
  const missing = consolidated.items.filter((item) => !existingByCnpj.has(item.cnpj));

  for (const batch of chunksOf(missing, 100)) {
    if (!batch.length) continue;
    const { data, error } = await client
      .from("app_suppliers")
      .insert(
        batch.map((item) => ({
          cnpj: formatCnpj(item.cnpj),
          cnpj_normalizado: item.cnpj,
          razao_social: item.razaoSocial,
          status: "PENDENTE_REVISAO",
          fluig_name: item.fluigName,
          fluig_code: item.fluigCode,
          fluig_supplier_label: item.fluigName || item.razaoSocial,
          default_source_request_id: item.defaultSourceRequestId,
          default_payload: item.defaultPayload,
          source_system: "PRE_CADASTRO_FLUIG",
          sync_status: "PENDENTE_REVISAO",
          created_by_user_id: input.actorId || null,
          updated_by_user_id: input.actorId || null,
        }))
      )
      .select("id,cnpj_normalizado");
    if (error) throw error;
    createdRows.push(...((data || []) as Array<{ id: string; cnpj_normalizado: string }>));
  }

  const createdByCnpj = new Map(createdRows.map((row) => [row.cnpj_normalizado, row]));
  let refreshed = 0;
  const refreshable = consolidated.items.filter((item) => {
    const current = existingByCnpj.get(item.cnpj);
    return current?.source_system === "PRE_CADASTRO_FLUIG" && current.status === "PENDENTE_REVISAO";
  });

  for (const batch of chunksOf(refreshable, 20)) {
    await Promise.all(
      batch.map(async (item) => {
        const current = existingByCnpj.get(item.cnpj);
        if (!current) return;
        const { error } = await client
          .from("app_suppliers")
          .update({
            fluig_name: item.fluigName,
            fluig_code: item.fluigCode,
            fluig_supplier_label: item.fluigName || item.razaoSocial,
            default_source_request_id: item.defaultSourceRequestId,
            default_payload: item.defaultPayload,
            updated_by_user_id: input.actorId || null,
          })
          .eq("id", current.id);
        if (error) throw error;
        refreshed += 1;
      })
    );
  }

  if (createdRows.length) {
    const auditRows = createdRows.map((created) => {
      const item = consolidated.items.find((candidate) => candidate.cnpj === created.cnpj_normalizado);
      return {
        supplier_id: created.id,
        actor_user_id: input.actorId || null,
        event_type: "fluig_pre_registration_created",
        after_payload: item || null,
        metadata: {
          source: "fluig_supplier_candidates",
          candidateIds: item?.candidateIds || [],
          sourceRequestIds: item?.sourceRequestIds || [],
          confidence: item?.confidence || 0,
        },
      };
    });
    for (const batch of chunksOf(auditRows, 200)) {
      const { error } = await client.from("app_supplier_audit_events").insert(batch);
      if (error) throw error;
    }
  }

  const supplierIds = consolidated.items
    .map((item) => existingByCnpj.get(item.cnpj)?.id || createdByCnpj.get(item.cnpj)?.id)
    .filter(Boolean) as string[];
  const relationSummary: Record<string, number> = {};
  for (const supplierIdBatch of chunksOf(supplierIds, 50)) {
    const { data, error } = await client.rpc("reconcile_fluig_supplier_relations", {
      p_supplier_ids: supplierIdBatch,
    });
    if (error) throw error;
    for (const [key, value] of Object.entries((data || {}) as Record<string, number>)) {
      relationSummary[key] = (relationSummary[key] || 0) + Number(value || 0);
    }
  }

  return {
    configured: true,
    saved: {
      supplierPreRegistrations: createdRows.length,
      supplierPreRegistrationsRefreshed: refreshed,
      supplierCandidatesInvalidCnpj: consolidated.invalidCnpj,
      supplierRequestLinks: Number(relationSummary.requestLinks || 0),
      supplierCandidateLinks: Number(relationSummary.candidateLinks || 0),
      supplierBranchLinks: Number(relationSummary.branchLinks || 0),
      supplierCandidatesInReview: Number(relationSummary.candidatesInReview || 0),
    },
    errors: [] as string[],
  };
}

type SupplierMutationOptions = {
  systemManaged?: boolean;
  eventType?: string;
  metadata?: JsonRecord;
};

async function saveSupplierTransaction(input: {
  client: SupabaseClient;
  supplierId: string | null;
  actor: AppActor;
  payload: JsonRecord;
  branchIds: string[] | undefined;
  eventType: string;
  metadata?: JsonRecord;
}) {
  const { data, error } = await input.client.rpc("save_app_supplier", {
    p_supplier_id: input.supplierId,
    p_actor_id: input.actor.id,
    p_payload: input.payload,
    p_branch_ids: input.branchIds ?? null,
    p_event_type: input.eventType,
    p_metadata: input.metadata || {},
  });
  if (error) throw error;
  return String(data || input.supplierId || "");
}

export async function createSupplier(
  actor: AppActor,
  input: SupplierInput,
  options: SupplierMutationOptions = {}
) {
  const client = assertServiceClient();
  const managedInput = options.systemManaged
    ? input
    : {
        ...input,
        status: input.status === "INATIVO" ? ("INATIVO" as const) : ("ATIVO" as const),
        sourceSystem: "LOCAL" as const,
        syncStatus: "NAO_SINCRONIZADO" as const,
      };
  const payload = normalizeSupplierInput(managedInput, actor);
  await assertNoDuplicateCnpj(client, payload.cnpj_normalizado);
  const branchIds = await validateSupplierBranchScope(client, actor, input.branchIds, {
    requiredForScopedActor: !actor.isAdmin,
  });

  const supplierId = await saveSupplierTransaction({
    client,
    supplierId: null,
    actor,
    payload,
    branchIds,
    eventType: options.eventType || "created",
    metadata: options.metadata,
  });
  const fluigLinks = await linkSupplierFluigReferences(client, {
    supplierId,
    cnpj: payload.cnpj_normalizado,
    supplierName: payload.razao_social,
  });
  if (Object.values(fluigLinks).some((value) => Number(value) > 0)) {
    await recordSupplierAudit(client, {
      supplierId,
      actorId: actor.id,
      eventType: "fluig_relations_linked",
      metadata: { fluigLinks },
    });
  }

  return readSupplier(actor, supplierId);
}

export async function saveOperationalSupplierModel(input: {
  actor: AppActor;
  supplierId?: string | null;
  supplierName: string;
  supplierCnpj: string;
  branchId: string;
  sourceRequestId: string;
  fieldOverrides: Record<string, string>;
}) {
  const client = assertServiceClient();
  const cnpj = normalizeCnpj(input.supplierCnpj);
  if (!cnpj || !isValidCnpj(cnpj)) throw new Error("CNPJ do fornecedor da nota fiscal e invalido.");

  let supplierId = cleanText(input.supplierId);
  if (!supplierId) {
    const { data, error } = await client
      .from("app_suppliers")
      .select("id")
      .eq("cnpj_normalizado", cnpj)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    supplierId = data?.id ? String(data.id) : null;
  }

  const defaultPayload = {
    ...input.fieldOverrides,
    sourceRequestId: input.sourceRequestId,
    latestFields: input.fieldOverrides,
  };
  if (!supplierId) {
    const created = await createSupplier(
      input.actor,
      {
        cnpj,
        razaoSocial: input.supplierName,
        fluigName: input.fieldOverrides.fornecedorC || input.supplierName,
        fluigSupplierLabel: input.fieldOverrides.fornecedorC || input.supplierName,
        defaultSourceRequestId: input.sourceRequestId,
        defaultPayload,
        sourceSystem: "LOCAL_FLUIG",
        syncStatus: "SINCRONIZADO",
        branchIds: [input.branchId],
      },
      {
        systemManaged: true,
        eventType: "operational_launch_supplier_created",
        metadata: { sourceRequestId: input.sourceRequestId },
      }
    );
    return created?.id || null;
  }

  const { data: links, error: linksError } = await client
    .from("app_supplier_branch_links")
    .select("branch_id")
    .eq("supplier_id", supplierId);
  if (linksError) throw linksError;
  const branchIds = Array.from(new Set([...(links || []).map((link) => String(link.branch_id)), input.branchId]));
  const updated = await updateSupplier(
    input.actor,
    supplierId,
    {
      defaultSourceRequestId: input.sourceRequestId,
      defaultPayload,
      fluigName: input.fieldOverrides.fornecedorC || input.supplierName,
      fluigSupplierLabel: input.fieldOverrides.fornecedorC || input.supplierName,
      sourceSystem: "LOCAL_FLUIG",
      syncStatus: "SINCRONIZADO",
      branchIds,
    },
    {
      systemManaged: true,
      eventType: "operational_launch_model_saved",
      metadata: { sourceRequestId: input.sourceRequestId },
    }
  );
  return updated?.id || supplierId;
}

export async function readSupplier(actor: AppActor, id: string) {
  const client = assertServiceClient();
  const { data, error } = await client
    .from("app_suppliers")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as SupplierDbRow;
  const [linksBySupplier, requestCounts, requestsBySupplier] = await Promise.all([
    fetchLinks(client, [row.id]),
    fetchRequestCounts(client, actor, [row.id]),
    fetchSupplierRequestSummaries(client, actor, [row.id], 8),
  ]);

  if (!supplierCanBeSeenByActor(actor, row.id, linksBySupplier)) return null;
  return mapSupplier(
    row,
    linksBySupplier.get(row.id),
    requestCounts.get(row.id) || 0,
    requestsBySupplier.get(row.id) || []
  );
}

export async function updateSupplier(
  actor: AppActor,
  id: string,
  input: Partial<SupplierInput>,
  options: SupplierMutationOptions = {}
) {
  const client = assertServiceClient();
  const { data: before, error: beforeError } = await client
    .from("app_suppliers")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (beforeError) throw beforeError;
  if (!before) return null;
  await assertSupplierMutationScope(client, actor, id);

  const current = before as SupplierDbRow;
  const controlledInput = options.systemManaged
    ? input
    : {
        ...input,
        status:
          input.status === "ATIVO" || input.status === "INATIVO"
            ? input.status
            : current.status,
        sourceSystem: current.source_system,
        syncStatus: current.sync_status,
      };
  const payload = normalizeSupplierInput(
    {
      cnpj: current.cnpj_normalizado,
      razaoSocial: current.razao_social,
      nomeFantasia: current.nome_fantasia,
      inscricaoEstadual: current.inscricao_estadual,
      inscricaoMunicipal: current.inscricao_municipal,
      categoria: current.categoria,
      status: current.status,
      email: current.email,
      telefone: current.telefone,
      contatoPrincipal: current.contato_principal,
      contatos: current.contatos || [],
      cep: current.cep,
      endereco: current.endereco,
      numero: current.numero,
      complemento: current.complemento,
      bairro: current.bairro,
      cidade: current.cidade,
      uf: current.uf,
      pais: current.pais,
      observacoes: current.observacoes,
      fluigName: current.fluig_name,
      fluigCode: current.fluig_code,
      fluigSupplierLabel: current.fluig_supplier_label,
      defaultSourceRequestId: current.default_source_request_id,
      defaultPayload: current.default_payload || {},
      sourceSystem: current.source_system,
      syncStatus: current.sync_status,
      ...controlledInput,
    },
    actor
  );
  await assertNoDuplicateCnpj(client, payload.cnpj_normalizado, id);
  const branchIds = await validateSupplierBranchScope(client, actor, input.branchIds, {
    requiredForScopedActor: !actor.isAdmin,
  });

  await saveSupplierTransaction({
    client,
    supplierId: id,
    actor,
    payload: { ...payload, last_fluig_sync_at: current.last_fluig_sync_at },
    branchIds,
    eventType: options.eventType || "updated",
    metadata: options.metadata,
  });
  const fluigLinks = await linkSupplierFluigReferences(client, {
    supplierId: id,
    cnpj: payload.cnpj_normalizado,
    supplierName: payload.razao_social,
  });
  if (Object.values(fluigLinks).some((value) => Number(value) > 0)) {
    await recordSupplierAudit(client, {
      supplierId: id,
      actorId: actor.id,
      eventType: "fluig_relations_linked",
      metadata: { fluigLinks },
    });
  }
  return readSupplier(actor, id);
}

export async function approveSupplierPreRegistration(actor: AppActor, id: string) {
  const client = assertServiceClient();
  const { data: before, error: beforeError } = await client
    .from("app_suppliers")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (beforeError) throw beforeError;
  if (!before) return null;

  const current = before as SupplierDbRow;
  const linksBySupplier = await fetchLinks(client, [current.id]);
  if (!supplierCanBeSeenByActor(actor, current.id, linksBySupplier)) return null;

  const isPreRegistration = current.source_system === "PRE_CADASTRO_FLUIG";
  if (!isPreRegistration) {
    throw new Error("Fornecedor nao esta pendente de revisao Fluig.");
  }

  const canonicalCnpj = normalizeCnpj(current.cnpj_normalizado || current.cnpj);
  if (!canonicalCnpj || !isValidCnpj(canonicalCnpj)) {
    throw new Error("Pre-cadastro sem CNPJ valido para aprovacao.");
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await client
    .from("app_suppliers")
    .update({
      status: "ATIVO",
      source_system: current.source_system === "PRE_CADASTRO_FLUIG" ? "LOCAL_FLUIG" : current.source_system,
      sync_status: current.sync_status === "PENDENTE_REVISAO" ? "SINCRONIZADO" : current.sync_status,
      updated_by_user_id: actor.id,
      updated_at: now,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (updateError) throw updateError;

  const relationSummary = await client
    .rpc("reconcile_fluig_supplier_relations", { p_supplier_ids: [id] })
    .then(({ data, error }) => {
      if (error) throw error;
      return (data || {}) as Record<string, number>;
    });

  const cnpjVariants = historicalCnpjVariants(canonicalCnpj);
  const { data: approvedCandidates, error: candidateError } = await client
    .from("fluig_supplier_candidates")
    .update({
      status: "APROVADO",
      updated_at: now,
    })
    .in("cnpj", cnpjVariants)
    .in("status", ["PRE_CADASTRO", "EM_REVISAO"])
    .select("id");
  if (candidateError) throw candidateError;

  const row = updated as SupplierDbRow;
  const fluigLinks = await linkSupplierFluigReferences(client, {
    supplierId: id,
    cnpj: row.cnpj_normalizado,
    supplierName: row.razao_social,
  });

  await recordSupplierAudit(client, {
    supplierId: id,
    actorId: actor.id,
    eventType: "pre_registration_approved",
    beforePayload: before,
    afterPayload: updated,
    metadata: {
      candidateIds: (approvedCandidates || []).map((candidate) => candidate.id),
      approvedCandidateCount: approvedCandidates?.length || 0,
      relationSummary,
      fluigLinks,
    },
  });

  return readSupplier(actor, id);
}

export async function deleteSupplier(actor: AppActor, id: string) {
  const client = assertServiceClient();
  const { data: supplier, error: supplierError } = await client
    .from("app_suppliers")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (supplierError) throw supplierError;
  if (!supplier) throw new Error("Fornecedor nao encontrado.");
  await assertSupplierMutationScope(client, actor, id);

  const { data, error } = await client.rpc("delete_app_supplier", {
    p_supplier_id: id,
    p_actor_id: actor.id,
  });
  if (error) throw error;
  return (data || { deleted: false, softDeleted: false }) as {
    deleted: boolean;
    softDeleted: boolean;
    links?: JsonRecord;
  };
}

export async function markSupplierFluigSyncQueued(actor: AppActor, id: string, metadata: JsonRecord = {}) {
  const client = assertServiceClient();
  await assertSupplierMutationScope(client, actor, id);
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("app_suppliers")
    .update({
      sync_status: "PENDENTE_REVISAO",
      updated_by_user_id: actor.id,
      updated_at: now,
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  await recordSupplierAudit(client, {
    supplierId: id,
    actorId: actor.id,
    eventType: "fluig_sync_queued",
    afterPayload: data,
    metadata,
  });

  return readSupplier(actor, id);
}

export async function markSupplierFluigSyncResult(input: {
  supplierId?: string | null;
  actorId?: string | null;
  status: "success" | "error" | "cancelled";
  historyItems?: FluigHistoryItem[];
  resultPayload?: JsonRecord;
  errorMessage?: string | null;
  persistence?: unknown;
}) {
  const supplierId = cleanText(input.supplierId);
  if (!supplierId) return null;

  const client = assertServiceClient();
  const historyItems = Array.isArray(input.historyItems) ? input.historyItems : [];
  const latest = historyItems[0] || null;
  const fields = latest?.formFields || {};
  const supplierLabel = firstText(fields, ["fornecedorC", "fornecedor", "nomeFornecedor", "supplierName"]);
  const cnpj = normalizeCnpj(firstText(fields, ["codCNPJ", "cnpj", "supplierCnpj"]));
  const now = new Date().toISOString();
  const hasMatches = historyItems.length > 0;
  const updatePayload: Record<string, unknown> = {
    sync_status: input.status === "success" ? (hasMatches ? "SINCRONIZADO" : "PENDENTE_REVISAO") : "ERRO_SYNC",
    last_fluig_sync_at: now,
    updated_by_user_id: input.actorId || null,
    updated_at: now,
  };

  if (hasMatches) {
    updatePayload.source_system = "LOCAL_FLUIG";
    updatePayload.default_source_request_id = latest.processInstanceId || null;
    updatePayload.default_payload = supplierDefaultsFromHistory(latest, input.resultPayload);
    if (supplierLabel) {
      updatePayload.fluig_name = supplierLabel;
      updatePayload.fluig_supplier_label = supplierLabel;
      updatePayload.fluig_code = leadingCode(supplierLabel);
    }
    if (cnpj) {
      updatePayload.cnpj = formatCnpj(cnpj);
      updatePayload.cnpj_normalizado = cnpj;
    }
  }

  const { data, error } = await client
    .from("app_suppliers")
    .update(updatePayload)
    .eq("id", supplierId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as SupplierDbRow;
  const fluigLinks = await linkSupplierFluigReferences(client, {
    supplierId,
    cnpj: row.cnpj_normalizado,
    supplierName: row.razao_social,
  });

  await recordSupplierAudit(client, {
    supplierId,
    actorId: input.actorId || null,
    eventType: input.status === "success" ? "fluig_sync_completed" : "fluig_sync_failed",
    afterPayload: data,
    metadata: {
      matchedItems: historyItems.length,
      errorMessage: input.errorMessage || null,
      persistence: input.persistence || null,
      fluigLinks,
    },
  });

  return data;
}

function suggestionFromCandidate(row: Record<string, unknown>) {
  const defaults = normalizedLookupDefaults((row.suggested_defaults || {}) as JsonRecord);
  const sourceRequestIds = Array.isArray(row.source_request_ids) ? row.source_request_ids : [];
  return withLookupReview({
    candidateId: row.id,
    razaoSocial: row.supplier_name,
    cnpj: row.cnpj,
    fluigName: row.fluig_name,
    fluigCode: row.fluig_code,
    branchCode: defaults.branchCode,
    branchLabel: defaults.branchLabel,
    defaultSourceRequestId: firstText(defaults, ["sourceRequestId", "latestRequest"]) || sourceRequestIds[0] || null,
    defaultPayload: defaults,
    confidence: row.confidence,
    sourceRequestIds,
  });
}

async function loadSupplierRequestEvidence(
  client: SupabaseClient,
  cnpjVariants: string[],
  actor: AppActor
): Promise<SupplierRequestEvidence | null> {
  let query = client
    .from("fluig_requests")
    .select(
      "fluig_request_id,supplier_name,branch_code,branch_label,raw_payload,last_synced_at,created_by_user_id,sync_owner_user_id,fluig_requester_login,fluig_requester_code,requester"
    )
    .in("supplier_cnpj", cnpjVariants)
    .order("last_synced_at", { ascending: false, nullsFirst: false })
    .limit(200);
  const actorFilter = buildFluigActorPostgrestFilter(actor);
  if (actorFilter) query = query.or(actorFilter);
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []) as Array<Record<string, unknown>>;
  if (!rows.length) return null;

  const branchCounts = new Map<
    string,
    { branchCode: string | null; branchLabel: string | null; count: number }
  >();
  for (const row of rows) {
    const branchCode = cleanText(row.branch_code);
    const branchLabel = cleanText(row.branch_label);
    const key = branchCode || branchLabel;
    if (!key) continue;
    const current = branchCounts.get(key);
    branchCounts.set(key, {
      branchCode,
      branchLabel,
      count: (current?.count || 0) + 1,
    });
  }

  const mostUsedBranch = Array.from(branchCounts.values()).sort((left, right) => right.count - left.count)[0];
  const latest = rows[0];
  const latestPayload = (latest.raw_payload || {}) as JsonRecord;
  const latestFields = payloadFormFields(latestPayload);
  const latestRequestId = cleanText(latest.fluig_request_id);

  return {
    latestRequestId,
    branchCode: mostUsedBranch?.branchCode || cleanText(latest.branch_code),
    branchLabel: mostUsedBranch?.branchLabel || cleanText(latest.branch_label),
    supplierName: cleanText(latest.supplier_name),
    defaults: normalizedLookupDefaults(
      {
        latestFields,
        sourceRequestId: latestRequestId,
      },
      null
    ),
    sourceRequestIds: rows.map((row) => cleanText(row.fluig_request_id)).filter(Boolean) as string[],
  };
}

function suggestionFromSupplierLink(
  row: Record<string, unknown>,
  candidate: Record<string, unknown> | null = null,
  evidence: SupplierRequestEvidence | null = null
) {
  const linkDefaults = normalizedLookupDefaults((row.default_payload || {}) as JsonRecord);
  const candidateSuggestion = candidate ? suggestionFromCandidate(candidate) : null;
  const sourceRequestIds = Array.from(
    new Set(
      [
        row.default_source_request_id,
        ...(candidateSuggestion?.sourceRequestIds || []),
      ].filter(Boolean)
    )
  );

  return mergeSuggestionWithEvidence({
    linkId: row.id,
    candidateId: candidateSuggestion?.candidateId,
    razaoSocial: row.supplier_name || candidateSuggestion?.razaoSocial,
    cnpj: row.cnpj || candidateSuggestion?.cnpj,
    fluigName: row.fluig_name || candidateSuggestion?.fluigName || row.supplier_name,
    fluigCode: row.fluig_code || candidateSuggestion?.fluigCode,
    fluigSupplierLabel: row.fluig_name || row.supplier_name,
    branchCode: linkDefaults.branchCode || candidateSuggestion?.branchCode,
    branchLabel: linkDefaults.branchLabel || candidateSuggestion?.branchLabel,
    defaultSourceRequestId:
      row.default_source_request_id ||
      firstText(linkDefaults, ["sourceRequestId", "latestRequest"]) ||
      candidateSuggestion?.defaultSourceRequestId ||
      sourceRequestIds[0] ||
      null,
    defaultPayload: {
      ...(candidateSuggestion?.defaultPayload || {}),
      ...linkDefaults,
    },
    confidence: candidateSuggestion?.confidence ?? 100,
    sourceRequestIds,
    sourceTable: "fluig_supplier_links",
  }, evidence);
}

async function findSupplierCatalogByCnpj(client: SupabaseClient, cnpj: string) {
  const pageSize = 1000;
  for (let page = 0; page < 20; page += 1) {
    const from = page * pageSize;
    const { data, error } = await client
      .from("fluig_catalog_items")
      .select("label,value,code,source_request_id,metadata,last_seen_at")
      .eq("catalog_type", "supplier")
      .range(from, from + pageSize - 1);
    if (error) throw error;

    const found = (data || []).find((row) => {
      const metadata = ((row as { metadata?: JsonRecord }).metadata || {}) as JsonRecord;
      return historicalCnpjMatches(metadata.cnpj, cnpj) || historicalCnpjMatches((row as { value?: string }).value, cnpj);
    });
    if (found) return found as Record<string, unknown>;
    if ((data || []).length < pageSize) return null;
  }

  return null;
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
    if (supplier) {
      return {
        source: "local" as const,
        supplier,
        suggestions: {},
        warnings: ["Fornecedor ja cadastrado. Deseja abrir o cadastro existente?"],
      };
    }
  }

  const cnpjVariants = historicalCnpjVariants(cnpj);
  const { data: supplierLink, error: supplierLinkError } = await client
    .from("fluig_supplier_links")
    .select(
      "id,candidate_id,app_supplier_id,adm_supplier_id,supplier_name,cnpj,fluig_name,fluig_code,default_source_request_id,default_payload,active,updated_at"
    )
    .in("cnpj", cnpjVariants)
    .eq("active", true)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (supplierLinkError) throw supplierLinkError;
  if (supplierLink) {
    const link = supplierLink as Record<string, unknown>;
    const evidence = await loadSupplierRequestEvidence(client, cnpjVariants, actor);
    const linkedSupplierId = cleanText(link.app_supplier_id) || cleanText(link.adm_supplier_id);

    if (linkedSupplierId) {
      const supplier = await readSupplier(actor, linkedSupplierId);
      if (supplier) {
        return {
          source: "local" as const,
          supplier,
          suggestions: suggestionFromSupplierLink(link, null, evidence),
          warnings: ["Fornecedor ja cadastrado e vinculado ao Fluig. Deseja abrir o cadastro existente?"],
        };
      }
    }

    let linkedCandidate: Record<string, unknown> | null = null;
    const candidateId = cleanText(link.candidate_id);
    if (candidateId) {
      const { data, error } = await client
        .from("fluig_supplier_candidates")
        .select("*")
        .eq("id", candidateId)
        .neq("status", "IGNORADO")
        .maybeSingle();
      if (error) throw error;
      const candidateRow = data as Record<string, unknown> | null;
      if (candidateRow && candidateRow.status !== "APROVADO") {
        linkedCandidate = candidateRow;
      }
    }

    if (actor.isAdmin || evidence) {
      return {
        source: linkedCandidate ? ("fluig_candidate" as const) : ("fluig_catalog" as const),
        supplier: null,
        suggestions: suggestionFromSupplierLink(link, linkedCandidate, evidence),
        warnings: [],
      };
    }
  }

  const requestEvidence = await loadSupplierRequestEvidence(client, cnpjVariants, actor);
  const { data: candidate, error: candidateError } = await client
    .from("fluig_supplier_candidates")
    .select("*")
    .in("cnpj", cnpjVariants)
    .neq("status", "IGNORADO")
    .order("confidence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (candidateError) throw candidateError;
  if (candidate && (actor.isAdmin || requestEvidence)) {
    return {
      source: "fluig_candidate" as const,
      supplier: null,
      suggestions: mergeSuggestionWithEvidence(
        suggestionFromCandidate(candidate as Record<string, unknown>),
        requestEvidence
      ),
      warnings: [],
    };
  }

  const catalog = actor.isAdmin || requestEvidence ? await findSupplierCatalogByCnpj(client, cnpj) : null;
  if (catalog) {
    const metadata = (catalog.metadata || {}) as JsonRecord;
    return {
      source: "fluig_catalog" as const,
      supplier: null,
      suggestions: mergeSuggestionWithEvidence({
        razaoSocial: catalog.label,
        cnpj,
        fluigCode: catalog.code || null,
        fluigName: metadata.fluigName || catalog.value || catalog.label,
        defaultSourceRequestId: catalog.source_request_id || metadata.latestRequest || null,
        defaultPayload: normalizedLookupDefaults(metadata, requestEvidence),
      }, requestEvidence),
      warnings: [],
    };
  }

  if (requestEvidence) {
    return {
      source: "fluig_request" as const,
      supplier: null,
      suggestions: mergeSuggestionWithEvidence({
        razaoSocial: requestEvidence.supplierName,
        cnpj,
        defaultSourceRequestId: requestEvidence.latestRequestId,
        branchCode: requestEvidence.branchCode,
        branchLabel: requestEvidence.branchLabel,
        latestRequestId: requestEvidence.latestRequestId,
        defaultPayload: requestEvidence.defaults,
        sourceRequestIds: requestEvidence.sourceRequestIds,
      }, requestEvidence),
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

async function resolveCandidateBranchIds(
  client: SupabaseClient,
  actor: AppActor,
  suggestions: JsonRecord,
  requestedBranchIds: string[] | undefined
) {
  if (requestedBranchIds !== undefined) {
    return validateSupplierBranchScope(client, actor, requestedBranchIds, {
      requiredForScopedActor: !actor.isAdmin,
    });
  }

  const branchCode = cleanText(suggestions.branchCode);
  const branchLabel = cleanText(suggestions.branchLabel)?.toLocaleLowerCase("pt-BR") || null;
  const { data, error } = await client
    .from("app_branches")
    .select("id,code,name,fluig_label,active")
    .eq("active", true)
    .is("deleted_at", null);
  if (error) throw error;

  const branch = (data || []).find((item) => {
    if (branchCode && String(item.code || "").trim() === branchCode) return true;
    if (!branchLabel) return false;
    return [item.fluig_label, item.name]
      .map((value) => String(value || "").trim().toLocaleLowerCase("pt-BR"))
      .some((value) => value === branchLabel);
  });

  if (!branch) {
    if (actor.isAdmin) return [];
    throw new AppAuthError(
      "O candidato Fluig nao possui uma filial permitida. Selecione a filial antes de aprovar.",
      403,
      "SUPPLIER_CANDIDATE_BRANCH_REQUIRED"
    );
  }

  return validateSupplierBranchScope(client, actor, [String(branch.id)], {
    requiredForScopedActor: !actor.isAdmin,
  });
}

export async function approveSupplierCandidate(
  actor: AppActor,
  candidateId: string,
  reviewedInput?: SupplierInput
) {
  const client = assertServiceClient();
  const { data: candidate, error } = await client.from("fluig_supplier_candidates").select("*").eq("id", candidateId).maybeSingle();
  if (error) throw error;
  if (!candidate) throw new Error("Candidato Fluig nao encontrado.");

  const row = candidate as Record<string, unknown>;
  if (!["PRE_CADASTRO", "EM_REVISAO"].includes(String(row.status || ""))) {
    throw new Error("Candidato Fluig ja foi revisado e nao pode ser aprovado novamente.");
  }
  const suggestions = suggestionFromCandidate(row);
  const canonicalCnpj = canonicalHistoricalCnpj(reviewedInput?.cnpj || row.cnpj);
  const branchIds = await resolveCandidateBranchIds(
    client,
    actor,
    suggestions as JsonRecord,
    reviewedInput?.branchIds
  );
  const { data: existingSupplier, error: existingSupplierError } = canonicalCnpj
    ? await client
        .from("app_suppliers")
        .select("id")
        .eq("cnpj_normalizado", canonicalCnpj)
        .is("deleted_at", null)
        .maybeSingle()
    : { data: null, error: null };
  if (existingSupplierError) throw existingSupplierError;

  const approvedInput: SupplierInput = {
    ...reviewedInput,
    cnpj: canonicalCnpj || String(row.cnpj || ""),
    razaoSocial:
      cleanText(reviewedInput?.razaoSocial) ||
      supplierLegalName(
        row.supplier_name || row.fluig_name || "Fornecedor Fluig",
        canonicalCnpj || row.cnpj,
        row.fluig_code
      ),
    status: "ATIVO",
    fluigName: cleanText(reviewedInput?.fluigName) || String(row.fluig_name || row.supplier_name || ""),
    fluigCode: cleanText(reviewedInput?.fluigCode) || String(row.fluig_code || ""),
    fluigSupplierLabel:
      cleanText(reviewedInput?.fluigSupplierLabel) || String(row.fluig_name || row.supplier_name || ""),
    defaultSourceRequestId:
      cleanText(reviewedInput?.defaultSourceRequestId) || String(suggestions.defaultSourceRequestId || ""),
    defaultPayload: reviewedInput?.defaultPayload || (suggestions.defaultPayload as JsonRecord),
    sourceSystem: "LOCAL_FLUIG",
    syncStatus: "SINCRONIZADO",
    branchIds,
  };
  const supplier = existingSupplier
    ? await updateSupplier(actor, String(existingSupplier.id), approvedInput, {
        systemManaged: true,
        eventType: "candidate_approved",
        metadata: { candidateId },
      })
    : await createSupplier(actor, approvedInput, {
        systemManaged: true,
        eventType: "candidate_approved",
        metadata: { candidateId },
      });

  const { error: updateError } = await client
    .from("fluig_supplier_candidates")
    .update({ status: "APROVADO", updated_at: new Date().toISOString() })
    .eq("id", candidateId)
    .in("status", ["PRE_CADASTRO", "EM_REVISAO"]);
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
  const { data: candidate, error: candidateError } = await client
    .from("fluig_supplier_candidates")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();
  if (candidateError) throw candidateError;
  if (!candidate) throw new Error("Candidato Fluig nao encontrado.");
  if (!["PRE_CADASTRO", "EM_REVISAO"].includes(String(candidate.status || ""))) {
    throw new Error("Candidato Fluig ja foi revisado e nao pode ser ignorado.");
  }
  await resolveCandidateBranchIds(
    client,
    actor,
    suggestionFromCandidate(candidate as Record<string, unknown>) as JsonRecord,
    undefined
  );

  const { data, error } = await client
    .from("fluig_supplier_candidates")
    .update({ status: "IGNORADO", updated_at: new Date().toISOString() })
    .eq("id", candidateId)
    .in("status", ["PRE_CADASTRO", "EM_REVISAO"])
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Candidato Fluig ja foi revisado e nao pode ser ignorado.");

  const { error: auditError } = await client.from("app_supplier_audit_events").insert({
    actor_user_id: actor.id,
    event_type: "candidate_ignored",
    after_payload: data,
  });
  if (auditError) throw auditError;

  return data;
}
