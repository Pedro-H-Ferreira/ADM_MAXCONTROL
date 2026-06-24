import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppActor, FluigJobRecord, FluigJobStatus } from "@/lib/db/app-repository";
import {
  operationalLaunchFingerprint,
  type OperationalLaunchAttachment,
  type OperationalLaunchModule,
  type OperationalLaunchRecord,
  type OperationalLaunchStatus,
  type OperationalLaunchValidateInput,
} from "@/lib/operational-launch";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";

type JsonRecord = Record<string, unknown>;

type LaunchDbRow = {
  id: string;
  module_slug: OperationalLaunchModule;
  status: OperationalLaunchStatus;
  title: string;
  description: string | null;
  app_supplier_id: string | null;
  supplier_name: string | null;
  supplier_cnpj: string | null;
  branch_id: string | null;
  branch_code: string | null;
  branch_label: string | null;
  source_request_id: string;
  fluig_job_id: string | null;
  fluig_request_id: string | null;
  fluig_request_row_id: string | null;
  amount_cents: number | string | null;
  due_date: string | null;
  field_overrides: Record<string, string> | null;
  attachment_metadata: OperationalLaunchAttachment[] | null;
  review_fingerprint: string;
  progress_stage: string | null;
  progress_label: string | null;
  last_error_message: string | null;
  result_payload: JsonRecord | null;
  validated_at: string;
  queued_at: string | null;
  opened_at: string | null;
  failed_at: string | null;
  created_by_user_id: string;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  job?: {
    status: string;
    progress_stage: string | null;
    progress_label: string | null;
    error_message: string | null;
    updated_at: string | null;
  } | Array<{
    status: string;
    progress_stage: string | null;
    progress_label: string | null;
    error_message: string | null;
    updated_at: string | null;
  }> | null;
  items?: LaunchItemDbRow[] | null;
};

type LaunchItemDbRow = {
  id: string;
  launch_id: string;
  line_number: number;
  description: string;
  quantity: number | string;
  unit: string;
  unit_price_cents: number | string;
  total_cents: number | string;
  metadata: JsonRecord | null;
};

function assertServiceClient() {
  const client = getSupabaseServiceClient();
  if (!client) {
    const status = getSupabaseServiceStatus();
    throw new Error(`Supabase service role nao configurado. Faltando: ${status.missing.join(", ")}`);
  }
  return client;
}

function mapLaunch(row: LaunchDbRow): OperationalLaunchRecord {
  const rawJob = Array.isArray(row.job) ? row.job[0] : row.job;
  return {
    id: row.id,
    module: row.module_slug,
    status: row.status,
    title: row.title,
    description: row.description,
    supplierId: row.app_supplier_id,
    supplierName: row.supplier_name,
    supplierCnpj: row.supplier_cnpj,
    branchId: row.branch_id,
    branchCode: row.branch_code,
    branchLabel: row.branch_label,
    sourceRequestId: row.source_request_id,
    fluigJobId: row.fluig_job_id,
    fluigRequestId: row.fluig_request_id,
    fluigRequestRowId: row.fluig_request_row_id,
    amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
    dueDate: row.due_date,
    fieldOverrides: row.field_overrides || {},
    attachments: row.attachment_metadata || [],
    reviewFingerprint: row.review_fingerprint,
    progressStage: row.progress_stage,
    progressLabel: row.progress_label,
    lastErrorMessage: row.last_error_message,
    validatedAt: row.validated_at,
    queuedAt: row.queued_at,
    openedAt: row.opened_at,
    failedAt: row.failed_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: (row.items || [])
      .sort((left, right) => left.line_number - right.line_number)
      .map((item) => ({
        id: item.id,
        lineNumber: item.line_number,
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unit,
        unitPriceCents: Number(item.unit_price_cents),
        totalCents: Number(item.total_cents),
        metadata: item.metadata || {},
      })),
    job: rawJob
      ? {
          status: rawJob.status,
          progressStage: rawJob.progress_stage,
          progressLabel: rawJob.progress_label,
          errorMessage: rawJob.error_message,
          updatedAt: rawJob.updated_at,
        }
      : null,
  };
}

function actorCanViewLaunch(actor: AppActor, row: LaunchDbRow) {
  if (actor.isAdmin || row.created_by_user_id === actor.id) return true;
  return actor.branches.some(
    (branch) => (row.branch_id && branch.id === row.branch_id) || (row.branch_code && branch.code === row.branch_code)
  );
}

async function recordLaunchEvent(
  client: SupabaseClient,
  input: {
    launchId: string;
    actorId?: string | null;
    type: string;
    label: string;
    statusFrom?: string | null;
    statusTo?: string | null;
    payload?: JsonRecord;
  }
) {
  const { error } = await client.from("app_fluig_launch_events").insert({
    launch_id: input.launchId,
    actor_user_id: input.actorId || null,
    event_type: input.type,
    event_label: input.label,
    status_from: input.statusFrom || null,
    status_to: input.statusTo || null,
    event_payload: input.payload || {},
  });
  if (error) throw error;
}

function launchSelect() {
  return [
    "*",
    "job:fluig_jobs(status,progress_stage,progress_label,error_message,updated_at)",
    "items:app_fluig_launch_items(*)",
  ].join(",");
}

export async function listOperationalLaunches(
  actor: AppActor,
  input: { module?: OperationalLaunchModule | null; limit?: number; id?: string | null } = {}
) {
  const client = assertServiceClient();
  let query = client
    .from("app_fluig_launches")
    .select(launchSelect())
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(input.id ? 1 : Math.min(Math.max(input.limit || 20, 1), 100));

  if (input.module) query = query.eq("module_slug", input.module);
  if (input.id) query = query.eq("id", input.id);
  if (!actor.isAdmin) {
    const branchIds = actor.branches.map((branch) => branch.id).filter(Boolean);
    query = branchIds.length
      ? query.or(`created_by_user_id.eq.${actor.id},branch_id.in.(${branchIds.join(",")})`)
      : query.eq("created_by_user_id", actor.id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data || []) as unknown as LaunchDbRow[]).filter((row) => actorCanViewLaunch(actor, row)).map(mapLaunch);
}

export async function getOperationalLaunch(actor: AppActor, id: string) {
  return (await listOperationalLaunches(actor, { id }))[0] || null;
}

export async function createValidatedOperationalLaunch(actor: AppActor, input: OperationalLaunchValidateInput) {
  const client = assertServiceClient();
  const selectedBranch =
    actor.branches.find((branch) => branch.code === input.branchCode) ||
    actor.branches.find((branch) => branch.fluigLabel === input.branchLabel) ||
    null;

  if (!actor.isAdmin && !selectedBranch) {
    throw new Error("Usuario sem acesso a filial informada.");
  }

  let supplier: { id: string; razao_social: string; cnpj_normalizado: string | null } | null = null;
  if (input.supplierId) {
    const { data, error } = await client
      .from("app_suppliers")
      .select("id,razao_social,cnpj_normalizado")
      .eq("id", input.supplierId)
      .eq("status", "ATIVO")
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Fornecedor oficial ativo nao encontrado.");
    supplier = data as { id: string; razao_social: string; cnpj_normalizado: string | null };
  }

  const fingerprint = operationalLaunchFingerprint(input);
  const { data: existingData, error: existingError } = await client
    .from("app_fluig_launches")
    .select("id")
    .eq("module_slug", input.module)
    .eq("status", "VALIDADO")
    .eq("created_by_user_id", actor.id)
    .eq("review_fingerprint", fingerprint)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingData?.id) {
    return (await getOperationalLaunch(actor, String(existingData.id)))!;
  }

  const { data, error } = await client
    .from("app_fluig_launches")
    .insert({
      module_slug: input.module,
      status: "VALIDADO",
      title: input.title,
      description: input.description || null,
      app_supplier_id: supplier?.id || null,
      supplier_name: input.supplierName || supplier?.razao_social || null,
      supplier_cnpj: input.supplierCnpj || supplier?.cnpj_normalizado || null,
      branch_id: selectedBranch?.id || null,
      branch_code: input.branchCode || selectedBranch?.code || null,
      branch_label: input.branchLabel || selectedBranch?.fluigLabel || selectedBranch?.name || null,
      source_request_id: input.sourceRequestId,
      amount_cents: input.amountCents ?? null,
      due_date: input.dueDate || null,
      field_overrides: input.fieldOverrides,
      attachment_metadata: input.attachments,
      review_fingerprint: fingerprint,
      progress_stage: "validated",
      progress_label: "Lancamento validado e aguardando confirmacao.",
      created_by_user_id: actor.id,
      updated_by_user_id: actor.id,
    })
    .select("*")
    .single();
  if (error) throw error;

  const launch = data as LaunchDbRow;
  const items = input.items || [];
  if (items.length) {
    const { error: itemsError } = await client.from("app_fluig_launch_items").insert(
      items.map((item, index) => ({
        launch_id: launch.id,
        line_number: index + 1,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price_cents: item.unitPriceCents,
        total_cents: Math.round(item.quantity * item.unitPriceCents),
        metadata: item.metadata || {},
      }))
    );
    if (itemsError) {
      await client.from("app_fluig_launches").delete().eq("id", launch.id);
      throw itemsError;
    }
  }

  await recordLaunchEvent(client, {
    launchId: launch.id,
    actorId: actor.id,
    type: "validated",
    label: "Lancamento validado no ADM.",
    statusTo: "VALIDADO",
    payload: {
      sourceRequestId: input.sourceRequestId,
      attachmentCount: input.attachments.length,
      itemCount: items.length,
    },
  });

  return (await getOperationalLaunch(actor, launch.id))!;
}

export async function markOperationalLaunchQueued(
  actor: AppActor,
  launchId: string,
  job: FluigJobRecord
) {
  const client = assertServiceClient();
  const current = await getOperationalLaunch(actor, launchId);
  if (!current) throw new Error("Lancamento operacional nao encontrado.");
  const now = new Date().toISOString();
  const { error } = await client
    .from("app_fluig_launches")
    .update({
      status: "NA_FILA",
      fluig_job_id: job.id,
      progress_stage: job.progressStage || "queued",
      progress_label: job.progressLabel || "Aguardando agente local.",
      last_error_message: null,
      queued_at: now,
      failed_at: null,
      updated_by_user_id: actor.id,
    })
    .eq("id", launchId);
  if (error) throw error;

  await recordLaunchEvent(client, {
    launchId,
    actorId: actor.id,
    type: "queued",
    label: "Lancamento enviado para a fila do agente Fluig.",
    statusFrom: current.status,
    statusTo: "NA_FILA",
    payload: { jobId: job.id },
  });
  return (await getOperationalLaunch(actor, launchId))!;
}

export async function markOperationalLaunchFailure(
  launchId: string,
  actorId: string,
  errorMessage: string,
  jobId?: string | null
) {
  const client = assertServiceClient();
  const { data: currentData, error: currentError } = await client
    .from("app_fluig_launches")
    .select("id,status,app_supplier_id,supplier_name,supplier_cnpj,branch_code,branch_label,amount_cents,due_date")
    .eq("id", launchId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!currentData) return null;

  const now = new Date().toISOString();
  const { error } = await client
    .from("app_fluig_launches")
    .update({
      status: "ERRO",
      last_error_message: errorMessage,
      progress_stage: "error",
      progress_label: errorMessage,
      failed_at: now,
      updated_by_user_id: actorId,
    })
    .eq("id", launchId);
  if (error) throw error;

  await recordLaunchEvent(client, {
    launchId,
    actorId,
    type: "error",
    label: errorMessage,
    statusFrom: String(currentData.status),
    statusTo: "ERRO",
    payload: { jobId: jobId || null },
  });
  return true;
}

export async function updateOperationalLaunchJobProgress(input: {
  job: FluigJobRecord;
  status?: FluigJobStatus;
  stage?: string | null;
  label?: string | null;
}) {
  if (input.job.operation !== "open_from_source" || !input.job.requestPayload.launchId) return null;
  const client = assertServiceClient();
  const activeStatus =
    input.status === "queued" ? "NA_FILA" : input.status && ["success", "error", "cancelled", "expired"].includes(input.status)
      ? null
      : "EM_EXECUCAO";
  if (!activeStatus) return null;

  const { error } = await client
    .from("app_fluig_launches")
    .update({
      status: activeStatus,
      progress_stage: input.stage || input.status || "processing",
      progress_label: input.label || "Agente local executando o lancamento.",
    })
    .eq("id", String(input.job.requestPayload.launchId))
    .eq("fluig_job_id", input.job.id);
  if (error) throw error;
  return true;
}

export async function completeOperationalLaunchJob(input: {
  job: FluigJobRecord;
  generatedRequestId: string;
  resultPayload: JsonRecord;
}) {
  const launchId = String(input.job.requestPayload.launchId || "");
  if (!launchId || input.job.operation !== "open_from_source") return null;
  const client = assertServiceClient();
  const { data: currentData, error: currentError } = await client
    .from("app_fluig_launches")
    .select("id,status,app_supplier_id,supplier_name,supplier_cnpj,branch_code,branch_label,amount_cents,due_date")
    .eq("id", launchId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!currentData) return null;

  const { data: requestRow, error: requestError } = await client
    .from("fluig_requests")
    .select("id")
    .eq("module_slug", input.job.module)
    .eq("fluig_request_id", input.generatedRequestId)
    .maybeSingle();
  if (requestError) throw requestError;

  const now = new Date().toISOString();
  if (requestRow?.id) {
    const { error: requestUpdateError } = await client
      .from("fluig_requests")
      .update({
        app_supplier_id: currentData.app_supplier_id || null,
        supplier_name: currentData.supplier_name || null,
        supplier_cnpj: currentData.supplier_cnpj || null,
        branch_code: currentData.branch_code || null,
        branch_label: currentData.branch_label || null,
        amount_cents: currentData.amount_cents == null ? null : Number(currentData.amount_cents),
        due_date: currentData.due_date || null,
        created_by_user_id: input.job.requestedByUserId,
        sync_owner_user_id: input.job.requestedByUserId,
        sync_source: "open_from_source",
        last_status_check_at: now,
      })
      .eq("id", requestRow.id);
    if (requestUpdateError) throw requestUpdateError;
  }

  const { error } = await client
    .from("app_fluig_launches")
    .update({
      status: "ABERTO_NO_FLUIG",
      fluig_request_id: input.generatedRequestId,
      fluig_request_row_id: requestRow?.id || null,
      progress_stage: "success",
      progress_label: `Solicitacao Fluig ${input.generatedRequestId} aberta.`,
      result_payload: input.resultPayload,
      last_error_message: null,
      opened_at: now,
      failed_at: null,
      updated_by_user_id: input.job.requestedByUserId,
    })
    .eq("id", launchId);
  if (error) throw error;

  await recordLaunchEvent(client, {
    launchId,
    actorId: input.job.requestedByUserId,
    type: "fluig_opened",
    label: `Solicitacao Fluig ${input.generatedRequestId} aberta.`,
    statusFrom: String(currentData.status),
    statusTo: "ABERTO_NO_FLUIG",
    payload: {
      jobId: input.job.id,
      generatedRequestId: input.generatedRequestId,
      sourceRequestId: input.job.requestPayload.sourceRequestId,
    },
  });
  return true;
}
