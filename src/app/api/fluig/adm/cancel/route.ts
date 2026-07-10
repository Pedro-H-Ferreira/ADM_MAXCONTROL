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

type CancelBody = {
  module?: string;
  requestIds?: string[] | string;
  comment?: string;
  confirm?: boolean;
  persist?: boolean;
};

function isCancelableModule(value: string): value is Extract<FluigModuleSlug, "pagamentos" | "compras" | "manutencao"> {
  return value === "pagamentos" || value === "compras" || value === "manutencao";
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const body = await readJsonBody<CancelBody>(request, {});
    const processMap = getProcessMapForRequest(body.module || "pagamentos");
    if (!isCancelableModule(processMap.module)) {
      return jsonError("Cancelamento Fluig esta disponivel para Pagamentos, Compras e Manutencao.", 400);
    }

    const requestIds = normalizeRequestIds(body.requestIds);

    if (!requestIds.length) {
      return jsonError("Informe ao menos um numero Fluig em requestIds.");
    }

    if (!body.confirm) {
      const dryRun = {
        module: processMap.module,
        requestIds,
        comment: body.comment || "Cancelamento executado via ADM MaxControl.",
        requiredConfirmation: true,
      };

      return NextResponse.json({
        success: true,
        generatedAt: new Date().toISOString(),
        dryRun,
      });
    }

    const comment = body.comment || "Cancelamento executado via ADM MaxControl.";
    const job = await createFluigJob({
      actor,
      module: processMap.module,
      operation: "cancel_request",
      requestPayload: {
        requestIds,
        comment,
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
      metadata: { jobId: job.id, operation: "cancel_request" },
    });

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      module: processMap.module,
      job,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : String(error), 500);
  }
}
