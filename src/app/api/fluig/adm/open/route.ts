import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { canActorAccessPage, canActorPerformPageAction, resolveCurrentAppUser } from "@/lib/db/app-repository";
import { recordFluigOperationRun } from "@/lib/db/fluig-repository";
import {
  getProcessMapForRequest,
  jsonError,
  normalizeFieldOverrides,
  readJsonBody,
} from "@/lib/fluig/route-utils";
import { getFluigRuntimeConfig } from "@/lib/fluig/server-client";

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
};

export const OPEN_PREVIEW_ONLY_ERROR =
  "Este endpoint aceita apenas preview (dry-run). Para realizar uma abertura produtiva, use /api/fluig/adm/launches.";

export async function POST(request: Request) {
  const body = await readJsonBody<OpenBody>(request, {});
  const runtimeConfig = getFluigRuntimeConfig();

  try {
    const actor = await resolveCurrentAppUser();
    const processMap = getProcessMapForRequest(body.module || "pagamentos");
    if (
      !canActorAccessPage(actor, processMap.module) ||
      !canActorPerformPageAction(actor, processMap.module, "canCreate")
    ) {
      return jsonError("Usuario sem permissao para preparar aberturas neste modulo Fluig.", 403);
    }
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao validar usuario.", 500);
  }

  try {
    if (body.confirm === true) {
      return jsonError(OPEN_PREVIEW_ONLY_ERROR);
    }

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

    const dryRun = {
      module: processMap.module,
      processId: processMap.processId,
      sourceRequestId,
      fieldOverrides,
      attachments: body.attachments || [],
      targetState: body.targetState,
      taskUserId: body.taskUserId,
      comment: body.comment,
      mode,
      previewOnly: true,
    };
    const persistence = await recordFluigOperationRun({
      module: processMap.module,
      operation: "open",
      status: "dry_run",
      sourceMode: runtimeConfig.mode,
      requestPayload: dryRun,
      responsePayload: { message: "Preview gerado. Nenhuma solicitacao ou job foi criado ou executado." },
    });

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      runtime: runtimeConfig,
      dryRun,
      persistence,
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
