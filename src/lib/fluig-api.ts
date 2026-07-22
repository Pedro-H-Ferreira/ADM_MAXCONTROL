import type { FluigAdmSyncResponse, FluigModuleSlug } from "@/lib/fluig-data";
import type {
  OperationalLaunchAttachmentPayload,
  OperationalLaunchModule,
  OperationalLaunchRecord,
  OperationalLaunchValidateInput,
} from "@/lib/operational-launch";

const inFlightFluigReads = new Map<string, Promise<unknown>>();

function dedupeFluigRead<T>(key: string, load: () => Promise<T>) {
  const current = inFlightFluigReads.get(key) as Promise<T> | undefined;
  if (current) return current;

  const request = load().finally(() => {
    if (inFlightFluigReads.get(key) === request) inFlightFluigReads.delete(key);
  });
  inFlightFluigReads.set(key, request);
  return request;
}

export type FluigAdmSyncAction = "sync" | "examples" | "suppliers" | "tasks";
export type FluigJobOperation =
  | "sync_history"
  | "sync_status"
  | "open_from_source"
  | "attach_to_request"
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
  local_api_url?: string | null;
  agent_version?: string | null;
  last_heartbeat_at: string | null;
  paired_at?: string | null;
  updated_at?: string | null;
  heartbeat_age_seconds?: number | null;
  heartbeat_is_stale?: boolean;
};

export type FluigAdmJobSummary = {
  id: string;
  requestedByUserId?: string;
  assignedAgentId?: string | null;
  module: FluigModuleSlug;
  operation: FluigJobOperation;
  status: string;
  progressStage: string | null;
  progressLabel: string | null;
  errorMessage?: string | null;
  requestPayload?: Record<string, unknown>;
  resultPayload?: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
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
  invoiceNumber: string | null;
  invoiceDueDate: string | null;
  amountCents: number | null;
  currency: string | null;
  dueDate: string | null;
  expenseNature?: string | null;
  sourceUrl: string | null;
  openedAt: string | null;
  lastSyncedAt: string | null;
  lastStatusCheckAt: string | null;
  lastSeenInUserOpenListAt: string | null;
  syncOwnerUserId: string | null;
  syncSource: string | null;
  assignedFluigUserId?: string | null;
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  assignedUserEmail?: string | null;
  membershipType?: "open_task" | "my_request";
  membershipLastSeenAt?: string | null;
};

export type FluigRequestDetails = {
  requestId: string;
  taskUserId: string | null;
  sourceUrl: string;
  fetchedAt: string;
  formFields: Record<string, string>;
  attachments: Array<{
    sequence: string;
    name: string;
    description: string;
    mimeType: string | null;
    size: number | null;
    documentId: string | null;
    version: string | null;
    attachedBy: string | null;
    attachedAt: string | null;
  }>;
  history: Array<{
    sequence: string;
    user: string;
    activity: string | null;
    destination: string | null;
    detail: string | null;
    observation: string | null;
    date: string | null;
    automatic: boolean;
  }>;
  warnings: string[];
};

export type FluigTaskDashboardFilters = {
  isAdmin: boolean;
  users: Array<{
    id: string;
    displayName: string;
    email: string | null;
    role: string;
    fluigUsername: string | null;
    fluigUserId: string | null;
    credentialConfigured: boolean;
    taskSyncCompleted: boolean;
  }>;
  natures: Array<{ value: string; label: string }>;
  coverage: {
    totalUsers: number;
    configuredUsers: number;
    syncedUsers: number;
  };
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
  status: "started" | "success" | "error";
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
  scope?: "self" | "all";
  usersQueued?: number;
  openTasks?: {
    jobs: FluigAdmJobSummary[];
    skipped: FluigUserSyncSkipped[];
  };
  myRequests?: {
    jobs: FluigAdmJobSummary[];
    skipped: FluigUserSyncSkipped[];
  };
  jobs: FluigAdmJobSummary[];
  skipped: Array<FluigUserSyncSkipped | { userId: string; displayName: string; reason: string }>;
  batches?: Array<{
    module: FluigModuleSlug;
    operation: Extract<FluigJobOperation, "sync_user_open_tasks" | "sync_user_open_requests">;
    syncType: "open_tasks" | "my_requests";
    requestIds: string[];
  }>;
};

export type FluigJobStatusResponse = {
  success: true;
  job: FluigAdmJobSummary;
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
  syncHistoricalPath: "/api/fluig/adm/sync/historical",
  syncOpenTasksPath: "/api/fluig/adm/sync/open-tasks",
  syncMyRequestsPath: "/api/fluig/adm/sync/my-requests",
  requestLookupPath: "/api/fluig/adm/request/lookup",
  requestDetailsPath: "/api/fluig/adm/request/details",
  requestAttachmentPath: "/api/fluig/adm/request/attachment",
  myTasksPath: "/api/fluig/adm/tasks/my",
  myOpenRequestsPath: "/api/fluig/adm/requests/my-open",
  requestsPath: "/api/fluig/adm/requests",
  operationalLaunchesPath: "/api/fluig/adm/launches",
  async sync(payload: FluigAdmSyncRequest) {
    return dedupeFluigRead(`snapshot:${payload.module}:${payload.action || "sync"}`, async () => {
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
    });
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
    return dedupeFluigRead(`get:${path}`, async () => {
      const response = await fetch(path, { cache: "no-store" });
      const data = (await response.json()) as TResponse & { success?: boolean; error?: string };

      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Falha ao consultar Fluig");
      }

      return data;
    });
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
      job: FluigAdmJobSummary;
    }>(this.jobsPath, payload);
  },
  async testAgentConnection(payload: { module?: FluigModuleSlug } = {}) {
    return this.createJob({
      module: payload.module || "pagamentos",
      operation: "health_check",
      payload: {
        check: "fluig_login",
        requestedAt: new Date().toISOString(),
      },
    });
  },
  async getJob(jobId: string, options: { details?: boolean } = {}) {
    const suffix = options.details ? "?details=true" : "";
    const response = await fetch(`${this.jobsPath}/${jobId}${suffix}`, { cache: "no-store" });
    const data = (await response.json()) as FluigJobStatusResponse | { success: false; error?: string };

    if (!response.ok || data.success === false || !("job" in data)) {
      throw new Error(("error" in data ? data.error : null) || "Falha ao consultar job Fluig");
    }

    return { success: true, job: data.job, events: data.events || [] } as FluigJobStatusResponse;
  },
  async listJobs(limit = 20) {
    const params = new URLSearchParams({ limit: "50" });
    const data = await this.get<{
      success: true;
      jobs: FluigAdmJobSummary[];
    }>(`${this.jobsPath}?${params.toString()}`);
    return { ...data, jobs: data.jobs.slice(0, Math.min(Math.max(limit, 1), 50)) };
  },
  async listAgents() {
    const data = await this.get<{
      success?: boolean;
      error?: string;
      agents?: FluigAdmAgent[];
    }>(this.agentPairPath);

    return data.agents || [];
  },
  async syncUser(payload: {
    module?: FluigModuleSlug | "all" | "auto";
    limit?: number;
    scope?: "self" | "all";
    userId?: string;
  }) {
    return this.post<FluigUserSyncResponse>(this.syncUserPath, payload);
  },
  async syncHistorical(payload: {
    module: FluigModuleSlug;
    action?: Extract<FluigAdmSyncAction, "sync" | "examples">;
    days?: number;
    pageSize?: number;
    maxPages?: number;
  }) {
    return this.post<{
      success: true;
      jobs: FluigAdmJobSummary[];
    }>(this.syncHistoricalPath, payload);
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
  async lookupRequest(payload: { module?: FluigModuleSlug | "auto"; fluigRequestId: string; persist?: boolean }) {
    return this.post<{
      success: true;
      job: FluigAdmJobSummary;
    }>(this.requestLookupPath, payload);
  },
  async syncStatus(payload: {
    module: Exclude<FluigModuleSlug, "fornecedores">;
    requestIds: string[] | string;
    taskUserId?: string;
    persist?: boolean;
  }) {
    return this.post<{
      success: true;
      generatedAt: string;
      module: Exclude<FluigModuleSlug, "fornecedores">;
      requestIds: string[];
      job: FluigAdmJobSummary;
    }>(this.statusPath, payload);
  },
  async cancelRequest(payload: {
    module: Exclude<FluigModuleSlug, "fornecedores">;
    requestIds: string[] | string;
    comment?: string;
    confirm?: boolean;
    persist?: boolean;
  }) {
    return this.post<{
      success: true;
      generatedAt: string;
      module: Exclude<FluigModuleSlug, "fornecedores">;
      job: FluigAdmJobSummary;
      dryRun?: {
        module: Exclude<FluigModuleSlug, "fornecedores">;
        requestIds: string[];
        comment: string;
        requiredConfirmation: boolean;
      };
    }>(this.cancelPath, payload);
  },
  async getLookupRequest(payload: { module?: FluigModuleSlug | "auto"; fluigRequestId: string }) {
    const params = new URLSearchParams({ fluigRequestId: payload.fluigRequestId });
    if (payload.module && payload.module !== "auto") params.set("module", payload.module);
    return this.get<{
      success: true;
      request: FluigOpenRequestRecord | null;
      persistence?: unknown;
    }>(`${this.requestLookupPath}?${params.toString()}`);
  },
  async openDryRun(payload: {
    module: FluigModuleSlug;
    sourceRequestId: string;
    fieldOverrides: Record<string, string>;
    attachments?: Array<{ name: string; mimeType?: string; size?: number }>;
    mode?: "test" | "production";
  }) {
    return this.post<{
      success: true;
      generatedAt: string;
      dryRun: {
        module: FluigModuleSlug;
        processId: string;
        sourceRequestId: string;
        mode: "test" | "production";
        requiredConfirmation: boolean;
        fieldOverrides: Record<string, string>;
      };
    }>(this.openPath, {
      module: payload.module,
      sourceRequestId: payload.sourceRequestId,
      fieldOverrides: payload.fieldOverrides,
      attachments: payload.attachments || [],
      mode: payload.mode || "production",
      confirm: false,
      persist: false,
    });
  },
  async validateOperationalLaunch(payload: OperationalLaunchValidateInput) {
    return this.post<{
      success: true;
      launch: OperationalLaunchRecord;
    }>(this.operationalLaunchesPath, {
      action: "validate",
      ...payload,
    });
  },
  async submitOperationalLaunch(launchId: string, attachments: OperationalLaunchAttachmentPayload[]) {
    return this.post<{
      success: true;
      launch: OperationalLaunchRecord;
      job: FluigAdmJobSummary;
    }>(this.operationalLaunchesPath, {
      action: "submit",
      launchId,
      attachments,
    });
  },
  async listOperationalLaunches(module: OperationalLaunchModule, limit = 20) {
    const params = new URLSearchParams({ module, limit: String(limit) });
    return this.get<{
      success: true;
      launches: OperationalLaunchRecord[];
      permissions: {
        canView: boolean;
        canCreate: boolean;
      };
    }>(`${this.operationalLaunchesPath}?${params.toString()}`);
  },
  async getOperationalLaunch(id: string) {
    const params = new URLSearchParams({ id });
    return this.get<{
      success: true;
      launches: OperationalLaunchRecord[];
    }>(`${this.operationalLaunchesPath}?${params.toString()}`);
  },
  async listMyTasks(
    limit = 20,
    module?: FluigModuleSlug,
    options: { scope?: "self" | "all"; userId?: string; nature?: string } = {}
  ) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (module) params.set("module", module);
    if (options.scope) params.set("scope", options.scope);
    if (options.userId) params.set("userId", options.userId);
    if (options.nature) params.set("nature", options.nature);
    return this.get<{
      success: true;
      tasks: FluigOpenRequestRecord[];
      total: number;
      scope: "self" | "all";
      filters: FluigTaskDashboardFilters;
      persistence?: unknown;
    }>(`${this.myTasksPath}?${params.toString()}`);
  },
  async getRequestDetails(payload: { module: FluigModuleSlug; fluigRequestId: string }) {
    const params = new URLSearchParams({ module: payload.module, fluigRequestId: payload.fluigRequestId });
    return this.get<{ success: true; details: FluigRequestDetails }>(`${this.requestDetailsPath}?${params.toString()}`);
  },
  requestAttachmentUrl(payload: { module: FluigModuleSlug; fluigRequestId: string; sequence: string }) {
    const params = new URLSearchParams({
      module: payload.module,
      fluigRequestId: payload.fluigRequestId,
      sequence: payload.sequence,
    });
    return `${this.requestAttachmentPath}?${params.toString()}`;
  },
  async listMyOpenRequests(
    limit = 20,
    module?: FluigModuleSlug,
    options: { scope?: "self" | "all"; userId?: string; nature?: string } = {}
  ) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (module) params.set("module", module);
    if (options.scope) params.set("scope", options.scope);
    if (options.userId) params.set("userId", options.userId);
    if (options.nature) params.set("nature", options.nature);
    return this.get<{
      success: true;
      requests: FluigOpenRequestRecord[];
      total: number;
      scope: "self" | "all";
      filters: FluigTaskDashboardFilters;
      persistence?: unknown;
    }>(`${this.myOpenRequestsPath}?${params.toString()}`);
  },
  async listRequests(input: {
    module: FluigModuleSlug;
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    branch?: string;
    nature?: string;
    open?: boolean | null;
    overdue?: boolean;
    errorOnly?: boolean;
  }) {
    const params = new URLSearchParams({ module: input.module, page: String(input.page || 1), pageSize: String(input.pageSize || 30) });
    if (input.search) params.set("q", input.search);
    if (input.status) params.set("status", input.status);
    if (input.branch) params.set("branch", input.branch);
    if (input.nature) params.set("nature", input.nature);
    if (input.open != null) params.set("open", String(input.open));
    if (input.overdue) params.set("overdue", "true");
    if (input.errorOnly) params.set("errorOnly", "true");
    return this.get<{ success: true; page: number; pageSize: number; total: number; items: FluigOpenRequestRecord[] }>(`${this.requestsPath}?${params.toString()}`);
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
