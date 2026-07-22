import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCurrentAppUser: vi.fn(),
  listFluigUserSyncState: vi.fn(),
  readKnownOpenFluigRequestsForActor: vi.fn(),
  listFluigTaskDashboardFilters: vi.fn(),
}));

vi.mock("@/lib/auth-response", () => ({ appAuthErrorResponse: vi.fn(() => null) }));
vi.mock("@/lib/db/app-repository", () => ({
  resolveCurrentAppUser: mocks.resolveCurrentAppUser,
  listFluigUserSyncState: mocks.listFluigUserSyncState,
}));
vi.mock("@/lib/db/fluig-repository", () => ({
  readKnownOpenFluigRequestsForActor: mocks.readKnownOpenFluigRequestsForActor,
  listFluigTaskDashboardFilters: mocks.listFluigTaskDashboardFilters,
}));

import { GET } from "@/app/api/fluig/adm/tasks/my/route";

const filters = {
  isAdmin: true,
  users: [{
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Administrativo AGC",
    email: "administrativo.agc@atacadaodiaadia.com.br",
    role: "ADMINISTRATIVO",
    fluigUsername: "administrativo.agc@atacadaodiaadia.com.br",
    fluigUserId: "00991",
    credentialConfigured: true,
    taskSyncCompleted: true,
  }],
  natures: [{ value: "5030101 - MANUTENCAO", label: "5030101 - MANUTENCAO" }],
  coverage: { totalUsers: 1, configuredUsers: 1, syncedUsers: 1 },
  persistence: { configured: true, saved: {}, errors: [] },
};

describe("GET /api/fluig/adm/tasks/my", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFluigUserSyncState.mockResolvedValue([]);
    mocks.listFluigTaskDashboardFilters.mockResolvedValue(filters);
    mocks.readKnownOpenFluigRequestsForActor.mockResolvedValue({
      total: 27,
      requests: [{
        id: "request-1",
        fluigRequestId: "1200001",
        assignedFluigUserId: "00991",
        taskOwner: "Administrativo AGC",
      }],
      persistence: { configured: true, saved: {}, errors: [] },
    });
  });

  it("consolida todos os usuarios somente para administrador e aplica natureza", async () => {
    mocks.resolveCurrentAppUser.mockResolvedValue({ id: "admin-1", isAdmin: true });
    const userId = "11111111-1111-4111-8111-111111111111";
    const response = await GET(new Request(
      `http://localhost/api/fluig/adm/tasks/my?scope=all&userId=${userId}&module=pagamentos&nature=${encodeURIComponent("5030101 - MANUTENCAO")}`
    ));

    expect(response.status).toBe(200);
    expect(mocks.readKnownOpenFluigRequestsForActor).toHaveBeenCalledWith(expect.objectContaining({
      scope: "all",
      userId,
      module: "pagamentos",
      nature: "5030101 - MANUTENCAO",
      membershipType: "open_task",
    }));
    expect(await response.json()).toMatchObject({
      scope: "all",
      total: 27,
      tasks: [{ assignedUserName: "Administrativo AGC" }],
    });
  });

  it("forca escopo proprio quando usuario comum tenta pedir todos", async () => {
    mocks.resolveCurrentAppUser.mockResolvedValue({ id: "user-1", isAdmin: false });
    const response = await GET(new Request(
      "http://localhost/api/fluig/adm/tasks/my?scope=all&userId=11111111-1111-4111-8111-111111111111"
    ));

    expect(response.status).toBe(200);
    expect(mocks.readKnownOpenFluigRequestsForActor).toHaveBeenCalledWith(expect.objectContaining({
      scope: "self",
      userId: null,
    }));
    expect((await response.json()).scope).toBe("self");
  });
});
