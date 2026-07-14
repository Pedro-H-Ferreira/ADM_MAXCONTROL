import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { listFluigUserSyncState, resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readKnownOpenFluigRequestsForActor } from "@/lib/db/fluig-repository";
import { moduleOrNull, parseNumber } from "@/lib/fluig/route-utils";
import { resolveFluigUserSyncTotal } from "@/lib/fluig-user-sync-total";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const moduleSlug = moduleOrNull(url.searchParams.get("module") || "");
    const [result, states] = await Promise.all([
      readKnownOpenFluigRequestsForActor({
        actor,
        module: moduleSlug,
        limit: parseNumber(url.searchParams.get("limit"), 50),
        onlyTasks: true,
      }),
      listFluigUserSyncState(actor, { module: moduleSlug }),
    ]);
    const total = resolveFluigUserSyncTotal(states, "open_tasks", result.total, { moduleScoped: Boolean(moduleSlug) });

    return NextResponse.json({ success: true, tasks: result.requests, total, persistence: result.persistence });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao listar tarefas Fluig.", 500);
  }
}
