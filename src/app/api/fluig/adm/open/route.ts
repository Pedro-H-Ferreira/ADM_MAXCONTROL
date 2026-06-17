import { NextResponse } from "next/server";
import { persistStatusItems, recordFluigOperationRun } from "@/lib/db/fluig-repository";
import {
  getProcessMapForRequest,
  jsonError,
  mergePersistence,
  normalizeFieldOverrides,
  readJsonBody,
} from "@/lib/fluig/route-utils";
import { getFluigRuntimeConfig, openFluigFromSource, type FluigStatusItem } from "@/lib/fluig/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpenBody = {
  module?: string;
  sourceRequestId?: string;
  fieldOverrides?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  attachments?: Array<{ path: string; name?: string }>;
  targetState?: string | number;
  taskUserId?: string;
  comment?: string;
  mode?: "test" | "production";
  confirm?: boolean;
  persist?: boolean;
};

export async function POST(request: Request) {
  const body = await readJsonBody<OpenBody>(request, {});
  const runtimeConfig = getFluigRuntimeConfig();

  try {
    const processMap = getProcessMapForRequest(body.module || "pagamentos");
    const sourceRequestId = String(body.sourceRequestId || processMap.defaultSourceRequestIds[0] || "").trim();
    const fieldOverrides = {
      ...normalizeFieldOverrides(body.payload),
      ...normalizeFieldOverrides(body.fieldOverrides),
    };
    const mode = body.mode || "test";

    if (!sourceRequestId) {
      return jsonError(
        `A aba ${processMap.module} ainda nao tem sourceRequestId padrao. Rode /api/fluig/adm/history e escolha uma solicitacao modelo real antes de abrir.`,
        409,
        { module: processMap.module, processId: processMap.processId }
      );
    }

    if (!body.confirm) {
      const dryRun = {
        module: processMap.module,
        processId: processMap.processId,
        sourceRequestId,
        mode,
        willCancelAfterOpen: mode === "test",
        fieldOverrides,
        attachments: body.attachments || [],
        requiredConfirmation: true,
      };
      const persistence = await recordFluigOperationRun({
        module: processMap.module,
        operation: "open",
        status: "dry_run",
        sourceMode: runtimeConfig.mode,
        requestPayload: dryRun,
        responsePayload: { message: "Dry-run. Envie confirm=true para executar no Fluig." },
      });

      return NextResponse.json({
        success: true,
        generatedAt: new Date().toISOString(),
        runtime: runtimeConfig,
        dryRun,
        persistence,
      });
    }

    const result = await openFluigFromSource({
      processMap,
      sourceRequestId,
      fieldOverrides,
      attachmentPaths: body.attachments,
      targetState: body.targetState,
      taskUserId: body.taskUserId,
      comment: body.comment,
      cancelAfter: mode === "test",
      keepOpen: mode === "production",
    });
    const generatedRequestId = result.data?.generatedRequestId || "";
    const finalDetails = result.data?.finalDetails as
      | {
          content?: {
            stateDescription?: unknown;
            colleagueName?: unknown;
          };
        }
      | null
      | undefined;
    const statusItem: FluigStatusItem | null = generatedRequestId
      ? {
          numeroFluig: generatedRequestId,
          etapaAtual: String(finalDetails?.content?.stateDescription || ""),
          responsavelAtual: String(finalDetails?.content?.colleagueName || ""),
          statusProcesso: mode === "test" ? "cancelado_teste" : "em_andamento",
          active: mode !== "test",
          cancelavel: mode !== "test",
          dataUltimaConsulta: result.data?.processedAt || new Date().toISOString(),
        }
      : null;
    const shouldPersist = body.persist !== false && Boolean(statusItem);
    const requestPersistence = shouldPersist ? await persistStatusItems(processMap.module, [statusItem!]) : null;
    const operationPersistence = await recordFluigOperationRun({
      module: processMap.module,
      operation: "open",
      status: "success",
      sourceMode: runtimeConfig.mode,
      requestPayload: {
        module: processMap.module,
        sourceRequestId,
        fieldOverrideCount: Object.keys(fieldOverrides).length,
        mode,
      },
      responsePayload: {
        outputPath: result.outputPath,
        generatedRequestId,
        cancelAfter: result.data?.cancelAfter,
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
      operation: "open",
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
