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
type IncrementalSyncType = Extract<FluigUserSyncType, "open_tasks" | "my_requests">;
type DiscoveryWindow = {
  days: number;
  pageSize: number;
  maxPages: number;
};

const defaultDiscovery: DiscoveryWindow = {
  days: 21,
  pageSize: 50,
  maxPages: 2,
};

const incrementalSyncPlans: Array<{
  syncType: IncrementalSyncType;
  operation: Extract<FluigJobOperation, "sync_user_open_tasks" | "sync_user_open_requests">;
}> = [
  { syncType: "open_tasks", operation: "sync_user_open_tasks" },
  { syncType: "my_requests", operation: "sync_user_open_requests" },
];

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
      reuseActive: true,
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

export async function createUserIncrementalBatchJob(input: {
  actor: AppActor;
  module?: UserSyncModule | null;
  limit?: number;
  discovery?: Partial<DiscoveryWindow>;
}) {
  const modules = modulesForUserSync(input.module);
  const discovery = {
    ...defaultDiscovery,
    ...(input.discovery || {}),
  };
  const skipped: Array<{ module: FluigModuleSlug; syncType: IncrementalSyncType; reason: string }> = [];
  const batches: Array<{
    module: FluigModuleSlug;
    operation: Extract<FluigJobOperation, "sync_user_open_tasks" | "sync_user_open_requests">;
    syncType: IncrementalSyncType;
    requestIds: string[];
    discoverRecent: boolean;
    discovery: DiscoveryWindow;
    taskUserId: string;
    processMap: {
      module: FluigModuleSlug;
      processId: string;
      processVersions: string[];
      processLabel: string;
      defaultTaskUserId: string;
    };
  }> = [];

  for (const moduleSlug of modules) {
    const snapshot = await readKnownOpenFluigRequestsForActor({
      actor: input.actor,
      module: moduleSlug,
      limit: input.limit,
    });
    const requestIds = Array.from(new Set(snapshot.requests.map((request) => request.fluigRequestId).filter(Boolean)));
    const map = requireFluigProcessMap(moduleSlug);

    for (const plan of incrementalSyncPlans) {
      batches.push({
        module: moduleSlug,
        operation: plan.operation,
        syncType: plan.syncType,
        requestIds,
        discoverRecent: true,
        discovery,
        taskUserId: input.actor.fluigUserId || map.defaultTaskUserId,
        processMap: {
          module: map.module,
          processId: map.processId,
          processVersions: map.processVersions,
          processLabel: map.processLabel,
          defaultTaskUserId: map.defaultTaskUserId,
        },
      });
    }
  }

  if (!batches.length) {
    return { jobs: [], skipped, batches: [] };
  }

  const orchestrationModule = modules.length === 1 ? modules[0] : "fornecedores";
  const job = await createFluigJob({
    actor: input.actor,
    module: orchestrationModule,
    operation: "sync_user_incremental_batch",
    reuseActive: true,
    requestPayload: {
      batches,
      batchCount: batches.length,
      requestCount: Array.from(new Set(batches.flatMap((batch) => batch.requestIds))).length,
      discovery,
      userMatch: {
        userId: input.actor.id,
        fluigUsername: input.actor.fluigUsername,
        fluigUserId: input.actor.fluigUserId,
        email: input.actor.email,
        displayName: input.actor.displayName,
        branchCodes: input.actor.branchCodes,
      },
      taskUserId: batches[0]?.taskUserId,
    },
  });

  for (const batch of batches) {
    await upsertFluigUserSyncState({
      actor: input.actor,
      module: batch.module,
      syncType: batch.syncType,
      status: "started",
      cursor: { requestCount: batch.requestIds.length, requestIds: batch.requestIds },
      metadata: {
        jobId: job.id,
        operation: batch.operation,
        batched: true,
        discovery,
        discoverRecent: batch.discoverRecent,
      },
    });
  }

  return { jobs: [job], skipped, batches };
}
