import type { FluigUserSyncStateRecord } from "@/lib/fluig-api";

export function resolveFluigUserSyncTotal(
  states: FluigUserSyncStateRecord[],
  syncType: Extract<FluigUserSyncStateRecord["syncType"], "open_tasks" | "my_requests">,
  fallback: number,
  options: { moduleScoped?: boolean } = {}
) {
  const state = [...states]
    .filter((item) => item.syncType === syncType && item.status === "success")
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .find((item) =>
      Number.isFinite(Number(options.moduleScoped ? item.metadata?.requestCount : item.metadata?.globalTotal))
    );
  const total = Number(options.moduleScoped ? state?.metadata?.requestCount : state?.metadata?.globalTotal);
  return Number.isFinite(total) && total >= 0 ? total : Math.max(0, fallback);
}
