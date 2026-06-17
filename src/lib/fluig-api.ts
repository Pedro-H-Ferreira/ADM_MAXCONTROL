import type { FluigAdmSyncResponse, FluigModuleSlug } from "@/lib/fluig-data";

export type FluigAdmSyncAction = "sync" | "examples" | "suppliers" | "tasks";

export type FluigAdmSyncRequest = {
  module: FluigModuleSlug;
  action?: FluigAdmSyncAction;
};

export const fluigAdmApi = {
  syncPath: "/api/fluig/adm/sync",
  mapPath: "/api/fluig/adm/map",
  historyPath: "/api/fluig/adm/history",
  statusPath: "/api/fluig/adm/status",
  openPath: "/api/fluig/adm/open",
  cancelPath: "/api/fluig/adm/cancel",
  supplierPreloadPath: "/api/fluig/adm/suppliers/preload",
  async sync(payload: FluigAdmSyncRequest) {
    const response = await fetch(this.syncPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as FluigAdmSyncResponse | { success: false; error: string };

    if (!response.ok || !data.success) {
      throw new Error("error" in data ? data.error : "Falha ao sincronizar Fluig");
    }

    return data;
  },
  async post<TResponse>(path: string, payload: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as TResponse & { success?: boolean; error?: string };

    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Falha ao executar operacao Fluig");
    }

    return data;
  },
};
