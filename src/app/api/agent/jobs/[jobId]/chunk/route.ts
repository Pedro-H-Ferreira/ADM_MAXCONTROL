import { NextResponse } from "next/server";
import { readJobForAgent, recordFluigJobEvent } from "@/lib/db/app-repository";
import {
  buildFluigCatalogItemsByModule,
  buildSupplierCandidates,
  persistFluigCatalogItems,
  type PersistenceResult,
  persistHistoryItemsInChunksByModule,
  persistStatusItems,
  persistSupplierCandidates,
} from "@/lib/db/fluig-repository";
import { reconcileSupplierPreRegistrations } from "@/lib/db/suppliers-repository";
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

type ChunkBody = {
  chunkIndex?: number;
  totalChunks?: number;
  totalItems?: number;
  resultPayload?: Record<string, unknown>;
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

function chunkLabel(input: { chunkIndex: number; totalChunks: number; itemCount: number }) {
  const position = input.chunkIndex + 1;
  return `Gravando lote ${position}/${input.totalChunks} no ADM (${input.itemCount} registros).`;
}

function isHistoryChunkJob(operation: string) {
  return operation === "sync_history" || operation === "sync_initial_history" || operation === "supplier_lookup_by_cnpj";
}

function isStatusChunkJob(operation: string) {
  return (
    operation === "sync_status" ||
    operation === "sync_request_by_number" ||
    operation === "sync_user_open_tasks" ||
    operation === "sync_user_open_requests" ||
    operation === "sync_user_incremental_batch"
  );
}

function isFluigModuleSlug(value: string): value is FluigModuleSlug {
  return value === "pagamentos" || value === "compras" || value === "manutencao" || value === "fornecedores";
}

function moduleFromStatusItem(item: FluigStatusItem, fallback: FluigModuleSlug) {
  const moduleSlug = String((item as FluigStatusItem & { moduleSlug?: unknown }).moduleSlug || "");
  return isFluigModuleSlug(moduleSlug) ? moduleSlug : fallback;
}

export async function POST(request: Request, context: RouteContext) {
  const { agent, error } = await requireAgent(request);
  if (!agent) return error;

  const { jobId } = await context.params;
  const job = await readJobForAgent(agent, jobId);
  if (!job) {
    return NextResponse.json({ success: false, error: "Job nao pertence a este agente." }, { status: 404 });
  }

  if (!isHistoryChunkJob(job.operation) && !isStatusChunkJob(job.operation)) {
    return NextResponse.json({ success: false, error: "Chunks nao sao suportados para esta operacao do agente." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as ChunkBody;
  const resultPayload = body.resultPayload || {};
  const chunkIndex = Number.isFinite(Number(body.chunkIndex)) ? Number(body.chunkIndex) : 0;
  const totalChunks = Number.isFinite(Number(body.totalChunks)) ? Number(body.totalChunks) : 1;
  const persistenceResults: PersistenceResult[] = [];
  let itemCount = 0;

  if (isHistoryChunkJob(job.operation)) {
    const historyItems = extractHistoryItems(resultPayload);
    const supplierCandidates = buildSupplierCandidates(historyItems);
    itemCount = historyItems.length;

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

  if (isStatusChunkJob(job.operation)) {
    const statusItems = extractStatusItems(resultPayload);
    itemCount = statusItems.length;

    if (job.operation === "sync_user_incremental_batch") {
      const itemsByModule = new Map<FluigModuleSlug, FluigStatusItem[]>();

      for (const item of statusItems) {
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
    } else {
      persistenceResults.push(
        await persistStatusItems(job.module, statusItems, {
          ownerUserId: job.requestedByUserId,
          syncSource: job.operation,
          markSeenOpen: job.operation === "sync_user_open_tasks" || job.operation === "sync_user_open_requests",
        })
      );
    }
  }

  const persistence = mergePersistence(...persistenceResults);
  const label = chunkLabel({ chunkIndex, totalChunks, itemCount });

  await recordFluigJobEvent({
    jobId,
    agentId: agent.id,
    eventType: persistence.errors.length ? "result_chunk_warning" : "result_chunk",
    stage: "syncing_result",
    label: persistence.errors.length ? `${label} Avisos: ${persistence.errors.join(" | ")}` : label,
    payload: {
      chunkIndex,
      totalChunks,
      totalItems: body.totalItems || null,
      itemCount,
      persistence,
    },
    status: "syncing_result",
  });

  return NextResponse.json({
    success: true,
    itemCount,
    persistence,
  });
}
