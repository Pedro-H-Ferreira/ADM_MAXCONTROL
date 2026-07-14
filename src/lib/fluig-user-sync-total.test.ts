import { describe, expect, it } from "vitest";
import { resolveFluigUserSyncTotal } from "@/lib/fluig-user-sync-total";
import type { FluigUserSyncStateRecord } from "@/lib/fluig-api";

function state(overrides: Partial<FluigUserSyncStateRecord>): FluigUserSyncStateRecord {
  return {
    id: "state-1",
    userId: "user-1",
    fluigUsername: null,
    fluigUserId: "00130",
    module: "pagamentos",
    syncType: "open_tasks",
    lastSyncAt: "2026-07-14T15:00:00.000Z",
    lastSuccessAt: "2026-07-14T15:00:00.000Z",
    lastErrorAt: null,
    lastErrorMessage: null,
    cursor: {},
    metadata: {},
    status: "success",
    createdAt: "2026-07-14T15:00:00.000Z",
    updatedAt: "2026-07-14T15:00:00.000Z",
    ...overrides,
  };
}

describe("resolveFluigUserSyncTotal", () => {
  it("usa o total global mais recente retornado pela Central de Tarefas", () => {
    expect(
      resolveFluigUserSyncTotal(
        [
          state({ metadata: { globalTotal: 44 }, updatedAt: "2026-07-14T14:00:00.000Z" }),
          state({ metadata: { globalTotal: 45 }, updatedAt: "2026-07-14T15:00:00.000Z" }),
        ],
        "open_tasks",
        20
      )
    ).toBe(45);
  });

  it("mantem a contagem persistida quando ainda nao existe total oficial", () => {
    expect(resolveFluigUserSyncTotal([state({ metadata: { requestCount: 80 } })], "open_tasks", 20)).toBe(20);
  });

  it("usa a contagem do modulo quando a rota esta filtrada", () => {
    expect(
      resolveFluigUserSyncTotal(
        [state({ metadata: { globalTotal: 45, requestCount: 12 } })],
        "open_tasks",
        10,
        { moduleScoped: true }
      )
    ).toBe(12);
  });
});
