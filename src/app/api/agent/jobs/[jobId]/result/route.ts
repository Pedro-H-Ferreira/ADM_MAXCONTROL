import { NextResponse } from "next/server";
import {
  completeFluigUserSyncStateForJob,
  completeFluigJob,
  readJobForAgent,
  recordDetectedFluigUserId,
  recordFluigJobEvent,
  type FluigUserSyncType,
  type FluigJobStatus,
} from "@/lib/db/app-repository";
import {
  buildFluigCatalogItemsByModule,
  buildSupplierCandidates,
  persistFluigCatalogItems,
  type PersistenceResult,
  persistHistoryItemsInChunksByModule,
  persistStatusItems,
  persistSupplierCandidates,
} from "@/lib/db/fluig-repository";
import {
  completeMaintenanceOrderFluigOpenJob,
  recordMaintenanceOrderFluigJobFailure,
} from "@/lib/db/maintenance-repository";
import {
  completeOperationalLaunchJob,
  markOperationalLaunchFailure,
} from "@/lib/db/operational-launch-repository";
import { markSupplierFluigSyncResult, reconcileSupplierPreRegistrations } from "@/lib/db/suppliers-repository";
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

function extractCurrentFluigUserId(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  return String(data?.currentUserId || payload.currentUserId || "").trim();
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

function batchDiscoveryCounts(resultPayload: Record<string, unknown>) {
  const output = (resultPayload.data && typeof resultPayload.data === "object"
    ? resultPayload.data
    : resultPayload) as Record<string, unknown>;
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

function batchDefinitions(payload: Record<string, unknown>, resultPayload: Record<string, unknown> = {}) {
  const batches = Array.isArray(payload.batches) ? payload.batches : [];
  const discoveryCounts = batchDiscoveryCounts(resultPayload);

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
        batch.requestIds.length ||
        discoveryCounts.get(`${batch.module}:${batch.syncType}`) ||
        0,
    }))
    .filter(
      (batch): batch is {
        module: FluigModuleSlug;
        syncType: Extract<FluigUserSyncType, "open_tasks" | "my_requests">;
        operation: string;
        requestIds: string[];
        requestCount: number;
      } => isFluigModuleSlug(batch.module) && (batch.syncType === "open_tasks" || batch.syncType === "my_requests")
    );
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
  const status = body.status || "success";
  const resultPayload = body.resultPayload || {};
  const persistenceResults: PersistenceResult[] = [];

  if (status === "success" && (job.operation === "sync_history" || job.operation === "sync_initial_history")) {
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

  if (status === "success" && (job.operation === "sync_status" || job.operation === "sync_request_by_number")) {
    persistenceResults.push(
      await persistStatusItems(job.module, extractStatusItems(resultPayload), {
        ownerUserId: job.requestedByUserId,
        syncSource: job.operation,
      })
    );
  }

  if (status === "success" && job.operation === "cancel_request") {
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

    for (const item of extractStatusItems(resultPayload)) {
      const moduleSlug = moduleFromStatusItem(item, job.module);
      itemsByModule.set(moduleSlug, [...(itemsByModule.get(moduleSlug) || []), item]);
    }

    for (const [moduleSlug, items] of itemsByModule.entries()) {
      persistenceResults.push(
        await persistStatusItems(moduleSlug, items, {
          ownerUserId: job.requestedByUserId,
          syncSource: job.operation,
          markSeenOpen: true,
        })
      );
    }
  }

  if (status === "success" && job.operation === "open_from_source") {
    const generatedRequestId = extractGeneratedRequest(resultPayload);
    if (generatedRequestId) {
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
  }

  if (status !== "success" && job.operation === "open_from_source") {
    await recordMaintenanceOrderFluigJobFailure({
      job,
      errorMessage: body.errorMessage,
    });
    if (job.requestPayload.launchId) {
      await markOperationalLaunchFailure(
        String(job.requestPayload.launchId),
        job.requestedByUserId,
        body.errorMessage || "Falha ao abrir solicitacao no Fluig.",
        job.id
      );
    }
  }

  if (status === "success" && job.operation === "health_check") {
    const currentFluigUserId = extractCurrentFluigUserId(resultPayload);
    const profileUpdated = await recordDetectedFluigUserId({
      userId: job.requestedByUserId,
      fluigUserId: currentFluigUserId,
    });

    if (profileUpdated) {
      await recordFluigJobEvent({
        jobId,
        agentId: agent.id,
        eventType: "profile_updated",
        stage: "syncing_result",
        label: "Usuario Fluig detectado pelo agente e salvo no perfil.",
        payload: { fluigUserId: currentFluigUserId },
      });
    }
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
      errorMessage: body.errorMessage,
      persistence,
    });
  }

  await completeFluigJob({
    jobId,
    agentId: agent.id,
    status,
    resultPayload: finalPayload,
    errorMessage: body.errorMessage,
  });

  if (syncType) {
    await completeFluigUserSyncStateForJob({
      job,
      syncType,
      status: status === "success" ? "success" : "error",
      errorMessage: body.errorMessage,
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
      errorMessage: body.errorMessage,
      metadata: {
        persistence,
        batched: true,
        operation: batch.operation,
        requestCount: batch.requestCount,
      },
    });
  }

  if (persistence?.errors.length) {
    await recordFluigJobEvent({
      jobId,
      agentId: agent.id,
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
