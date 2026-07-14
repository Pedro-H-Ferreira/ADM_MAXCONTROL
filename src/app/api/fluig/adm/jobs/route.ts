import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import {
  canActorAccessPage,
  canActorPerformPageAction,
  createFluigJob,
  listJobsForActor,
  resolveCurrentAppUser,
} from "@/lib/db/app-repository";
import { requireFluigProcessMap } from "@/lib/fluig/process-map";
import type { FluigModuleSlug } from "@/lib/fluig-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JobBody = {
  module?: FluigModuleSlug;
  operation?: unknown;
  branchCode?: string | null;
  branchLabel?: string | null;
  payload?: Record<string, unknown>;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export const GENERIC_JOBS_OPEN_ERROR =
  "A operacao open_from_source neste endpoint e exclusiva de Manutencao. Use /api/fluig/adm/launches para Pagamentos e Compras.";
export const GENERIC_JOBS_MAINTENANCE_CONFIRM_ERROR =
  "Confirme explicitamente a abertura da solicitacao Fluig de Manutencao.";
export const GENERIC_JOBS_CANCEL_ERROR =
  "A operacao cancel_request nao e aceita neste endpoint. Use /api/fluig/adm/cancel para cancelamentos produtivos.";
export const GENERIC_JOBS_RESTRICTED_ERROR =
  "O POST /api/fluig/adm/jobs aceita apenas a operacao health_check. Use o endpoint dedicado para operacoes produtivas, sincronizacoes e consultas.";

function rejectedOperationError(operation: unknown) {
  if (operation === "open_from_source") return GENERIC_JOBS_OPEN_ERROR;
  if (operation === "cancel_request") return GENERIC_JOBS_CANCEL_ERROR;

  const operationLabel = typeof operation === "string" && operation.trim() ? `"${operation}"` : "nao informada";
  return `Operacao Fluig ${operationLabel} nao permitida. ${GENERIC_JOBS_RESTRICTED_ERROR}`;
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 100);
    const jobs = await listJobsForActor(actor, limit);

    return NextResponse.json({
      success: true,
      jobs,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao listar jobs.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const body = (await request.json().catch(() => ({}))) as JobBody;
    const moduleSlug = body.module;

    if (!moduleSlug) {
      return jsonError("Modulo Fluig nao informado.");
    }

    const operation = body.operation;
    const isMaintenanceOpen = operation === "open_from_source" && moduleSlug === "manutencao";
    if (operation !== "health_check" && !isMaintenanceOpen) {
      return jsonError(rejectedOperationError(operation));
    }
    if (isMaintenanceOpen) {
      if (body.payload?.confirm !== true) return jsonError(GENERIC_JOBS_MAINTENANCE_CONFIRM_ERROR);
      if (
        !canActorAccessPage(actor, "manutencao") ||
        !canActorPerformPageAction(actor, "manutencao", "canCreate")
      ) {
        return jsonError("Usuario sem permissao para abrir solicitacoes Fluig de Manutencao.", 403);
      }
    }

    const map = requireFluigProcessMap(moduleSlug);
    const requestPayload = {
      ...(body.payload || {}),
      processMap: {
        module: map.module,
        processId: map.processId,
        processVersions: map.processVersions,
        processLabel: map.processLabel,
        defaultTaskUserId: map.defaultTaskUserId,
      },
    };
    const job = await createFluigJob({
      actor,
      module: moduleSlug,
      operation,
      branchCode: body.branchCode,
      branchLabel: body.branchLabel,
      requestPayload,
      reuseActive: false,
    });

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao criar job.", 500);
  }
}
