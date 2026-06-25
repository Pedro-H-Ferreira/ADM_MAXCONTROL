import { describe, expect, it } from "vitest";
import {
  defaultFluigJobMaxAttempts,
  evaluateFluigJobLifecycle,
  fluigJobRetryDelayMs,
} from "@/lib/fluig-job-lifecycle";

const now = new Date("2026-06-25T14:00:00.000Z");

describe("Fluig job lifecycle", () => {
  it("expira jobs que ficaram na fila alem do prazo", () => {
    expect(
      evaluateFluigJobLifecycle(
        {
          operation: "sync_user_incremental_batch",
          status: "queued",
          attempts: 0,
          maxAttempts: 3,
          updatedAt: "2026-06-25T12:00:00.000Z",
          expiresAt: "2026-06-25T13:00:00.000Z",
        },
        now
      )
    ).toMatchObject({ action: "expire" });
  });

  it("reagenda leitura interrompida com backoff controlado", () => {
    const decision = evaluateFluigJobLifecycle(
      {
        operation: "sync_user_open_tasks",
        status: "reading_page",
        attempts: 1,
        maxAttempts: 3,
        updatedAt: "2026-06-25T13:30:00.000Z",
        expiresAt: "2026-06-25T15:00:00.000Z",
      },
      now
    );

    expect(decision).toMatchObject({
      action: "retry",
      nextAttemptAt: new Date(now.getTime() + fluigJobRetryDelayMs(1)).toISOString(),
    });
  });

  it("nao repete automaticamente operacoes que podem duplicar lancamentos", () => {
    expect(defaultFluigJobMaxAttempts("open_from_source")).toBe(1);
    expect(defaultFluigJobMaxAttempts("cancel_request")).toBe(1);

    expect(
      evaluateFluigJobLifecycle(
        {
          operation: "open_from_source",
          status: "waiting_protocol",
          attempts: 1,
          maxAttempts: 1,
          updatedAt: "2026-06-25T13:30:00.000Z",
          expiresAt: "2026-06-25T15:00:00.000Z",
        },
        now
      )
    ).toMatchObject({
      action: "expire",
      label: expect.stringContaining("evitar duplicidade"),
    });
  });

  it("mantem execucao com heartbeat recente", () => {
    expect(
      evaluateFluigJobLifecycle(
        {
          operation: "sync_status",
          status: "reading_page",
          attempts: 1,
          maxAttempts: 3,
          updatedAt: "2026-06-25T13:55:00.000Z",
          expiresAt: "2026-06-25T15:00:00.000Z",
        },
        now
      )
    ).toEqual({ action: "keep" });
  });
});
