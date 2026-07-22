import { NextResponse } from "next/server";
import {
  completeFluigUserSyncStateForJob,
  completeFluigJob,
  completeServerFluigJob,
  readJobForAgent,
  recordDetectedFluigUserId,
  recordFluigJobEvent,
  recordServerFluigJobEvent,
  type FluigJobRecord,
  type FluigUserSyncType,
  type FluigJobStatus,
} from "@/lib/db/app-repository";
import {
  buildFluigCatalogItemsByModule,
  buildSupplierCandidates,
  clearStaleFluigUserTaskMemberships,
  persistFluigCatalogItems,
  type PersistenceResult,
  persistHistoryItemsInChunksByModule,
  persistFluigMonitoredUserSyncResults,
  persistStatusItems,
  persistSupplierCandidates,
} from "@/lib/db/fluig-repository";
import {
  completeMaintenanceOrderFluigOpenJob,
  recordMaintenanceOrderFluigJobFailure,
} from "@/lib/db/maintenance-repository";
import {
  completeExpenseAuthorizationAttachment,
} from "@/lib/db/expense-authorization-repository";
import {
  completeOperationalLaunchJob,
  markOperationalLaunchFailure,
} from "@/lib/db/operational-launch-repository";
import { markSupplierFluigSyncResult, reconcileSupplierPreRegistrations } from "@/lib/db/suppliers-repository";
import { syncProductsFromFluigHistoryRequestIds } from "@/lib/db/products-repository";
import { mergePersistence } from "@/lib/fluig/route-utils";
import type { FluigHistoryItem, FluigStatusItem } from "@/lib/fluig/server-client";
import type { FluigModuleSlug } from "@/lib/fluig-data";
import { requireAgent } from "@/app/api/agent/_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

type ResultBody = {
  status?: Extract<FluigJobStatus, "success" | "error" | "cancelled">;
  resultPayload?: Record<string, unknown>;
  errorMessage?: string | null;
};

const MISSING_OPEN_PROTOCOL_ERROR =
  "O agente informou sucesso, mas nao retornou o protocolo da solicitacao Fluig.";

function extractHistoryItems(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  const directItems = payload.items;
  const dataItems = data?.items;
  return (Array.isArray(dataItems) ? dataItems : Array.isArray(directItems) ? directItems : []) as FluigHistoryItem[];
}

function extractStatusItems(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  const directItems = payload.items;
  const dataItems = data?.items;
  return (Array.isArray(dataItems) ? dataItems : Array.isArray(directItems) ? directItems : []) as FluigStatusItem[];
}

function extractCancelStatusItems(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  const directItems = payload.items;
  const dataItems = data?.items;
  const items = (Array.isArray(dataItems) ? dataItems : Array.isArray(directItems) ? directItems : []) as Array<
    Record<string, unknown>
  >;
  const processedAt = String(data?.processedAt || payload.processedAt || new Date().toISOString());

  return items
    .map((item) => String(item.requestId || item.numeroFluig || "").trim())
    .filter(Boolean)
    .map(
      (requestId): FluigStatusItem => ({
        numeroFluig: requestId,
        etapaAtual: "Cancelado",
        responsavelAtual: "",
        statusProcesso: "cancelado",
        active: false,
        cancelavel: false,
        dataUltimaConsulta: processedAt,
      })
    );
}

type DetectedFluigUser = {
  id: string | null;
  code: string;
  login: string | null;
  email: string | null;
  fullName: string | null;
};

function resultOutput(payload: Record<string, unknown>) {
  return (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;
}

function extractCurrentFluigUser(payload: Record<string, unknown>): DetectedFluigUser | null {
  const output = resultOutput(payload);
  const candidate = (output.currentFluigUser || output.currentUser) as Record<string, unknown> | undefined;
  const code = String(candidate?.code || output.currentUserId || "").trim();
  if (!code) return null;

  return {
    id: candidate?.id == null ? null : String(candidate.id),
    code,
    login: String(candidate?.login || "").trim() || null,
    email: String(candidate?.email || "").trim() || null,
    fullName: String(candidate?.fullName || "").trim() || null,
  };
}

function purchaseHistoryRequestIds(fallback: FluigModuleSlug, items: FluigHistoryItem[]) {
  return Array.from(
    new Set(
      items
        .filter((item) => (item.moduleSlug || fallback) === "compras")
        .map((item) => String(item.processInstanceId || "").trim())
        .filter(Boolean)
    )
  );
}

async function persistProductsFromHistoryJob(
  fallback: FluigModuleSlug,
  items: FluigHistoryItem[],
  actorId: string
): Promise<PersistenceResult> {
  const requestIds = purchaseHistoryRequestIds(fallback, items);
  if (!requestIds.length) return { configured: true, saved: {}, errors: [] };

  try {
    const result = await syncProductsFromFluigHistoryRequestIds(actorId, requestIds);
    return {
      configured: true,
      saved: {
        productRequests: result.requestsScanned,
        products: result.products,
        productOccurrences: result.occurrences,
      },
      errors: [],
    };
  } catch (error) {
    return {
      configured: true,
      saved: {},
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function extractGeneratedRequest(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  const requestId =
    data?.generatedRequestId ||
    data?.requestId ||
    data?.numeroSolicitacao ||
    data?.processInstanceId ||
    payload.generatedRequestId ||
    payload.requestId;

  return requestId ? String(requestId) : "";
}

function syncTypeForJob(operation: string): FluigUserSyncType | null {
  if (operation === "sync_initial_history" || operation === "sync_history") return "historical";
  if (operation === "sync_request_by_number" || operation === "sync_status") return "status_check";
  if (operation === "supplier_lookup_by_cnpj") return "supplier_lookup";
  if (operation === "sync_user_open_tasks") return "open_tasks";
  if (operation === "sync_user_open_requests") return "my_requests";
  return null;
}

function isFluigModuleSlug(value: string): value is FluigModuleSlug {
  return value === "pagamentos" || value === "compras" || value === "manutencao" || value === "fornecedores";
}

function moduleFromStatusItem(item: FluigStatusItem, fallback: FluigModuleSlug) {
  const moduleSlug = String((item as FluigStatusItem & { moduleSlug?: unknown }).moduleSlug || "");
  return isFluigModuleSlug(moduleSlug) ? moduleSlug : fallback;
}

function shouldPersistJobResult(job: { requestPayload: Record<string, unknown> }) {
  return job.requestPayload.persist !== false;
}

function batchDiscoveryCounts(resultPayload: Record<string, unknown>) {
  const output = resultOutput(resultPayload);
  const discovery = output.discovery as Record<string, unknown> | undefined;
  const modules = Array.isArray(discovery?.modules) ? discovery.modules : [];
  const counts = new Map<string, number>();

  for (const item of modules) {
    const row = item as Record<string, unknown>;
    const key = `${String(row.module || "")}:${String(row.syncType || "")}`;
    counts.set(key, Number(row.knownRequestIds || 0) + Number(row.discovered || 0));
  }

  return counts;
}

function directMembershipCounts(resultPayload: Record<string, unknown>) {
  const output = resultOutput(resultPayload);
  const membership = output.membership as Record<string, unknown> | undefined;
  const global = membership?.global as Record<string, unknown> | undefined;
  const modules = Array.isArray(membership?.modules) ? membership.modules : [];
  const counts = new Map<string, number>();

  for (const item of modules) {
    const row = item as Record<string, unknown>;
    const moduleSlug = String(row.module || "");
    counts.set(`${moduleSlug}:open_tasks`, Number(row.openTasks || 0));
    counts.set(`${moduleSlug}:my_requests`, Number(row.myRequests || 0));
  }

  return {
    directTaskCentral: output.directTaskCentral === true,
    counts,
    globalTotals: {
      open_tasks: Number(global?.openTasks || 0),
      my_requests: Number(global?.myRequests || 0),
    },
  };
}

function batchDefinitions(payload: Record<string, unknown>, resultPayload: Record<string, unknown> = {}) {
  const batches = Array.isArray(payload.batches) ? payload.batches : [];
  const discoveryCounts = batchDiscoveryCounts(resultPayload);
  const directCounts = directMembershipCounts(resultPayload);

  return batches
    .map((batch) => ({
      module: String((batch as Record<string, unknown>)?.module || ""),
      syncType: String((batch as Record<string, unknown>)?.syncType || ""),
      operation: String((batch as Record<string, unknown>)?.operation || ""),
      requestIds: Array.isArray((batch as Record<string, unknown>)?.requestIds)
        ? ((batch as Record<string, unknown>).requestIds as unknown[]).map(String)
        : [],
    }))
    .map((batch) => ({
      ...batch,
      requestCount:
        (directCounts.directTaskCentral
          ? directCounts.counts.get(`${batch.module}:${batch.syncType}`) ?? 0
          : discoveryCounts.get(`${batch.module}:${batch.syncType}`) ?? batch.requestIds.length),
      globalTotal: directCounts.globalTotals[batch.syncType as "open_tasks" | "my_requests"] || 0,
    }))
    .filter(
      (batch): batch is {
        module: FluigModuleSlug;
        syncType: Extract<FluigUserSyncType, "open_tasks" | "my_requests">;
        operation: string;
        requestIds: string[];
        requestCount: number;
        globalTotal: number;
      } => isFluigModuleSlug(batch.module) && (batch.syncType === "open_tasks" || batch.syncType === "my_requests")
    );
}

type JobResultExecutor = { type: "agent"; agentId: string } | { type: "server" };

async function completeResultJob(
  executor: JobResultExecutor,
  input: { jobId: string; status: "success" | "error" | "cancelled"; resultPayload?: Record<string, unknown>; errorMessage?: string | null }
) {
  return executor.type === "agent"
    ? completeFluigJob({ ...input, agentId: executor.agentId })
    : completeServerFluigJob(input);
}

function extractMonitoredUserResults(payload: Record<string, unknown>) {
  const output = resultOutput(payload);
  return (Array.isArray(output.monitoredUsers) ? output.monitoredUsers : []) as Array<{
    id?: string | null;
    displayName?: string | null;
    email?: string | null;
    currentFluigUser?: { code?: string | null; login?: string | null; email?: string | null; fullName?: string | null } | null;
    centralTaskTotals?: { openTasks?: number; myRequests?: number } | null;
    syncStartedAt?: string | null;
    processedAt?: string | null;
    error?: string | null;
  }>;
}

async function recordResultJobEvent(
  executor: JobResultExecutor,
  input: { jobId: string; eventType: string; stage?: string | null; label?: string | null; payload?: Record<string, unknown>; status?: FluigJobStatus }
) {
  return executor.type === "agent"
    ? recordFluigJobEvent({ ...input, agentId: executor.agentId })
    : recordServerFluigJobEvent(input);
}

export async function persistFluigJobResult(input: {
  job: FluigJobRecord;
  body: ResultBody;
  executor: JobResultExecutor;
}) {
  const { job, body, executor } = input;
  const jobId = job.id;
  const reportedStatus = body.status || "success";
  const resultPayload = body.resultPayload || {};
  const generatedRequestId =
    reportedStatus === "success" && job.operation === "open_from_source"
      ? extractGeneratedRequest(resultPayload).trim()
      : "";
  const missingOpenProtocol =
    reportedStatus === "success" && job.operation === "open_from_source" && !generatedRequestId;
  const status = missingOpenProtocol ? "error" : reportedStatus;
  const errorMessage = missingOpenProtocol ? MISSING_OPEN_PROTOCOL_ERROR : body.errorMessage;
  const persistenceResults: PersistenceResult[] = [];
  const currentFluigUser = extractCurrentFluigUser(resultPayload);

  if (status === "success" && (job.operation === "health_check" || job.operation === "sync_user_incremental_batch")) {
    const identity = await recordDetectedFluigUserId({
      userId: job.requestedByUserId,
      fluigUserId: currentFluigUser?.code,
      fluigUsername: currentFluigUser?.login || currentFluigUser?.email,
      fluigEmail: currentFluigUser?.email,
      legacyFluigUserIds: [currentFluigUser?.id],
    });

    if (!identity.matched) {
      const identityError = identity.detected
        ? "A credencial cadastrada pertence a outro usuario Fluig. Corrija usuario e senha Fluig no cadastro deste usuario."
        : "Nao foi possivel confirmar a identidade da credencial Fluig cadastrada.";
      await completeResultJob(executor, {
        jobId,
        status: "error",
        resultPayload: { identityVerified: false },
        errorMessage: identityError,
      });
      return NextResponse.json(
        { success: false, error: identityError, code: "FLUIG_IDENTITY_MISMATCH" },
        { status: 409 }
      );
    }

    if (identity.updated) {
      await recordResultJobEvent(executor, {
        jobId,
        eventType: "profile_updated",
        stage: "syncing_result",
        label: "Usuario Fluig detectado pelo executor e salvo no perfil.",
        payload: { fluigUserId: currentFluigUser?.code },
      });
    }
  }

  if (status === "success" && (job.operation === "sync_history" || job.operation === "sync_initial_history")) {
    const historyItems = extractHistoryItems(resultPayload);
    const supplierCandidates = buildSupplierCandidates(historyItems);
    persistenceResults.push(await persistHistoryItemsInChunksByModule(job.module, historyItems, { id: job.requestedByUserId }));
    persistenceResults.push(await persistProductsFromHistoryJob(job.module, historyItems, job.requestedByUserId));
    persistenceResults.push(await persistFluigCatalogItems(buildFluigCatalogItemsByModule(job.module, historyItems)));
    persistenceResults.push(await persistSupplierCandidates(supplierCandidates));
    persistenceResults.push(
      await reconcileSupplierPreRegistrations({
        actorId: job.requestedByUserId,
        candidateKeys: supplierCandidates.map((candidate) => candidate.candidateKey),
      })
    );
  }

  if (status === "success" && job.operation === "supplier_lookup_by_cnpj") {
    const historyItems = extractHistoryItems(resultPayload);
    const supplierCandidates = buildSupplierCandidates(historyItems);
    persistenceResults.push(await persistHistoryItemsInChunksByModule(job.module, historyItems, { id: job.requestedByUserId }));
    persistenceResults.push(await persistFluigCatalogItems(buildFluigCatalogItemsByModule(job.module, historyItems)));
    persistenceResults.push(await persistSupplierCandidates(supplierCandidates));
    persistenceResults.push(
      await reconcileSupplierPreRegistrations({
        actorId: job.requestedByUserId,
        candidateKeys: supplierCandidates.map((candidate) => candidate.candidateKey),
      })
    );
  }

  if (
    status === "success" &&
    (job.operation === "sync_status" || job.operation === "sync_request_by_number") &&
    shouldPersistJobResult(job)
  ) {
    persistenceResults.push(
      await persistStatusItems(job.module, extractStatusItems(resultPayload), {
        ownerUserId: job.requestedByUserId,
        syncSource: job.operation,
      })
    );
  }

  if (status === "success" && job.operation === "cancel_request" && shouldPersistJobResult(job)) {
    persistenceResults.push(
      await persistStatusItems(job.module, extractCancelStatusItems(resultPayload), {
        ownerUserId: job.requestedByUserId,
        syncSource: job.operation,
      })
    );
  }

  if (status === "success" && (job.operation === "sync_user_open_tasks" || job.operation === "sync_user_open_requests")) {
    persistenceResults.push(
      await persistStatusItems(job.module, extractStatusItems(resultPayload), {
        ownerUserId: job.requestedByUserId,
        syncSource: job.operation,
        markSeenOpen: true,
      })
    );
  }

  if (status === "success" && job.operation === "sync_user_incremental_batch") {
    const itemsByModule = new Map<FluigModuleSlug, FluigStatusItem[]>();
    const output = resultOutput(resultPayload);
    const directTaskCentral = output.directTaskCentral === true;
    const syncStartedAt = String(output.syncStartedAt || "").trim();
    const monitoredUserResults = extractMonitoredUserResults(resultPayload);
    const directPersistenceResults: PersistenceResult[] = [];

    for (const item of extractStatusItems(resultPayload)) {
      const moduleSlug = moduleFromStatusItem(item, job.module);
      itemsByModule.set(moduleSlug, [...(itemsByModule.get(moduleSlug) || []), item]);
    }

    for (const [moduleSlug, items] of itemsByModule.entries()) {
      directPersistenceResults.push(
        await persistStatusItems(moduleSlug, items, {
          ownerUserId: job.requestedByUserId,
          syncSource: directTaskCentral ? "fluig_task_central" : job.operation,
          markSeenOpen: true,
          fluigUserId: currentFluigUser?.code,
        })
      );
    }

    persistenceResults.push(...directPersistenceResults);
    if (monitoredUserResults.length) {
      persistenceResults.push(await persistFluigMonitoredUserSyncResults(monitoredUserResults));
      if (directPersistenceResults.every((item) => item.errors.length === 0)) {
        for (const monitoredUser of monitoredUserResults.filter((item) => !item.error)) {
          const targetFluigUserId = String(monitoredUser.currentFluigUser?.code || "").trim();
          const targetSyncStartedAt = String(monitoredUser.syncStartedAt || syncStartedAt).trim();
          if (targetFluigUserId && targetSyncStartedAt) {
            persistenceResults.push(
              await clearStaleFluigUserTaskMemberships({
                fluigUserId: targetFluigUserId,
                syncStartedAt: targetSyncStartedAt,
              })
            );
          }
        }
      }
    } else if (
      directTaskCentral &&
      currentFluigUser?.code &&
      syncStartedAt &&
      directPersistenceResults.every((item) => item.errors.length === 0)
    ) {
      persistenceResults.push(await clearStaleFluigUserTaskMemberships({ fluigUserId: currentFluigUser.code, syncStartedAt }));
    }
  }

  if (status === "success" && job.operation === "open_from_source") {
    persistenceResults.push(
      await persistStatusItems(job.module, [
        {
          numeroFluig: generatedRequestId,
          statusProcesso: "aberto",
          etapaAtual: "Solicitacao aberta pelo ADM",
          active: true,
          dataUltimaConsulta: new Date().toISOString(),
        },
      ])
    );
    await completeMaintenanceOrderFluigOpenJob({
      job,
      generatedRequestId,
      resultPayload,
    });
    await completeOperationalLaunchJob({
      job,
      generatedRequestId,
      resultPayload,
    });
  }

  if (status !== "success" && job.operation === "open_from_source") {
    await recordMaintenanceOrderFluigJobFailure({
      job,
      errorMessage,
    });
    if (job.requestPayload.launchId) {
      await markOperationalLaunchFailure(
        String(job.requestPayload.launchId),
        job.requestedByUserId,
        errorMessage || "Falha ao abrir solicitacao no Fluig.",
        job.id
      );
    }
  }

  if (job.operation === "attach_to_request") {
    await completeExpenseAuthorizationAttachment({
      job,
      success: status === "success",
      resultPayload,
      errorMessage,
    });
  }

  const persistence = persistenceResults.length ? mergePersistence(...persistenceResults) : undefined;
  const finalPayload = persistence ? { ...resultPayload, persistence } : resultPayload;
  const syncType = syncTypeForJob(job.operation);
  const batchSyncStates = job.operation === "sync_user_incremental_batch" ? batchDefinitions(job.requestPayload, resultPayload) : [];

  if (job.operation === "supplier_lookup_by_cnpj") {
    await markSupplierFluigSyncResult({
      supplierId: String(job.requestPayload.supplierId || ""),
      actorId: job.requestedByUserId,
      status,
      historyItems: status === "success" ? extractHistoryItems(resultPayload) : [],
      resultPayload: finalPayload,
      errorMessage,
      persistence,
    });
  }

  await completeResultJob(executor, {
    jobId,
    status,
    resultPayload: finalPayload,
    errorMessage,
  });

  if (syncType) {
    await completeFluigUserSyncStateForJob({
      job,
      syncType,
      status: status === "success" ? "success" : "error",
      errorMessage,
      metadata: {
        persistence,
      },
    });
  }

  for (const batch of batchSyncStates) {
    await completeFluigUserSyncStateForJob({
      job,
      module: batch.module,
      syncType: batch.syncType,
      status: status === "success" ? "success" : "error",
      errorMessage,
      metadata: {
        persistence,
        batched: true,
        operation: batch.operation,
        requestCount: batch.requestCount,
        globalTotal: batch.globalTotal,
      },
      fluigUserId: currentFluigUser?.code,
    });
  }

  if (persistence?.errors.length) {
    await recordResultJobEvent(executor, {
      jobId,
      eventType: "persistence_warning",
      stage: "syncing_result",
      label: persistence.errors.join(" | "),
      payload: { persistence },
    });
  }

  return NextResponse.json({
    success: true,
    persistence,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { agent, error } = await requireAgent(request);
  if (!agent) return error;

  const { jobId } = await context.params;
  const job = await readJobForAgent(agent, jobId);
  if (!job) {
    return NextResponse.json({ success: false, error: "Job nao pertence a este agente." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as ResultBody;
  return persistFluigJobResult({
    job,
    body,
    executor: { type: "agent", agentId: agent.id },
  });
}
