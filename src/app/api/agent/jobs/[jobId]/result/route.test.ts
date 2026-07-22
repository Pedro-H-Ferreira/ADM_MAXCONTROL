import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAgent: vi.fn(),
  completeFluigUserSyncStateForJob: vi.fn(),
  completeFluigJob: vi.fn(),
  readJobForAgent: vi.fn(),
  recordDetectedFluigUserId: vi.fn(),
  recordFluigJobEvent: vi.fn(),
  buildFluigCatalogItemsByModule: vi.fn(),
  buildSupplierCandidates: vi.fn(),
  clearStaleFluigUserTaskMemberships: vi.fn(),
  persistFluigCatalogItems: vi.fn(),
  persistHistoryItemsInChunksByModule: vi.fn(),
  persistStatusItems: vi.fn(),
  persistSupplierCandidates: vi.fn(),
  completeMaintenanceOrderFluigOpenJob: vi.fn(),
  recordMaintenanceOrderFluigJobFailure: vi.fn(),
  completeOperationalLaunchJob: vi.fn(),
  markOperationalLaunchFailure: vi.fn(),
  markSupplierFluigSyncResult: vi.fn(),
  reconcileSupplierPreRegistrations: vi.fn(),
}));

vi.mock("@/app/api/agent/_utils", () => ({
  requireAgent: mocks.requireAgent,
}));

vi.mock("@/lib/db/app-repository", () => ({
  completeFluigUserSyncStateForJob: mocks.completeFluigUserSyncStateForJob,
  completeFluigJob: mocks.completeFluigJob,
  readJobForAgent: mocks.readJobForAgent,
  recordDetectedFluigUserId: mocks.recordDetectedFluigUserId,
  recordFluigJobEvent: mocks.recordFluigJobEvent,
}));

vi.mock("@/lib/db/fluig-repository", () => ({
  buildFluigCatalogItemsByModule: mocks.buildFluigCatalogItemsByModule,
  buildSupplierCandidates: mocks.buildSupplierCandidates,
  clearStaleFluigUserTaskMemberships: mocks.clearStaleFluigUserTaskMemberships,
  persistFluigCatalogItems: mocks.persistFluigCatalogItems,
  persistHistoryItemsInChunksByModule: mocks.persistHistoryItemsInChunksByModule,
  persistStatusItems: mocks.persistStatusItems,
  persistSupplierCandidates: mocks.persistSupplierCandidates,
}));

vi.mock("@/lib/db/maintenance-repository", () => ({
  completeMaintenanceOrderFluigOpenJob: mocks.completeMaintenanceOrderFluigOpenJob,
  recordMaintenanceOrderFluigJobFailure: mocks.recordMaintenanceOrderFluigJobFailure,
}));

vi.mock("@/lib/db/operational-launch-repository", () => ({
  completeOperationalLaunchJob: mocks.completeOperationalLaunchJob,
  markOperationalLaunchFailure: mocks.markOperationalLaunchFailure,
}));

vi.mock("@/lib/db/suppliers-repository", () => ({
  markSupplierFluigSyncResult: mocks.markSupplierFluigSyncResult,
  reconcileSupplierPreRegistrations: mocks.reconcileSupplierPreRegistrations,
}));

vi.mock("@/lib/fluig/route-utils", () => ({
  mergePersistence: (...items: unknown[]) => items[0],
}));

import { POST } from "@/app/api/agent/jobs/[jobId]/result/route";

const agent = {
  id: "agent-1",
  userId: "user-1",
};

const job = {
  id: "job-1",
  requestedByUserId: agent.userId,
  assignedAgentId: agent.id,
  module: "pagamentos",
  operation: "open_from_source",
  status: "syncing_result",
  branchCode: "001",
  branchLabel: "Matriz",
  fluigUsername: "usuario.fluig",
  requestPayload: {
    launchId: "launch-1",
  },
  resultPayload: {},
  errorMessage: null,
  progressStage: "syncing_result",
  progressLabel: "Enviando resultado",
  attempts: 1,
  maxAttempts: 1,
  nextAttemptAt: null,
  lastAttemptAt: "2026-07-13T12:00:00.000Z",
  expiresAt: "2026-07-13T13:00:00.000Z",
  createdAt: "2026-07-13T11:00:00.000Z",
  updatedAt: "2026-07-13T12:00:00.000Z",
};

function resultRequest(resultPayload: Record<string, unknown>) {
  return new Request("http://localhost/api/agent/jobs/job-1/result", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "success",
      resultPayload,
    }),
  });
}

const context = {
  params: Promise.resolve({ jobId: job.id }),
};

describe("POST /api/agent/jobs/[jobId]/result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgent.mockResolvedValue({ agent, error: null });
    mocks.readJobForAgent.mockResolvedValue(job);
    mocks.persistStatusItems.mockResolvedValue({
      configured: true,
      saved: { fluigRequests: 1 },
      errors: [],
    });
    mocks.recordDetectedFluigUserId.mockResolvedValue({ detected: true, matched: true, updated: false });
    mocks.clearStaleFluigUserTaskMemberships.mockResolvedValue({ configured: true, saved: {}, errors: [] });
  });

  it.each([
    ["ausente", {}],
    ["em branco", { data: { generatedRequestId: "   " } }],
  ])("persiste como erro quando o protocolo esta %s", async (_case, resultPayload) => {
    const response = await POST(resultRequest(resultPayload), context);
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody).toEqual({ success: true });
    expect(mocks.completeFluigJob).toHaveBeenCalledWith({
      jobId: job.id,
      agentId: agent.id,
      status: "error",
      resultPayload,
      errorMessage: expect.stringContaining("protocolo"),
    });
    expect(mocks.recordMaintenanceOrderFluigJobFailure).toHaveBeenCalledWith({
      job,
      errorMessage: expect.stringContaining("protocolo"),
    });
    expect(mocks.markOperationalLaunchFailure).toHaveBeenCalledWith(
      job.requestPayload.launchId,
      job.requestedByUserId,
      expect.stringContaining("protocolo"),
      job.id
    );
    expect(mocks.persistStatusItems).not.toHaveBeenCalled();
    expect(mocks.completeMaintenanceOrderFluigOpenJob).not.toHaveBeenCalled();
    expect(mocks.completeOperationalLaunchJob).not.toHaveBeenCalled();
  });

  it("preserva o fluxo de sucesso quando o protocolo foi retornado", async () => {
    const resultPayload = {
      data: {
        generatedRequestId: " 12345 ",
      },
    };

    const response = await POST(resultRequest(resultPayload), context);

    expect(response.status).toBe(200);
    expect(mocks.persistStatusItems).toHaveBeenCalledWith(
      job.module,
      expect.arrayContaining([
        expect.objectContaining({
          numeroFluig: "12345",
          statusProcesso: "aberto",
        }),
      ])
    );
    expect(mocks.completeMaintenanceOrderFluigOpenJob).toHaveBeenCalledWith({
      job,
      generatedRequestId: "12345",
      resultPayload,
    });
    expect(mocks.completeOperationalLaunchJob).toHaveBeenCalledWith({
      job,
      generatedRequestId: "12345",
      resultPayload,
    });
    expect(mocks.completeFluigJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: job.id,
        agentId: agent.id,
        status: "success",
        errorMessage: undefined,
      })
    );
    expect(mocks.recordMaintenanceOrderFluigJobFailure).not.toHaveBeenCalled();
    expect(mocks.markOperationalLaunchFailure).not.toHaveBeenCalled();
  });

  it("persiste a Central de Tarefas, limpa participacoes antigas e grava os totais oficiais", async () => {
    const incrementalJob = {
      ...job,
      module: "fornecedores",
      operation: "sync_user_incremental_batch",
      requestPayload: {
        batches: [
          {
            module: "pagamentos",
            operation: "sync_user_open_tasks",
            syncType: "open_tasks",
            requestIds: [],
          },
          {
            module: "pagamentos",
            operation: "sync_user_open_requests",
            syncType: "my_requests",
            requestIds: [],
          },
        ],
      },
    };
    mocks.readJobForAgent.mockResolvedValue(incrementalJob);
    const resultPayload = {
      data: {
        directTaskCentral: true,
        syncStartedAt: "2026-07-14T15:00:00.000Z",
        currentFluigUser: {
          id: "132",
          code: "00130",
          login: "administrativo.dvaatacados.com.br.1",
          email: "administrativo@dvaatacados.com.br",
        },
        membership: {
          global: { openTasks: 45, myRequests: 600 },
          modules: [{ module: "pagamentos", openTasks: 32, myRequests: 567 }],
        },
        items: [
          {
            numeroFluig: "1160447",
            moduleSlug: "pagamentos",
            statusProcesso: "em_andamento",
            active: true,
            syncFluigUserId: "00130",
            syncTypes: ["open_tasks", "my_requests"],
          },
        ],
      },
    };

    const response = await POST(resultRequest(resultPayload), context);

    expect(response.status).toBe(200);
    expect(mocks.recordDetectedFluigUserId).toHaveBeenCalledWith({
      userId: incrementalJob.requestedByUserId,
      fluigUserId: "00130",
      fluigUsername: "administrativo.dvaatacados.com.br.1",
      fluigEmail: "administrativo@dvaatacados.com.br",
      legacyFluigUserIds: ["132"],
    });
    expect(mocks.persistStatusItems).toHaveBeenCalledWith(
      "pagamentos",
      expect.arrayContaining([expect.objectContaining({ numeroFluig: "1160447" })]),
      expect.objectContaining({
        ownerUserId: incrementalJob.requestedByUserId,
        syncSource: "fluig_task_central",
        fluigUserId: "00130",
      })
    );
    expect(mocks.clearStaleFluigUserTaskMemberships).toHaveBeenCalledWith({
      fluigUserId: "00130",
      syncStartedAt: "2026-07-14T15:00:00.000Z",
    });
    expect(mocks.completeFluigUserSyncStateForJob).toHaveBeenCalledWith(
      expect.objectContaining({
        job: incrementalJob,
        module: "pagamentos",
        syncType: "open_tasks",
        fluigUserId: "00130",
        metadata: expect.objectContaining({ requestCount: 32, globalTotal: 45 }),
      })
    );
    expect(mocks.completeFluigUserSyncStateForJob).toHaveBeenCalledWith(
      expect.objectContaining({
        job: incrementalJob,
        module: "pagamentos",
        syncType: "my_requests",
        fluigUserId: "00130",
        metadata: expect.objectContaining({ requestCount: 567, globalTotal: 600 }),
      })
    );
  });

  it("finaliza o job como erro quando o Fluig responde mas a gravacao no ADM falha", async () => {
    const incrementalJob = {
      ...job,
      module: "fornecedores",
      operation: "sync_user_incremental_batch",
      requestPayload: {
        batches: [
          {
            module: "pagamentos",
            operation: "sync_user_open_tasks",
            syncType: "open_tasks",
            requestIds: [],
          },
        ],
      },
    };
    mocks.readJobForAgent.mockResolvedValue(incrementalJob);
    mocks.persistStatusItems.mockResolvedValue({
      configured: true,
      saved: {},
      errors: ['null value in column "currency" violates not-null constraint'],
    });

    const response = await POST(
      resultRequest({
        data: {
          directTaskCentral: true,
          syncStartedAt: "2026-07-22T21:00:00.000Z",
          currentFluigUser: {
            code: "00130",
            login: "administrativo.dvaatacados.com.br.1",
            email: "administrativo@dvaatacados.com.br",
          },
          items: [
            {
              numeroFluig: "1160447",
              moduleSlug: "pagamentos",
              statusProcesso: "em_andamento",
              active: true,
              syncFluigUserId: "00130",
              syncTypes: ["open_tasks"],
            },
          ],
        },
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        success: true,
        persistence: expect.objectContaining({ errors: expect.any(Array) }),
      })
    );
    expect(mocks.clearStaleFluigUserTaskMemberships).not.toHaveBeenCalled();
    expect(mocks.completeFluigJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: incrementalJob.id,
        status: "error",
        errorMessage: expect.stringContaining("currency"),
      })
    );
    expect(mocks.completeFluigUserSyncStateForJob).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorMessage: expect.stringContaining("currency"),
      })
    );
  });
});
