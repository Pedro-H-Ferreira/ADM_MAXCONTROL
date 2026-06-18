import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { persistStatusItems, recordFluigOperationRun } from "@/lib/db/fluig-repository";
import {
  getProcessMapForRequest,
  jsonError,
  mergePersistence,
  normalizeRequestIds,
  parseBoolean,
  readJsonBody,
} from "@/lib/fluig/route-utils";
import { getFluigRuntimeConfig, syncFluigStatus } from "@/lib/fluig/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StatusBody = {
  module?: string;
  requestIds?: string[] | string;
  taskUserId?: string;
  persist?: boolean;
};

export async function POST(request: Request) {
  const body = await readJsonBody<StatusBody>(request, {});
  const runtimeConfig = getFluigRuntimeConfig();

  try {
    await resolveCurrentAppUser();
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao validar usuario.", 500);
  }

  try {
    const processMap = getProcessMapForRequest(body.module || "pagamentos");
    const requestIds = normalizeRequestIds(body.requestIds);

    if (!requestIds.length) {
      return jsonError("Informe ao menos um numero Fluig em requestIds.");
    }

    const result = await syncFluigStatus(requestIds, {
      taskUserId: body.taskUserId || processMap.defaultTaskUserId,
    });
    const items = result.data?.items || [];
    const shouldPersist = body.persist !== false;
    const persistence = shouldPersist ? await persistStatusItems(processMap.module, items) : null;
    const operationPersistence = await recordFluigOperationRun({
      module: processMap.module,
      operation: "status",
      status: "success",
      sourceMode: runtimeConfig.mode,
      requestPayload: {
        module: processMap.module,
        requestIds,
      },
      responsePayload: {
        outputPath: result.outputPath,
        processed: result.data?.processed || requestIds.length,
        items: items.length,
      },
    });

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      runtime: runtimeConfig,
      module: processMap.module,
      requestIds,
      outputPath: result.outputPath,
      items,
      persistence: shouldPersist ? mergePersistence(persistence!, operationPersistence) : operationPersistence,
    });
  } catch (error) {
    await recordFluigOperationRun({
      module: body.module === "pagamentos" || body.module === "compras" || body.module === "manutencao" ? body.module : null,
      operation: "status",
      status: "error",
      sourceMode: runtimeConfig.mode,
      requestPayload: body as Record<string, unknown>,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return jsonError(error instanceof Error ? error.message : String(error), runtimeConfig.configured ? 500 : 503, {
      runtime: runtimeConfig,
      persistRequested: parseBoolean(body.persist, true),
    });
  }
}
