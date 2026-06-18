import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { persistStatusItems, recordFluigOperationRun } from "@/lib/db/fluig-repository";
import {
  getProcessMapForRequest,
  jsonError,
  mergePersistence,
  normalizeRequestIds,
  readJsonBody,
} from "@/lib/fluig/route-utils";
import { cancelFluigRequests, getFluigRuntimeConfig, type FluigStatusItem } from "@/lib/fluig/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CancelBody = {
  module?: string;
  requestIds?: string[] | string;
  comment?: string;
  confirm?: boolean;
  persist?: boolean;
};

export async function POST(request: Request) {
  const body = await readJsonBody<CancelBody>(request, {});
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

    if (!body.confirm) {
      const dryRun = {
        module: processMap.module,
        requestIds,
        comment: body.comment || "Cancelamento executado via ADM MaxControl.",
        requiredConfirmation: true,
      };
      const persistence = await recordFluigOperationRun({
        module: processMap.module,
        operation: "cancel",
        status: "dry_run",
        sourceMode: runtimeConfig.mode,
        requestPayload: dryRun,
        responsePayload: { message: "Dry-run. Envie confirm=true para cancelar no Fluig." },
      });

      return NextResponse.json({
        success: true,
        generatedAt: new Date().toISOString(),
        runtime: runtimeConfig,
        dryRun,
        persistence,
      });
    }

    const result = await cancelFluigRequests({
      requestIds,
      comment: body.comment || "Cancelamento executado via ADM MaxControl.",
    });
    const statusItems: FluigStatusItem[] = requestIds.map((requestId) => ({
      numeroFluig: requestId,
      etapaAtual: "Cancelado",
      responsavelAtual: "",
      statusProcesso: "cancelado",
      active: false,
      cancelavel: false,
      dataUltimaConsulta: result.data?.processedAt || new Date().toISOString(),
    }));
    const shouldPersist = body.persist !== false;
    const requestPersistence = shouldPersist ? await persistStatusItems(processMap.module, statusItems) : null;
    const operationPersistence = await recordFluigOperationRun({
      module: processMap.module,
      operation: "cancel",
      status: "success",
      sourceMode: runtimeConfig.mode,
      requestPayload: {
        module: processMap.module,
        requestIds,
      },
      responsePayload: {
        outputPath: result.outputPath,
        processed: result.data?.items?.length || requestIds.length,
      },
    });

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      runtime: runtimeConfig,
      module: processMap.module,
      outputPath: result.outputPath,
      result: result.data,
      persistence: requestPersistence ? mergePersistence(requestPersistence, operationPersistence) : operationPersistence,
    });
  } catch (error) {
    await recordFluigOperationRun({
      module: body.module === "pagamentos" || body.module === "compras" || body.module === "manutencao" ? body.module : null,
      operation: "cancel",
      status: "error",
      sourceMode: runtimeConfig.mode,
      requestPayload: body as Record<string, unknown>,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return jsonError(error instanceof Error ? error.message : String(error), runtimeConfig.configured ? 500 : 503, {
      runtime: runtimeConfig,
    });
  }
}
