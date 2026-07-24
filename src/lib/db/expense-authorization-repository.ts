import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AppAuthError,
  canActorAccessPage,
  canActorPerformPageAction,
  createFluigJob,
  type AppActor,
  type FluigJobRecord,
} from "@/lib/db/app-repository";
import {
  type ExpenseAuthorizationEvent,
  type ExpenseAuthorizationItem,
  type ExpenseAuthorizationCreateInput,
  type ExpenseAuthorizationRecord,
  type ExpenseAuthorizationStatus,
  type ExpenseAuthorizationUpdateInput,
  expenseAuthorizationSourceData,
} from "@/lib/expense-authorization";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";

const signedDocumentBucket = "adf-documents";

type AuthorizationDbRow = {
  id: string;
  document_number: string;
  launch_id: string | null;
  module_slug: "pagamentos" | "compras";
  creation_source: "LANCAMENTO" | "MANUAL" | "DOCUMENTO_FISCAL";
  status: ExpenseAuthorizationStatus;
  issue_date: string;
  invoice_number: string | null;
  invoice_due_date: string | null;
  expense_type: string | null;
  description: string;
  expense_account: string | null;
  financial_account: string | null;
  cost_center: string | null;
  branch_id: string | null;
  branch_code: string | null;
  branch_label: string | null;
  supplier_name: string | null;
  supplier_tax_id: string | null;
  amount_cents: number | null;
  amount_words: string | null;
  beneficiary_category: string | null;
  beneficiary_name: string | null;
  beneficiary_tax_id: string | null;
  beneficiary_phone: string | null;
  payment_method: string | null;
  bank_name: string | null;
  bank_operation: string | null;
  bank_agency: string | null;
  bank_account: string | null;
  pix_key: string | null;
  requester_name: string | null;
  requester_role: string | null;
  budget_planned_cents: number | null;
  budget_realized_cents: number | null;
  budget_deviation_cents: number | null;
  budget_deviation_percent: number | null;
  additional_info: string | null;
  fluig_request_id: string | null;
  physical_location: string | null;
  delivered_to: string | null;
  signature_storage_bucket: string | null;
  signature_storage_path: string | null;
  signature_file_name: string | null;
  signature_size_bytes: number | null;
  signature_received_at: string | null;
  sent_for_signature_at: string | null;
  delivered_at: string | null;
  attached_to_fluig_at: string | null;
  attach_job_id: string | null;
  last_error_message: string | null;
  source_snapshot: unknown;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

type AuthorizationItemDbRow = {
  id: string;
  launch_id: string;
  line_number: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
  total_cents: number;
};

type AuthorizationEventDbRow = {
  id: string;
  authorization_id: string;
  event_type: string;
  label: string;
  status_from: ExpenseAuthorizationStatus | null;
  status_to: ExpenseAuthorizationStatus | null;
  created_at: string;
};

function assertServiceClient() {
  const client = getSupabaseServiceClient();
  if (!client) {
    const status = getSupabaseServiceStatus();
    throw new Error(`Supabase nao configurado para ADF. Faltando: ${status.missing.join(", ") || "service role"}.`);
  }
  return client;
}

function assertViewAccess(actor: AppActor) {
  if (!canActorAccessPage(actor, "adfs")) {
    throw new AppAuthError("Usuario sem acesso ao controle de ADF.", 403, "ADF_ACCESS_DENIED");
  }
}

function assertUpdateAccess(actor: AppActor) {
  assertViewAccess(actor);
  if (!canActorPerformPageAction(actor, "adfs", "canUpdate")) {
    throw new AppAuthError("Usuario sem permissao para atualizar ADF.", 403, "ADF_UPDATE_DENIED");
  }
}

function assertCreateAccess(actor: AppActor) {
  assertViewAccess(actor);
  if (
    !actor.isAdmin &&
    !canActorPerformPageAction(actor, "adfs", "canCreate") &&
    !canActorPerformPageAction(actor, "adfs", "canUpdate")
  ) {
    throw new AppAuthError("Usuario sem permissao para criar ADF.", 403, "ADF_CREATE_DENIED");
  }
}

function mapEvent(row: AuthorizationEventDbRow): ExpenseAuthorizationEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    label: row.label,
    statusFrom: row.status_from,
    statusTo: row.status_to,
    createdAt: row.created_at,
  };
}

function mapAuthorization(
  row: AuthorizationDbRow,
  events: ExpenseAuthorizationEvent[] = [],
  items: ExpenseAuthorizationItem[] = []
): ExpenseAuthorizationRecord {
  const sourceData = expenseAuthorizationSourceData(row.source_snapshot);
  return {
    id: row.id,
    documentNumber: row.document_number,
    launchId: row.launch_id,
    module: row.module_slug,
    creationSource: row.creation_source || "LANCAMENTO",
    status: row.status,
    issueDate: row.issue_date,
    invoiceNumber: row.invoice_number,
    invoiceDueDate: row.invoice_due_date,
    expenseType: row.expense_type,
    description: row.description,
    expenseAccount: row.expense_account,
    financialAccount: row.financial_account,
    costCenter: row.cost_center,
    branchId: row.branch_id,
    branchCode: row.branch_code,
    branchLabel: row.branch_label,
    supplierName: row.supplier_name,
    supplierTaxId: row.supplier_tax_id,
    amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
    amountWords: row.amount_words,
    beneficiaryCategory: row.beneficiary_category,
    beneficiaryName: row.beneficiary_name,
    beneficiaryTaxId: row.beneficiary_tax_id,
    beneficiaryPhone: row.beneficiary_phone,
    paymentMethod: row.payment_method,
    bankName: row.bank_name,
    bankOperation: row.bank_operation,
    bankAgency: row.bank_agency,
    bankAccount: row.bank_account,
    pixKey: row.pix_key,
    requesterName: row.requester_name,
    requesterRole: row.requester_role,
    budgetPlannedCents: row.budget_planned_cents == null ? null : Number(row.budget_planned_cents),
    budgetRealizedCents: row.budget_realized_cents == null ? null : Number(row.budget_realized_cents),
    budgetDeviationCents: row.budget_deviation_cents == null ? null : Number(row.budget_deviation_cents),
    budgetDeviationPercent: row.budget_deviation_percent == null ? null : Number(row.budget_deviation_percent),
    additionalInfo: row.additional_info,
    fluigRequestId: row.fluig_request_id,
    physicalLocation: row.physical_location,
    deliveredTo: row.delivered_to,
    signedDocumentName: row.signature_file_name,
    signedDocumentSize: row.signature_size_bytes == null ? null : Number(row.signature_size_bytes),
    signedDocumentReceivedAt: row.signature_received_at,
    sentForSignatureAt: row.sent_for_signature_at,
    deliveredAt: row.delivered_at,
    attachedToFluigAt: row.attached_to_fluig_at,
    attachJobId: row.attach_job_id,
    lastErrorMessage: row.last_error_message,
    sourceRequestId: sourceData.sourceRequestId,
    sourceFields: sourceData.sourceFields,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
    events,
  };
}

function actorCanView(actor: AppActor, row: AuthorizationDbRow) {
  return actor.isAdmin || row.created_by_user_id === actor.id || actor.branches.some((branch) => branch.id === row.branch_id);
}

async function loadEvents(client: SupabaseClient, authorizationIds: string[]) {
  const grouped = new Map<string, ExpenseAuthorizationEvent[]>();
  if (!authorizationIds.length) return grouped;

  const { data, error } = await client
    .from("app_expense_authorization_events")
    .select("id,authorization_id,event_type,label,status_from,status_to,created_at")
    .in("authorization_id", authorizationIds)
    .order("created_at", { ascending: false });
  if (error) throw error;

  for (const row of (data || []) as AuthorizationEventDbRow[]) {
    grouped.set(row.authorization_id, [...(grouped.get(row.authorization_id) || []), mapEvent(row)]);
  }
  return grouped;
}

async function loadItems(client: SupabaseClient, launchIds: string[]) {
  const grouped = new Map<string, ExpenseAuthorizationItem[]>();
  if (!launchIds.length) return grouped;

  const { data, error } = await client
    .from("app_fluig_launch_items")
    .select("id,launch_id,line_number,description,quantity,unit,unit_price_cents,total_cents")
    .in("launch_id", launchIds)
    .order("line_number", { ascending: true });
  if (error) throw error;

  for (const row of (data || []) as AuthorizationItemDbRow[]) {
    const item: ExpenseAuthorizationItem = {
      id: row.id,
      lineNumber: Number(row.line_number),
      description: row.description,
      quantity: Number(row.quantity),
      unit: row.unit,
      unitPriceCents: Number(row.unit_price_cents),
      totalCents: Number(row.total_cents),
    };
    grouped.set(row.launch_id, [...(grouped.get(row.launch_id) || []), item]);
  }
  return grouped;
}

export async function listExpenseAuthorizations(
  actor: AppActor,
  input: { id?: string | null; status?: ExpenseAuthorizationStatus | null; query?: string | null } = {}
) {
  assertViewAccess(actor);
  const client = assertServiceClient();
  let request = client
    .from("app_expense_authorizations")
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(input.id ? 1 : 250);

  if (input.id) request = request.eq("id", input.id);
  if (input.status) request = request.eq("status", input.status);
  if (input.query?.trim()) {
    const query = input.query.trim().replace(/[,%()]/g, " ");
    request = request.or(
      `document_number.ilike.%${query}%,supplier_name.ilike.%${query}%,fluig_request_id.ilike.%${query}%,description.ilike.%${query}%`
    );
  }
  if (!actor.isAdmin) {
    const branchIds = actor.branches.map((branch) => branch.id);
    request = branchIds.length
      ? request.or(`created_by_user_id.eq.${actor.id},branch_id.in.(${branchIds.join(",")})`)
      : request.eq("created_by_user_id", actor.id);
  }

  const { data, error } = await request;
  if (error) throw error;
  const rows = ((data || []) as AuthorizationDbRow[]).filter((row) => actorCanView(actor, row));
  const [events, items] = await Promise.all([
    loadEvents(client, rows.map((row) => row.id)),
    loadItems(client, rows.map((row) => row.launch_id).filter((id): id is string => Boolean(id))),
  ]);
  return rows.map((row) => mapAuthorization(row, events.get(row.id) || [], row.launch_id ? items.get(row.launch_id) || [] : []));
}

export async function getExpenseAuthorization(actor: AppActor, id: string) {
  return (await listExpenseAuthorizations(actor, { id }))[0] || null;
}

async function recordEvent(
  client: SupabaseClient,
  input: {
    authorizationId: string;
    actorId: string;
    eventType: string;
    label: string;
    statusFrom?: ExpenseAuthorizationStatus | null;
    statusTo?: ExpenseAuthorizationStatus | null;
    payload?: Record<string, unknown>;
  }
) {
  const { error } = await client.from("app_expense_authorization_events").insert({
    authorization_id: input.authorizationId,
    actor_user_id: input.actorId,
    event_type: input.eventType,
    label: input.label,
    status_from: input.statusFrom || null,
    status_to: input.statusTo || null,
    event_payload: input.payload || {},
  });
  if (error) throw error;
}

function textOrNull(value: string | null | undefined) {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}

function resolveBranch(actor: AppActor, branchId: string | null | undefined) {
  if (!branchId) return null;
  const branch = actor.branches.find((item) => item.id === branchId);
  if (!branch) {
    throw new AppAuthError("A filial selecionada nao esta disponivel para este usuario.", 403, "ADF_BRANCH_DENIED");
  }
  return branch;
}

export async function createExpenseAuthorization(actor: AppActor, input: ExpenseAuthorizationCreateInput) {
  assertCreateAccess(actor);
  const client = assertServiceClient();
  const branch = resolveBranch(actor, input.branchId);
  const sourceDocument = input.sourceDocument || null;
  const payload = {
    launch_id: null,
    module_slug: input.module,
    creation_source: input.creationSource,
    status: "EM_ELABORACAO",
    issue_date: input.issueDate,
    invoice_number: textOrNull(input.invoiceNumber),
    invoice_due_date: input.invoiceDueDate || null,
    expense_type: textOrNull(input.expenseType),
    description: input.description.trim(),
    expense_account: textOrNull(input.expenseAccount),
    financial_account: textOrNull(input.financialAccount),
    cost_center: textOrNull(input.costCenter),
    branch_id: branch?.id || null,
    branch_code: branch?.code || textOrNull(input.branchCode),
    branch_label: branch?.fluigLabel || branch?.name || textOrNull(input.branchLabel),
    supplier_name: textOrNull(input.supplierName),
    supplier_tax_id: textOrNull(input.supplierTaxId),
    amount_cents: input.amountCents ?? null,
    amount_words: textOrNull(input.amountWords),
    beneficiary_category: textOrNull(input.beneficiaryCategory),
    beneficiary_name: textOrNull(input.beneficiaryName),
    beneficiary_tax_id: textOrNull(input.beneficiaryTaxId),
    beneficiary_phone: textOrNull(input.beneficiaryPhone),
    payment_method: textOrNull(input.paymentMethod),
    bank_name: textOrNull(input.bankName),
    bank_operation: textOrNull(input.bankOperation),
    bank_agency: textOrNull(input.bankAgency),
    bank_account: textOrNull(input.bankAccount),
    pix_key: textOrNull(input.pixKey),
    requester_name: textOrNull(input.requesterName) || actor.displayName,
    requester_role: textOrNull(input.requesterRole) || actor.role,
    budget_planned_cents: input.budgetPlannedCents ?? null,
    budget_realized_cents: input.budgetRealizedCents ?? null,
    budget_deviation_cents: input.budgetDeviationCents ?? null,
    budget_deviation_percent: input.budgetDeviationPercent ?? null,
    additional_info: textOrNull(input.additionalInfo),
    fluig_request_id: textOrNull(input.fluigRequestId),
    physical_location: textOrNull(input.physicalLocation),
    delivered_to: textOrNull(input.deliveredTo),
    source_snapshot: {
      creationSource: input.creationSource,
      sourceDocument,
      fieldOverrides: {},
    },
    created_by_user_id: actor.id,
    updated_by_user_id: actor.id,
  };

  const { data, error } = await client.from("app_expense_authorizations").insert(payload).select("id").single();
  if (error) throw error;

  await recordEvent(client, {
    authorizationId: String(data.id),
    actorId: actor.id,
    eventType: input.creationSource === "DOCUMENTO_FISCAL" ? "CREATED_FROM_FISCAL_DOCUMENT" : "CREATED_MANUALLY",
    label:
      input.creationSource === "DOCUMENTO_FISCAL"
        ? `ADF criada a partir do ${sourceDocument?.sourceType?.toUpperCase() || "documento fiscal"} ${sourceDocument?.name || ""}.`.trim()
        : "ADF criada manualmente no Controle de ADF.",
    statusTo: "EM_ELABORACAO",
    payload: sourceDocument ? { sourceDocument } : {},
  });
  return (await getExpenseAuthorization(actor, String(data.id)))!;
}

export async function updateExpenseAuthorization(
  actor: AppActor,
  id: string,
  input: ExpenseAuthorizationUpdateInput
) {
  assertUpdateAccess(actor);
  const client = assertServiceClient();
  const current = await getExpenseAuthorization(actor, id);
  if (!current) throw new Error("ADF nao encontrada.");
  const branch = input.branchId !== undefined ? resolveBranch(actor, input.branchId) : undefined;

  const payload: Record<string, unknown> = { updated_by_user_id: actor.id };
  const textFields: Array<[keyof ExpenseAuthorizationUpdateInput, string]> = [
    ["expenseType", "expense_type"],
    ["description", "description"],
    ["expenseAccount", "expense_account"],
    ["financialAccount", "financial_account"],
    ["costCenter", "cost_center"],
    ["branchCode", "branch_code"],
    ["branchLabel", "branch_label"],
    ["supplierName", "supplier_name"],
    ["supplierTaxId", "supplier_tax_id"],
    ["invoiceNumber", "invoice_number"],
    ["amountWords", "amount_words"],
    ["beneficiaryCategory", "beneficiary_category"],
    ["beneficiaryName", "beneficiary_name"],
    ["beneficiaryTaxId", "beneficiary_tax_id"],
    ["beneficiaryPhone", "beneficiary_phone"],
    ["paymentMethod", "payment_method"],
    ["bankName", "bank_name"],
    ["bankOperation", "bank_operation"],
    ["bankAgency", "bank_agency"],
    ["bankAccount", "bank_account"],
    ["pixKey", "pix_key"],
    ["requesterName", "requester_name"],
    ["requesterRole", "requester_role"],
    ["additionalInfo", "additional_info"],
    ["fluigRequestId", "fluig_request_id"],
    ["physicalLocation", "physical_location"],
    ["deliveredTo", "delivered_to"],
  ];
  for (const [source, target] of textFields) {
    if (input[source] !== undefined) payload[target] = textOrNull(input[source] as string | null | undefined);
  }

  const numericFields: Array<[keyof ExpenseAuthorizationUpdateInput, string]> = [
    ["amountCents", "amount_cents"],
    ["budgetPlannedCents", "budget_planned_cents"],
    ["budgetRealizedCents", "budget_realized_cents"],
    ["budgetDeviationCents", "budget_deviation_cents"],
    ["budgetDeviationPercent", "budget_deviation_percent"],
  ];
  for (const [source, target] of numericFields) {
    if (input[source] !== undefined) payload[target] = input[source];
  }

  if (input.issueDate !== undefined) payload.issue_date = input.issueDate;
  if (input.invoiceDueDate !== undefined) payload.invoice_due_date = input.invoiceDueDate;
  if (input.module !== undefined) payload.module_slug = input.module;
  if (input.branchId !== undefined) {
    payload.branch_id = branch?.id || null;
    payload.branch_code = branch?.code || null;
    payload.branch_label = branch?.fluigLabel || branch?.name || null;
  }
  if (input.status !== undefined) {
    payload.status = input.status;
    if (input.status === "AGUARDANDO_ASSINATURA" && !current.sentForSignatureAt) {
      payload.sent_for_signature_at = new Date().toISOString();
    }
    if (input.status === "ENTREGUE" && !current.deliveredAt) payload.delivered_at = new Date().toISOString();
  }

  const { error } = await client.from("app_expense_authorizations").update(payload).eq("id", id);
  if (error) throw error;

  await recordEvent(client, {
    authorizationId: id,
    actorId: actor.id,
    eventType: input.status && input.status !== current.status ? "STATUS_CHANGED" : "UPDATED",
    label:
      input.status && input.status !== current.status
        ? `Status da ADF alterado para ${input.status}.`
        : "Dados da ADF atualizados.",
    statusFrom: current.status,
    statusTo: input.status || current.status,
  });

  return (await getExpenseAuthorization(actor, id))!;
}

export async function uploadSignedExpenseAuthorization(actor: AppActor, id: string, file: File) {
  assertUpdateAccess(actor);
  if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Envie a ADF assinada em PDF.");
  }
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error("O PDF assinado deve ter ate 10 MB.");
  }

  const client = assertServiceClient();
  const current = await getExpenseAuthorization(actor, id);
  if (!current) throw new Error("ADF nao encontrada.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${id}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "-")}`;
  const { error: uploadError } = await client.storage.from(signedDocumentBucket).upload(storagePath, buffer, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data: currentStorage } = await client
    .from("app_expense_authorizations")
    .select("signature_storage_bucket,signature_storage_path")
    .eq("id", id)
    .maybeSingle();
  const now = new Date().toISOString();
  const { error } = await client
    .from("app_expense_authorizations")
    .update({
      status: "ASSINADA",
      signature_storage_bucket: signedDocumentBucket,
      signature_storage_path: storagePath,
      signature_file_name: file.name,
      signature_mime_type: "application/pdf",
      signature_size_bytes: file.size,
      signature_received_at: now,
      last_error_message: null,
      updated_by_user_id: actor.id,
    })
    .eq("id", id);
  if (error) {
    await client.storage.from(signedDocumentBucket).remove([storagePath]);
    throw error;
  }

  if (currentStorage?.signature_storage_bucket && currentStorage.signature_storage_path) {
    await client.storage
      .from(String(currentStorage.signature_storage_bucket))
      .remove([String(currentStorage.signature_storage_path)]);
  }

  await recordEvent(client, {
    authorizationId: id,
    actorId: actor.id,
    eventType: "SIGNED_DOCUMENT_UPLOADED",
    label: "ADF assinada recebida e armazenada no ADM.",
    statusFrom: current.status,
    statusTo: "ASSINADA",
    payload: { fileName: file.name, size: file.size },
  });
  return (await getExpenseAuthorization(actor, id))!;
}

export async function createSignedExpenseAuthorizationDownload(actor: AppActor, id: string) {
  const current = await getExpenseAuthorization(actor, id);
  if (!current) throw new Error("ADF nao encontrada.");
  const client = assertServiceClient();
  const { data } = await client
    .from("app_expense_authorizations")
    .select("signature_storage_bucket,signature_storage_path,signature_file_name")
    .eq("id", id)
    .maybeSingle();
  if (!data?.signature_storage_bucket || !data.signature_storage_path) throw new Error("ADF assinada ainda nao anexada.");
  const { data: signed, error } = await client.storage
    .from(String(data.signature_storage_bucket))
    .createSignedUrl(String(data.signature_storage_path), 60, { download: String(data.signature_file_name || "ADF-assinada.pdf") });
  if (error) throw error;
  return signed.signedUrl;
}

export async function enqueueExpenseAuthorizationAttachment(actor: AppActor, id: string) {
  assertUpdateAccess(actor);
  const client = assertServiceClient();
  const current = await getExpenseAuthorization(actor, id);
  if (!current) throw new Error("ADF nao encontrada.");
  if (!current.fluigRequestId) throw new Error("Abra a solicitacao no Fluig antes de anexar a ADF assinada.");

  const { data } = await client
    .from("app_expense_authorizations")
    .select("signature_storage_bucket,signature_storage_path,signature_file_name,signature_size_bytes")
    .eq("id", id)
    .maybeSingle();
  if (!data?.signature_storage_bucket || !data.signature_storage_path) {
    throw new Error("Envie o PDF assinado antes de anexar ao Fluig.");
  }

  const { data: file, error: downloadError } = await client.storage
    .from(String(data.signature_storage_bucket))
    .download(String(data.signature_storage_path));
  if (downloadError) throw downloadError;
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const job = await createFluigJob({
    actor,
    module: current.module,
    operation: "attach_to_request",
    branchCode: current.branchCode,
    branchLabel: current.branchLabel,
    requestPayload: {
      adfId: current.id,
      requestId: current.fluigRequestId,
      attachments: [
        {
          name: data.signature_file_name || `${current.documentNumber}-assinada.pdf`,
          mimeType: "application/pdf",
          size: Number(data.signature_size_bytes || fileBuffer.length),
          dataBase64: fileBuffer.toString("base64"),
        },
      ],
    },
  });

  const { error } = await client
    .from("app_expense_authorizations")
    .update({
      status: "ANEXO_NA_FILA",
      attach_job_id: job.id,
      last_error_message: null,
      updated_by_user_id: actor.id,
    })
    .eq("id", id);
  if (error) throw error;

  await recordEvent(client, {
    authorizationId: id,
    actorId: actor.id,
    eventType: "FLUIG_ATTACHMENT_QUEUED",
    label: `Envio da ADF assinada para o Fluig ${current.fluigRequestId} colocado na fila.`,
    statusFrom: current.status,
    statusTo: "ANEXO_NA_FILA",
    payload: { jobId: job.id, requestId: current.fluigRequestId },
  });
  return { job, authorization: (await getExpenseAuthorization(actor, id))! };
}

export async function completeExpenseAuthorizationAttachment(input: {
  job: FluigJobRecord;
  success: boolean;
  resultPayload: Record<string, unknown>;
  errorMessage?: string | null;
}) {
  if (input.job.operation !== "attach_to_request") return null;
  const authorizationId = String(input.job.requestPayload.adfId || "");
  if (!authorizationId) return null;
  const client = assertServiceClient();
  const { data: current, error: currentError } = await client
    .from("app_expense_authorizations")
    .select("status,fluig_request_id")
    .eq("id", authorizationId)
    .eq("attach_job_id", input.job.id)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) return null;

  const nextStatus: ExpenseAuthorizationStatus = input.success ? "ANEXADA_FLUIG" : "ASSINADA";
  const { error } = await client
    .from("app_expense_authorizations")
    .update({
      status: nextStatus,
      attached_to_fluig_at: input.success ? new Date().toISOString() : null,
      last_error_message: input.success ? null : input.errorMessage || "Falha ao anexar ADF no Fluig.",
      updated_by_user_id: input.job.requestedByUserId,
    })
    .eq("id", authorizationId);
  if (error) throw error;

  await recordEvent(client, {
    authorizationId,
    actorId: input.job.requestedByUserId,
    eventType: input.success ? "FLUIG_ATTACHMENT_CONFIRMED" : "FLUIG_ATTACHMENT_FAILED",
    label: input.success
      ? `ADF confirmada nos anexos da solicitacao Fluig ${current.fluig_request_id}.`
      : input.errorMessage || "Falha ao anexar ADF no Fluig.",
    statusFrom: current.status as ExpenseAuthorizationStatus,
    statusTo: nextStatus,
    payload: { jobId: input.job.id, result: input.resultPayload },
  });
  return true;
}
