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

import { GET } from "@/app/api/fluig/adm/requests/my-open/route";

describe("GET /api/fluig/adm/requests/my-open", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFluigUserSyncState.mockResolvedValue([]);
    mocks.listFluigTaskDashboardFilters.mockResolvedValue({ isAdmin: true, users: [] });
    mocks.readKnownOpenFluigRequestsForActor.mockResolvedValue({
      total: 3634,
      requests: [],
      persistence: { configured: true, saved: {}, errors: [] },
    });
  });

  it("usa todas as solicitacoes por padrao para administrador", async () => {
    mocks.resolveCurrentAppUser.mockResolvedValue({ id: "admin-1", isAdmin: true });

    const response = await GET(new Request(
      "http://localhost/api/fluig/adm/requests/my-open?module=pagamentos"
    ));

    expect(response.status).toBe(200);
    expect(mocks.readKnownOpenFluigRequestsForActor).toHaveBeenCalledWith(expect.objectContaining({
      scope: "all",
      userId: null,
      membershipType: "my_request",
    }));
    expect(await response.json()).toMatchObject({ scope: "all", total: 3634 });
  });

  it("forca solicitacoes proprias para usuario comum", async () => {
    mocks.resolveCurrentAppUser.mockResolvedValue({ id: "user-1", isAdmin: false });

    const response = await GET(new Request(
      "http://localhost/api/fluig/adm/requests/my-open?scope=all&module=pagamentos"
    ));

    expect(response.status).toBe(200);
    expect(mocks.readKnownOpenFluigRequestsForActor).toHaveBeenCalledWith(expect.objectContaining({
      scope: "self",
      userId: null,
    }));
    expect((await response.json()).scope).toBe("self");
  });
});
