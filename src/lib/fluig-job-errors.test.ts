import { describe, expect, it } from "vitest";
import { actionableRecentFluigJobFailures } from "@/lib/fluig-job-errors";

const now = Date.parse("2026-07-14T21:00:00.000Z");

function job(status: string, updatedAt: string, overrides: Partial<{ module: string; operation: string }> = {}) {
  return {
    module: "fornecedores",
    operation: "sync_user_incremental_batch",
    status,
    updatedAt,
    finishedAt: updatedAt,
    ...overrides,
  };
}

describe("actionableRecentFluigJobFailures", () => {
  it("oculta uma falha ja resolvida por sucesso posterior equivalente", () => {
    expect(
      actionableRecentFluigJobFailures(
        [
          job("error", "2026-07-14T20:26:27.000Z"),
          job("success", "2026-07-14T20:31:20.000Z"),
        ],
        { now }
      )
    ).toEqual([]);
  });

  it("mantem falha recente sem sucesso posterior no mesmo fluxo", () => {
    const failure = job("error", "2026-07-14T20:26:27.000Z");
    expect(
      actionableRecentFluigJobFailures(
        [failure, job("success", "2026-07-14T20:31:20.000Z", { operation: "health_check" })],
        { now }
      )
    ).toEqual([failure]);
  });
});
