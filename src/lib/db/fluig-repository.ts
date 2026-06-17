import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";
import type { FluigHistoryItem, FluigStatusItem } from "@/lib/fluig/server-client";
import type {
  FluigExampleRequest,
  FluigModuleSlug,
  FluigSupplierMatch,
  FluigSyncRow,
} from "@/lib/fluig-data";
import type { FluigProcessMap } from "@/lib/fluig/process-map";

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
  supplier_name: string | null;
  supplier_cnpj: string | null;
  amount_cents: number | null;
  currency: string | null;
  due_date: string | null;
  opened_at: string | null;
  last_synced_at: string | null;
  raw_payload: JsonRecord;
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

function suggestedDefaultString(value: unknown, label: string) {
  const raw = String(value ?? "").trim();
  return raw ? `${label} = ${raw}` : null;
}

function mapRequestRowToSyncRow(row: FluigRequestDbRow): FluigSyncRow {
  const fields = formFieldsFromPayload(row.raw_payload || {});
  const fluigStatus = normalizeStatus(row.status);

  return {
    id: row.id,
    module: row.module_slug,
    admReference: row.adm_reference || fields.numeroSolicitacao || fields.codigoPedido || "-",
    fluigNumber: row.fluig_request_id || "-",
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

function mapHistoryToRequest(module: FluigModuleSlug, item: FluigHistoryItem) {
  const fields = item.formFields || {};
  const supplier = supplierFromFields(fields);
  const amount =
    parseMoneyToCents(fields.valorNF || fields.valorNFT || fields.valorTotalExibicao || fields.valorPedido || fields.valorTotal) ??
    null;

  return {
    module_slug: module,
    adm_reference: fields.numeroSolicitacao || fields.romaneioReferencia || fields.codigoPedido || null,
    process_id: item.processId,
    fluig_request_id: item.processInstanceId,
    source_request_id: null,
    status: item.status || null,
    current_task: null,
    task_owner: null,
    requester: item.requesterName || item.requesterId || null,
    supplier_name: supplier.name || null,
    supplier_cnpj: supplier.cnpj,
    amount_cents: amount,
    currency: "BRL",
    due_date: parseDateOnly(fields.vencPagNota || fields.vencimento || fields.dataPrevRetorno),
    opened_at: item.startDate,
    last_synced_at: new Date().toISOString(),
    canceled_at: String(item.status || "").toLowerCase().includes("cancel") ? new Date().toISOString() : null,
    source_url: item.sourceUrl,
    raw_payload: {
      formFields: fields,
      raw: item.raw,
    },
  };
}

function mapStatusToRequest(module: FluigModuleSlug, item: FluigStatusItem) {
  return {
    module_slug: module,
    fluig_request_id: item.numeroFluig,
    status: item.statusProcesso || (item.active === false ? "finalizado" : "em_andamento"),
    current_task: item.etapaAtual || null,
    task_owner: item.responsavelAtual || null,
    due_date: item.vencimentoPagamento || null,
    last_synced_at: item.dataUltimaConsulta || new Date().toISOString(),
    raw_payload: item as unknown as JsonRecord,
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

export async function persistHistoryItems(module: FluigModuleSlug, items: FluigHistoryItem[]) {
  return runWithDb(async (client) => {
    const rows = items.map((item) => mapHistoryToRequest(module, item)).filter((item) => item.fluig_request_id);
    if (!rows.length) return 0;
    const { error } = await client.from("fluig_requests").upsert(rows, { onConflict: "module_slug,fluig_request_id" });
    if (error) throw error;
    return rows.length;
  }).then(({ result, persistence }) => {
    if (result !== null) persistence.saved.requests = result;
    return persistence;
  });
}

export async function persistStatusItems(module: FluigModuleSlug, items: FluigStatusItem[]) {
  return runWithDb(async (client) => {
    const rows = items
      .filter((item) => item.numeroFluig)
      .map((item) => mapStatusToRequest(module, item));
    if (!rows.length) return 0;
    const { error } = await client.from("fluig_requests").upsert(rows, { onConflict: "module_slug,fluig_request_id" });
    if (error) throw error;
    return rows.length;
  }).then(({ result, persistence }) => {
    if (result !== null) persistence.saved.requests = result;
    return persistence;
  });
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
      status: "PRE_CADASTRO",
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

export async function readFluigSyncSnapshot(module: FluigModuleSlug, limit = 50) {
  return runWithDb(async (client) => {
    const requestModules =
      module === "fornecedores"
        ? (["pagamentos", "compras", "manutencao"] satisfies FluigModuleSlug[])
        : ([module] satisfies FluigModuleSlug[]);

    const requestsQuery = client
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

    const suppliersQuery = client
      .from("fluig_supplier_candidates")
      .select("supplier_name,cnpj,fluig_name,confidence,source_request_ids,suggested_defaults,status")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(module === "fornecedores" ? limit : 10);

    const [{ data: requestRows, error: requestsError }, { data: supplierRows, error: suppliersError }] =
      await Promise.all([requestsQuery, suppliersQuery]);

    if (requestsError) throw requestsError;
    if (suppliersError) throw suppliersError;

    const typedRequestRows = (requestRows || []) as unknown as FluigRequestDbRow[];
    const typedSupplierRows = (supplierRows || []) as unknown as FluigSupplierCandidateDbRow[];
    const rows = typedRequestRows.map(mapRequestRowToSyncRow);
    const examples = typedRequestRows
      .filter((row) => row.fluig_request_id)
      .slice(0, module === "fornecedores" ? 6 : 3)
      .map(mapRequestRowToExample);
    const supplierMatches = typedSupplierRows.map(mapSupplierCandidateToMatch);

    return {
      rows,
      examples,
      supplierMatches,
    };
  }).then(({ result, persistence }) => ({
    rows: result?.rows || [],
    examples: result?.examples || [],
    supplierMatches: result?.supplierMatches || [],
    persistence,
  }));
}
