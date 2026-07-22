import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { listFluigUserSyncState, resolveCurrentAppUser } from "@/lib/db/app-repository";
import { listFluigTaskDashboardFilters, readKnownOpenFluigRequestsForActor } from "@/lib/db/fluig-repository";
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
    const requestedScope = url.searchParams.get("scope") === "all" ? "all" : "self";
    const scope = actor.isAdmin ? requestedScope : "self";
    const userId = scope === "all" ? url.searchParams.get("userId") : null;
    const nature = String(url.searchParams.get("nature") || "").trim() || null;
    const [result, states, filters] = await Promise.all([
      readKnownOpenFluigRequestsForActor({
        actor,
        module: moduleSlug,
        limit: parseNumber(url.searchParams.get("limit"), 50),
        onlyTasks: true,
        membershipType: "open_task",
        scope,
        userId,
        nature,
      }),
      listFluigUserSyncState(actor, { userId, module: moduleSlug }),
      listFluigTaskDashboardFilters(actor, { module: moduleSlug }),
    ]);
    const total = scope === "self"
      ? resolveFluigUserSyncTotal(states, "open_tasks", result.total, { moduleScoped: Boolean(moduleSlug) })
      : result.total;
    const selectedUser = userId ? filters.users.find((user) => user.id === userId) : null;
    const tasks = result.requests.map((task) => {
      const assignedUser = selectedUser || filters.users.find((user) => user.fluigUserId === task.assignedFluigUserId);
      return {
        ...task,
        assignedUserId: assignedUser?.id || null,
        assignedUserName: assignedUser?.displayName || task.taskOwner || null,
        assignedUserEmail: assignedUser?.email || null,
      };
    });

    return NextResponse.json({
      success: true,
      tasks,
      total,
      scope,
      filters,
      persistence: result.persistence,
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao listar tarefas Fluig.", 500);
  }
}
