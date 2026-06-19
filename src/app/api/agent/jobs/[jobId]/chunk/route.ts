import { NextResponse } from "next/server";
import { readJobForAgent, recordFluigJobEvent } from "@/lib/db/app-repository";
import {
  buildFluigCatalogItems,
  buildSupplierCandidates,
  persistFluigCatalogItems,
  type PersistenceResult,
  persistHistoryItemsInChunks,
  persistSupplierCandidates,
} from "@/lib/db/fluig-repository";
import { mergePersistence } from "@/lib/fluig/route-utils";
import type { FluigHistoryItem } from "@/lib/fluig/server-client";
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

function chunkLabel(input: { chunkIndex: number; totalChunks: number; itemCount: number }) {
  const position = input.chunkIndex + 1;
  return `Gravando lote ${position}/${input.totalChunks} no ADM (${input.itemCount} registros).`;
}

export async function POST(request: Request, context: RouteContext) {
  const { agent, error } = await requireAgent(request);
  if (!agent) return error;

  const { jobId } = await context.params;
  const job = await readJobForAgent(agent, jobId);
  if (!job) {
    return NextResponse.json({ success: false, error: "Job nao pertence a este agente." }, { status: 404 });
  }

  if (job.operation !== "sync_history") {
    return NextResponse.json({ success: false, error: "Chunks sao suportados somente para sync_history." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as ChunkBody;
  const resultPayload = body.resultPayload || {};
  const historyItems = extractHistoryItems(resultPayload);
  const chunkIndex = Number.isFinite(Number(body.chunkIndex)) ? Number(body.chunkIndex) : 0;
  const totalChunks = Number.isFinite(Number(body.totalChunks)) ? Number(body.totalChunks) : 1;
  const persistenceResults: PersistenceResult[] = [];

  persistenceResults.push(await persistHistoryItemsInChunks(job.module, historyItems, { id: job.requestedByUserId }));
  persistenceResults.push(await persistFluigCatalogItems(buildFluigCatalogItems(job.module, historyItems)));
  persistenceResults.push(await persistSupplierCandidates(buildSupplierCandidates(historyItems)));

  const persistence = mergePersistence(...persistenceResults);
  const label = chunkLabel({ chunkIndex, totalChunks, itemCount: historyItems.length });

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
      itemCount: historyItems.length,
      persistence,
    },
    status: "syncing_result",
  });

  return NextResponse.json({
    success: true,
    itemCount: historyItems.length,
    persistence,
  });
}
