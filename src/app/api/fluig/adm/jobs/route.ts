import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { createFluigJob, listJobsForActor, resolveCurrentAppUser, type FluigJobOperation } from "@/lib/db/app-repository";
import { requireFluigProcessMap } from "@/lib/fluig/process-map";
import type { FluigModuleSlug } from "@/lib/fluig-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JobBody = {
  module?: FluigModuleSlug;
  operation?: FluigJobOperation;
  branchCode?: string | null;
  branchLabel?: string | null;
  payload?: Record<string, unknown>;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function shouldReuseActiveJob(operation: FluigJobOperation) {
  return (
    operation === "sync_history" ||
    operation === "sync_status" ||
    operation === "sync_initial_history" ||
    operation === "sync_user_open_tasks" ||
    operation === "sync_user_open_requests" ||
    operation === "sync_user_incremental_batch" ||
    operation === "sync_request_by_number" ||
    operation === "supplier_lookup_by_cnpj"
  );
}

export const GENERIC_JOBS_OPEN_ERROR =
  "A operacao open_from_source nao e aceita neste endpoint. Use /api/fluig/adm/launches para aberturas produtivas.";

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

    const operation = body.operation || "sync_history";
    if (operation === "open_from_source") {
      return jsonError(GENERIC_JOBS_OPEN_ERROR);
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
      reuseActive: shouldReuseActiveJob(operation),
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
