import { describe, expect, it } from "vitest";
import type { FluigAdmJobSummary, FluigUserSyncStateRecord } from "@/lib/fluig-api";
import {
  findCorrelatedFluigJob,
  fluigSyncStateJobId,
  normalizeFluigJobState,
  projectFluigJobState,
} from "@/lib/fluig-job-state";

function job(overrides: Partial<FluigAdmJobSummary> = {}): FluigAdmJobSummary {
  return {
    id: "job-default",
    module: "pagamentos",
    operation: "sync_status",
    status: "queued",
    progressStage: null,
    progressLabel: null,
    attempts: 0,
    maxAttempts: 3,
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z",
    finishedAt: null,
    expiresAt: "2026-07-12T12:00:00.000Z",
    nextAttemptAt: null,
    lastAttemptAt: null,
    ...overrides,
  };
}

function syncState(overrides: Partial<FluigUserSyncStateRecord> = {}): FluigUserSyncStateRecord {
  return {
    id: "sync-default",
    userId: "user-1",
    fluigUsername: "usuario@empresa.com.br",
    fluigUserId: "132",
    module: "pagamentos",
    syncType: "status_check",
    lastSyncAt: "2026-07-12T10:00:00.000Z",
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    cursor: {},
    metadata: {},
    status: "started",
    createdAt: "2026-07-12T09:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z",
    ...overrides,
  };
}

describe("Fluig job state projection", () => {
  it.each([
    ["queued", null, "queued"],
    ["queued", "2026-07-12T10:05:00.000Z", "retry_wait"],
    ["retry_wait", null, "retry_wait"],
    ["agent_claimed", null, "running"],
    ["reading_page", null, "running"],
    ["success", null, "succeeded"],
    ["error", null, "failed"],
    ["cancelled", null, "cancelled"],
    ["expired", null, "expired"],
  ])("normaliza %s como %s", (status, nextAttemptAt, expected) => {
    expect(normalizeFluigJobState(status, nextAttemptAt)).toBe(expected);
  });

  it("correlaciona o job terminal exclusivamente por metadata.jobId", () => {
    const olderCorrelated = job({ id: "job-correlated", status: "success", updatedAt: "2026-07-12T10:00:00.000Z" });
    const newerUnrelated = job({ id: "job-unrelated", status: "error", updatedAt: "2026-07-12T11:00:00.000Z" });
    const state = syncState({ metadata: { jobId: "job-correlated" } });

    expect(fluigSyncStateJobId(state)).toBe("job-correlated");
    expect(findCorrelatedFluigJob([newerUnrelated, olderCorrelated], state)).toBe(olderCorrelated);
    expect(projectFluigJobState({ jobs: [newerUnrelated, olderCorrelated], syncState: state })).toMatchObject({
      state: "succeeded",
      job: { id: "job-correlated" },
    });
  });

  it("prioriza job ativo sobre job terminal correlacionado", () => {
    const projection = projectFluigJobState({
      jobs: [
        job({ id: "job-terminal", status: "success", finishedAt: "2026-07-12T10:00:00.000Z" }),
        job({ id: "job-active", status: "opening_fluig", progressLabel: "Abrindo o Fluig" }),
      ],
      syncState: syncState({ metadata: { jobId: "job-terminal" }, lastSuccessAt: "2026-07-12T10:00:00.000Z" }),
    });

    expect(projection).toMatchObject({
      state: "running",
      source: "job",
      busy: true,
      terminal: false,
      label: "Abrindo o Fluig",
      progressLabel: "Abrindo o Fluig",
      job: { id: "job-active" },
    });
  });

  it("nao usa outro job terminal quando metadata.jobId nao foi encontrado", () => {
    const state = syncState({
      status: "success",
      metadata: { jobId: "job-ausente" },
      lastSuccessAt: "2026-07-12T10:00:00.000Z",
    });
    const projection = projectFluigJobState({
      jobs: [job({ id: "job-nao-relacionado", status: "error" })],
      syncState: state,
    });

    expect(projection).toMatchObject({
      state: "succeeded",
      source: "sync_state",
      job: null,
      syncState: { id: "sync-default" },
    });
  });

  it("nunca converte sync state sem lastSuccessAt em sucesso", () => {
    expect(projectFluigJobState({ syncState: syncState() })).toMatchObject({
      state: "queued",
      source: "sync_state",
      terminal: false,
      busy: true,
      lastSuccessAt: null,
    });
  });

  it("usa o evento mais recente entre sucesso e erro do sync state", () => {
    const failed = projectFluigJobState({
      syncState: syncState({
        status: "error",
        lastSuccessAt: "2026-07-12T10:00:00.000Z",
        lastErrorAt: "2026-07-12T11:00:00.000Z",
        lastErrorMessage: "Falha ao consultar o Fluig",
      }),
    });
    const recovered = projectFluigJobState({
      syncState: syncState({
        status: "success",
        lastSuccessAt: "2026-07-12T12:00:00.000Z",
        lastErrorAt: "2026-07-12T11:00:00.000Z",
        lastErrorMessage: "Erro anterior",
      }),
    });

    expect(failed).toMatchObject({ state: "failed", errorMessage: "Falha ao consultar o Fluig" });
    expect(recovered).toMatchObject({ state: "succeeded", errorMessage: null });
  });

  it("prioriza uma nova execucao iniciada sobre erro antigo", () => {
    const projection = projectFluigJobState({
      syncState: syncState({
        status: "started",
        lastSyncAt: "2026-07-12T12:00:00.000Z",
        lastErrorAt: "2026-07-12T11:00:00.000Z",
        lastErrorMessage: null,
      }),
    });

    expect(projection).toMatchObject({ state: "queued", busy: true, errorMessage: null });
  });

  it("preserva timestamps e labels do job sem fabricar datas", () => {
    const projection = projectFluigJobState({
      jobs: [
        job({
          status: "queued",
          progressLabel: "Aguardando nova tentativa",
          createdAt: "2026-07-12T09:00:00.000Z",
          updatedAt: "2026-07-12T10:00:00.000Z",
          finishedAt: null,
          expiresAt: "2026-07-12T15:00:00.000Z",
          nextAttemptAt: "2026-07-12T10:05:00.000Z",
          lastAttemptAt: "2026-07-12T09:55:00.000Z",
        }),
      ],
    });

    expect(projection).toMatchObject({
      state: "retry_wait",
      label: "Aguardando nova tentativa",
      createdAt: "2026-07-12T09:00:00.000Z",
      updatedAt: "2026-07-12T10:00:00.000Z",
      finishedAt: null,
      expiresAt: "2026-07-12T15:00:00.000Z",
      nextAttemptAt: "2026-07-12T10:05:00.000Z",
      lastAttemptAt: "2026-07-12T09:55:00.000Z",
    });
  });

  it("retorna idle sem fonte quando nao ha job nem sync state", () => {
    expect(projectFluigJobState()).toEqual(expect.objectContaining({
      state: "idle",
      source: "none",
      job: null,
      syncState: null,
    }));
  });
});
