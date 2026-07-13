import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFluigJob: vi.fn(),
  listJobsForActor: vi.fn(),
  resolveCurrentAppUser: vi.fn(),
}));

vi.mock("@/lib/db/app-repository", () => ({
  createFluigJob: mocks.createFluigJob,
  listJobsForActor: mocks.listJobsForActor,
  resolveCurrentAppUser: mocks.resolveCurrentAppUser,
}));

import { GENERIC_JOBS_OPEN_ERROR, POST } from "@/app/api/fluig/adm/jobs/route";

function request(operation: string) {
  return new Request("http://localhost/api/fluig/adm/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ module: "pagamentos", operation }),
  });
}

describe("POST /api/fluig/adm/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentAppUser.mockResolvedValue({ id: "user-1" });
    mocks.createFluigJob.mockResolvedValue({ id: "job-1" });
  });

  it("rejeita open_from_source antes de criar o job", async () => {
    const response = await POST(request("open_from_source"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: GENERIC_JOBS_OPEN_ERROR });
    expect(mocks.createFluigJob).not.toHaveBeenCalled();
  });

  it("preserva a criacao das demais operacoes", async () => {
    const response = await POST(request("sync_status"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, job: { id: "job-1" } });
    expect(mocks.createFluigJob).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "sync_status", module: "pagamentos" })
    );
  });
});
