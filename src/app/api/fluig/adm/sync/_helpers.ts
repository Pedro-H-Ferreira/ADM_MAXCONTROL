import {
  createFluigJob,
  upsertFluigUserSyncState,
  type AppActor,
  type FluigJobOperation,
  type FluigUserSyncType,
} from "@/lib/db/app-repository";
import { readKnownOpenFluigRequestsForActor } from "@/lib/db/fluig-repository";
import { requireFluigProcessMap } from "@/lib/fluig/process-map";
import { normalizeRequestIds } from "@/lib/fluig/route-utils";
import type { FluigModuleSlug } from "@/lib/fluig-data";

type UserSyncModule = FluigModuleSlug | "all" | "auto";

export function modulesForUserSync(module: UserSyncModule | null | undefined): FluigModuleSlug[] {
  if (!module || module === "all" || module === "auto" || module === "fornecedores") {
    return ["pagamentos", "compras", "manutencao"];
  }

  return [module];
}

export async function createKnownOpenSyncJobs(input: {
  actor: AppActor;
  module?: UserSyncModule | null;
  operation: Extract<FluigJobOperation, "sync_user_open_tasks" | "sync_user_open_requests">;
  syncType: Extract<FluigUserSyncType, "open_tasks" | "my_requests">;
  requestIds?: unknown;
  limit?: number;
}) {
  const modules = modulesForUserSync(input.module);
  const explicitRequestIds = normalizeRequestIds(input.requestIds);
  const jobs = [];
  const skipped = [];

  for (const moduleSlug of modules) {
    const snapshot = explicitRequestIds.length
      ? { requests: explicitRequestIds.map((fluigRequestId) => ({ module: moduleSlug, fluigRequestId })), persistence: null }
      : await readKnownOpenFluigRequestsForActor({
          actor: input.actor,
          module: moduleSlug,
          limit: input.limit,
        });
    const requestIds = snapshot.requests.map((request) => request.fluigRequestId).filter(Boolean);

    if (!requestIds.length) {
      skipped.push({ module: moduleSlug, reason: "Nenhuma solicitacao aberta conhecida para consulta incremental." });
      await upsertFluigUserSyncState({
        actor: input.actor,
        module: moduleSlug,
        syncType: input.syncType,
        status: "success",
        cursor: { requestCount: 0 },
        metadata: { skipped: true, reason: "no_known_open_requests" },
      });
      continue;
    }

    const map = requireFluigProcessMap(moduleSlug);
    const job = await createFluigJob({
      actor: input.actor,
      module: moduleSlug,
      operation: input.operation,
      requestPayload: {
        requestIds,
        taskUserId: input.actor.fluigUserId || map.defaultTaskUserId,
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
      actor: input.actor,
      module: moduleSlug,
      syncType: input.syncType,
      status: "started",
      cursor: { requestCount: requestIds.length, requestIds },
      metadata: { jobId: job.id, operation: input.operation },
    });

    jobs.push(job);
  }

  return { jobs, skipped };
}
