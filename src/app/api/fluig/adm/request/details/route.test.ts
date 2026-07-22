import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCurrentAppUser: vi.fn(),
  readFluigRequestByNumberForActor: vi.fn(),
  readFluigCredentials: vi.fn(),
  queryFluigRequestDetails: vi.fn(),
}));

vi.mock("@/lib/auth-response", () => ({ appAuthErrorResponse: vi.fn(() => null) }));
vi.mock("@/lib/db/app-repository", () => ({ resolveCurrentAppUser: mocks.resolveCurrentAppUser }));
vi.mock("@/lib/db/fluig-repository", () => ({ readFluigRequestByNumberForActor: mocks.readFluigRequestByNumberForActor }));
vi.mock("@/lib/fluig/credentials", () => ({ readFluigCredentials: mocks.readFluigCredentials }));
vi.mock("@/lib/fluig/server-client", () => ({ queryFluigRequestDetails: mocks.queryFluigRequestDetails }));

import { GET } from "@/app/api/fluig/adm/request/details/route";

describe("GET /api/fluig/adm/request/details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentAppUser.mockResolvedValue({ id: "user-1", fluigUserId: "00130" });
    mocks.readFluigRequestByNumberForActor.mockResolvedValue({ request: { fluigRequestId: "1160475" } });
    mocks.readFluigCredentials.mockResolvedValue({ username: "usuario", password: "senha" });
    mocks.queryFluigRequestDetails.mockResolvedValue({
      data: { requestId: "1160475", formFields: { nNotaFiscal: "3737" }, attachments: [], history: [] },
    });
  });

  it("valida a visibilidade antes de consultar o Fluig com a credencial do usuario", async () => {
    const response = await GET(new Request("http://localhost/api/fluig/adm/request/details?module=pagamentos&fluigRequestId=1160475"));

    expect(response.status).toBe(200);
    expect(mocks.readFluigRequestByNumberForActor).toHaveBeenCalledWith(expect.objectContaining({ fluigRequestId: "1160475", module: "pagamentos" }));
    expect(mocks.queryFluigRequestDetails).toHaveBeenCalledWith(expect.objectContaining({ requestId: "1160475", taskUserId: "00130" }));
  });

  it("nao consulta o Fluig quando a solicitacao nao pertence ao escopo do usuario", async () => {
    mocks.readFluigRequestByNumberForActor.mockResolvedValue({ request: null });
    const response = await GET(new Request("http://localhost/api/fluig/adm/request/details?module=pagamentos&fluigRequestId=1160475"));

    expect(response.status).toBe(404);
    expect(mocks.queryFluigRequestDetails).not.toHaveBeenCalled();
  });
});
