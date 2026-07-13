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
});
