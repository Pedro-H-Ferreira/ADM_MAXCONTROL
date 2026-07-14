import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fluig-api", () => ({
  fluigAdmApi: {
    getJob: vi.fn(),
    listJobs: vi.fn(),
  },
}));

import { fluigAdmApi } from "@/lib/fluig-api";
import { fluigPollDelayMs, waitForFluigJob } from "@/lib/use-fluig-job-state";

function response(status: string) {
  return {
    success: true as const,
    job: {
      id: "job-1",
      module: "pagamentos" as const,
      operation: "sync_status" as const,
      status,
      progressStage: null,
      progressLabel: null,
      attempts: 0,
      maxAttempts: 3,
      nextAttemptAt: null,
      lastAttemptAt: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: status === "success" ? new Date().toISOString() : null,
    },
    events: [],
  };
}

describe("Fluig job polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aplica backoff progressivo limitado a 15 segundos", () => {
    expect([0, 1, 2, 3, 8].map((attempt) => fluigPollDelayMs(attempt))).toEqual([
      2_000,
      5_000,
      10_000,
      15_000,
      15_000,
    ]);
  });

  it("deduplica dois consumidores do mesmo job", async () => {
    vi.mocked(fluigAdmApi.getJob)
      .mockResolvedValueOnce(response("queued"))
      .mockResolvedValueOnce(response("success"));

    const first = waitForFluigJob("job-1", { backoffMs: [100] });
    const second = waitForFluigJob("job-1", { backoffMs: [100] });
    await Promise.resolve();
    await Promise.resolve();
    expect(fluigAdmApi.getJob).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.job.status).toBe("success");
    expect(secondResult.job.status).toBe("success");
    expect(fluigAdmApi.getJob).toHaveBeenCalledTimes(2);
  });

  it("nao consulta enquanto a aba esta oculta", async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const visibilityTarget = new EventTarget() as EventTarget & { visibilityState: string };
    let visibilityState = "hidden";
    Object.defineProperty(visibilityTarget, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: visibilityTarget,
    });
    vi.mocked(fluigAdmApi.getJob).mockResolvedValue(response("success"));

    try {
      const pending = waitForFluigJob("job-hidden");
      await Promise.resolve();
      expect(fluigAdmApi.getJob).not.toHaveBeenCalled();

      visibilityState = "visible";
      visibilityTarget.dispatchEvent(new Event("visibilitychange"));
      await pending;
      expect(fluigAdmApi.getJob).toHaveBeenCalledTimes(1);
    } finally {
      if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });

  it("respeita cancelamento antes de iniciar", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(waitForFluigJob("job-cancelled", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fluigAdmApi.getJob).not.toHaveBeenCalled();
  });
});
