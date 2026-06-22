import type { FluigAdmSyncResponse, FluigModuleSlug } from "@/lib/fluig-data";

export type FluigAdmSyncAction = "sync" | "examples" | "suppliers" | "tasks";
export type FluigJobOperation =
  | "sync_history"
  | "sync_status"
  | "open_from_source"
  | "cancel_request"
  | "health_check"
  | "sync_initial_history"
  | "sync_user_open_tasks"
  | "sync_user_open_requests"
  | "sync_user_incremental_batch"
  | "sync_request_by_number"
  | "supplier_lookup_by_cnpj";

export type FluigAdmSyncRequest = {
  module: FluigModuleSlug;
  action?: FluigAdmSyncAction;
};

export type FluigAdmAgent = {
  id: string;
  display_name: string;
  machine_name: string | null;
  status: string;
  last_heartbeat_at: string | null;
};

export type FluigAdmJobSummary = {
  id: string;
  module: FluigModuleSlug;
  operation: FluigJobOperation;
  status: string;
  progressStage: string | null;
  progressLabel: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
  finishedAt?: string | null;
};

export type FluigOpenRequestRecord = {
  id: string;
  module: FluigModuleSlug;
  fluigRequestId: string;
  admReference: string | null;
  status: string | null;
  normalizedStatus: string | null;
  isOpen: boolean | null;
  currentTask: string | null;
  taskOwner: string | null;
  requester: string | null;
  branchCode: string | null;
  branchLabel: string | null;
  supplierName: string | null;
  supplierCnpj: string | null;
  openedAt: string | null;
  lastSyncedAt: string | null;
  lastStatusCheckAt: string | null;
  lastSeenInUserOpenListAt: string | null;
  syncOwnerUserId: string | null;
  syncSource: string | null;
};

export type FluigUserSyncStateRecord = {
  id: string;
  userId: string;
  fluigUsername: string | null;
  fluigUserId: string | null;
  module: FluigModuleSlug;
  syncType: "historical" | "open_tasks" | "my_requests" | "status_check" | "supplier_lookup";
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  cursor: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type FluigUserSyncSkipped = {
  module: FluigModuleSlug;
  syncType?: "open_tasks" | "my_requests";
  reason: string;
};

export type FluigUserSyncResponse = {
  success: true;
  openTasks?: {
    jobs: FluigAdmJobSummary[];
    skipped: FluigUserSyncSkipped[];
  };
  myRequests?: {
    jobs: FluigAdmJobSummary[];
    skipped: FluigUserSyncSkipped[];
  };
  jobs: FluigAdmJobSummary[];
  skipped: FluigUserSyncSkipped[];
  batches?: Array<{
    module: FluigModuleSlug;
    operation: Extract<FluigJobOperation, "sync_user_open_tasks" | "sync_user_open_requests">;
    syncType: "open_tasks" | "my_requests";
    requestIds: string[];
  }>;
};

type FluigJobStatusResponse = {
  success: true;
  job: {
    id: string;
    status: string;
    progressStage: string | null;
    progressLabel: string | null;
    errorMessage?: string | null;
  };
  events: Array<{
    id: string;
    event_type: string;
    stage: string | null;
    label: string | null;
    created_at: string;
  }>;
};

export const fluigAdmApi = {
  syncPath: "/api/fluig/adm/sync",
  mapPath: "/api/fluig/adm/map",
  historyPath: "/api/fluig/adm/history",
  statusPath: "/api/fluig/adm/status",
  openPath: "/api/fluig/adm/open",
  cancelPath: "/api/fluig/adm/cancel",
  supplierPreloadPath: "/api/fluig/adm/suppliers/preload",
  agentPairPath: "/api/fluig/adm/agent/pair",
  jobsPath: "/api/fluig/adm/jobs",
  syncUserPath: "/api/fluig/adm/sync/user",
  syncStatePath: "/api/fluig/adm/sync/state",
  syncOpenTasksPath: "/api/fluig/adm/sync/open-tasks",
  syncMyRequestsPath: "/api/fluig/adm/sync/my-requests",
  myTasksPath: "/api/fluig/adm/tasks/my",
  myOpenRequestsPath: "/api/fluig/adm/requests/my-open",
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
  async get<TResponse>(path: string) {
    const response = await fetch(path, { cache: "no-store" });
    const data = (await response.json()) as TResponse & { success?: boolean; error?: string };

    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Falha ao consultar Fluig");
    }

    return data;
  },
  async createJob(payload: {
    module: FluigModuleSlug;
    operation?: FluigJobOperation;
    branchCode?: string | null;
    branchLabel?: string | null;
    payload?: Record<string, unknown>;
  }) {
    return this.post<{
      success: true;
      job: {
        id: string;
        status: string;
        progressStage: string | null;
        progressLabel: string | null;
      };
    }>(this.jobsPath, payload);
  },
  async getJob(jobId: string) {
    const response = await fetch(`${this.jobsPath}/${jobId}`, { cache: "no-store" });
    const data = (await response.json()) as FluigJobStatusResponse | { success: false; error?: string };

    if (!response.ok || data.success === false || !("job" in data)) {
      throw new Error(("error" in data ? data.error : null) || "Falha ao consultar job Fluig");
    }

    return { success: true, job: data.job, events: data.events || [] } as FluigJobStatusResponse;
  },
  async listAgents() {
    const response = await fetch(this.agentPairPath, { cache: "no-store" });
    const data = (await response.json()) as {
      success?: boolean;
      error?: string;
      agents?: FluigAdmAgent[];
    };

    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Falha ao consultar agente Fluig");
    }

    return data.agents || [];
  },
  async syncUser(payload: { module?: FluigModuleSlug | "all" | "auto"; limit?: number }) {
    return this.post<FluigUserSyncResponse>(this.syncUserPath, payload);
  },
  async syncOpenTasks(payload: { module?: FluigModuleSlug | "all" | "auto"; requestIds?: string[] | string; limit?: number }) {
    return this.post<{
      success: true;
      jobs: FluigAdmJobSummary[];
      skipped: Array<{ module: FluigModuleSlug; reason: string }>;
    }>(this.syncOpenTasksPath, payload);
  },
  async syncMyRequests(payload: { module?: FluigModuleSlug | "all" | "auto"; requestIds?: string[] | string; limit?: number }) {
    return this.post<{
      success: true;
      jobs: FluigAdmJobSummary[];
      skipped: Array<{ module: FluigModuleSlug; reason: string }>;
    }>(this.syncMyRequestsPath, payload);
  },
  async listMyTasks(limit = 20, module?: FluigModuleSlug) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (module) params.set("module", module);
    return this.get<{
      success: true;
      tasks: FluigOpenRequestRecord[];
      persistence?: unknown;
    }>(`${this.myTasksPath}?${params.toString()}`);
  },
  async listMyOpenRequests(limit = 20, module?: FluigModuleSlug) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (module) params.set("module", module);
    return this.get<{
      success: true;
      requests: FluigOpenRequestRecord[];
      persistence?: unknown;
    }>(`${this.myOpenRequestsPath}?${params.toString()}`);
  },
  async listSyncState(module?: FluigModuleSlug) {
    const params = new URLSearchParams();
    if (module) params.set("module", module);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return this.get<{
      success: true;
      states: FluigUserSyncStateRecord[];
    }>(`${this.syncStatePath}${suffix}`);
  },
  async pairAgent(payload: { displayName?: string; machineName?: string }) {
    return this.post<{
      success: true;
      agent: {
        id: string;
        display_name: string;
        status: string;
      };
      token: string;
      installHint: string;
    }>(this.agentPairPath, payload);
  },
};
