import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { createFluigJob, resolveCurrentAppUser, upsertFluigUserSyncState } from "@/lib/db/app-repository";
import { readFluigRequestByNumberForActor } from "@/lib/db/fluig-repository";
import { requireFluigProcessMap } from "@/lib/fluig/process-map";
import { moduleOrNull } from "@/lib/fluig/route-utils";
import type { FluigModuleSlug } from "@/lib/fluig-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const lookupSchema = z.object({
  module: z.enum(["pagamentos", "compras", "manutencao", "fornecedores", "auto"]).default("auto"),
  fluigRequestId: z.string().trim().min(1, "Numero Fluig e obrigatorio."),
  persist: z.boolean().default(true),
});

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function normalizeFluigRequestId(value: string) {
  return value.replace(/\D+/g, "").trim();
}

async function resolveModuleForLookup(input: {
  actor: Awaited<ReturnType<typeof resolveCurrentAppUser>>;
  requestedModule: string;
  fluigRequestId: string;
}): Promise<FluigModuleSlug | null> {
  if (
    input.requestedModule === "pagamentos" ||
    input.requestedModule === "compras" ||
    input.requestedModule === "manutencao"
  ) {
    return input.requestedModule;
  }

  const knownRequest = await readFluigRequestByNumberForActor({
    actor: input.actor,
    fluigRequestId: input.fluigRequestId,
    module: null,
  });

  if (
    knownRequest.request?.module === "pagamentos" ||
    knownRequest.request?.module === "compras" ||
    knownRequest.request?.module === "manutencao"
  ) {
    return knownRequest.request.module;
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const fluigRequestId = url.searchParams.get("fluigRequestId") || url.searchParams.get("numero") || "";
    const moduleSlug = moduleOrNull(url.searchParams.get("module") || "");

    if (!fluigRequestId.trim()) {
      return jsonError("Numero Fluig e obrigatorio.");
    }

    const result = await readFluigRequestByNumberForActor({
      actor,
      fluigRequestId,
      module: moduleSlug,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao consultar solicitacao Fluig.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const body = await request.json().catch(() => ({}));
    const parsed = lookupSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Consulta Fluig invalida.");
    }

    const fluigRequestId = normalizeFluigRequestId(parsed.data.fluigRequestId);
    if (!fluigRequestId) {
      return jsonError("Numero Fluig e obrigatorio.");
    }

    const moduleSlug = await resolveModuleForLookup({
      actor,
      requestedModule: parsed.data.module,
      fluigRequestId,
    });
    if (!moduleSlug) {
      return jsonError(
        "Numero Fluig ainda nao existe no ADM. Selecione Pagamentos, Compras ou Manutencao antes de consultar diretamente no Fluig.",
        409
      );
    }

    const map = requireFluigProcessMap(moduleSlug);
    const job = await createFluigJob({
      actor,
      module: moduleSlug,
      operation: "sync_request_by_number",
      reuseActive: true,
      requestPayload: {
        requestIds: [fluigRequestId],
        persist: parsed.data.persist,
        processMap: {
          module: map.module,
          processId: map.processId,
          processVersions: map.processVersions,
          processLabel: map.processLabel,
          defaultTaskUserId: map.defaultTaskUserId,
        },
      },
    });

    await upsertFluigUserSyncState({
      actor,
      module: moduleSlug,
      syncType: "status_check",
      status: "started",
      cursor: { fluigRequestId },
      metadata: { jobId: job.id, requestedModule: parsed.data.module },
    });

    return NextResponse.json({ success: true, job });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao criar consulta Fluig.", 500);
  }
}
