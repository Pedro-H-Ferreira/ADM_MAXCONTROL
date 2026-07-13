import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCurrentAppUser: vi.fn(),
  syncProductsFromFluigHistory: vi.fn(),
}));

vi.mock("@/lib/db/app-repository", () => ({
  resolveCurrentAppUser: mocks.resolveCurrentAppUser,
}));

vi.mock("@/lib/db/products-repository", () => ({
  syncProductsFromFluigHistory: mocks.syncProductsFromFluigHistory,
}));

import { POST } from "@/app/api/produtos/sync-historico/route";

describe("POST /api/produtos/sync-historico", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bloqueia usuario comum antes de iniciar o lote", async () => {
    mocks.resolveCurrentAppUser.mockResolvedValue({ id: "user-1", isAdmin: false });

    const response = await POST();

    expect(response.status).toBe(403);
    expect(mocks.syncProductsFromFluigHistory).not.toHaveBeenCalled();
  });

  it("executa o lote para administrador", async () => {
    const actor = { id: "admin-1", isAdmin: true };
    mocks.resolveCurrentAppUser.mockResolvedValue(actor);
    mocks.syncProductsFromFluigHistory.mockResolvedValue({ requestsScanned: 427, occurrences: 596 });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.syncProductsFromFluigHistory).toHaveBeenCalledWith(actor);
  });
});
