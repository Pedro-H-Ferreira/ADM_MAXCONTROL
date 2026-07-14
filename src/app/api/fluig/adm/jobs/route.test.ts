import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canActorAccessPage: vi.fn(),
  canActorPerformPageAction: vi.fn(),
  createFluigJob: vi.fn(),
  listJobsForActor: vi.fn(),
  resolveCurrentAppUser: vi.fn(),
}));

vi.mock("@/lib/db/app-repository", () => ({
  canActorAccessPage: mocks.canActorAccessPage,
  canActorPerformPageAction: mocks.canActorPerformPageAction,
  createFluigJob: mocks.createFluigJob,
  listJobsForActor: mocks.listJobsForActor,
  resolveCurrentAppUser: mocks.resolveCurrentAppUser,
}));

import {
  GENERIC_JOBS_CANCEL_ERROR,
  GENERIC_JOBS_MAINTENANCE_CONFIRM_ERROR,
  GENERIC_JOBS_OPEN_ERROR,
  GENERIC_JOBS_RESTRICTED_ERROR,
  POST,
} from "@/app/api/fluig/adm/jobs/route";

function request(operation?: unknown) {
  return new Request("http://localhost/api/fluig/adm/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ module: "pagamentos", ...(operation === undefined ? {} : { operation }) }),
  });
}

function maintenanceRequest(payload: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/fluig/adm/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ module: "manutencao", operation: "open_from_source", payload }),
  });
}

describe("POST /api/fluig/adm/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentAppUser.mockResolvedValue({ id: "user-1" });
    mocks.createFluigJob.mockResolvedValue({ id: "job-1" });
    mocks.canActorAccessPage.mockReturnValue(true);
    mocks.canActorPerformPageAction.mockReturnValue(true);
  });

  it("rejeita open_from_source antes de criar o job", async () => {
    const response = await POST(request("open_from_source"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: GENERIC_JOBS_OPEN_ERROR });
    expect(mocks.createFluigJob).not.toHaveBeenCalled();
  });

  it("rejeita cancel_request antes de criar o job", async () => {
    const response = await POST(request("cancel_request"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: GENERIC_JOBS_CANCEL_ERROR });
    expect(mocks.createFluigJob).not.toHaveBeenCalled();
  });

  it("preserva abertura Fluig de Manutencao confirmada e autorizada", async () => {
    const response = await POST(maintenanceRequest({ confirm: true, sourceRequestId: "123" }));

    expect(response.status).toBe(200);
    expect(mocks.createFluigJob).toHaveBeenCalledWith(
      expect.objectContaining({ module: "manutencao", operation: "open_from_source", reuseActive: false })
    );
  });

  it("exige confirmacao e permissao para abertura Fluig de Manutencao", async () => {
    const missingConfirmation = await POST(maintenanceRequest());
    expect(missingConfirmation.status).toBe(400);
    expect(await missingConfirmation.json()).toEqual({
      success: false,
      error: GENERIC_JOBS_MAINTENANCE_CONFIRM_ERROR,
    });

    mocks.canActorPerformPageAction.mockReturnValue(false);
    const forbidden = await POST(maintenanceRequest({ confirm: true }));
    expect(forbidden.status).toBe(403);
    expect(mocks.createFluigJob).not.toHaveBeenCalled();
  });

  it.each(["sync_history", "sync_status"])("rejeita a operacao produtiva %s", async (operation) => {
    const response = await POST(request(operation));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: `Operacao Fluig "${operation}" nao permitida. ${GENERIC_JOBS_RESTRICTED_ERROR}`,
    });
    expect(mocks.createFluigJob).not.toHaveBeenCalled();
  });

  it("rejeita operacao desconhecida antes de criar o job", async () => {
    const response = await POST(request("delete_everything"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: `Operacao Fluig "delete_everything" nao permitida. ${GENERIC_JOBS_RESTRICTED_ERROR}`,
    });
    expect(mocks.createFluigJob).not.toHaveBeenCalled();
  });

  it("rejeita requisicao sem operacao em vez de assumir sync_history", async () => {
    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: `Operacao Fluig nao informada nao permitida. ${GENERIC_JOBS_RESTRICTED_ERROR}`,
    });
    expect(mocks.createFluigJob).not.toHaveBeenCalled();
  });

  it("preserva a criacao do health_check usado pelo teste de conexao", async () => {
    const response = await POST(request("health_check"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, job: { id: "job-1" } });
    expect(mocks.createFluigJob).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "health_check", module: "pagamentos", reuseActive: false })
    );
  });
});
