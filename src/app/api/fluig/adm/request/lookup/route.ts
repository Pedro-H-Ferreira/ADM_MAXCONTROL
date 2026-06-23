import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { createFluigJob, resolveCurrentAppUser, upsertFluigUserSyncState } from "@/lib/db/app-repository";
import { requireFluigProcessMap } from "@/lib/fluig/process-map";
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

function moduleForLookup(module: string): FluigModuleSlug {
  return module === "auto" || module === "fornecedores" ? "pagamentos" : (module as FluigModuleSlug);
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const body = await request.json().catch(() => ({}));
    const parsed = lookupSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Consulta Fluig invalida.");
    }

    const moduleSlug = moduleForLookup(parsed.data.module);
    const map = requireFluigProcessMap(moduleSlug);
    const job = await createFluigJob({
      actor,
      module: moduleSlug,
      operation: "sync_request_by_number",
      reuseActive: true,
      requestPayload: {
        requestIds: [parsed.data.fluigRequestId],
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
      cursor: { fluigRequestId: parsed.data.fluigRequestId },
      metadata: { jobId: job.id, requestedModule: parsed.data.module },
    });

    return NextResponse.json({ success: true, job });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao criar consulta Fluig.", 500);
  }
}
