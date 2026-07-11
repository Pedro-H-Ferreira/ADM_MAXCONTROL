import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { createFluigJob, resolveCurrentAppUser, upsertFluigUserSyncState } from "@/lib/db/app-repository";
import {
  getProcessMapForRequest,
  jsonError,
  normalizeRequestIds,
  readJsonBody,
} from "@/lib/fluig/route-utils";
import type { FluigModuleSlug } from "@/lib/fluig-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StatusBody = {
  module?: string;
  requestIds?: string[] | string;
  taskUserId?: string;
  persist?: boolean;
};

function isStatusModule(value: string): value is Extract<FluigModuleSlug, "pagamentos" | "compras" | "manutencao"> {
  return value === "pagamentos" || value === "compras" || value === "manutencao";
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const body = await readJsonBody<StatusBody>(request, {});
    const processMap = getProcessMapForRequest(body.module || "pagamentos");
    if (!isStatusModule(processMap.module)) {
      return jsonError("Consulta de status Fluig esta disponivel para Pagamentos, Compras e Manutencao.", 400);
    }

    const requestIds = normalizeRequestIds(body.requestIds);

    if (!requestIds.length) {
      return jsonError("Informe ao menos um numero Fluig em requestIds.");
    }

    const job = await createFluigJob({
      actor,
      module: processMap.module,
      operation: "sync_status",
      reuseActive: true,
      requestPayload: {
        requestIds,
        taskUserId: body.taskUserId || processMap.defaultTaskUserId,
        persist: body.persist !== false,
        processMap: {
          module: processMap.module,
          processId: processMap.processId,
          processVersions: processMap.processVersions,
          processLabel: processMap.processLabel,
          defaultTaskUserId: processMap.defaultTaskUserId,
        },
      },
    });

    await upsertFluigUserSyncState({
      actor,
      module: processMap.module,
      syncType: "status_check",
      status: "started",
      cursor: { requestIds },
      metadata: { jobId: job.id, operation: "sync_status" },
    });

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      module: processMap.module,
      requestIds,
      job,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : String(error), 500);
  }
}
