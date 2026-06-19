import { NextResponse } from "next/server";
import {
  completeFluigJob,
  readJobForAgent,
  recordFluigJobEvent,
  type FluigJobStatus,
} from "@/lib/db/app-repository";
import {
  buildFluigCatalogItems,
  buildSupplierCandidates,
  persistFluigCatalogItems,
  type PersistenceResult,
  persistHistoryItemsInChunks,
  persistStatusItems,
  persistSupplierCandidates,
} from "@/lib/db/fluig-repository";
import { mergePersistence } from "@/lib/fluig/route-utils";
import type { FluigHistoryItem, FluigStatusItem } from "@/lib/fluig/server-client";
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

  if (status === "success" && job.operation === "sync_history") {
    const historyItems = extractHistoryItems(resultPayload);
    persistenceResults.push(await persistHistoryItemsInChunks(job.module, historyItems, { id: job.requestedByUserId }));
    persistenceResults.push(await persistFluigCatalogItems(buildFluigCatalogItems(job.module, historyItems)));
    persistenceResults.push(await persistSupplierCandidates(buildSupplierCandidates(historyItems)));
  }

  if (status === "success" && job.operation === "sync_status") {
    persistenceResults.push(await persistStatusItems(job.module, extractStatusItems(resultPayload)));
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
    }
  }

  const persistence = persistenceResults.length ? mergePersistence(...persistenceResults) : undefined;
  const finalPayload = persistence ? { ...resultPayload, persistence } : resultPayload;

  await completeFluigJob({
    jobId,
    agentId: agent.id,
    status,
    resultPayload: finalPayload,
    errorMessage: body.errorMessage,
  });

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
