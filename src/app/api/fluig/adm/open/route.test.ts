import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordFluigOperationRun: vi.fn(),
  resolveCurrentAppUser: vi.fn(),
}));

vi.mock("@/lib/db/app-repository", () => ({
  resolveCurrentAppUser: mocks.resolveCurrentAppUser,
}));

vi.mock("@/lib/db/fluig-repository", () => ({
  recordFluigOperationRun: mocks.recordFluigOperationRun,
}));

vi.mock("@/lib/fluig/server-client", () => ({
  getFluigRuntimeConfig: () => ({ configured: true, mode: "test" }),
}));

import { OPEN_PREVIEW_ONLY_ERROR, POST } from "@/app/api/fluig/adm/open/route";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/fluig/adm/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fluig/adm/open", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentAppUser.mockResolvedValue({ id: "user-1" });
    mocks.recordFluigOperationRun.mockResolvedValue({ recorded: true });
  });

  it("rejeita confirm=true sem registrar ou executar a abertura", async () => {
    const response = await POST(request({ module: "pagamentos", confirm: true }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: OPEN_PREVIEW_ONLY_ERROR });
    expect(OPEN_PREVIEW_ONLY_ERROR).not.toContain("confirm=true");
    expect(mocks.recordFluigOperationRun).not.toHaveBeenCalled();
  });

  it("gera somente preview e registra a auditoria como dry_run", async () => {
    const response = await POST(request({ module: "pagamentos", sourceRequestId: "12345" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      dryRun: {
        module: "pagamentos",
        sourceRequestId: "12345",
        previewOnly: true,
      },
    });
    expect(payload.dryRun).not.toHaveProperty("requiredConfirmation");
    expect(mocks.recordFluigOperationRun).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "open", status: "dry_run" })
    );
  });
});
