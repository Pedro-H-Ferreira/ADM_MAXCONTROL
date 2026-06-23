import { NextResponse } from "next/server";
import {
  completeFluigUserSyncStateForJob,
  completeFluigJob,
  readJobForAgent,
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

function batchDefinitions(payload: Record<string, unknown>) {
  const batches = Array.isArray(payload.batches) ? payload.batches : [];

  return batches
    .map((batch) => ({
      module: String((batch as Record<string, unknown>)?.module || ""),
      syncType: String((batch as Record<string, unknown>)?.syncType || ""),
      operation: String((batch as Record<string, unknown>)?.operation || ""),
      requestIds: Array.isArray((batch as Record<string, unknown>)?.requestIds)
        ? ((batch as Record<string, unknown>).requestIds as unknown[]).map(String)
        : [],
    }))
    .filter(
      (batch): batch is {
        module: FluigModuleSlug;
        syncType: Extract<FluigUserSyncType, "open_tasks" | "my_requests">;
        operation: string;
        requestIds: string[];
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
    persistenceResults.push(await persistHistoryItemsInChunksByModule(job.module, historyItems, { id: job.requestedByUserId }));
    persistenceResults.push(await persistFluigCatalogItems(buildFluigCatalogItemsByModule(job.module, historyItems)));
    persistenceResults.push(await persistSupplierCandidates(buildSupplierCandidates(historyItems)));
  }

  if (status === "success" && (job.operation === "sync_status" || job.operation === "sync_request_by_number")) {
    persistenceResults.push(
      await persistStatusItems(job.module, extractStatusItems(resultPayload), {
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
    }
  }

  if (status !== "success" && job.operation === "open_from_source") {
    await recordMaintenanceOrderFluigJobFailure({
      job,
      errorMessage: body.errorMessage,
    });
  }

  const persistence = persistenceResults.length ? mergePersistence(...persistenceResults) : undefined;
  const finalPayload = persistence ? { ...resultPayload, persistence } : resultPayload;
  const syncType = syncTypeForJob(job.operation);
  const batchSyncStates = job.operation === "sync_user_incremental_batch" ? batchDefinitions(job.requestPayload) : [];

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
        requestCount: batch.requestIds.length,
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
