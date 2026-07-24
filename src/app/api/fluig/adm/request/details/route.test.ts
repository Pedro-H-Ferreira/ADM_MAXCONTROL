import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCurrentAppUser: vi.fn(),
  readFluigRequestByNumberForActor: vi.fn(),
}));

vi.mock("@/lib/auth-response", () => ({ appAuthErrorResponse: vi.fn(() => null) }));
vi.mock("@/lib/db/app-repository", () => ({ resolveCurrentAppUser: mocks.resolveCurrentAppUser }));
vi.mock("@/lib/db/fluig-repository", () => ({ readFluigRequestByNumberForActor: mocks.readFluigRequestByNumberForActor }));

import { GET } from "@/app/api/fluig/adm/request/details/route";

describe("GET /api/fluig/adm/request/details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentAppUser.mockResolvedValue({ id: "user-1", fluigUserId: "00130" });
    mocks.readFluigRequestByNumberForActor.mockResolvedValue({
      request: {
        fluigRequestId: "1160475",
        sourceUrl: "https://fluig.example/request",
        lastSyncedAt: "2026-07-22T10:00:00.000Z",
        detailSyncedAt: "2026-07-22T10:00:00.000Z",
        fieldValues: { nNotaFiscal: "3737" },
        detailSnapshot: { requestId: "1160475", formFields: { nNotaFiscal: "3737" }, attachments: [], history: [] },
      },
    });
  });

  it("valida a visibilidade e devolve o snapshot do banco sem consultar o Fluig", async () => {
    const response = await GET(new Request("http://localhost/api/fluig/adm/request/details?module=pagamentos&fluigRequestId=1160475"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.readFluigRequestByNumberForActor).toHaveBeenCalledWith(expect.objectContaining({ fluigRequestId: "1160475", module: "pagamentos" }));
    expect(body.source).toBe("database");
    expect(body.details.formFields.nNotaFiscal).toBe("3737");
  });

  it("nao devolve dados quando a solicitacao nao pertence ao escopo do usuario", async () => {
    mocks.readFluigRequestByNumberForActor.mockResolvedValue({ request: null });
    const response = await GET(new Request("http://localhost/api/fluig/adm/request/details?module=pagamentos&fluigRequestId=1160475"));

    expect(response.status).toBe(404);
  });
});
